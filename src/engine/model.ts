// The engine. Every number the UI or Claude shows comes from here.
//
// Forecast (per group):
//   P50 = actuals to date + sum over remaining days of (driver-based daily run rate x demand profile)
//         + active scenario drivers - applied policy recoveries
//   P90 = P50 + 1.2816 x sigma, sigma = sqrt(base variance + sum of driver variances).
//   Driver variance scales with the driver's autonomous agent share (agent work is lumpier).
// P50 is a demand forecast: where the bill lands if nothing is blocked. "Over budget"
// means the budget, not demand, will decide what runs (Google Ads semantics).
import { DAYS, TODAY, Z90, planFraction, weights } from "./calendar";
import { GROUP_IDS, GROUPS, PROFILES, tenuredMembers, workstreamsOf } from "./data";
import { recoveryOf } from "./routing";
import { ruleFor } from "./rules";
import { SCENARIOS } from "./scenarios";
import { shownInView } from "./viewMode";
import type {
  DayPoint, DemoState, Driver, Forecast, GroupId, GroupSelection, Member, ScenarioId,
  SharingLevel, Status, Tier, Workstream,
} from "./types";

/** Rebalance keeps recipient members' frontier windows at full size: more Opus, slightly higher cost. */
export const REBALANCE_MIX_COST = 400;
/** Funding removes the cap-block cliff from the recipient's outcome, which narrows its variance. */
export const FUNDED_SIGMA_FACTOR = 0.899;
export const RUNG_SHARE: Record<SharingLevel, number> = { fixed: 0, share20: 0.2, pooled: 1 };
export const RUNG_TIER: Record<SharingLevel, Tier> = { fixed: 1, share20: 2, pooled: 3 };
export const RUNG_LABEL: Record<SharingLevel, string> = { fixed: "Fixed limits", share20: "Share up to 20%", pooled: "Fully shared" };

export function initialState(scenarioId: ScenarioId = "baseline"): DemoState {
  return {
    scenarioId, appliedFixes: [], handedOff: [], overrides: [], rebalanceApplied: false, sharingLevel: "share20",
    budgetRevisions: {}, tier3Arrived: false, tier5Imported: false, hurdleOverrides: {}, declined: [],
  };
}

/** True when the admin declined this recommendation, or one of their rules says not to suggest it. */
export const isDeclined = (s: DemoState, driverId: string) => (s.declined ?? []).includes(driverId) || ruleFor(s, driverId)?.level === "skip";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const zeros = () => new Array<number>(DAYS).fill(0);
const addInto = (a: number[], b: number[], k = 1) => b.forEach((v, i) => (a[i] += v * k));

export const poolOf = (s: DemoState, g: GroupId) => s.budgetRevisions[g] ?? GROUPS[g].pool;
export const hurdleOf = (s: DemoState, g: GroupId) => s.hurdleOverrides[g] ?? GROUPS[g].hurdle;
export const scenarioOf = (s: DemoState) => SCENARIOS[s.scenarioId];
// The default view has no workstreams, so items that only exist as workstream plans (the SOC 2 sprint) are left out.
export const driversOf = (s: DemoState, g: GroupId) => scenarioOf(s).drivers.filter((d) => d.groupId === g && shownInView(d.id));

export interface DriverEffect {
  driver: Driver;
  /** Booked spend so far, as the scenario states it (used for every total). */
  sunk: number;
  /** The same driver's past spend at its forecast daily rate, used for the day-by-day shape. */
  pastRate: number;
  forward: number; // after any applied recovery
  recovered: number;
  sigma: number;
  fixed: boolean;
}

/**
 * Spend a driver has already caused this month. It runs at the same daily rate as its forecast, shaped by the team's
 * weekly pattern, from the day it started: a loop that costs $340 a day from today also cost about that since it began.
 */
export function sunkOf(g: GroupId, d: Driver): number {
  if (d.startDay > TODAY) return 0;
  const past = sum(weights(PROFILES[g], d.startDay, TODAY));
  const future = sum(weights(PROFILES[g], TODAY + 1, DAYS));
  return Math.round((d.forward * past) / future);
}

