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

export async function startAgentRun({ agent, prompt: basePrompt, driverId, escalate, echo, anchor, revision, context, say }: StartRun) {
  const s = useStore.getState();
  const prompt = revision
    ? `${basePrompt}\n\nThe admin reviewed your draft and asked for this change: "${revision}". Redraft to reflect it, and say in one sentence what changed.`
    : basePrompt;
  // Work about one spot on the page stays under it as a thread; everything else goes to the chat drawer.
  if (echo || say) s.addMessage({ role: "user", text: say ?? revision ?? basePrompt, anchor });
  // Keep each context item short enough for the server, whatever the thread holds.
  const ctx = context?.map((c) => (c.length > 1_200 ? `${c.slice(0, 1_197)}...` : c));
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
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-session": s.sessionId },
      body: JSON.stringify({
        agent, prompt, driverId, escalate, offline: s.offline, advanced: s.advanced, model: s.model, demo: s.demo, group: s.group,
        pinned: ctx ?? s.pinned.map((p) => (p.detail ? `${p.label}: ${p.detail}` : p.label)),
      }),
    });
    if (!res.ok || !res.body) throw new Error(friendlyError(res.status));
    const reader = res.body.getReader();
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
        if (chunk.startsWith("data: ")) handle(JSON.parse(chunk.slice(6)) as AgentEvent);
      }
    }
    const run = useStore.getState().messages.find((m) => m.id === runId)?.run;
    if (run?.status === "running") patchRun(() => ({ status: "done" }));
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
