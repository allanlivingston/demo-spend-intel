// Runs the answers eval: each case goes through the app's real entry point (runAgent), then is graded.
//
//   npm run eval                                   offline answers, free and deterministic
//   npm run eval -- --backend claude-code          live, through this machine's Claude Code login (no API key)
//   npm run eval -- --backend claude-code --only do-nothing,day-14 --reps 2
//   npm run eval -- --selftest [--judge]           harness check: references must pass, empty answers must fail
//   npm run eval -- --backend claude-code --arch base --variant base   the earlier setup (ANSWER_ARCH=base)
//   npm run eval -- --backend claude-code --variant v1 --regrade   re-apply the rule checks to saved answers (no model calls; judge grades kept)
//
// Output (per backend): evals/answers/runs/<backend>/<variant>/results.jsonl, traces/, errors.jsonl.
// Rows are written as each case finishes; a rerun skips (case, rep) pairs already written.
import fs from "node:fs";
import path from "node:path";
import { initialState, setAdvancedView, type DemoState } from "@/engine";
import { offlinePlan } from "@/agents/offline";
import { systemPrompt, userPrompt } from "@/agents/prompts";
import { runAgent, type RunOutcome } from "@/agents/runAgent";
import { callTool, type ToolContext } from "@/agents/tools";
import type { AgentRequest, Backend } from "@/agents/types";
import { CASES, SETUPS, type EvalCase } from "../evals/answers/cases";
import { gradeRules, judge, JUDGE_METRICS, RULE_METRICS, type Graded } from "../evals/answers/grade";

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const backend = (opt("backend", "offline") as "offline" | "claude-code");
const reps = Number(opt("reps", "1"));
const variant = opt("variant", "baseline")!;
const concurrency = Number(opt("concurrency", backend === "offline" ? "8" : "2"));
const timeoutS = Number(opt("timeout-s", "180"));
const only = opt("only")?.split(",");
// The answer architecture under test; the app reads the same flag (ANSWER_ARCH), default "shaped".
const arch = opt("arch", process.env.ANSWER_ARCH ?? "shaped")!;
if (arch !== "base" && arch !== "shaped") throw new Error("--arch must be base or shaped");
process.env.ANSWER_ARCH = arch;
const useJudge = flag("judge") || (backend === "claude-code" && !flag("no-judge"));
const MAX_ATTEMPTS = 3;

// A plain folder name: baseline, v<N> or a descriptive one like base-3-runs (no paths).
if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(variant)) throw new Error("--variant must be lowercase letters, digits and dashes, like baseline, v2 or base-3-runs");
// The default view, as a reviewer first sees the app.
setAdvancedView(false);

const cases = CASES.filter((c) => !only || only.includes(c.id));
const demoFor = (c: EvalCase): DemoState => ({ ...initialState(c.scenario), ...SETUPS[c.setup] });
const reqFor = (c: EvalCase): AgentRequest => ({ agent: "chat", prompt: c.prompt, demo: demoFor(c), group: c.group, pinned: c.pinned ?? [], advanced: false, offline: backend === "offline" });

// ---------- one attempt ----------
interface Attempt {
  shown: string; results: unknown[]; calls: { tool: string; input: unknown; result: unknown }[]; drafted: string[];
  model: string; requestedModel: string; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
  sdkCostUsd: number; latencyS: number; retried: boolean; fallback?: string;
}
class InfraError extends Error { constructor(m: string, public failureClass: "timeout" | "harness_error") { super(m); } }