export function driverEffects(s: DemoState, g: GroupId): DriverEffect[] {
  return driversOf(s, g).map((d) => {
    const fixed = s.appliedFixes.includes(d.id);
    const recovered = fixed ? recoveryOf(d) : 0;
    let sigma = fixed ? 0 : d.sigma;
    if (s.rebalanceApplied && d.workstreamId === rebalanceRecipient(g) && d.kind === "growth") sigma *= FUNDED_SIGMA_FACTOR;
    return { driver: d, sunk: d.sunk, pastRate: sunkOf(g, d), forward: d.forward - recovered, recovered, sigma, fixed };
  });
}

/** Spread a month landing across days by the group's demand profile. */
function spread(g: GroupId, amount: number, from = 1, to = DAYS): number[] {
  const out = zeros();
  const w = weights(PROFILES[g], from, to);
  const total = sum(w);
  w.forEach((x, i) => (out[from - 1 + i] = (amount * x) / total));
  return out;
}

/** Driver daily spend: the same daily rate before and after today, shaped by the demand profile. */
function driverDaily(g: GroupId, e: DriverEffect): number[] {
  const out = zeros();
  const start = e.driver.startDay;
  if (e.pastRate > 0 && start <= TODAY) addInto(out, spread(g, e.pastRate, start, TODAY));
  addInto(out, spread(g, e.forward, Math.max(start, TODAY + 1), DAYS));
  return out;
}

export function workstreamLanding(s: DemoState, ws: Workstream): number {
  const shift = scenarioOf(s).workstreamShift[ws.id] ?? 0;
  return ws.baseLanding + shift;
}

function groupDaily(s: DemoState, g: GroupId): { daily: number[]; variance: number } {
  const daily = zeros();
  for (const ws of workstreamsOf(g)) addInto(daily, spread(g, workstreamLanding(s, ws)));
  let variance = GROUPS[g].baseSigma ** 2;
  for (const e of driverEffects(s, g)) {
    addInto(daily, driverDaily(g, e));
    // Totals stay as booked: the driver's extra past spend at its real rate comes out of the team's other past spend.
    if (e.pastRate > e.sunk) addInto(daily, spread(g, e.sunk - e.pastRate, e.driver.startDay, TODAY));
    variance += e.sigma ** 2;
  }
  if (s.rebalanceApplied && g === "pe") addInto(daily, spread(g, REBALANCE_MIX_COST, TODAY + 1, DAYS));
  return { daily, variance };
}

export function statusFor(p50: number, pool: number): Status {
  if (p50 > pool) return "Over budget";
  if (p50 < 0.85 * pool) return "Budget remaining";
  return "On track";
}

export function forecast(s: DemoState, sel: GroupSelection): Forecast {
  const groups = sel === "all" ? GROUP_IDS : [sel];
  const daily = zeros();
  let variance = 0;
  let pool = 0;
  let original = 0;
  const planDaily = zeros();
  for (const g of groups) {
    const r = groupDaily(s, g);
    addInto(daily, r.daily);
    variance += r.variance;
    pool += poolOf(s, g);
    original += GROUPS[g].originalForecast;
    addInto(planDaily, spread(g, poolOf(s, g)));
  }
  const sigma = Math.sqrt(variance);
  const p50 = sum(daily);
  const actualToDate = sum(daily.slice(0, TODAY));
  const p90 = p50 + Z90 * sigma;
  const status = statusFor(p50, pool);

  // Variance accrues over remaining days in proportion to remaining demand.
  const remW = sel === "all" ? daily.slice(TODAY) : weights(PROFILES[sel], TODAY + 1, DAYS);
  const remTotal = sum(remW);
  const series: DayPoint[] = [];
  let cum = 0;
  let plan = 0;
  let remCum = 0;
  for (let d = 1; d <= DAYS; d++) {
    cum += daily[d - 1];
    plan += planDaily[d - 1];
    const pt: DayPoint = { day: d, plan, ceiling: pool };
    if (d <= TODAY) pt.actual = cum;
    if (d >= TODAY) {
      if (d > TODAY) remCum += remW[d - TODAY - 1];
      const spreadD = Z90 * sigma * Math.sqrt(remCum / remTotal);
      pt.p50 = cum;
      pt.p90 = cum + spreadD;
      pt.band = [cum, cum + spreadD];
    }
    series.push(pt);
  }

  const growthOver = groups.some((g) => driversOf(s, g).some((d) => d.kind === "growth"));
  const fundedVariance = status === "Over budget" && growthOver && (s.rebalanceApplied || s.overrides.length > 0);
  return {
    groupId: sel, pool, actualToDate, p50, p90, sigma, status, fundedVariance,
    overForecastPct: (p50 - original) / original, series,
  };
}

