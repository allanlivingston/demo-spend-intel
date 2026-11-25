// Pacing and hard limits for the current month, as one system.
//
// The month's overrun is planned up front at team level and held back evenly, day by day, down one ladder:
//   1. Cheaper model: routine work is routed to a cheaper model. The work still gets done now.
//   2. Paused: scheduled agent runs wait. The work gets done later.
//   3. Hard throttled: runs are refused for a few hours, then allowed again.
// Burst days (a big agent run, a long session) that go over the daily limit go down the same ladder: most of the
// excess moves to a lighter default model (people can switch back for a task that needs it), and only what that
// doesn't cover waits or is held for a few hours.
// Every number about pacing in the app (chart, Users, Workstreams, headline, chat) comes from monthStrip() below.
import { DAYS, TODAY, weights } from "./calendar";
import { GROUP_IDS } from "./data";
import { driverEffects, isDeclined, memberProjections, scenarioOf, unfundedOver, type MemberProjection } from "./model";
import { SHRINK_K } from "./health";
import type { DemoState, GroupId, GroupSelection } from "./types";

/** Up to this share of a person's spend can move to a cheaper model, and up to DEFER_SHARE more can pause. */
export const CHEAPER_SHARE = 0.15;
export const DEFER_SHARE = 0.1;
export const SLOW_MAX = CHEAPER_SHARE + DEFER_SHARE;
/** Share of days that are burst days, and how big a burst is against a normal day. */
export const BURST_SHARE = 0.12;
export const BURST_SIZE = 3.5;
/** Daily limit per person, as a multiple of an even daily share of their monthly limit. */
export const CAPS_DAILY_X = 2;
/** Share of a burst's excess a lighter default model covers. Below 1 because people can switch back to the bigger model. */
export const BURST_CHEAPER = 0.6;
/** Of the burst excess the lighter default doesn't cover: the share that can wait (scheduled runs); the rest is held for a few hours. */
export const BURST_DEFERRABLE = 0.7;

/** Highest step someone reaches: cheaper model, paused, hard throttled. ("blocked" is kept for stopped-for-the-month.) */
export type PaceStep = "cheaper" | "deferred" | "rationed" | "blocked";

export interface MemberPace {
  id: string;
  cohort: MemberProjection["cohort"];
  workstreamId: string;
  step: PaceStep;
  /** Share of their runs from today to month end that is held back, all steps together. */
  trim: number;
  /** Share of their runs from today to month end that is hard throttled. */
  hardShare: number;
  /** Not used: nobody is stopped for the month. */
  blockDay: number | null;
  /** Day a plain monthly limit would cut them off, or null if they stay under it. */
  capsBlockDay: number | null;
}

export interface PacingResult {
  members: MemberPace[];
  /** People whose runs are only moved to a cheaper model or paused. */
  slowed: number;
  /** People with some runs hard throttled. */
  rationed: number;
  /** Share of runs hard throttled from today, across the people with any hard throttling. */
  rationShare: number;
  blocked: number;
  firstBlockDay: number | null;
  /** People over their monthly limit, and the first day a plain monthly limit would cut one off. */
  capsBlocked: number;
  capsFirstBlockDay: number | null;
  /** Held back per day from today (index 0 = day 1; earlier days are 0). */
  heldPacing: number[];
  /** What a plain monthly limit would hold back per day, for comparison. */
  heldCaps: number[];
  /** The whole month, held back per day: all steps, then throttled (cheaper + paused) and hard throttled. */
  heldPacingMonth: number[];
  throttledPacingMonth: number[];
  blockedPacingMonth: number[];
  pacingStartDay: number | null;
  /** Share of what is held back that falls on days 26-30. */
  lateShare: { pacing: number; caps: number };
  /** From today to month end: cheaper model, paused, hard throttled. */
  split: { cheaper: number; deferred: number; held: number };
  /** Share of the team's runs from today to month end that is slowed or held, all steps together. */
  teamShare: number;
}

