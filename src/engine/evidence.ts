// Evidence levels: the stronger the evidence that spend pays off, the bigger the action Claude can recommend.
import type { Tier } from "./types";

export type LadderTier = Tier | "M";

export const LADDER: { tier: LadderTier; name: string; examples: string; unlocks: string }[] = [
  { tier: 1, name: "Usage only", examples: "Retry loops, cache drops, Opus on short tasks", unlocks: "Routing and retry fixes only" },
  { tier: 2, name: "Shipped work", examples: "PRs merged, tests newly passing, Cowork tasks completed", unlocks: "Share up to 20% of budget" },
  { tier: 3, name: "Code still in use", examples: "Code still in use after 30 days, artifacts reused", unlocks: "Fully shared budget" },
  { tier: 4, name: "Team reports", examples: "Team reports, surveys, planned spend approvals", unlocks: "Planned spend approvals and budget increases" },
  { tier: 5, name: "Delivered outcomes", examples: "Jira epics closed, incidents resolved", unlocks: "Budget owner briefs and next-quarter planning" },
  { tier: "M", name: "Estimated", examples: "Estimated value for chat and zero-retention sessions", unlocks: "Forecasting only, never moves money" },
];

/** Minimum tier each action needs. The UI disables actions below it and names the missing tier. */
export const ACTION_TIER = {
  routing: 1,
  rebalanceShare20: 2,
  rebalancePooled: 3,
  goodVariance: 4,
  cfoBrief: 2, // V1 ships fund briefs backed by Claude Code PR and test evidence (tier 2)
} as const satisfies Record<string, Tier>;

export function gate(action: keyof typeof ACTION_TIER, tier: Tier): { ok: boolean; reason: string } {
  const need = ACTION_TIER[action];
  return tier >= need ? { ok: true, reason: "" } : { ok: false, reason: `Needs stronger evidence: ${LADDER.find((l) => l.tier === need)!.name.toLowerCase()}` };
}

/** Synthetic signal counts per group and tier (this month). */
export const SIGNAL_COUNTS: Record<string, Partial<Record<LadderTier, number>>> = {
  pe: { 1: 18_400, 2: 243, 3: 0, 4: 9, 5: 0, M: 0 },
  fpa: { 1: 6_100, 2: 87, 3: 0, 4: 4, 5: 0, M: 0 },
  mkt: { 1: 4_900, 2: 41, 3: 0, 4: 0, 5: 0, M: 312 },
};