// ---------- Members and the cost of caps ----------

export interface MemberProjection {
  id: string;
  cohort: Member["cohort"];
  workstreamId: string;
  limit: number;
  total: number;
  cumulative: number[];
  /** Day the member would hit today's per-member limit, or null. */
  blockDay: number | null;
  excess: number;
  evidenced: boolean;
}

/** Per person, a driver's month total runs at one even daily rate (shaped by the weekly pattern) from the day it started. */
function memberDriverDaily(g: GroupId, e: DriverEffect): number[] {
  return spread(g, e.sunk + e.forward, Math.max(1, e.driver.startDay), DAYS);
}

export function memberProjections(s: DemoState, g: GroupId): MemberProjection[] {
  const grp = GROUPS[g];
  const tenured = tenuredMembers(g);
  const newbies = scenarioOf(s).newMembers.filter((m) => m.groupId === g);
  const effects = driverEffects(s, g);
  const tDemand = sum(tenured.map((m) => m.baseDemand));
  const nDemand = sum(newbies.map((m) => m.baseDemand));
  const wsTier = (id: string) => workstreamsOf(g).find((w) => w.id === id)?.tier ?? 1;

  const project = (m: Member): MemberProjection => {
    const daily = spread(g, m.cohort === "tenured" ? m.baseDemand : 0);
    for (const e of effects) {
      const pool = e.driver.cohort === "new" ? (m.cohort === "new" ? nDemand : 0) : m.cohort === "tenured" ? tDemand : 0;
      if (!pool) continue;
      // Per person, a driver's month total runs at an even daily rate from the day it started (not back-loaded),
      // so people reach their limits on the days they really would.
      addInto(daily, memberDriverDaily(g, e), (e.driver.memberShare * m.baseDemand) / pool);
    }
    const limit = m.cohort === "new" ? grp.newMemberLimit : grp.memberLimit;
    const cumulative: number[] = [];
    let c = 0;
    let blockDay: number | null = null;
    daily.forEach((v, i) => {
      c += v;
      cumulative.push(c);
      if (blockDay === null && c >= limit) blockDay = i + 1;
    });
    return {
      id: m.id, cohort: m.cohort, workstreamId: m.workstreamId, limit, total: c, cumulative, blockDay,
      excess: Math.max(0, c - limit), evidenced: wsTier(m.workstreamId) >= 2,
    };
  };
  return [...tenured, ...newbies].map(project);
}

export interface Throttle {
  /** Members projected to hit today's per-member limit this month. */
  blockedMonth: number;
  blockedToday: number;
  blockedByDay22: number;
  /** Projected spend blocked on evidenced (tier 2+) work. */
  value: number;
  /** Blocking days, for chart markers: day -> count. */
  blockDays: Record<number, number>;
  newHiresBlockedByDay22: number;
}