const daily = (m: MemberProjection) => m.cumulative.map((c, i) => c - (i ? m.cumulative[i - 1] : 0));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function burst(id: string, day: number): number {
  let h = 2166136261;
  for (const ch of `${id}:${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const u = ((h >>> 0) % 10000) / 10000;
  return u < BURST_SHARE ? BURST_SIZE : (1 - BURST_SHARE * BURST_SIZE) / (1 - BURST_SHARE);
}

export interface StripMember {
  id: string;
  groupId: GroupId;
  demand: number[];
  rerouted: number[];
  paused: number[];
  hard: number[];
}

export interface MonthStrip {
  /** People with any work held back this month. */
  people: number;
  demand: number[];
  /** Cheaper model + paused: the work still gets done. */
  throttled: number[];
  /** Hard throttled: refused for a few hours. */
  blocked: number[];
  rerouted: number[];
  paused: number[];
  hardThrottled: number[];
  stopped: number[];
  /** People first hard throttled on each day. */
  firstBlocks: Record<number, number>;
  members: StripMember[];
}

export function monthStrip(s: DemoState, sel: GroupSelection): MonthStrip {
  const groups: GroupId[] = sel === "all" ? GROUP_IDS : [sel];
  const z = () => new Array<number>(DAYS).fill(0);
  const out: MonthStrip = { people: 0, demand: z(), throttled: z(), blocked: z(), rerouted: z(), paused: z(), hardThrottled: z(), stopped: z(), firstBlocks: {}, members: [] };
  for (const g of groups) {
    const team = memberProjections(s, g);
    const overIds = new Set(unfundedOver(s, g).still.map((m) => m.id));
    const dem = team.map((m) => daily(m).map((v, i) => v * burst(m.id, i + 1)));
    // Work with evidence that it is producing results is slowed last: here the rest of the team absorbs the overrun, and its overrun is the case for funding it.
    const prot = team.map((m) => isProtected(s, g, m));
    // 1. The month's totals for each step: each over-limit person's overrun goes down the ladder; burst-day excess
    //    over the daily limit first moves to a lighter default model (60%); of the rest, 70% waits and 30% is held for a few hours.
    let R = 0;
    let P = 0;
    let H = 0;
    team.forEach((m, k) => {
      if (prot[k]) return;
      if (overIds.has(m.id)) {
        const t = Math.max(0, m.total - m.limit) / Math.max(1, m.total);
        R += m.total * Math.min(t, CHEAPER_SHARE);
        P += m.total * (Math.min(t, SLOW_MAX) - Math.min(t, CHEAPER_SHARE));
        H += m.total * Math.max(0, t - SLOW_MAX);
      }
      const cap = CAPS_DAILY_X * (m.limit / DAYS);
      const excess = sum(dem[k].map((v) => Math.max(0, v - cap)));
      R += excess * BURST_CHEAPER;
      P += excess * (1 - BURST_CHEAPER) * BURST_DEFERRABLE;
      H += excess * (1 - BURST_CHEAPER) * (1 - BURST_DEFERRABLE);
    });
    if (R + P + H < 1) continue;
    // 2. Each total is spread evenly over the month (the same every weekday, half at weekends) and shared across the
    //    team in proportion to what each person runs that day.
    const w = weights("engineering");
    const wSum = sum(w);
    team.forEach((m, k) => {
      if (prot[k]) {
        // Protected people still run: their work shows in the bars, with nothing slowed.
        out.people++;
        for (let i = 0; i < DAYS; i++) out.demand[i] += dem[k][i];
        return;
      }
      const rer = z();
      const pau = z();
      const hard = z();
      for (let i = 0; i < DAYS; i++) {
        if (prot[k]) continue;
        const D = sum(dem.map((d, j) => (prot[j] ? 0 : d[i])));
        if (!D) continue;
        const share = (w[i] / wSum) * (dem[k][i] / D);
        rer[i] = R * share;
        pau[i] = P * share;
        hard[i] = H * share;
      }
      if (![...rer, ...pau, ...hard].some((x) => x > 0.5)) return;
      out.people++;
      out.members.push({ id: m.id, groupId: g, demand: dem[k], rerouted: rer, paused: pau, hard });
      const fb = hard.findIndex((x) => x > 0.5) + 1;
      if (fb) out.firstBlocks[fb] = (out.firstBlocks[fb] ?? 0) + 1;
      for (let i = 0; i < DAYS; i++) {
        out.demand[i] += dem[k][i];
        out.rerouted[i] += rer[i];
        out.paused[i] += pau[i];
        out.hardThrottled[i] += hard[i];
        out.throttled[i] += rer[i] + pau[i];
        out.blocked[i] += hard[i];
      }
    });
  }
  return out;
}

/** New engineers on growth with evidence that it is producing results (not declined) are protected from slowing. */
export function isProtected(s: DemoState, g: GroupId, m: MemberProjection): boolean {
  if (m.cohort !== "new") return false;
  return driverEffects(s, g).some((e) => e.driver.kind === "growth" && e.driver.cohort === "new" && !isDeclined(s, e.driver.id));
}

/** The same month, per person and from today, for the Users and Workstreams tabs, the headline and chat. */
export function pacing(s: DemoState, sel: GroupSelection): PacingResult {
  const groups: GroupId[] = sel === "all" ? GROUP_IDS : [sel];
  const ms = monthStrip(s, sel);
  const proj = new Map(groups.flatMap((g) => memberProjections(s, g)).map((m) => [m.id, m]));
  const fromToday = (xs: number[]) => sum(xs.slice(TODAY));
  const members: MemberPace[] = ms.members.map((x) => {
    const m = proj.get(x.id)!;
    const d = Math.max(1, fromToday(x.demand));
    const r = fromToday(x.rerouted);
    const p = fromToday(x.paused);
    const h = fromToday(x.hard);
    const step: PaceStep = h > 0.5 ? "rationed" : p > 0.5 ? "deferred" : "cheaper";
    return { id: x.id, cohort: m.cohort, workstreamId: m.workstreamId, step, trim: (r + p + h) / d, hardShare: h / d, blockDay: null, capsBlockDay: m.blockDay };
  });
  const rationed = members.filter((m) => m.step === "rationed");
  const over = groups.flatMap((g) => unfundedOver(s, g).still);
  const heldCaps = new Array<number>(DAYS).fill(0);
  for (const m of over) {
    let c = 0;
    daily(m).forEach((v, i) => {
      const served = Math.min(v, Math.max(0, m.limit - c));
      heldCaps[i] += v - served;
      c += served;
    });
  }
  const heldPacingMonth = ms.demand.map((_, i) => ms.throttled[i] + ms.blocked[i]);
  const heldPacing = heldPacingMonth.map((v, i) => (i >= TODAY ? v : 0));
  const late = (xs: number[]) => { const t = sum(xs); return t ? sum(xs.slice(25)) / t : 0; };
  const first = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.min(...v) : null; };
  const firstHeld = heldPacingMonth.findIndex((v) => v > 0.5) + 1;
  return {
    members,
    slowed: members.length - rationed.length,
    rationed: rationed.length,
    rationShare: rationed.length ? sum(ms.members.map((x) => fromToday(x.hard))) / Math.max(1, sum(ms.members.filter((x) => fromToday(x.hard) > 0.5).map((x) => fromToday(x.demand)))) : 0,
    blocked: 0,
    firstBlockDay: null,
    capsBlocked: over.length,
    capsFirstBlockDay: first(over.map((m) => m.blockDay)),
    heldPacing,
    heldCaps,
    heldPacingMonth,
    throttledPacingMonth: ms.throttled,
    blockedPacingMonth: ms.blocked,
    pacingStartDay: firstHeld || null,
    lateShare: { pacing: late(heldPacingMonth), caps: late(heldCaps) },
    split: { cheaper: Math.round(fromToday(ms.rerouted)), deferred: Math.round(fromToday(ms.paused)), held: Math.round(fromToday(ms.hardThrottled)) },
    teamShare: fromToday(heldPacingMonth) / Math.max(1, fromToday(ms.demand)),
  };
}

/** One member's pacing status, for the Users tab and follow-ups. */
export function memberPace(s: DemoState, g: GroupId, id: string): MemberPace | null {
  return pacing(s, g).members.find((m) => m.id === id) ?? null;
}

export const PACE_STEP_LABEL: Record<PaceStep, string> = {
  cheaper: "Cheaper model",
  deferred: "Paused",
  rationed: "Hard throttled",
  blocked: "Stopped",
};

// ---------- How much each workstream's estimate leans on its own data ----------

/** Months of history established workstreams have in the demo. */
export const ESTABLISHED_MONTHS = 4;

export interface EvidenceAge {
  /** Days (new work) or months (established) of evidence behind the estimate. */
  label: string;
  /** Weight on the workstream's own data; the rest comes from the team average (shrinkage, k = SHRINK_K months). */
  ownWeight: number;
  isNew: boolean;
  /** For new work: when the 30-day check completes, in plain words. */
  settles: string | null;
  /** For new work: funding is protected from cuts while it ramps. */
  protectedRamp: boolean;
}

export function evidenceAge(s: DemoState, wsId: string): EvidenceAge {
  const growth = scenarioOf(s).drivers.find((d) => d.workstreamId === wsId && d.kind === "growth" && d.tier <= 2 && d.startDay > 1);
  if (growth) {
    const days = TODAY - growth.startDay + 1;
    const months = days / DAYS;
    const done = s.tier3Arrived || s.tier5Imported;
    const checkDay = growth.startDay + DAYS;
    return {
      label: `${days} days of evidence`,
      ownWeight: months / (months + SHRINK_K),
      isNew: true,
      settles: done ? null : checkDay > DAYS ? `the 30-day check completes on day ${checkDay - DAYS} next month` : `the 30-day check completes on day ${checkDay}`,
      protectedRamp: true,
    };
  }
  return { label: `${ESTABLISHED_MONTHS} months of evidence`, ownWeight: ESTABLISHED_MONTHS / (ESTABLISHED_MONTHS + SHRINK_K), isNew: false, settles: null, protectedRamp: false };
}


// ---------- The private note each person sees about their own spend ----------
/** Basic user-level nudge: what this person is shown (only them, never their team). Null when there is nothing to say yet. */
export function userNote(u: { spent: number; limit: number; landing: number; blockDay: number | null; isNew?: boolean }, pm: MemberPace | null): string | null {
  const used = Math.round((u.spent / u.limit) * 100);
  if (!pm && u.blockDay !== null && u.isNew) return "You're past your share, but your work is shipping, so you won't be slowed.";
  if (!pm) return used >= 60 ? `You've used ${used}% of your share and will finish under it.` : null;
  if (pm.step === "blocked") return `Your runs stop on day ${pm.blockDay}; ask your admin for more.`;
  const pct = Math.round(pm.trim * 100);
  return `About ${pct}% of your runs now use Sonnet${pm.hardShare > 0 ? ", wait or pause for a few hours" : " or wait a little"}, to keep the team on budget.`;
}