async function runOnce(c: EvalCase, signal: AbortSignal): Promise<Attempt> {
  const req = reqFor(c);
  let start: { backend: Backend; model: string; replayReason?: string } | null = null;
  let shown = "";
  const drafted: string[] = [];
  let outcome: RunOutcome | null = null;
  let done: { inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; latencyMs: number } | null = null;
  for await (const e of runAgent(req, { backend: backend === "offline" ? "replay" : "claude-code", onDone: (o) => (outcome = o) })) {
    if (signal.aborted) throw new InfraError("wall-clock ceiling", "timeout");
    if (e.type === "start") start = e;
    if (e.type === "text") shown = e.text;
    if (e.type === "artifact") drafted.push(e.artifact.kind);
    if (e.type === "done") done = e;
    if (e.type === "error") throw new InfraError(e.message, "harness_error");
  }
  if (!start || !done) throw new InfraError("run ended without start/done", "harness_error");
  const o = outcome as RunOutcome | null;

  if (backend === "offline") {
    // Offline answers come from the engine; recompute the same tool results for the grounding check.
    const ctx: ToolContext = { demo: req.demo, group: req.group, artifacts: [] };
    const calls = offlinePlan(req).calls.map((k) => ({ tool: k.tool, input: k.input, result: callTool(ctx, k.tool, k.input).output.data }));
    return { shown, results: calls.map((k) => k.result), calls, drafted, model: "offline", requestedModel: "offline", usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }, sdkCostUsd: 0, latencyS: done.latencyMs / 1000, retried: false };
  }

  // Live: a replay here means the live answer was not shown. Infra failures retry; a failed grounding check is the model's.
  if (start.backend === "replay" || !o) {
    const why = start.replayReason ?? "fell back";
    if (/Grounding check failed/.test(why)) {
      return { shown: "", results: [], calls: [], drafted, model: start.model, requestedModel: start.model, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }, sdkCostUsd: 0, latencyS: done.latencyMs / 1000, retried: true, fallback: why };
    }
    throw new InfraError(why, /Timed out/.test(why) ? "timeout" : "harness_error");
  }
  if (!o.servedModel?.startsWith(o.model)) throw new InfraError(`served by ${o.servedModel ?? "unknown"}, requested ${o.model}`, "harness_error");
  return {
    shown, results: o.calls.map((k) => k.result), calls: o.calls, drafted, model: o.servedModel, requestedModel: o.model,
    usage: { input_tokens: done.inputTokens, output_tokens: done.outputTokens, cache_read_input_tokens: done.cacheReadTokens },
    sdkCostUsd: done.costUsd, latencyS: done.latencyMs / 1000, retried: Boolean(o.retried),
  };
}

// ---------- files ----------
const flowRoot = path.join("evals/answers/runs", backend);
const dir = path.join(flowRoot, variant);
fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
const metrics = [...RULE_METRICS, ...(useJudge ? JUDGE_METRICS : [])];
const statePath = path.join(flowRoot, "_state.json");
if (!fs.existsSync(statePath)) {
  fs.writeFileSync(statePath, JSON.stringify({
    metrics,
    perf_fields: [{ id: "latency_s", label: "Latency", unit: "s" }, { id: "tool_calls", label: "Tool calls" }, { id: "in_tokens", label: "In tokens" }, { id: "out_tokens", label: "Out tokens" }],
    metrics_md: "See evals/answers/README.md for what each check means.",
  }, null, 2) + "\n");
}
const resultsPath = path.join(dir, "results.jsonl");
const errorsPath = path.join(dir, "errors.jsonl");
const done = new Set(fs.existsSync(resultsPath) ? fs.readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.prompt_id}#${r.rep}`; }) : []);
const append = (p: string, row: unknown) => fs.appendFileSync(p, JSON.stringify(row) + "\n");

function writeTrace(c: EvalCase, rep: number, a: Attempt) {
  const req = reqFor(c);
  const turns: unknown[] = [
    { role: "system", content: systemPrompt("chat", req.demo, req.group) },
    { role: "user", content: userPrompt(req.prompt, req.pinned) },
  ];
  for (const k of a.calls) {
    turns.push({ role: "tool_call", name: k.tool, content: JSON.stringify(k.input ?? {}, null, 2) });
    turns.push({ role: "tool_result", content: JSON.stringify(k.result) });
  }
  turns.push({ role: "assistant", content: a.fallback ? `[No live answer shown: ${a.fallback}]` : a.shown + (a.drafted.length ? `\n\n[Drafted: ${a.drafted.join(", ")}]` : "") });
  fs.writeFileSync(path.join(dir, "traces", `${c.id}_rep${rep}.json`), JSON.stringify(turns, null, 2) + "\n");
}

