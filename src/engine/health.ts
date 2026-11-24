// Pacing health: is the system allocating well, measured without knowing what any single task is worth.
//
// Six months of the same seeded demand run under three policies:
//   caps      hard per-workload monthly limits, reset each month to last month's usage (what admins do today)
//   linear    the same allocations, released as a straight line through the month
//   pacing    ours: shrinkage estimates, damped and protected allocations, a shared pool, a slow-down
//             ladder before blocking, a daily surge allowance and early waste detection
// Then each policy is scored on system measures only: forecast calibration, when blocks land relative
// to demand, landing accuracy, allocation churn, funding persistence and output per dollar.
// Workload value is never an input. "Output" is a lagged, noisy count the policies cannot see in-month.
import { rng } from "./calendar";

export type PolicyId = "caps" | "linear" | "pacing";
export const POLICY_LABEL: Record<PolicyId, string> = { caps: "Hard caps", linear: "Straight-line", pacing: "Pacing" };
export const POLICIES: PolicyId[] = ["caps", "linear", "pacing"];

export const MONTHS = 6;
const D = 30;
export const BUDGET = 40_000;
/** Months of history at which a workload's own data and the team average count equally. */
export const SHRINK_K = 2;
/** Max share an allocation can change in one month (without an admin override). */
export const MAX_CHANGE = 0.2;
/** Share of budget held for new, unproven work. */
export const EXPLORE_SHARE = 0.06;
const CHEAPER = 0.15; // ladder step 1: cheaper model, work kept
const DEFER = 0.1; // ladder step 2: deferred runs, work waits

interface Workload {
  id: string;
  name: string;
  /** Monthly demand by month (dollars, before daily noise). */
  demand: number[];
  /** Output per dollar, hidden from every policy. */
  productivity: number;
  /** Share of spend that is scheduled agent work (deferrable). */
  agent: number;
  start: number; // first month (0-based)
  /** Month-end close work runs three times as hard in the last five days. */
  close?: boolean;
}

// The six full months before this one.
const MONTH_NAMES = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
export const monthName = (m: number) => MONTH_NAMES[m] ?? `M${m + 1}`;

/** Day weights: weekdays full, weekends half, last 3 days of each two-week sprint busier. */
function dayShape(): number[] {
  const w: number[] = [];
  for (let d = 1; d <= D; d++) {
    const wk = (d - 1) % 7 >= 5 ? 0.5 : 1;
    const sprintEnd = ((d - 1) % 14) >= 11 ? 1.3 : 1;
    w.push(wk * sprintEnd);
  }
  const t = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / t);
}
const SHAPE = dayShape();
const CLOSE_SHAPE = (() => { const w = SHAPE.map((x, d) => (d >= 25 ? 3 * x : x)); const t = w.reduce((a, b) => a + b, 0); return w.map((x) => x / t); })();
const cumOf = (sh: number[]) => sh.map((_, i) => sh.slice(0, i + 1).reduce((a, b) => a + b, 0));
const shapeOf = (w: Workload) => (w.close ? CLOSE_SHAPE : SHAPE);
const CUM = { normal: cumOf(SHAPE), close: cumOf(CLOSE_SHAPE) };
const cumShapeOf = (w: Workload) => (w.close ? CUM.close : CUM.normal);

function workloads(): Workload[] {
  const r = rng(4242);
  const walk = (base: number, start = 0, ramp = false) => {
    const out: number[] = [];
    let v = base;
    for (let m = 0; m < MONTHS; m++) {
      v *= Math.exp(0.07 * ((r() + r() + r() - 1.5) * 2));
      out.push(m < start ? 0 : ramp && m === start ? v * 0.5 : v);
    }
    return out;
  };
  const W: Workload[] = [
    { id: "pay", name: "Payments Refactor", demand: walk(7_200), productivity: 1.3, agent: 0.4, start: 0 },
    { id: "infra", name: "Infra and On-call", demand: walk(6_400), productivity: 1.0, agent: 0.5, start: 0 },
    { id: "review", name: "Code Review", demand: walk(5_200), productivity: 1.1, agent: 0.6, start: 0 },
    { id: "tool", name: "Developer Tooling", demand: walk(3_800), productivity: 0.8, agent: 0.5, start: 0 },
    { id: "close", name: "Month-end Close", demand: walk(4_600), productivity: 1.0, agent: 0.3, start: 0, close: true },
    { id: "model", name: "Forecasting Models", demand: walk(3_600), productivity: 0.9, agent: 0.3, start: 0 },
    { id: "camp", name: "Campaigns", demand: walk(3_000), productivity: 0.7, agent: 0.2, start: 0 },
    { id: "research", name: "Research", demand: walk(2_200), productivity: 0.6, agent: 0.2, start: 0 },
    // New work arrives in month 3 and ramps; an old project winds down after month 4.
    { id: "mobile", name: "Mobile Rewrite", demand: walk(4_400, 2, true), productivity: 1.4, agent: 0.4, start: 2 },
    { id: "legacy", name: "Legacy Migration", demand: walk(3_000).map((v, m) => (m >= 4 ? v * 0.25 : v)), productivity: 0.9, agent: 0.5, start: 0 },
  ];
  return W;
}

