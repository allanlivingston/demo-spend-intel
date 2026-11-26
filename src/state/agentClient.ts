"use client";
// Starts an agent run on the server and streams its events into the chat.
import type { AgentEvent, AgentId } from "@/agents/types";
import { useStore } from "./store";

export interface StartRun {
  agent: AgentId;
  prompt: string;
  driverId?: string;
  escalate?: boolean;
  /** Show the prompt as a user message (questions typed into the assistant). */
  echo?: boolean;
  /** Show the run where the admin clicked ("verdict" or a driver id). Unset: the assistant drawer. */
  anchor?: string;
  /** What the user bubble says, when the prompt itself is machine-worded. */
  say?: string;
  /** Redraft an earlier run with this change from the admin. */
  revision?: string;
  /** Context for this run instead of the chat's pinned items (a thread under a row knows its row). */
  context?: string[];
}

/** The request the server sees. A run started early and the run the admin clicks send the same body, so the same body
 *  means the same answer. */
function requestOf({ agent, prompt: basePrompt, driverId, escalate, revision, context }: StartRun) {
  const s = useStore.getState();
  const prompt = revision
    ? `${basePrompt}\n\nThe admin reviewed your draft and asked for this change: "${revision}". Redraft to reflect it, and say in one sentence what changed.`
    : basePrompt;
  // Keep each context item short enough for the server, whatever the thread holds.
  const ctx = context?.map((c) => (c.length > 1_200 ? `${c.slice(0, 1_197)}...` : c));
  const body = JSON.stringify({
    agent, prompt, driverId, escalate, offline: s.offline, advanced: s.advanced, model: s.model, demo: s.demo, group: s.group,
    pinned: ctx ?? s.pinned.map((p) => (p.detail ? `${p.label}: ${p.detail}` : p.label)),
  });
  return { body, ctx };
}

const post = (body: string, init: { early?: boolean; signal?: AbortSignal } = {}) =>
  fetch("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-session": useStore.getState().sessionId, ...(init.early ? { "x-early-run": "1" } : {}) },
    body,
    signal: init.signal,
  });

/** Read a server-sent event stream, one event at a time. */
async function readEvents(stream: ReadableStream<Uint8Array>, on: (e: AgentEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) on(JSON.parse(chunk.slice(6)) as AgentEvent);
    }
  }
}

// ---------- Early runs ----------
// The likely next step (the headline button, then the first chip) is a draft: nothing changes until the admin approves
// it. So while they read, it runs in the background. If they click it with nothing changed, the click picks the run up
// where it is (often finished); if anything changes first, or they ask something else, it is stopped and thrown away.
// Live only: Offline replay is instant anyway, and the server refuses early runs past half the daily spend cap.

interface Early { body: string; events: AgentEvent[]; done: boolean; error?: string; listeners: Set<() => void>; abort: AbortController }
let early: Early | null = null;
let earlyRuns = 0;
let earlyOff = false;
/** At most this many early runs per page load, however often the admin changes their mind. */
export const MAX_EARLY_RUNS = 6;

/** What identifies a run for matching an early run to a click: its full request. */
export const runKey = (run: StartRun) => requestOf(run).body;

/** Start `run` in the background, unless that exact run is already going. */
export function startEarlyRun(run: StartRun) {
  if (earlyOff || useStore.getState().offline) return;
  const { body } = requestOf(run);
  if (early?.body === body) return;
  dropEarlyRun();
  if (earlyRuns >= MAX_EARLY_RUNS) return;
  earlyRuns++;
  const e: Early = { body, events: [], done: false, listeners: new Set(), abort: new AbortController() };
  early = e;
  const notify = () => e.listeners.forEach((l) => l());
  (async () => {
    try {
      const res = await post(body, { early: true, signal: e.abort.signal });
      // 204: the server won't run early (no live backend, or the caps). Don't ask again on this page.
      if (res.status === 204) { earlyOff = true; earlyRuns--; throw new Error("skipped"); }
      if (!res.ok || !res.body) throw new Error(friendlyError(res.status));
      await readEvents(res.body, (ev) => { e.events.push(ev); notify(); });
    } catch (err) {
      e.error = err instanceof Error ? err.message : String(err);
    } finally {
      e.done = true;
      if (e.error && early === e) early = null;
      notify();
    }
  })();
}

/** Stop the background run unless it is exactly `run` (the likely next step changed, or the admin did something else). */
export function keepEarlyRun(run: StartRun | null) {
  if (early && (!run || requestOf(run).body !== early.body)) dropEarlyRun();
}

export function dropEarlyRun() {
  early?.abort.abort();
  early = null;
}

