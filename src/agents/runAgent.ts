// Orchestrates one agent run: picks a backend, streams tool steps as they happen, checks grounding,
// then emits the text and the drafted artifacts. Falls back to recorded replay on error, timeout or cap.
import { runApi } from "./backends/api";
import { runClaudeCode } from "./backends/claudeCode";
import { findRecording } from "./backends/replay";
import { freshSummary } from "./offline";
import { offlineGuide, offlinePlan } from "./offline";
import type { BackendResult, BackendRun, ToolCallRecord } from "./backends/types";
import { ground, isTooLong, jargonIn, MAX_SENTENCES, MAX_WORDS, plainWords, polish, trimToLimit } from "./grounding";
import { pickModel } from "./models";
import { systemPrompt, userPrompt } from "./prompts";
import { callTool, TOOLS, type ToolContext } from "./tools";
import type { AgentEvent, AgentRequest, Backend } from "./types";

export const MAX_TOOL_STEPS = 8;
const TIMEOUT_MS: Record<Backend, number> = { "claude-code": 90_000, api: 30_000, replay: 0 };
const REPLAY_STEP_MS = 400;

/** claude-code locally (no API tokens), api in production. AGENT_BACKEND overrides. */
export function defaultBackend(): Backend {
  const env = process.env.AGENT_BACKEND as Backend | undefined;
  if (env === "claude-code" || env === "api" || env === "replay") return env;
  if (process.env.NODE_ENV === "production") return process.env.ANTHROPIC_API_KEY ? "api" : "replay";
  return "claude-code";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal async queue so tool handlers can push events while the backend runs. */
class Channel<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  push(x: T) { this.items.push(x); this.wake?.(); }
  close() { this.closed = true; this.wake?.(); }
  async *drain(): AsyncGenerator<T> {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

export interface RunOutcome {
  calls: ToolCallRecord[];
  text: string;
  model: string;
  backend: Backend;
}

export async function* runAgent(req: AgentRequest, opts: { backend?: Backend; onDone?: (o: RunOutcome, e: Extract<AgentEvent, { type: "done" }>) => void } = {}): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  // The default view has no workstreams: funding growth means the budget owner brief, never a budget move or a planned-work approval.
  if (req.agent === "funding" && req.advanced === false && req.driverId) req = { ...req, driverId: undefined, prompt: "Draft the budget owner brief." };
  const backend: Backend = req.offline ? "replay" : opts.backend ?? defaultBackend();
  const model = pickModel(req.agent, req.prompt, req.escalate, req.model);
  const system = systemPrompt(req.agent, req.demo);
  const user = userPrompt(req.prompt, req.pinned);

  if (backend !== "replay") {
    const live = yield* liveRun(req, backend, model, system, user, started, opts.onDone);
    if (live.ok) return;
    yield* replay(req, live.reason, started);
    return;
  }
  yield* replay(req, req.offline ? "Offline demo" : "no Claude connection on the server", started);
}

async function* liveRun(
  req: AgentRequest, backend: Backend, model: string, system: string, user: string, started: number,
  onDone?: (o: RunOutcome, e: Extract<AgentEvent, { type: "done" }>) => void,
): AsyncGenerator<AgentEvent, { ok: true } | { ok: false; reason: string }> {
  yield { type: "start", backend, model, agent: req.agent };
  const channel = new Channel<AgentEvent>();
  const calls: ToolCallRecord[] = [];
  let quietSteps = false;

  const attempt = async (u: string): Promise<{ result: BackendResult; ctx: ToolContext }> => {
    const ctx: ToolContext = { demo: req.demo, group: req.group, artifacts: [] };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS[backend]);
    let steps = 0;
    const run: BackendRun = {
      agent: req.agent, model, system, user: u, ctx, signal: controller.signal, maxToolSteps: MAX_TOOL_STEPS,
      invoke: (name, input) => {
        if (++steps > MAX_TOOL_STEPS) return { text: JSON.stringify({ error: "Step limit reached. Answer now with what you have." }), isError: true };
        const r = callTool(ctx, name, input);
        calls.push({ tool: name, input, result: r.output.data });
        const def = TOOLS.find((t) => t.name === name);
        if (!quietSteps && def) channel.push({ type: "step", phase: def.phase, tool: name, summary: r.output.summary });
        return { text: r.text, isError: r.isError };
      },
    };
    try {
      const result = backend === "api" ? await runApi(run) : await runClaudeCode(run);
      return { result, ctx };
    } finally {
      clearTimeout(timer);
    }
  };

  // Run the backend while streaming its tool steps.
  let outcome: { result: BackendResult; ctx: ToolContext } | null = null;
  let failure = "";
  const work = attempt(user)
    .then((o) => (outcome = o))
    .catch((e) => (failure = e?.name === "AbortError" || /abort/i.test(String(e)) ? "Timed out" : String(e?.message ?? e)))
    .finally(() => channel.close());
  for await (const ev of channel.drain()) yield ev;
  await work;
  if (!outcome) return { ok: false, reason: `Live run failed (${failure}), showing recorded replay` };

  let { result, ctx } = outcome as { result: BackendResult; ctx: ToolContext };
  let g = req.agent === "guide" ? { ok: true as const, unmatched: [] as string[] } : ground(result.text, calls.map((c) => c.result));
  if (!g.ok || jargonIn(result.text).length > 0 || (req.agent !== "guide" && isTooLong(result.text))) {
    // One retry with a correction. Steps already shown are not repeated.
    const problems = [
      !g.ok && `it stated figures that no tool returned (${g.unmatched.join(", ")}); state only figures the tools return`,
      jargonIn(result.text).length > 0 && `it used jargon (${jargonIn(result.text).join(", ")}); use plain everyday words`,
      isTooLong(result.text) && `it was too long; answer in at most ${MAX_SENTENCES} short sentences and ${MAX_WORDS} words, outcome first, without repeating the card`,
    ].filter(Boolean);
    quietSteps = true;
    const firstCalls = calls.splice(0);
    const first = { result, ctx, g };
    try {
      const again = await attempt(`${user}\n\nCorrection: your previous answer had problems: ${problems.join("; ")}. Call the tools again and answer correctly.`);
      result = { ...again.result, costUsd: result.costUsd + again.result.costUsd, inputTokens: result.inputTokens + again.result.inputTokens, outputTokens: result.outputTokens + again.result.outputTokens, cacheReadTokens: result.cacheReadTokens + again.result.cacheReadTokens };
      ctx = again.ctx;
      g = ground(result.text, calls.map((c) => c.result));
    } catch {
      /* keep the first answer if it was grounded */
    }
    if (!g.ok && first.g.ok) {
      // The retry broke grounding; the first answer was only long. Use it, trimmed.
      result = { ...result, text: first.result.text };
      ctx = first.ctx;
      calls.splice(0, calls.length, ...firstCalls);
      g = first.g;
    }
    if (!g.ok) return { ok: false, reason: `Grounding check failed (${g.unmatched.join(", ")}), showing recorded replay` };
    if (isTooLong(result.text)) result = { ...result, text: trimToLimit(result.text) };
  }

  yield { type: "text", text: polish(plainWords(result.text.trim())) };
  for (const a of ctx.artifacts) yield { type: "artifact", artifact: a };
  const done = {
    type: "done" as const, costUsd: result.costUsd, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens, latencyMs: Date.now() - started, grounded: true, steps: calls.length,
  };
  onDone?.({ calls, text: result.text, model, backend }, done);
  yield done;
  return { ok: true };
}

