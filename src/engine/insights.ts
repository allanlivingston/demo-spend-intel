// Derived views: KPIs, the fund-or-fix breakdown, headlines, alerts, counterfactuals.
import { isAdvanced, shownInView } from "./viewMode";
import { pacing } from "./pacing";
import { TODAY } from "./calendar";
import { baseLanding, GROUP_IDS, GROUPS, newHires, tenuredMembers, workstreamsOf } from "./data";
import {
  driverEffects, driversOf, evidenceTier, forecast, hurdleOf, isDeclined, memberProjections, poolOf, rebalanceRecipient, scenarioOf, throttle,
} from "./model";
import { distanceOffPace, nudge, type Nudge } from "./nudge";
import { ownerOf, recoveryOf } from "./routing";
import type { DemoState, Driver, GroupId, GroupSelection, Tier } from "./types";

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** Headline rounding: nearest $100. */
export const usd100 = (n: number) => usd(Math.round(n / 100) * 100);

const groupsOf = (sel: GroupSelection): GroupId[] => (sel === "all" ? GROUP_IDS : [sel]);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export type AgentId = "connector" | "cache" | "routing" | "funding";
export const AGENT_FOR_DRIVER: Record<string, AgentId> = {
  "a-connector": "connector", "a-cache": "cache", "a-subagents": "routing", "b-newhires": "funding", "b-soc2": "funding",
};

export interface BreakdownRow {
  driver: Driver;
  side: "fix" | "fund";
  projected: number; // forward cost if left alone
  sunk: number;
  recoverable: number;
  roiWeighted: number;
  belowHurdle: boolean;
  state: "open" | "applied" | "overridden" | "funded" | "sent" | "declined";
  agent: AgentId;
}

export interface Breakdown {
  rows: BreakdownRow[];
  hurdle: number;
  unclassified: number;
  underspend: boolean;
}

export const UNCLASSIFIED_SHARE: Record<GroupId, number> = { pe: 0.06, fpa: 0.04, mkt: 0.09 };

/** Sent to an owner who hasn't shipped the fix yet. */
export const waitingOnOwner = (s: DemoState, driverId: string) =>
  !!ownerOf(driverId) && (s.handedOff ?? []).includes(driverId) && !s.appliedFixes.includes(driverId);

export function breakdown(s: DemoState, sel: GroupSelection): Breakdown {
  const rows: BreakdownRow[] = [];
  let unclassified = 0;
  const hurdle = sel === "all" ? 1 : hurdleOf(s, sel);
  for (const g of groupsOf(sel)) {
    const h = hurdleOf(s, g);
    for (const e of driverEffects(s, g)) {
      if (!shownInView(e.driver.id)) continue;
      const d = e.driver;
      const roiWeighted = d.roi * d.confidence;
      const belowHurdle = roiWeighted < h;
      rows.push({
        driver: d,
        side: d.kind === "waste" || belowHurdle ? "fix" : "fund",
        projected: d.forward,
        sunk: d.sunk,
        recoverable: d.kind === "waste" ? recoveryOf(d) : 0,
        roiWeighted,
        belowHurdle,
        state: e.fixed ? "applied" : waitingOnOwner(s, d.id) ? "sent" : s.overrides.includes(d.id) ? "overridden"
          : d.kind === "growth" && ((s.rebalanceApplied && d.workstreamId === rebalanceRecipient(g)) || s.budgetRevisions[g] !== undefined) ? "funded"
          : isDeclined(s, d.id) ? "declined" : "open",
        agent: AGENT_FOR_DRIVER[d.id],
      });
    }
    unclassified += Math.round((UNCLASSIFIED_SHARE[g] * forecast(s, g).p50) / 100) * 100;
  }
  rows.sort((a, b) => b.roiWeighted - a.roiWeighted);
  const growth = rows.filter((r) => r.driver.kind === "growth");
  const underspend = growth.length > 0 && growth.every((r) => r.belowHurdle);
  return { rows, hurdle, unclassified, underspend };
}

