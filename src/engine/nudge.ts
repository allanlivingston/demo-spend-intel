// Nudge strength comes from distance off pace in standard deviations of the remaining forecast.
// The signature takes no day of month: time enters only through sigma.
export type NudgeLevel = 0 | 1 | 2 | 3;
export type NudgeDirection = "fix" | "fund";

export const NUDGE_BOUNDS = [-Infinity, 1, 2, 3] as const; // lower bound of each level
export const HYSTERESIS = 0.5;

export interface Nudge {
  d: number;
  level: NudgeLevel;
  direction: NudgeDirection;
  admin: string;
  builder: string;
  action: "none" | "digest" | "recommend" | "urgent-routing" | "fund-prompt";
}

export function distanceOffPace(p50: number, ceiling: number, sigma: number): number {
  return sigma > 0 ? (p50 - ceiling) / sigma : 0;
}

function rawLevel(d: number): NudgeLevel {
  if (d >= 3) return 3;
  if (d >= 2) return 2;
  if (d >= 1) return 1;
  return 0;
}

/** Steps up immediately; steps down only once d falls HYSTERESIS below the current level's lower bound. */
export function levelWithHysteresis(d: number, previous: NudgeLevel | null): NudgeLevel {
  const raw = rawLevel(d);
  if (previous === null || raw >= previous) return raw;
  let lvl = previous;
  while (lvl > raw && d < NUDGE_BOUNDS[lvl] - HYSTERESIS) lvl = (lvl - 1) as NudgeLevel;
  return lvl;
}

export function nudge(d: number, direction: NudgeDirection, previous: NudgeLevel | null = null): Nudge {
  const level = levelWithHysteresis(d, previous);
  const base = { d, level, direction };
  if (level === 0) return { ...base, admin: "On pace: nothing to do", builder: "Nothing", action: "none" };
  if (level === 1) return { ...base, admin: "Weekly digest line", builder: "Frontier window remaining in the status line", action: "digest" };
  if (level === 2) return { ...base, admin: "Active fund-or-fix recommendation", builder: direction === "fix" ? "Private in-flow nudges on fixable waste" : "Nothing", action: "recommend" };
  return direction === "fix"
    ? { ...base, admin: "Urgent: approve routing fixes", builder: "One-time notice once routine subagents move to Sonnet", action: "urgent-routing" }
    : { ...base, admin: "Fund prompt with a draft budget owner brief", builder: "Nothing: the work is the point", action: "fund-prompt" };
}

export function nudgeSummary(n: Nudge): string {
  if (n.d <= 0) return `${Math.abs(n.d).toFixed(1)} sd under the ceiling: on pace`;
  return `${n.d.toFixed(1)} sd over pace: ${n.admin.charAt(0).toLowerCase()}${n.admin.slice(1)}`;
}
