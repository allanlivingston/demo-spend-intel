// Early runs: the likely next step starts while the admin reads. A click with nothing changed picks it up; anything
// else stops it and throws it away. Uses a fake server, so no Claude calls.
import { beforeEach, expect, test, vi } from "vitest";
import type { AgentEvent } from "@/agents/types";
import type { StartRun } from "@/state/agentClient";

type Call = { body: string; early: boolean; aborted: () => boolean; push: (e: AgentEvent) => void; end: () => void };
const enc = new TextEncoder();
const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const FIX: StartRun = { agent: "routing", prompt: "Fix all open waste with one policy." };

let calls: Call[] = [];
let status = 200;

beforeEach(() => {
  vi.resetModules();
  calls = [];
  status = 200;
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c; } });
    const signal = init?.signal ?? undefined;
    signal?.addEventListener("abort", () => { try { ctrl.error(new DOMException("aborted", "AbortError")); } catch { /* closed */ } });
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      body: String(init?.body), early: headers["x-early-run"] === "1", aborted: () => !!signal?.aborted,
      push: (e) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)),
      end: () => ctrl.close(),
    });
    return status === 204 ? new Response(null, { status: 204 }) : new Response(stream, { status });
  }) as typeof fetch;
});

async function load() {
  const client = await import("@/state/agentClient");
  const { useStore } = await import("@/state/store");
  useStore.getState().reset();
  useStore.setState({ offline: false });
  return { ...client, useStore };
}

const lastRun = (useStore: Awaited<ReturnType<typeof load>>["useStore"]) => {
  const m = [...useStore.getState().messages].reverse().find((x) => x.run);
  return { text: m?.text, run: m?.run };
};

test("a click with nothing changed picks up the early run where it is, without a second request", async () => {
  const { startEarlyRun, startAgentRun, useStore } = await load();
  startEarlyRun(FIX);
  await tick();
  expect(calls).toHaveLength(1);
  expect(calls[0].early).toBe(true);
  calls[0].push({ type: "start", backend: "api", model: "claude-sonnet", agent: "routing" });
  calls[0].push({ type: "text", text: "Two fixes save $8,700." });
  await tick();

  const clicked = startAgentRun({ ...FIX, say: "Fix all the waste" });
  await tick();
  expect(calls).toHaveLength(1);
  // What arrived before the click shows at once; the rest streams in.
  expect(lastRun(useStore).text).toBe("Two fixes save $8,700.");
  expect(lastRun(useStore).run?.status).toBe("running");
  calls[0].push({ type: "done", costUsd: 0.1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, latencyMs: 9_000, grounded: true, steps: 2 });
  calls[0].end();
  await clicked;
  expect(lastRun(useStore).run).toMatchObject({ status: "done", latencyMs: 9_000, backend: "api" });
});

test("a finished early run shows at once on click", async () => {
  const { startEarlyRun, startAgentRun, useStore } = await load();
  startEarlyRun(FIX);
  await tick();
  calls[0].push({ type: "start", backend: "api", model: "claude-sonnet", agent: "routing" });
  calls[0].push({ type: "text", text: "Done early." });
  calls[0].push({ type: "done", costUsd: 0.1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, latencyMs: 7_000, grounded: true, steps: 1 });
  calls[0].end();
  await tick();
  await startAgentRun(FIX);
  expect(calls).toHaveLength(1);
  expect(lastRun(useStore)).toMatchObject({ text: "Done early.", run: { status: "done" } });
});

test("a change before the click throws the early run away and runs fresh", async () => {
  const { startEarlyRun, startAgentRun, useStore } = await load();
  startEarlyRun(FIX);
  await tick();
  useStore.setState({ group: "fpa" });
  void startAgentRun(FIX);
  await tick();
  expect(calls[0].aborted()).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[1].early).toBe(false);
  expect(JSON.parse(calls[1].body).group).toBe("fpa");
});

test("asking something else stops the early run", async () => {
  const { startEarlyRun, startAgentRun } = await load();
  startEarlyRun(FIX);
  await tick();
  void startAgentRun({ agent: "chat", prompt: "Why are we over budget?", echo: true });
  await tick();
  expect(calls[0].aborted()).toBe(true);
  expect(calls[1].early).toBe(false);
});

test("keepEarlyRun stops it as soon as the likely next step changes", async () => {
  const { startEarlyRun, keepEarlyRun } = await load();
  startEarlyRun(FIX);
  await tick();
  keepEarlyRun(FIX);
  expect(calls[0].aborted()).toBe(false);
  keepEarlyRun({ agent: "funding", prompt: "Draft the budget owner brief." });
  expect(calls[0].aborted()).toBe(true);
});

test("an early run that fell back to a recording is not reused", async () => {
  const { startEarlyRun, startAgentRun } = await load();
  startEarlyRun(FIX);
  await tick();
  calls[0].push({ type: "start", backend: "replay", model: "offline", agent: "routing", replayReason: "Live run failed" });
  await tick();
  void startAgentRun(FIX);
  await tick();
  expect(calls).toHaveLength(2);
  expect(calls[1].early).toBe(false);
});

test("no early runs in Offline replay, none after the server says no, and a limit per page", async () => {
  let c = await load();
  c.useStore.setState({ offline: true });
  c.startEarlyRun(FIX);
  await tick();
  expect(calls).toHaveLength(0);

  vi.resetModules();
  status = 204;
  c = await load();
  c.startEarlyRun(FIX);
  await tick();
  c.useStore.setState({ group: "fpa" });
  c.startEarlyRun(FIX);
  await tick();
  expect(calls).toHaveLength(1);

  vi.resetModules();
  calls = [];
  status = 200;
  c = await load();
  const groups = ["pe", "fpa", "mkt", "all"] as const;
  for (let i = 0; i < c.MAX_EARLY_RUNS + 3; i++) {
    c.useStore.setState({ group: groups[i % 4], model: i < 4 ? "auto" : "sonnet" });
    c.startEarlyRun(FIX);
    await tick();
  }
  expect(calls).toHaveLength(c.MAX_EARLY_RUNS);
});

test("the server refuses early runs once half the day's cap is spent, but still serves clicks", async () => {
  const { checkCaps, record } = await import("@/agents/ledger");
  expect(checkCaps("a", true)).toBeNull();
  record("b", 2.6);
  expect(checkCaps("a", true)).toMatch(/half the daily cap/);
  expect(checkCaps("a")).toBeNull();
});