export interface Kpis {
  pool: number;
  p50: number;
  p90: number;
  delta: number;
  fixableWaste: number;
  /** Recoverable waste sent to its owner, not fixed yet. */
  waitingOnOwner: number;
  wasteRunning: number;
  throttledValue: number;
  evidenceTier: Tier;
  nudge: Nudge;
}

export function kpis(s: DemoState, sel: GroupSelection): Kpis {
  const f = forecast(s, sel);
  const gs = groupsOf(sel);
  const all = gs.flatMap((g) => driverEffects(s, g)).filter((e) => e.driver.kind === "waste" && !e.fixed);
  const open = all.filter((e) => !waitingOnOwner(s, e.driver.id) && !isDeclined(s, e.driver.id));
  const tiers = gs.map((g) => evidenceTier(s, g));
  const effects = gs.flatMap((g) => driverEffects(s, g)).filter((e) => !e.fixed && e.forward > 0);
  const direction = effects.some((e) => e.driver.kind === "waste") ? "fix" : "fund";
  return {
    pool: f.pool,
    p50: f.p50,
    p90: f.p90,
    delta: f.p50 - f.pool,
    fixableWaste: sum(open.map((e) => recoveryOf(e.driver))),
    waitingOnOwner: sum(all.filter((e) => waitingOnOwner(s, e.driver.id)).map((e) => recoveryOf(e.driver))),
    wasteRunning: sum(open.map((e) => e.driver.forward)),
    throttledValue: sum(gs.map((g) => throttle(s, g).value)),
    evidenceTier: Math.max(...tiers) as Tier,
    nudge: nudge(distanceOffPace(f.p50, f.pool, f.sigma), direction),
  };
}

/** Under the headline: how much of the waste the admin can fix here, and how much another team has to ship. */
export function headlineNote(s: DemoState): string | null {
  if (s.scenarioId !== "C" || newWorkAsk(s) === null) return null;
  const open = driverEffects(s, "pe").filter((e) => e.driver.kind === "waste" && !e.fixed && !waitingOnOwner(s, e.driver.id) && !isDeclined(s, e.driver.id));
  const theirs = open.filter((e) => ownerOf(e.driver.id));
  if (!theirs.length || theirs.length === open.length) return null;
  const owed = sum(theirs.map((e) => recoveryOf(e.driver)));
  const mine = sum(open.map((e) => recoveryOf(e.driver))) - owed;
  return `${usd(mine)} you can fix here; ${usd(owed)} is a code fix for ${ownerOf(theirs[0].driver.id)!.short}.`;
}

/**
 * The verdict line for the team in view: what is happening, in plain words, ending on the next step.
 * Every number comes from the engine.
 */