// ---------- one (case, rep) with retries ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function runCase(c: EvalCase, rep: number) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const ceiling = setTimeout(() => controller.abort(), timeoutS * 1000);
    try {
      const a = await Promise.race([
        runOnce(c, controller.signal),
        new Promise<never>((_, rej) => controller.signal.addEventListener("abort", () => rej(new InfraError(`no result in ${timeoutS}s`, "timeout")))),
      ]);
      let g: Graded = gradeRules(c, a.shown, a.results, a.drafted);
      let judgeInfo: Record<string, unknown> = {};
      if (useJudge) {
        if (a.fallback) {
          g = { grade: { ...g.grade, j_answers: 0, j_plain: 0, j_faithful: 0 }, explanation: { ...g.explanation, j_answers: "No live answer.", j_plain: "No live answer.", j_faithful: "No live answer." } };
        } else {
          const j = await judge(c, a.shown, a.results, controller.signal);
          g = { grade: { ...g.grade, ...j.grade }, explanation: { ...g.explanation, ...j.explanation } };
          judgeInfo = { judge_model: j.model, judge_usage: j.usage, judge_sdk_cost_usd: j.sdkCostUsd };
        }
      }
      // The headline needs the judge too: a grounded answer can still misstate who does what.
      if (useJudge && g.grade.pass && JUDGE_METRICS.some((m) => g.grade[m.id] !== 1)) {
        g.grade.pass = 0;
        g.explanation.pass = `Rule checks passed; the judge failed: ${JUDGE_METRICS.filter((m) => g.grade[m.id] !== 1).map((m) => m.label).join(", ")}.`;
      }
      if (a.fallback) g.explanation.pass = `No live answer: ${a.fallback}`;
      writeTrace(c, rep, a);
      append(resultsPath, {
        prompt_id: c.id, prompt: c.prompt, tags: c.tags, rep, status: "ok", stop_reason: null,
        grade: g.grade, explanation: g.explanation,
        model: a.model, usage: a.usage, latency_s: Math.round(a.latencyS * 10) / 10, tool_calls: a.calls.length,
        in_tokens: a.usage.input_tokens, out_tokens: a.usage.output_tokens, ...judgeInfo,
        meta: { backend, arch, requested_model: a.requestedModel, attempt, retried_inside_app: a.retried, fallback: a.fallback ?? null, drafted: a.drafted, answer: a.shown, sdk_cost_usd: a.sdkCostUsd },
      });
      process.stdout.write(`${g.grade.pass ? "PASS" : "fail"}  ${c.id}#${rep}${a.fallback ? " (no live answer)" : ""}\n`);
      return;
    } catch (e) {
      const infra = e instanceof InfraError ? e : new InfraError(String((e as Error)?.message ?? e), "harness_error");
      append(errorsPath, { prompt_id: c.id, rep, attempt, failure_class: infra.failureClass, message: infra.message, at: new Date().toISOString() });
      process.stdout.write(`ERR   ${c.id}#${rep} attempt ${attempt}: ${infra.message}\n`);
      if (attempt < MAX_ATTEMPTS) await sleep(2000 * 2 ** (attempt - 1) * (0.5 + Math.random()));
    } finally {
      clearTimeout(ceiling);
    }
  }
}

// ---------- regrade: rule checks on saved answers, after a grading change (no model calls) ----------
function regrade() {
  const rows = fs.readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let changed = 0;
  const out = rows.map((r) => {
    const c = CASES.find((x) => x.id === r.prompt_id);
    if (!c || r.status !== "ok" || r.meta.fallback) return r;
    const trace = JSON.parse(fs.readFileSync(path.join(dir, "traces", `${r.prompt_id}_rep${r.rep}.json`), "utf8")) as { role: string; content: string }[];
    const results = trace.filter((t) => t.role === "tool_result").map((t) => JSON.parse(t.content));
    const g = gradeRules(c, r.meta.answer, results, r.meta.drafted);
    const grade = { ...r.grade, ...g.grade }, explanation = { ...r.explanation, ...g.explanation };
    const judged = JUDGE_METRICS.filter((m) => m.id in grade);
    if (grade.pass && judged.some((m) => grade[m.id] !== 1)) {
      grade.pass = 0;
      explanation.pass = `Rule checks passed; the judge failed: ${judged.filter((m) => grade[m.id] !== 1).map((m) => m.label).join(", ")}.`;
    }
    if (grade.pass !== r.grade.pass) { changed++; console.log(`${grade.pass ? "now PASS" : "now fail"}  ${r.prompt_id}#${r.rep}`); }
    return { ...r, grade, explanation };
  });
  fs.writeFileSync(resultsPath, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`Regraded ${rows.length} rows, ${changed} changed headline.`);
  summarize();
}

// ---------- summary ----------
function summarize() {
  const rows = fs.readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.status === "ok");
  const n = rows.length;
  if (!n) return;
  const mean = (id: string) => rows.reduce((s, r) => s + (r.grade[id] ?? 0), 0) / n;
  const p = mean("pass");
  // Wilson 95% interval for the headline pass rate.
  const z = 1.96, den = 1 + z * z / n, mid = (p + z * z / (2 * n)) / den, half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den;
  const errs = fs.existsSync(errorsPath) ? fs.readFileSync(errorsPath, "utf8").trim().split("\n").filter(Boolean).length : 0;
  console.log(`\n${backend}/${variant} (${arch}): all checks passed on ${Math.round(p * n)}/${n} (${Math.round(p * 100)}%, 95% CI ${Math.round((mid - half) * 100)}–${Math.round((mid + half) * 100)}%), ${errs} failed attempts in errors.jsonl`);
  console.log(metrics.map((m) => `${m.label}: ${Math.round(mean(m.id) * 100)}%`).join(" · "));
  const lat = rows.map((r) => r.latency_s).sort((a, b) => a - b);
  if (backend !== "offline") console.log(`Latency median ${lat[Math.floor(n / 2)]}s · SDK cost estimate $${rows.reduce((s, r) => s + (r.meta.sdk_cost_usd ?? 0) + (r.judge_sdk_cost_usd ?? 0), 0).toFixed(2)} (Claude Code login; not billed per token on a subscription)`);
}