async function* replay(req: AgentRequest, reason: string, started: number): AsyncGenerator<AgentEvent> {
  // Questions never replay a recording meant for another question: answer from the engine, the FAQ or the guide.
  if (req.agent === "chat" || req.agent === "guide") {
    yield { type: "start", backend: "replay", model: "offline", agent: req.agent, replayReason: reason };
    const ctx: ToolContext = { demo: req.demo, group: req.group, artifacts: [] };
    const planned = req.agent === "guide" ? { calls: [], text: offlineGuide(req.prompt) } : offlinePlan(req);
    for (const c of planned.calls) {
      await sleep(REPLAY_STEP_MS / 2);
      const r = callTool(ctx, c.tool, c.input);
      const def = TOOLS.find((t) => t.name === c.tool);
      if (def) yield { type: "step", phase: def.phase, tool: c.tool, summary: r.output.summary };
    }
    yield { type: "text", text: polish(planned.text) };
    yield { type: "done", costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, latencyMs: Date.now() - started, grounded: true, steps: planned.calls.length };
    return;
  }
  const rec = await findRecording(req.agent, req.demo.scenarioId, req.driverId);
  yield { type: "start", backend: "replay", model: rec?.model ?? "recorded", agent: req.agent, replayReason: reason };
  if (!rec) {
    yield { type: "error", message: "No recording for this agent and scenario yet. Run npm run record, or turn Offline demo off." };
    return;
  }
  const ctx: ToolContext = { demo: req.demo, group: req.group, artifacts: [] };
  const results: unknown[] = [];
  for (const c of rec.calls) {
    await sleep(REPLAY_STEP_MS);
    const r = callTool(ctx, c.tool, c.input);
    results.push(r.output.data);
    const def = TOOLS.find((t) => t.name === c.tool);
    if (def) yield { type: "step", phase: def.phase, tool: c.tool, summary: r.output.summary };
  }
  await sleep(REPLAY_STEP_MS);
  // Recorded prose is shown only while its figures still match the current engine state.
  const grounded = ground(rec.text, results).ok;
  const art = ctx.artifacts.at(-1) as { kind?: string } | undefined;
  const fresh = art?.kind && art.kind !== "handoff" ? freshSummary(req.demo, art.kind) : "State has changed since this run was recorded, so only the engine's fresh results are shown above.";
  yield { type: "text", text: polish(grounded ? rec.text : fresh) };
  for (const a of ctx.artifacts) yield { type: "artifact", artifact: a };
  yield { type: "done", costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, latencyMs: Date.now() - started, grounded, steps: rec.calls.length };
}