/** Members over today's limit after any funding, plus the value still at risk. Shared by caps (throttle) and pacing. */
export function unfundedOver(s: DemoState, g: GroupId): { still: MemberProjection[]; value: number } {
  const ms = memberProjections(s, g).filter((m) => m.blockDay !== null);
  let value = Math.round(sum(ms.filter((m) => m.evidenced).map((m) => m.excess)));
  const funded = new Set<string>();
  if (s.rebalanceApplied && g === "pe") {
    // Moved headroom funds blocked work in the recipient workstream, smallest gaps first (counts only, no IDs leave the engine).
    const moved = rebalancePlan(s, g).moved;
    let budget = moved;
    for (const m of ms.filter((x) => x.workstreamId === rebalanceRecipient(g)).sort((a, b) => a.excess - b.excess)) {
      const take = Math.min(budget, m.excess);
      budget -= take;
      if (take >= m.excess - 0.5) funded.add(m.id);
    }
    value = Math.max(0, value - moved);
  }
  // An approved budget increase raises limits for the work it was asked for: it funds the remaining blocked work, smallest gaps first.
  const raise = (s.budgetRevisions[g] ?? 0) - (GROUPS[g]?.pool ?? 0);
  if (raise > 0) {
    let budget = raise;
    for (const m of ms.filter((x) => !funded.has(x.id) && x.evidenced).sort((a, b) => a.excess - b.excess)) {
      const take = Math.min(budget, m.excess);
      budget -= take;
      if (take >= m.excess - 0.5) funded.add(m.id);
    }
    value = Math.max(0, value - raise);
  }
  return { still: ms.filter((m) => !funded.has(m.id)), value };
}

export function throttle(s: DemoState, g: GroupId): Throttle {
  const { still, value } = unfundedOver(s, g);
  const blockDays: Record<number, number> = {};
  still.forEach((m) => (blockDays[m.blockDay!] = (blockDays[m.blockDay!] ?? 0) + 1));
  const blockedMonth = still.length;
  return {
    blockedMonth,
    blockedToday: still.filter((m) => m.blockDay! <= TODAY).length,
    blockedByDay22: still.filter((m) => m.blockDay! <= 22).length,
    value,
    blockDays,
    newHiresBlockedByDay22: still.filter((m) => m.cohort === "new" && m.blockDay! <= 22).length,
  };
}

// ---------- Workstreams and rebalancing ----------

export interface WorkstreamPace {
  ws: Workstream;
  target: number;
  actualToDate: number;
  landing: number;
  pace: number; // actual / (target x plan fraction to date)
  tier: Tier;
  membersBlocked: number;
}

export function workstreamPaces(s: DemoState, g: GroupId): WorkstreamPace[] {
  const frac = planFraction(PROFILES[g], TODAY);
  const effects = driverEffects(s, g);
  const blocked = memberProjections(s, g).filter((m) => m.blockDay !== null);
  const plan = s.rebalanceApplied ? rebalancePlanRaw(s, g) : null;
  return workstreamsOf(g).map((ws) => {
    const base = workstreamLanding(s, ws);
    const mine = effects.filter((e) => e.driver.workstreamId === ws.id);
    const actualToDate = base * frac + sum(mine.map((e) => e.sunk));
    const landing = base + sum(mine.map((e) => e.sunk + e.forward)) + (plan && ws.id === plan.recipientId ? REBALANCE_MIX_COST : 0);
    const delta = plan ? (ws.id === plan.recipientId ? plan.moved : -(plan.donors.find((d) => d.id === ws.id)?.move ?? 0)) : 0;
    const target = ws.target + delta;
    let tier = Math.max(ws.tier, ...mine.map((e) => e.driver.tier).filter((t) => t <= 2)) as Tier;
    // Survival data (tier 3) upgrades work that already has deterministic output (tier 2).
    if ((s.tier3Arrived || s.tier5Imported) && tier === 2) tier = 3;
    return {
      ws, target, actualToDate, landing, pace: actualToDate / (ws.target * frac), tier,
      membersBlocked: blocked.filter((m) => m.workstreamId === ws.id).length,
    };
  });
}

/** Highest evidence tier reached in the group this month (drives what actions unlock). */
export function evidenceTier(s: DemoState, g: GroupId): Tier {
  let t = Math.max(...workstreamsOf(g).map((w) => w.tier), ...driversOf(s, g).map((d) => d.tier)) as Tier;
  if (s.tier3Arrived) t = Math.max(t, 3) as Tier;
  if (s.tier5Imported) t = 5;
  return t;
}