export function headline(s: DemoState, sel: GroupSelection = "all"): string {
  const gs = groupsOf(sel);
  const f = forecast(s, sel);
  const over = f.p50 - f.pool;
  const name = sel === "all" ? "" : GROUPS[sel].name;
  const affected = gs.filter((g) => driversOf(s, g).length > 0);
  const onPace = `Forecast ${usd100(f.p50)} of ${usd(f.pool)}.`;
  if (!affected.length) {
    if (sel === "all") return "All teams on pace.";
    return over > 0 ? `${name} is forecast ${usd100(over)} over budget.` : `${name} is on pace. ${onPace}`;
  }
  const k = kpis(s, sel);
  const t = throttle(s, "pe");
  // In the all-teams view, say which team the line is about.
  const lead = (line: string) => (sel === "all" && affected.length === 1 ? `${GROUPS[affected[0]].name}: ${line}` : line);

  // Drift and growth: waste first, then the growth story.
  // Name both amounts up front, so the new engineers' share isn't a surprise after the fixes (what's left once the
  // waste is fixed is theirs: the same figure the funding step gives later).
  if (s.scenarioId === "C" && k.fixableWaste > 0) {
    // Their team's figures, not all teams': other teams' unused budget doesn't pay for them. The line names who it is
    // about, so it needs no team prefix in the all-teams view.
    const rest = newWorkAsk(s) ?? 0;
    return rest >= 100 ? `Fix ${usd(k.fixableWaste)} of waste, then ask for ${usd100(rest)}.` : lead(`Fix ${usd(k.fixableWaste)} of waste.`);
  }

  if (s.scenarioId === "A") {
    if (k.fixableWaste > 0) return lead(`Fix ${usd(k.fixableWaste)} of waste.`);
    if (k.waitingOnOwner > 0)
      return lead(over > 0 ? `${usd100(over)} over budget until the dev tools team fixes the prompt cache.` : `On track. ${onPace} Waiting on the dev tools team's cache fix.`);
    return lead(over > 0 ? `${usd100(over)} over budget.` : `On track. ${onPace}`);
  }

  if (s.scenarioId === "B" || s.scenarioId === "C") {
    if (s.budgetRevisions.pe) return `Budget is now ${usd(poolOf(s, "pe"))}.${k.waitingOnOwner > 0 ? " Waiting on the dev tools team's cache fix." : " Nothing else needs you."}`;
    if (s.rebalanceApplied) {
      if (over <= 0) return lead(`On track. ${onPace}`);
      return lead(fundLine(s));
    }
    const pc = pacing(s, "pe");
    if (!isAdvanced()) return lead(fundLine(s));
    if (pc.members.length) return lead(`About ${Math.round(pc.teamShare * 100)}% of runs are slowed or held each day to stay within limits. Move unused budget to the payments refactor.`);
    return lead(`${t.newHiresBlockedByDay22} engineers reach their monthly limit by day 22. Move unused budget to the payments refactor.`);
  }
  return over > 0 ? `${usd100(over)} over budget.` : "All teams on pace.";
}

export interface Alert {
  id: string;
  groupId: GroupId;
  label: string;
  detail: string;
  kind: "fix" | "fund";
  agent: AgentId;
  driverId: string;
}

export function alerts(s: DemoState): Alert[] {
  return GROUP_IDS.flatMap((g) =>
    driverEffects(s, g)
      .filter((e) => !e.fixed && !s.overrides.includes(e.driver.id))
      .map((e) => ({
        id: `alert-${e.driver.id}`,
        groupId: g,
        label: e.driver.label,
        detail: `${usd100(e.driver.forward)} projected to month end`,
        kind: e.driver.kind === "waste" ? ("fix" as const) : ("fund" as const),
        agent: AGENT_FOR_DRIVER[e.driver.id],
        driverId: e.driver.id,
      })),
  );
}

// ---------- Short-window counterfactual (Scenario A) ----------

export const WINDOWS = {
  hoursPerWindow: 5,
  /** Hours of loop traffic until the frontier window is exhausted. */
  hoursToExhaust: 2,
  sonnetPriceRatio: 0.6,
  /** Days from fallback to tier 1 loop detection pausing the connector (backtest median lag). */
  detectionLagDays: 1.5,
};

/** What the day-14 connector loop would have cost with short windows and tier 1 detection on. */
export function windowsCounterfactual(s: DemoState) {
  const d = scenarioOf(s).drivers.find((x) => x.id === "a-connector");
  if (!d) return null;
  const actualCost = d.sunk + d.forward;
  const blended = (WINDOWS.hoursToExhaust + (WINDOWS.hoursPerWindow - WINDOWS.hoursToExhaust) * WINDOWS.sonnetPriceRatio) / WINDOWS.hoursPerWindow;
  const windowsOnly = actualCost * blended;
  // With detection, the loop runs only until it is paused for approval, at the rate it reached by then.
  const loopDays = TODAY - d.startDay + 1;
  const sunkPerDayAtEnd = (2 * d.sunk) / loopDays; // linear ramp: final day carries twice the average
  const forwardPerDay = d.forward / (30 - TODAY);
  const detected = blended * (d.sunk + Math.max(0, WINDOWS.detectionLagDays) * Math.max(sunkPerDayAtEnd, forwardPerDay));
  return {
    hoursToFallback: WINDOWS.hoursToExhaust,
    actualCost,
    windowsOnly,
    withDetection: detected,
  };
}