/** Daily demand with noise, plus an agent retry loop in month 2 (zero output) that only pacing detects early. */
function dailyDemand(W: Workload[]): number[][][] {
  const r = rng(99);
  return W.map((w, wi) =>
    Array.from({ length: MONTHS }, (_, m) =>
      shapeOf(w).map((s, d) => {
        const noise = Math.exp(0.22 * ((r() + r() + r() - 1.5) * 2));
        const loop = wi === 1 && m === 1 && d >= 11 ? 220 : 0; // Infra connector loop from day 12 of month 2
        return w.demand[m] * s * noise + loop;
      }),
    ),
  );
}
const LOOP_W = 1;
const LOOP_MONTH = 1;
const LOOP_START = 11;

export interface MonthScore {
  month: number;
  spend: number;
  demand: number;
  /** Forecast at day 10: absolute error as a share of actual spend, and whether actual fell in the 10-90 band. */
  forecastError: number;
  forecastInBand: number; // share of workloads whose landing fell inside their band
  /** Demand blocked (work lost), dollars and share of demand. */
  blocked: number;
  blockedShare: number;
  /** Work blocked in days 21-30, as a share of the month's demand: the month-end pile-up. */
  lateBlocked: number;
  /** Demand slowed but kept (cheaper model or deferred). */
  slowed: number;
  landingError: number; // |spend - budget| / budget
  stranded: number; // budget left unused while work was blocked elsewhere
  reshuffle: number; // sum |allocation change| / budget, vs last month
  fundedCut: number; // workloads raised last month and cut 10%+ this month while their demand held
  repeatBlocked: number; // workloads blocked 5%+ of demand this month and last
  outputPer1k: number; // hidden output per $1,000 spent
  wasteSpend: number; // spend on the zero-output retry loop
  /** How much the newest workload's estimate leans on its own data (0-1). */
  newOwnWeight: number;
}