/** The background run for this exact request, if one is going or finished cleanly. It can be taken once. */
function takeEarlyRun(body: string): Early | null {
  const e = early;
  // A run that fell back to a recording or failed is no better than a fresh try.
  const spoiled = e?.events.some((ev) => ev.type === "error" || (ev.type === "start" && ev.backend === "replay"));
  if (!e || e.body !== body || e.error || spoiled) { dropEarlyRun(); return null; }
  early = null;
  return e;
}

/** Feed an early run's events, the ones already in and the rest as they arrive, to `on`. */
function follow(e: Early, on: (ev: AgentEvent) => void) {
  return new Promise<void>((resolve, reject) => {
    let i = 0;
    const pump = () => {
      while (i < e.events.length) on(e.events[i++]);
      if (!e.done) return;
      e.listeners.delete(pump);
      if (e.error) reject(new Error(e.error)); else resolve();
    };
    e.listeners.add(pump);
    pump();
  });
}

// ---------- Runs ----------

export async function startAgentRun(run: StartRun) {
  const { agent, prompt: basePrompt, driverId, echo, anchor, revision, say } = run;
  const s = useStore.getState();
  const { body, ctx } = requestOf(run);
  // Work about one spot on the page stays under it as a thread; everything else goes to the chat drawer.
  if (echo || say) s.addMessage({ role: "user", text: say ?? revision ?? basePrompt, anchor });
  // A question about how spend is slowed opens the daily bars, which show it day by day.
  if (/\bhow (is|was) (spend|it) slowed\b|\bslowed (each|per) day\b|\bdaily bars\b/i.test(basePrompt)) s.setDailyOpen(true);
  const runId = s.addMessage({
    role: "assistant", anchor,
    run: { agent, steps: [], status: "running", prompt: basePrompt, driverId, request: revision, anchor, context: ctx, revision },
  });
  const patchRun = (fn: (r: NonNullable<ReturnType<typeof useStore.getState>["messages"][number]["run"]>) => object) =>
    useStore.getState().patchMessage(runId, (m) => ({ ...m, run: m.run ? { ...m.run, ...fn(m.run) } : m.run }));

  const handle = (e: AgentEvent) => {
    const st = useStore.getState();
    switch (e.type) {
      case "start":
        patchRun(() => ({ backend: e.backend, model: e.model, replayReason: e.replayReason }));
        st.noteRun({ backend: e.backend, model: e.model, replayReason: e.replayReason });
        break;
      case "step":
        patchRun((r) => {
          const last = r.steps[r.steps.length - 1];
          if (last && last.tool === e.tool && last.summary === e.summary) return {};
          return { steps: [...r.steps, { phase: e.phase, tool: e.tool, summary: e.summary }] };
        });
        break;
      case "text":
        st.patchMessage(runId, (m) => ({ ...m, text: e.text }));
        break;
      case "artifact":
        st.openArtifact(e.artifact, { anchor, runOf: runId });
        break;
      case "done":
        patchRun(() => ({ status: "done", costUsd: e.costUsd, latencyMs: e.latencyMs }));
        st.addUsage(e.costUsd);
        break;
      case "error":
        patchRun(() => ({ status: "error", error: e.message }));
        break;
    }
  };

  try {
    const joined = takeEarlyRun(body);
    if (joined) await follow(joined, handle);
    else {
      const res = await post(body);
      if (!res.ok || !res.body) throw new Error(friendlyError(res.status));
      await readEvents(res.body, handle);
    }
    const r = useStore.getState().messages.find((m) => m.id === runId)?.run;
    if (r?.status === "running") patchRun(() => ({ status: "done" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    patchRun(() => ({ status: "error", error: /fetch|network/i.test(msg) ? "Couldn't reach the server. Check your connection and try again." : msg }));
  }
}

/** Plain-English errors instead of HTTP codes. */
function friendlyError(status: number): string {
  if (status === 400) return "That request couldn't be sent. Try again.";
  if (status === 429) return "Too many requests right now. Wait a moment and try again.";
  if (status >= 500) return "Claude couldn't finish that. Try again.";
  return `Something went wrong (${status}). Try again.`;
}

/** Re-run a failed run with the same request, in the same place. */
export function retryRun(messageId: string) {
  const s = useStore.getState();
  const run = s.messages.find((m) => m.id === messageId)?.run;
  if (!run) return;
  s.patchMessage(messageId, (m) => ({ ...m, dismissed: true }));
  startAgentRun({ agent: run.agent, prompt: run.prompt, driverId: run.driverId, anchor: run.anchor, context: run.context, revision: run.revision });
}

export const AGENT_LABEL: Record<AgentId, string> = {
  connector: "Claude, on the Jira connector",
  cache: "Claude, on the prompt cache",
  routing: "Claude, on the waste",
  funding: "Claude, on funding",
  chat: "Assistant",
  guide: "Demo guide",
};