// ---------- Users and agents ----------

export interface PeopleSummary { people: number; newPeople: number; landing: number; blocked: number; workstreams: { name: string; people: number; blocked: number }[] }
/** kind: what the spend is (base: scheduled runs and service accounts; waste or growth: from a driver). */
export interface AgentRow { id: string; label: string; landing: number; state: "running" | "fixed" | "waiting"; kind: "base" | "waste" | "growth" }

/** Spend run by people (aggregates only, never per person) and by autonomous agents, for one team. */
export function usersAndAgents(s: DemoState, g: GroupId): { people: PeopleSummary; agents: AgentRow[] } {
  const ms = memberProjections(s, g);
  const people: PeopleSummary = {
    people: ms.length,
    newPeople: ms.filter((m) => m.cohort === "new").length,
    landing: Math.round(ms.reduce((a, m) => a + m.total, 0)),
    blocked: ms.filter((m) => m.blockDay !== null).length,
    workstreams: workstreamsOf(g).map((w) => {
      const here = ms.filter((m) => m.workstreamId === w.id);
      return { name: w.name, people: here.length, blocked: here.filter((m) => m.blockDay !== null).length };
    }),
  };
  const agents: AgentRow[] = [
    { id: "service", label: "Scheduled runs and service accounts", landing: Math.round((1 - GROUPS[g].memberShare) * baseLanding(g) / 100) * 100, state: "running", kind: "base" },
    ...driverEffects(s, g).filter((e) => e.driver.agentShare > 0).map((e) => ({
      id: e.driver.id,
      // Growth drivers are people; this row is only the agent runs they start.
      label: e.driver.kind === "growth" ? `Agent runs: ${e.driver.label.charAt(0).toLowerCase()}${e.driver.label.slice(1)}` : e.driver.label,
      landing: Math.round(e.driver.agentShare * (e.sunk + e.forward) / 100) * 100,
      state: (e.fixed ? "fixed" : waitingOnOwner(s, e.driver.id) ? "waiting" : "running") as AgentRow["state"],
      kind: (e.driver.kind === "waste" ? "waste" : "growth") as AgentRow["kind"],
    })),
  ];
  return { people, agents };
}

// ---------- One day ----------

export interface DayInfo { day: number; past: boolean; spend: number; cumulative: number; events: string[]; blocked: number }

/** What happened (or is forecast) on one day of the month, for the selected teams. */
export function dayInfo(s: DemoState, sel: GroupSelection, day: number): DayInfo {
  const f = forecast(s, sel);
  const at = (d: number) => { const p = f.series[d - 1]; return p ? (p.actual ?? p.p50 ?? 0) : 0; };
  const groups = sel === "all" ? GROUP_IDS : [sel];
  const events = groups.flatMap((g) => driversOf(s, g).filter((d) => d.startDay === day).map((d) => d.label));
  const blocked = groups.reduce((n, g) => n + (throttle(s, g).blockDays[day] ?? 0), 0);
  return { day, past: day <= TODAY, spend: Math.round(at(day) - at(day - 1)), cumulative: Math.round(at(day)), events, blocked };
}

// ---------- Users ----------

const FIRST = ["Ada", "Ben", "Chloe", "Dev", "Elena", "Femi", "Grace", "Hiro", "Isla", "Jon", "Kira", "Leo", "Maya", "Nico", "Omar", "Priya", "Quinn", "Rosa", "Sam", "Tara", "Uma", "Vik", "Wen", "Yara", "Zane"];
const LAST = ["A", "B", "C", "D", "E", "F", "G", "H", "K", "L", "M", "N", "P", "R", "S", "T", "W"];