export interface PolicyRun { policy: PolicyId; months: MonthScore[] }

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function simulate(policy: PolicyId, W: Workload[], dem: number[][][]): PolicyRun {
  const n = W.length;
  const months: MonthScore[] = [];
  let alloc: number[] = [];
  let prevAlloc: number[] = [];
  let prevBlockedShare: number[] = new Array(n).fill(0);
  let prevRaised: boolean[] = new Array(n).fill(false);
  let prevBlocked: number[] = new Array(n).fill(0);
  // What each policy can see of past demand. Caps only see what was served: blocked demand is invisible.
  // Pacing logs slowed and blocked demand too, so it sees the real thing.
  const seen: number[][] = W.map(() => []);
  const errHistory: number[] = []; // pacing's own forecast errors, to calibrate its band

  for (let m = 0; m < MONTHS; m++) {
    const active = W.map((w) => m >= w.start);
    // ----- Allocation for this month -----
    if (m === 0) {
      const tot = sum(W.map((w, i) => (active[i] ? w.demand[0] : 0)));
      alloc = W.map((w, i) => (active[i] ? (BUDGET * w.demand[0]) / tot : 0));
    } else if (policy !== "pacing") {
      // What admins do today: reset each limit to last month's usage, then hand extra budget to whoever
      // escalated (blocked 10%+ last month), taken evenly from everyone else. New work gets a token amount.
      const last = seen.map((h) => h[m - 1] ?? 0);
      const isNew = W.map((w, i) => active[i] && w.start === m);
      const reserve = isNew.filter(Boolean).length * 0.02 * BUDGET;
      const tot = sum(last);
      alloc = W.map((_, i) => (isNew[i] ? 0.02 * BUDGET : active[i] ? ((BUDGET - reserve) * last[i]) / tot : 0));
      const escalated = W.map((_, i) => active[i] && prevBlockedShare[i] >= 0.1);
      const raise = W.map((_, i) => (escalated[i] ? prevBlocked[i] : 0));
      const given = sum(raise);
      const others = sum(alloc.filter((_, i) => !escalated[i]));
      alloc = alloc.map((a, i) => (escalated[i] ? a + raise[i] : a - (given * a) / others));
    } else {
      // Ours: shrink each workload's own history toward the team average by how much data it has,
      // then damp the change, protect ramps and funded work, and hold an exploration pool for new work.
      const known = seen.filter((h) => h.length >= m && (h[m - 1] ?? 0) > 0);
      const teamMean = sum(known.map((h) => h[m - 1])) / Math.max(1, known.length);
      const est = W.map((w, i) => {
        if (!active[i]) return 0;
        const h = seen[i].slice(w.start);
        const k = h.length;
        if (!k) return teamMean * 0.5; // unknown: start from half the team average, funded from the exploration pool
        const recent = h.slice(-3);
        const own = sum(recent.map((v, j) => v * (j + 1))) / sum(recent.map((_, j) => j + 1));
        return (k * own + SHRINK_K * teamMean) / (k + SHRINK_K);
      });
      const tot = sum(est);
      alloc = est.map((e, i) => {
        const t = (BUDGET * e) / tot;
        const prev = prevAlloc[i] ?? 0;
        if (!active[i]) return 0;
        if (!prev) return Math.min(t, EXPLORE_SHARE * BUDGET); // new work: exploration pool
        const young = m - W[i].start <= 2; // protected ramp
        const demandFell = (seen[i][m - 1] ?? 0) < 0.85 * (seen[i][m - 2] ?? Infinity);
        let lo = prev * (1 - MAX_CHANGE);
        if (young || (prevRaised[i] && !demandFell)) lo = Math.max(lo, prev); // no arbitrary cuts
        return Math.min(prev * (1 + MAX_CHANGE), Math.max(lo, t));
      });
      const scale = BUDGET / sum(alloc);
      alloc = alloc.map((a) => a * scale);
    }

    // ----- Forecast at day 10 -----
    // Caps and straight-line extend spend so far in a straight line with a fixed +-10% band.
    // Pacing uses each workload's demand shape and a band sized from its own past errors.
    const day10 = 10;
    const sd = errHistory.length >= W.length ? Math.max(0.04, Math.sqrt(sum(errHistory.slice(-2 * W.length).map((e) => e * e)) / Math.min(errHistory.length, 2 * W.length))) : 0.12;
    const fc = W.map((w, i) => {
      const so = sum(dem[i][m].slice(0, day10));
      const p50 = policy === "pacing" ? so / cumShapeOf(w)[day10 - 1] : (so * D) / day10;
      const width = policy === "pacing" ? 1.2816 * sd : 0.1;
      return { p50, lo: p50 * (1 - width), hi: p50 * (1 + width) };
    });

    // ----- Serve the month day by day -----
    const served = new Array(n).fill(0);
    const blocked = new Array(n).fill(0);
    const slowed = new Array(n).fill(0);
    const cost = new Array(n).fill(0);
    const blockedLate = new Array(n).fill(0);
    let waste = 0;
    for (let d = 0; d < D; d++) {
      // Pacing: the team projection decides how much must come off the rest of the month; the cut falls on
      // workloads running over their allocation, so unused allocation elsewhere flows to busy work (shared pool).
      const cutShare = new Array(n).fill(0);
      if (policy === "pacing" && d >= 3) {
        const remaining = W.map((w, i) => (active[i] ? (sum(dem[i][m].slice(0, d)) / cumShapeOf(w)[d - 1]) * (1 - cumShapeOf(w)[d - 1]) : 0));
        const teamOver = sum(cost) + sum(remaining) - BUDGET;
        if (teamOver > 0) {
          const over = remaining.map((r, i) => Math.max(0, cost[i] + r - alloc[i]));
          const totOver = sum(over) || 1;
          over.forEach((o, i) => (cutShare[i] = remaining[i] > 0 ? Math.min(1, Math.min(o, (teamOver * o) / totOver) / remaining[i]) : 0));
        }
      }
      for (let i = 0; i < n; i++) {
        if (!active[i]) continue;
        let want = dem[i][m][d];
        // The loop: pacing's anomaly check (spend with no completed work) pauses it after two days.
        if (i === LOOP_W && m === LOOP_MONTH && d >= LOOP_START) {
          if (policy === "pacing" && d >= LOOP_START + 2) want -= 220;
          else waste += 220;
        }
        if (policy !== "pacing") {
          const room = Math.max(0, policy === "caps" ? alloc[i] - cost[i] : alloc[i] * ((d + 1) / D) - cost[i]);
          const s = Math.min(want, room);
          served[i] += s; cost[i] += s; blocked[i] += want - s;
          if (d >= 20) blockedLate[i] += want - s;
          continue;
        }
        // Ladder, in cost terms: a cheaper model saves 55% of what it touches; deferring and blocking save all of it.
        const c = cutShare[i];
        const cheaperFrac = Math.min(CHEAPER, c / 0.55);
        const deferFrac = Math.min(DEFER, Math.max(0, c - CHEAPER * 0.55));
        const blockFrac = Math.max(0, c - CHEAPER * 0.55 - DEFER);
        const cheaper = want * cheaperFrac;
        const defer = want * deferFrac;
        let block = want * blockFrac;
        let full = want - cheaper - defer - block;
        // The team budget is the only hard line. A spike day is never blocked on its own (surge allowance).
        let dayCost = full + cheaper * 0.45;
        const left = Math.max(0, BUDGET - sum(cost));
        if (dayCost > left) { const x = dayCost - left; full -= x; block += x; dayCost = left; }
        served[i] += full + cheaper; cost[i] += dayCost;
        slowed[i] += cheaper + defer; blocked[i] += block;
        if (d >= 20) blockedLate[i] += block;
      }
    }

    // ----- Score -----
    const demandM = W.map((_, i) => sum(dem[i][m]));
    const spend = sum(cost);
    const totalBlocked = sum(blocked);
    const inBand = W.map((_, i) => (active[i] ? (demandM[i] >= fc[i].lo && demandM[i] <= fc[i].hi ? 1 : 0) : null)).filter((x): x is 0 | 1 => x !== null);
    const fcErr = Math.abs(sum(fc.map((f, i) => (active[i] ? f.p50 : 0))) - sum(demandM)) / sum(demandM);
    if (policy === "pacing") W.forEach((_, i) => active[i] && demandM[i] > 0 && errHistory.push((fc[i].p50 - demandM[i]) / demandM[i]));
    const blockedShare = W.map((_, i) => (demandM[i] ? blocked[i] / demandM[i] : 0));
    const raised = alloc.map((a, i) => m > 0 && a > (prevAlloc[i] ?? 0) * 1.1);
    const fundedCut = m > 0 ? alloc.filter((a, i) => prevRaised[i] && a < (prevAlloc[i] ?? 0) * 0.9 && demandM[i] > 0.85 * sum(dem[i][m - 1])).length : 0;
    // Output: work done (served, plus most deferred work finished later) times the hidden productivity.
    const output = sum(W.map((w, i) => (served[i] + slowed[i] * 0.4) * w.productivity));
    const newest = W.filter((w) => w.start > 0 && m >= w.start).map((w) => m - w.start);
    months.push({
      month: m,
      spend,
      demand: sum(demandM),
      forecastError: fcErr,
      forecastInBand: inBand.length ? sum(inBand) / inBand.length : 0,
      blocked: totalBlocked,
      blockedShare: totalBlocked / sum(demandM),
      lateBlocked: sum(blockedLate) / sum(demandM),
      slowed: sum(slowed),
      landingError: Math.abs(spend - BUDGET) / BUDGET,
      stranded: totalBlocked > 1 ? Math.max(0, BUDGET - spend) : 0,
      reshuffle: m > 0 ? sum(alloc.map((a, i) => Math.abs(a - (prevAlloc[i] ?? 0)))) / BUDGET : 0,
      fundedCut,
      repeatBlocked: m > 0 ? blockedShare.filter((b, i) => b >= 0.05 && prevBlockedShare[i] >= 0.05).length : 0,
      outputPer1k: (output / spend) * 10, // about 10 shipped results per $1,000 at the start
      wasteSpend: waste,
      newOwnWeight: newest.length ? newest[0] / (newest[0] + SHRINK_K) : 0,
    });
    const loopDemand = (i: number) => (i === LOOP_W && m === LOOP_MONTH ? 220 * (D - LOOP_START) : 0);
    W.forEach((_, i) => seen[i].push(policy === "pacing" ? demandM[i] - loopDemand(i) : cost[i]));
    prevAlloc = alloc.slice();
    prevBlockedShare = blockedShare;
    prevBlocked = blocked.slice();
    prevRaised = raised;
  }
  return { policy, months };
}

