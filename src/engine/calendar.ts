// Calendar and demand profiles. 30-day month, today = day 18 (a Monday).
export const DAYS = 30;
export const TODAY = 18;
export const Z90 = 1.2816;

/** 0 = Monday ... 6 = Sunday, with day 18 a Monday. */
export function weekday(day: number): number {
  return (((day - TODAY) % 7) + 7) % 7;
}
export const isWeekend = (day: number) => weekday(day) >= 5;

export type ProfileName = "engineering" | "close" | "flat";

/** Relative demand weight for a day. Time enters forecasts only through these weights and sigma. */
export function demandWeight(profile: ProfileName, day: number): number {
  const wk = isWeekend(day) ? 0.5 : 1;
  if (profile === "close") return day >= 26 ? 3 * wk : wk; // FP&A month-end close triples
  if (profile === "flat") return isWeekend(day) ? 0.7 : 1;
  return wk;
}

export function weights(profile: ProfileName, from = 1, to = DAYS): number[] {
  const out: number[] = [];
  for (let d = from; d <= to; d++) out.push(demandWeight(profile, d));
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Fraction of the month's demand that falls on days 1..day. */
export function planFraction(profile: ProfileName, day: number): number {
  return sum(weights(profile, 1, day)) / sum(weights(profile));
}

/** Seeded PRNG (mulberry32). Never use Math.random in the engine. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