/** Tier that gates rebalancing: the recipient's deterministic evidence (tiers 2 and 3), not attested tier 4. */
export function rebalanceTier(s: DemoState, g: GroupId): Tier {
  let t: Tier = Math.max(...workstreamsOf(g).map((w) => w.tier)) as Tier;
  if (s.tier3Arrived || s.tier5Imported) t = Math.max(t, 3) as Tier;
  return t;
}

export const rebalanceRecipient = (g: GroupId) => (g === "pe" ? "pe-pay" : "");

export interface RebalancePlan {
  groupId: GroupId;
  rung: SharingLevel;
  rungLabel: string;
  requiredTier: Tier;
  tier: Tier;
  allowed: boolean;
  reason: string;
  donors: { id: string; name: string; pace: number; remaining: number; max: number; move: number }[];
  recipientId: string;
  recipientName: string;
  moved: number;
  throttledBefore: number;
  throttledAfter: number;
  /** Largest change to any workstream's target, as a share of it (stability rule: at most MAX_TARGET_CHANGE). */
  largestChange: { name: string; share: number };
}

/** Stability rule: no workstream's target moves more than this in one month without an admin override. */
export const MAX_TARGET_CHANGE = 0.2;

function rebalancePlanRaw(s: DemoState, g: GroupId): RebalancePlan {
  const frac = planFraction(PROFILES[g], TODAY);
  const noRebalance = { ...s, rebalanceApplied: false };
  const paces = workstreamPaces({ ...noRebalance }, g);
  const share = RUNG_SHARE[s.sharingLevel];
  const donors = paces
    .filter((p) => p.pace < 0.5)
    .map((p) => {
      const remaining = p.ws.target - p.actualToDate;
      return { id: p.ws.id, name: p.ws.name, pace: p.pace, remaining, max: Math.min(share * remaining, MAX_TARGET_CHANGE * p.ws.target), move: 0 };
    });
  const recipientId = rebalanceRecipient(g);
  const recipient = paces.find((p) => p.ws.id === recipientId);
  const before = throttle(noRebalance, g).value;
  const cap = sum(donors.map((d) => d.max));
  const recipientCap = recipient ? MAX_TARGET_CHANGE * recipient.ws.target : 0;
  const moved = Math.floor(Math.min(cap, before, recipientCap) / 100) * 100;
  donors.forEach((d) => (d.move = cap > 0 ? Math.round((moved * d.max) / cap) : 0));
  const tier = rebalanceTier(s, g);
  const requiredTier = RUNG_TIER[s.sharingLevel];
  let reason = "";
  if (s.sharingLevel === "fixed") reason = "Budget sharing is off for this team.";
  else if (tier < requiredTier) reason = "Moving this much budget needs high-confidence evidence. The 30-day check is still pending.";
  else if (!donors.length) reason = "No workstream is pacing under half its target, so there is no unused budget to move.";
  else if (before <= 0) reason = "No evidenced work is projected to be blocked.";
  // Silence unused-variable lint for frac in future rung math.
  void frac;
  return {
    groupId: g, rung: s.sharingLevel, rungLabel: RUNG_LABEL[s.sharingLevel], requiredTier, tier,
    allowed: reason === "", reason, donors, recipientId, recipientName: recipient?.ws.name ?? "",
    moved: reason === "" ? moved : 0, throttledBefore: before, throttledAfter: reason === "" ? before - moved : before,
    largestChange: [
      ...donors.map((d) => ({ name: d.name, share: d.move / (paces.find((p) => p.ws.id === d.id)?.ws.target ?? 1) })),
      { name: recipient?.ws.name ?? "", share: recipient ? moved / recipient.ws.target : 0 },
    ].sort((a, b) => b.share - a.share)[0],
  };
}

export const rebalancePlan = (s: DemoState, g: GroupId) => rebalancePlanRaw(s, g);