let CACHE: PolicyRun[] | null = null;
/** Every policy over the same six months of demand. Deterministic and cached. */
export function healthRuns(): PolicyRun[] {
  if (CACHE) return CACHE;
  const W = workloads();
  const dem = dailyDemand(W);
  CACHE = POLICIES.map((p) => simulate(p, W, dem));
  return CACHE;
}

export interface HealthMetric {
  id: keyof MonthScore;
  label: string;
  good: string;
  format: "pct" | "usd" | "count" | "num";
  /** Lower is better unless false. */
  lowerBetter: boolean;
  /** When set, closest to this value is best (calibration, not "more is better"). */
  target?: number;
  /** Month-level trend from month 2 on (the first month has no history to compare). */
  fromMonth: number;
}

export const HEALTH_METRICS: HealthMetric[] = [
  { id: "forecastInBand", label: "Month-end spend inside the forecast range", good: "About 80%", format: "pct", lowerBetter: false, target: 0.8, fromMonth: 0 },
  { id: "forecastError", label: "Forecast miss on day 10", good: "Low", format: "pct", lowerBetter: true, fromMonth: 0 },
  { id: "landingError", label: "Month-end spend vs budget", good: "Close to 0%", format: "pct", lowerBetter: true, fromMonth: 0 },
  { id: "reshuffle", label: "Budget moved between workstreams", good: "Low", format: "pct", lowerBetter: true, fromMonth: 1 },
  { id: "fundedCut", label: "Funded workstreams cut the next month", good: "0", format: "count", lowerBetter: true, fromMonth: 1 },
  { id: "outputPer1k", label: "Merged PRs and passing tests per $1,000", good: "Rising", format: "num", lowerBetter: false, fromMonth: 0 },
];