/** Stable, unique display names for every member (constructed data, no real people). */
let NAMES: Map<string, string> | null = null;
export function memberName(id: string): string {
  if (!NAMES) {
    const ids = [...GROUP_IDS.flatMap((g) => tenuredMembers(g).map((m) => m.id)), ...newHires().map((m) => m.id)];
    // 7 is coprime with 25, so first names never repeat within a block of 25; the last initial changes per block.
    NAMES = new Map(ids.map((x, i) => [x, `${FIRST[(i * 7) % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}.`]));
  }
  return NAMES.get(id) ?? id;
}

export interface UserRow {
  id: string; name: string; groupId: GroupId; team: string; workstream: string; isNew: boolean;
  spent: number; landing: number; limit: number; blockDay: number | null;
}

/** Every member with spend to date, where they land and whether today's limit would stop them. Blocked first. */
export function usersOf(s: DemoState, sel: GroupSelection): UserRow[] {
  const groups = sel === "all" ? GROUP_IDS : [sel];
  return groups.flatMap((g) => {
    const ws = workstreamsOf(g);
    return memberProjections(s, g).map((m) => ({
      id: m.id, name: memberName(m.id), groupId: g, team: GROUPS[g].name,
      workstream: ws.find((w) => w.id === m.workstreamId)?.name ?? "",
      isNew: m.cohort === "new", spent: Math.round(m.cumulative[TODAY - 1]), landing: Math.round(m.total),
      limit: m.limit, blockDay: m.blockDay,
    }));
  }).sort((a, b) => (a.blockDay ?? 99) - (b.blockDay ?? 99) || b.landing - a.landing);
}

export const findUser = (s: DemoState, nameOrId: string) => {
  const q = nameOrId.toLowerCase().replace(/\.$/, "");
  return usersOf(s, "all").find((u) => u.id.toLowerCase() === q || u.name.toLowerCase().replace(/\.$/, "") === q) ?? null;
};

/** Agent sources for the selected teams (scheduled runs, subagents, connectors) with landing and state. */
export function agentsOf(s: DemoState, sel: GroupSelection): (AgentRow & { team: string })[] {
  const groups = sel === "all" ? GROUP_IDS : [sel];
  return groups.flatMap((g) => usersAndAgents(s, g).agents.map((a) => ({ ...a, id: a.id === "service" ? `service-${g}` : a.id, team: GROUPS[g].name })));
}

/** The funding step in plain words: what is over, where it comes from, and the next step. */
function fundLine(s: DemoState): string {
  // Always Platform Engineering's own figures: in the all-teams view, other teams' unused budget doesn't pay for it.
  const pf = forecast(s, "pe");
  const over = pf.p50 - pf.pool;
  const soc2 = driversOf(s, "pe").find((d) => d.id === "b-soc2");
  const hires = scenarioOf(s).newMembers.filter((m) => m.groupId === "pe").length;
  const who = hires ? `the ${hires} new engineers` : "new work";
  if (soc2 && isAdvanced() && !s.overrides.includes("b-soc2") && !isDeclined(s, "b-soc2"))
    return `${usd100(over)} over budget from ${who} and a planned ${usd(soc2.forward)} SOC 2 sprint starting tomorrow. Approve the sprint, then ask the budget owner for the rest.`;
  const waiting = kpis(s, "pe").waitingOnOwner;
  if (waiting > 0 && over > waiting)
    return `${usd100(over)} over budget: ${usd100(over - waiting)} from ${who} and ${usd(waiting)} until the dev tools team ships their fix. Ask the budget owner for the ${usd100(over - waiting)}.`;
  return `${usd100(over)} over budget from ${who}. Ask the budget owner for the ${usd100(over)}.`;
}

/** What to ask for the new engineers' work: what is still over budget once all waste is fixed (scenario C only). */
export function newWorkAsk(s: DemoState): number | null {
  if (s.scenarioId !== "C") return null;
  const pf = forecast(s, "pe");
  return pf.p50 - pf.pool - (kpis(s, "pe").fixableWaste + kpis(s, "pe").waitingOnOwner);
}