// ---------- self-test: oracle and null through the same graders ----------
async function selftest() {
  const sweep = (c: EvalCase) => {
    const ctx: ToolContext = { demo: demoFor(c), group: c.group, artifacts: [] };
    const calls: [string, unknown][] = [["get_forecast", {}], ["get_forecast", { group: "all" }], ["list_drivers", {}], ["get_evidence", {}], ["get_pacing_health", {}], ["list_agents", {}], ["get_user", { user: "Vik D." }], ["get_day", { day: 14 }],
      ["simulate_policy", { apply_fixes: ["a-connector"] }], ["simulate_policy", { apply_fixes: ["a-cache"] }], ["lookup_faq", { question: c.prompt }], ["draft_cfo_brief", {}]];
    for (const g of ["pe", "fpa", "mkt"]) calls.push(["get_forecast", { group: g }]);
    return calls.map(([t, i]) => callTool(ctx, t, i).output.data);
  };
  let oracle = 0, nulls = 0;
  for (const c of CASES) {
    const r = sweep(c);
    const ok = gradeRules(c, c.reference, r, c.draft ? [c.draft] : []);
    if (ok.grade.pass) oracle++; else console.log(`oracle FAIL ${c.id}: ${Object.entries(ok.explanation).filter(([k]) => ok.grade[k] !== 1).map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
    for (const bad of ["", "I don't know."]) if (gradeRules(c, bad, r, []).grade.pass) { nulls++; console.log(`null PASSED ${c.id}: "${bad}"`); }
  }
  console.log(`\nOracle (reference answers): ${oracle}/${CASES.length} pass. Null answers passing: ${nulls}/${CASES.length * 2} (should be 0).`);
  if (useJudge) {
    // The judge must fail empty, "I don't know" and a confident answer to a different question, and pass the reference.
    const picks = ["do-nothing", "faq-prompts", "what-if-connector-only"].map((id) => CASES.find((c) => c.id === id)!);
    const wrong = CASES.find((c) => c.id === "summary-all-teams")!.reference;
    for (const c of picks) {
      const r = sweep(c);
      for (const [label, ans] of [["reference", c.reference], ["empty", ""], ["I don't know", "I don't know."], ["wrong question", wrong]] as const) {
        const j = await judge(c, ans, r, new AbortController().signal);
        console.log(`judge ${c.id} / ${label}: answers=${j.grade.j_answers} plain=${j.grade.j_plain} faithful=${j.grade.j_faithful}  (${j.explanation.j_answers})`);
      }
    }
  }
}

/** Writes evals/answers/CASES.md: every case, for a human to review. */
function listCases() {
  const fence = "````";
  const lines = ["# Answers eval: cases", "", `${CASES.length} cases. Expected facts come from the engine in the default view and were checked by hand.`, "", "| id | group | state | expects | tags |", "|---|---|---|---|---|"];
  for (const c of CASES) lines.push(`| ${c.id} | ${c.scenario} · ${c.group} | ${c.setup.replace("_", " ")} | ${c.draft ? `draft ${c.draft}` : "answer, no draft"} | ${c.tags.join(", ")} |`);
  for (const c of CASES) {
    lines.push("", `## ${c.id}`, "", c.why, "", fence, c.prompt, fence);
    if (c.pinned?.length) lines.push("", "Pinned by the UI:", "", fence, ...c.pinned, fence);
    lines.push("", "Must say:", ...(c.facts.length ? c.facts.map((f) => `- ${f.label}`) : ["- (nothing specific)"]));
    if (c.forbidden?.length) lines.push("", "Must not:", ...c.forbidden.map((f) => `- ${f.label}`));
    lines.push("", `Drafts: ${c.draft ?? "nothing"}${c.mayDraft ? ` (may also draft ${c.mayDraft.join(" or ")})` : ""}`);
    lines.push("", `Reference answer: ${c.reference}`);
  }
  fs.writeFileSync("evals/answers/CASES.md", lines.join("\n") + "\n");
  console.log("Wrote evals/answers/CASES.md");
}

async function main() {
  if (flag("list")) return listCases();
  if (flag("selftest")) return selftest();
  if (flag("regrade")) return regrade();
  const todo = cases.flatMap((c) => Array.from({ length: reps }, (_, rep) => ({ c, rep }))).filter(({ c, rep }) => !done.has(`${c.id}#${rep}`));
  console.log(`${todo.length} to run (${cases.length} cases × ${reps} reps, ${done.size} already done) on ${backend}${useJudge ? ", judged" : ""}`);
  const started = Date.now();
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, async () => { while (i < todo.length) { const t = todo[i++]; await runCase(t.c, t.rep); } }));
  console.log(`Wall clock ${((Date.now() - started) / 1000).toFixed(0)}s`);
  summarize();
}

main().catch((e) => { console.error(e); process.exit(1); });