export interface HealthSummary {
  months: string[];
  rows: { metric: HealthMetric; values: Record<PolicyId, number[]>; latest: Record<PolicyId, number>; average: Record<PolicyId, number> }[];
  wasteSpend: Record<PolicyId, number>;
  newOwnWeight: number[];
}

/** The pacing health table: every measure for every policy, by month, with six-month averages. */
export function pacingHealth(): HealthSummary {
  const runs = healthRuns();
  const by = (p: PolicyId) => runs.find((r) => r.policy === p)!;
  const rows = HEALTH_METRICS.map((metric) => {
    const values = Object.fromEntries(POLICIES.map((p) => [p, by(p).months.map((s) => s[metric.id] as number)])) as Record<PolicyId, number[]>;
    const latest = Object.fromEntries(POLICIES.map((p) => [p, values[p][MONTHS - 1]])) as Record<PolicyId, number>;
    const average = Object.fromEntries(POLICIES.map((p) => {
      const v = values[p].slice(metric.fromMonth);
      return [p, sum(v) / v.length];
    })) as Record<PolicyId, number>;
    return { metric, values, latest, average };
  });
  return {
    months: Array.from({ length: MONTHS }, (_, m) => monthName(m)),
    rows,
    wasteSpend: Object.fromEntries(POLICIES.map((p) => [p, Math.round(sum(by(p).months.map((s) => s.wasteSpend)))])) as Record<PolicyId, number>,
    newOwnWeight: by("pacing").months.map((s) => s.newOwnWeight),
  };
}

export function formatMetric(v: number, f: HealthMetric["format"]): string {
  if (f === "pct") return `${Math.round(v * 100)}%`;
  if (f === "usd") return `$${Math.round(v).toLocaleString("en-US")}`;
  if (f === "count") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return v.toFixed(1);
}
