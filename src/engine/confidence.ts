// Plain-English confidence for a recommendation: how sure we are that it is waste (fix) or that it pays off (fund).
// Replaces "Tier 1-5" in everything the admin reads. The tiers stay internal to the engine.
import type { Driver } from "./types";

export type ConfidenceLevel = "High" | "Medium" | "Low";
export interface Confidence { level: ConfidenceLevel; reason: string }

const WASTE_REASON: Record<string, string> = {
  "a-connector": "None of the 9,400 retries completed a write, so stopping them loses no work.",
  "a-subagents": "Sonnet completes these search and lint tasks as well as Opus does.",
  "a-cache": "Measured from cache metadata since the day 12 prompt change, without reading prompt text.",
};

/** Evidence strength as a plain level (workstreams, the evidence panel, drafts). */
export function levelOfTier(tier: number | string): ConfidenceLevel {
  if (tier === 5 || tier === 3) return "High";
  if (tier === 4 || tier === 2) return "Medium";
  return "Low";
}

export function confidenceOf(d: Driver): Confidence {
  if (d.kind === "waste") return { level: "High", reason: WASTE_REASON[d.id] ?? "The spend produced no completed work." };
  // Growth: how strong the evidence is that the spend is paying off.
  if (d.tier >= 5) return { level: "High", reason: "Backed by delivered outcomes, like closed Jira epics." };
  if (d.tier === 3) return { level: "High", reason: "The shipped code is still in place after 30 days." };
  if (d.tier === 4) return { level: "Medium", reason: "Backed by a team report and a survey, not measured output." };
  if (d.tier === 2) return { level: "Medium", reason: "Work is shipping, but the 30-day check that it lasts is still pending." };
  return { level: "Low", reason: "Only usage data so far, no evidence of shipped work." };
}
