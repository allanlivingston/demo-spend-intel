// Walks the primary flow for a scenario: chips at each step, every question answered offline, every action replayed and approved.
import { initialState, forecast, type DemoState, type GroupSelection, type ScenarioId } from "@/engine";
import { offlinePlan } from "@/agents/offline";
import { callTool } from "@/agents/tools";
import { ground, isTooLong } from "@/agents/grounding";
import { findRecording } from "@/agents/backends/replay";
import { chipsFor } from "@/state/chipRules";
import type { ChatMessage } from "@/state/store";

const sc = (process.argv[2] ?? "C") as ScenarioId;
const group: GroupSelection = (process.argv[3] ?? "pe") as GroupSelection;
let demo: DemoState = initialState(sc);
const messages: ChatMessage[] = [];
let n = 0;
const usd = (x: number) => "$" + Math.round(x).toLocaleString("en-US");
const issues: string[] = [];

function answer(q: string, context?: string[]) {
  const plan = offlinePlan({ agent: "chat", prompt: q, demo, group, pinned: context ?? [] });
  const ctx = { demo, group, artifacts: [] as unknown[] };
  const res = plan.calls.map((c) => callTool(ctx as never, c.tool, c.input).output.data);
  const g = ground(plan.text, res);
  if (g.unmatched.length) issues.push(`ungrounded in "${q}": ${g.unmatched}`);
  if (isTooLong(plan.text)) issues.push(`too long: "${q}"`);
  return plan.text;
}

async function main() {
for (let step = 1; step <= 10; step++) {
  const f = forecast(demo, group);
  const chips = chipsFor({ demo, group, messages, auditCount: n, forecastVisible: true });
  console.log(`\n=== Step ${step}: lands ${usd(f.p50)} / budget ${usd(f.pool)} (${f.status}) ===`);
  console.log("chips:", chips.map((c) => (c.primary ? `[${c.text}]` : c.text)).join(" | "));
  for (const c of chips.filter((c) => c.action.type === "ask")) {
    const a = c.action as { q: string; context?: string[] };
    console.log(`  Q: ${a.q}\n  A: ${answer(a.q, a.context)}`);
  }
  const primary = chips.find((c) => c.primary);
  if (!primary) { console.log("(no primary step: flow ends)"); break; }
  messages.push({ id: `u${step}`, role: "user", text: primary.text } as ChatMessage);
  if (primary.action.type === "run") {
    const r = primary.action.run;
    const rec = await findRecording(r.agent, sc, r.driverId);
    if (!rec) { issues.push(`no recording for ${r.agent} ${r.driverId}`); break; }
    const ctx = { demo, group, artifacts: [] as { kind: string; id: string; driverIds?: string[]; rows?: unknown[] }[] };
    const res = rec.calls.map((c) => callTool(ctx as never, c.tool, c.input).output.data);
    const g = ground(rec.text, res);
    console.log(`  RUN ${r.agent}${r.driverId ? " " + r.driverId : ""}: ${rec.text}`);
    if (g.unmatched.length) issues.push(`stale recording ${rec.key}: ${g.unmatched}`);
    const art = ctx.artifacts.at(-1)!;
    console.log(`  -> draft: ${art.kind}`);
    messages.push({ id: `a${step}`, role: "assistant", artifact: art, artifactStatus: "proposed", runOf: `r${step}` } as unknown as ChatMessage);
    const draftChips = chipsFor({ demo, group, messages, auditCount: n, forecastVisible: true });
    console.log("  chips with draft:", draftChips.map((c) => (c.primary ? `[${c.text}]` : c.text)).join(" | "));
    for (const c of draftChips.filter((c) => c.action.type === "ask")) {
      const a = c.action as { q: string; context?: string[] };
      console.log(`    Q: ${a.q}\n    A: ${answer(a.q, a.context)}`);
    }
    // Approve.
    const m = messages.at(-1)!; (m as { artifactStatus: string }).artifactStatus = "applied";
    const a = art as unknown as Record<string, unknown>;
    if (art.kind === "policy_diff") {
      const ids = (a.driverIds as string[]) ?? [];
      const mine = ids.filter((x) => x !== "a-cache");
      demo = { ...demo, appliedFixes: [...demo.appliedFixes, ...mine], handedOff: ids.includes("a-cache") ? [...demo.handedOff, "a-cache"] : demo.handedOff };
      n += 2;
    } else if (art.kind === "rebalance_plan") { demo = { ...demo, rebalanceApplied: true }; n++; }
    else if (art.kind === "governed_override") { demo = { ...demo, overrides: [...demo.overrides, r.driverId ?? "b-soc2"] }; n++; }
    else if (art.kind === "cfo_brief") { demo = { ...demo, budgetRevisions: { ...demo.budgetRevisions, pe: (a.newBudget as number) ?? (a.proposed as number) } }; n++; }
    else if (art.kind === "handoff") { demo = { ...demo, handedOff: [...demo.handedOff, r.driverId!] }; n++; }
    console.log(`  APPROVED ${art.kind}`);
  } else { console.log("  (non-run primary)", primary.action.type); break; }
}
}
main().then(() => console.log("\nISSUES:", issues.length ? "\n- " + issues.join("\n- ") : "none"));
