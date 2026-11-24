// The one decision the product resolves: fix it, fund it, or nothing to do. Plus the single next step.
import { driverEffects, forecast, GROUP_IDS, recoveryOf, waitingOnOwner, type DemoState, type GroupId, type GroupSelection, isDeclined, isAdvanced } from "@/engine";
import type { StartRun } from "./agentClient";

export type Verdict = "fix" | "fund" | "waiting" | "on-pace" | "funded";

export interface NextAction {
  verdict: Verdict;
  /** Primary call to action, or null when there is nothing to do. */
  cta: { label: string; run: StartRun } | null;
}

export function verdictFor(demo: DemoState, g: GroupId): Verdict {
  const effects = driverEffects(demo, g);
  const unfixed = effects.filter((e) => e.driver.kind === "waste" && !e.fixed);
  const openWaste = unfixed.filter((e) => !waitingOnOwner(demo, e.driver.id) && !isDeclined(demo, e.driver.id));
  const growth = effects.filter((e) => e.driver.kind === "growth" && !isDeclined(demo, e.driver.id));
  if (openWaste.length) return "fix";
  if (growth.length && forecast(demo, g).status === "Over budget") return "fund";
  if (unfixed.some((e) => waitingOnOwner(demo, e.driver.id))) return "waiting";
  if (growth.length || effects.some((e) => e.fixed)) return "funded";
  return "on-pace";
}

export function nextAction(demo: DemoState, sel: GroupSelection): NextAction {
  const groups = sel === "all" ? GROUP_IDS : [sel];
  const verdicts = groups.map((g) => verdictFor(demo, g));
  const order: Verdict[] = ["fix", "fund", "waiting", "funded", "on-pace"];
  const verdict = order.find((v) => verdicts.includes(v)) ?? "on-pace";

  if (verdict === "fix") {
    const open = groups.flatMap((g) => driverEffects(demo, g)).filter((e) => e.driver.kind === "waste" && !e.fixed && !waitingOnOwner(demo, e.driver.id) && !isDeclined(demo, e.driver.id));
    if (open.length > 1)
      return { verdict, cta: { label: "Fix it", run: { agent: "routing", prompt: "Fix all open waste with one policy." } } };
    const d = open[0].driver;
    const agent = d.id === "a-connector" ? "connector" : d.id === "a-cache" ? "cache" : "routing";
    return { verdict, cta: { label: "Fix it", run: { agent, driverId: d.id, prompt: `Fix with agent: ${d.label}.` } } };
  }
  if (verdict === "fund") {
    // Guided order: rebalance headroom, then override the planned sprint, then ask Finance.
    if (isAdvanced() && !demo.rebalanceApplied && !isDeclined(demo, "b-newhires"))
      return { verdict, cta: { label: "Move unused budget", run: { agent: "funding", driverId: "b-newhires", prompt: "Fund with agent: 14 new engineers ramping on the payments refactor. Plan a rebalance." } } };
    if (isAdvanced() && !demo.overrides.includes("b-soc2") && !isDeclined(demo, "b-soc2"))
      return { verdict, cta: { label: "Approve the planned SOC 2 sprint", run: { agent: "funding", driverId: "b-soc2", prompt: "Fund with agent: planned SOC 2 documentation sprint. Draft the planned spend approval." } } };
    return { verdict, cta: { label: "Draft the budget owner brief", run: { agent: "funding", prompt: "Draft the budget owner brief." } } };
  }
  return { verdict, cta: null };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  fix: "Fix it",
  fund: "Fund it",
  waiting: "Waiting on owner",
  "on-pace": "On pace",
  funded: "Resolved",
};

/** Short names for the waste sources, used where space is tight (the verdict panel). */
export const SHORT_NAME: Record<string, string> = {
  "a-subagents": "Opus subagents",
  "a-connector": "Jira retry loop",
  "a-cache": "Prompt cache drop",
};

/** Open waste sources for the selection, largest recoverable first. */
export function wasteSources(demo: DemoState, sel: GroupSelection) {
  const groups = sel === "all" ? GROUP_IDS : [sel];
  return groups
    .flatMap((g) => driverEffects(demo, g))
    .filter((e) => e.driver.kind === "waste" && !e.fixed && !waitingOnOwner(demo, e.driver.id) && !isDeclined(demo, e.driver.id))
    .map((e) => ({ id: e.driver.id, name: SHORT_NAME[e.driver.id] ?? e.driver.label, recoverable: recoveryOf(e.driver) }))
    .sort((a, b) => b.recoverable - a.recoverable);
}
