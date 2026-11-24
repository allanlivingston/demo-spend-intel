// Artifacts are built only from engine values. Claude (later) chooses which to draft; it never writes their numbers.
import { levelOfTier } from "./confidence";
import { z } from "zod";
import { GROUPS } from "./data";
import { breakdown, kpis, usd } from "./insights";
import { driverEffects, evidenceTier, forecast, MAX_TARGET_CHANGE, poolOf, rebalancePlan, throttle, isDeclined } from "./model";
import { evidenceAge } from "./pacing";
import { policyRow } from "./routing";
import { SIGNAL_COUNTS } from "./evidence";
import type { DemoState, GroupId } from "./types";

const StatusZ = z.enum(["On track", "Budget remaining", "Over budget"]);
const Landing = z.object({ p50: z.number(), p90: z.number(), status: StatusZ });

export const PolicyDiffZ = z.object({
  kind: z.literal("policy_diff"),
  id: z.string(),
  groupId: z.enum(["pe", "fpa", "mkt"]),
  driverIds: z.array(z.string()),
  rows: z.array(z.object({ driverId: z.string(), control: z.string(), before: z.string(), after: z.string(), savings: z.number(), method: z.string() })),
  total: z.number(),
  before: Landing,
  after: Landing,
  pool: z.number(),
});
export type PolicyDiff = z.infer<typeof PolicyDiffZ>;

export const RebalanceZ = z.object({
  kind: z.literal("rebalance_plan"),
  id: z.string(),
  groupId: z.enum(["pe", "fpa", "mkt"]),
  rungLabel: z.string(),
  requiredTier: z.number(),
  tier: z.number(),
  allowed: z.boolean(),
  reason: z.string(),
  donors: z.array(z.object({ name: z.string(), pace: z.number(), move: z.number() })),
  recipientName: z.string(),
  moved: z.number(),
  throttledBefore: z.number(),
  throttledAfter: z.number(),
  before: Landing,
  after: Landing,
  /** The stability rules this plan stays inside, in plain words. */
  limits: z.array(z.string()).optional(),
});
export type RebalanceArtifact = z.infer<typeof RebalanceZ>;

export const REASON_CODES = ["Planned SOC 2 audit prep", "Approved product launch", "New team onboarding", "Other"] as const;
export const FUNDING_PATHS = ["Pull from Q4 innovation budget", "Ask the budget owner"] as const;

export const OverrideZ = z.object({
  kind: z.literal("governed_override"),
  id: z.string(),
  groupId: z.enum(["pe", "fpa", "mkt"]),
  driverId: z.string(),
  driverLabel: z.string(),
  amount: z.number(),
  tier: z.number(),
  evidence: z.array(z.string()),
  suggestedReason: z.enum(REASON_CODES),
  suggestedFunding: z.enum(FUNDING_PATHS),
});
export type OverrideArtifact = z.infer<typeof OverrideZ>;

export const CfoBriefZ = z.object({
  kind: z.literal("cfo_brief"),
  id: z.string(),
  groupId: z.enum(["pe", "fpa", "mkt"]),
  groupName: z.string(),
  currentBudget: z.number(),
  requested: z.number(),
  newBudget: z.number(),
  p50: z.number(),
  p90: z.number(),
  statusBefore: StatusZ,
  statusAfter: StatusZ,
  fix: z.number(),
  fund: z.number(),
  evidence: z.array(z.object({ tier: z.string(), count: z.number(), detail: z.string() })),
  overrideRate: z.number(),
  throttledAvoided: z.number(),
  recommendation: z.string(),
  /** Team-level return: shipped results (merged PRs, newly passing tests) per $1,000 spent so far. Never per task. */
  outputPer1k: z.number().optional(),
  markdown: z.string(),
});
export type CfoBrief = z.infer<typeof CfoBriefZ>;

export type Artifact = PolicyDiff | RebalanceArtifact | OverrideArtifact | CfoBrief | Handoff;

export const landing = (s: DemoState, g: GroupId) => {
  const f = forecast(s, g);
  return { p50: f.p50, p90: f.p90, status: f.status };
};

export function draftPolicyDiff(s: DemoState, g: GroupId, driverIds?: string[]): PolicyDiff {
  const open = driverEffects(s, g).filter((e) => e.driver.kind === "waste" && !e.fixed && !isDeclined(s, e.driver.id)).map((e) => e.driver);
  const chosen = driverIds?.length ? open.filter((d) => driverIds.includes(d.id)) : open;
  const rows = chosen.map(policyRow).filter((r): r is NonNullable<typeof r> => r !== null);
  const after: DemoState = { ...s, appliedFixes: [...s.appliedFixes, ...rows.map((r) => r.driverId)] };
  return {
    kind: "policy_diff",
    id: `pd-${rows.map((r) => r.driverId).join("+")}`,
    groupId: g,
    driverIds: rows.map((r) => r.driverId),
    rows,
    total: rows.reduce((a, r) => a + r.savings, 0),
    before: landing(s, g),
    after: landing(after, g),
    pool: poolOf(s, g),
  };
}

export function draftRebalance(s: DemoState, g: GroupId): RebalanceArtifact {
  const p = rebalancePlan(s, g);
  return {
    kind: "rebalance_plan",
    id: `rb-${g}-${s.sharingLevel}`,
    groupId: g,
    rungLabel: p.rungLabel,
    requiredTier: p.requiredTier,
    tier: p.tier,
    allowed: p.allowed,
    reason: p.reason,
    donors: p.donors.map((d) => ({ name: d.name, pace: d.pace, move: d.move })),
    recipientName: p.recipientName,
    moved: p.moved,
    throttledBefore: p.throttledBefore,
    throttledAfter: p.throttledAfter,
    before: landing({ ...s, rebalanceApplied: false }, g),
    after: landing({ ...s, rebalanceApplied: p.allowed }, g),
    limits: p.allowed ? rebalanceLimits(s, p) : [],
  };
}

function rebalanceLimits(s: DemoState, p: ReturnType<typeof rebalancePlan>): string[] {
  const age = evidenceAge(s, p.recipientId);
  return [
    `No workstream's target changes by more than ${Math.round(MAX_TARGET_CHANGE * 100)}% this month. The largest change is ${p.largestChange.name} at ${Math.round(p.largestChange.share * 100)}%.`,
    `Budget only comes from workstreams that have used less than half their target.`,
    ...(age.protectedRamp ? [`${p.recipientName} is new, so this budget is not taken back before ${age.settles ?? "its 30-day check"}.`] : []),
  ];
}

export function draftOverride(s: DemoState, g: GroupId, driverId = "b-soc2"): OverrideArtifact {
  const d = driverEffects(s, g).find((e) => e.driver.id === driverId)?.driver;
  if (!d) throw new Error(`No driver ${driverId} in ${g}`);
  return {
    kind: "governed_override",
    id: `ov-${driverId}`,
    groupId: g,
    driverId,
    driverLabel: d.label,
    amount: d.forward,
    tier: d.tier,
    evidence: d.evidence,
    suggestedReason: driverId === "b-soc2" ? "Planned SOC 2 audit prep" : "New team onboarding",
    suggestedFunding: "Ask the budget owner",
  };
}

/** Override rate: share of this month's growth drivers reclassified by a person. */
export function overrideRate(s: DemoState, g: GroupId): number {
  const growth = driverEffects(s, g).filter((e) => e.driver.kind === "growth");
  if (!growth.length) return 0;
  return growth.filter((e) => s.overrides.includes(e.driver.id)).length / growth.length;
}

export function draftCfoBrief(s: DemoState, g: GroupId): CfoBrief {
  const f = forecast(s, g);
  const pool = poolOf(s, g);
  const requested = Math.max(0, Math.ceil((f.p50 - pool) / 500) * 500);
  const newBudget = pool + requested;
  const b = breakdown(s, g);
  const fix = b.rows.filter((r) => r.side === "fix" && r.state === "open").reduce((a, r) => a + r.recoverable, 0);
  const fund = b.rows.filter((r) => r.side === "fund").reduce((a, r) => a + r.projected, 0);
  const counts = SIGNAL_COUNTS[g];
  const drivers = driverEffects(s, g).map((e) => e.driver);
  const evidence = [
    { tier: "Waste", count: counts[1] ?? 0, detail: fix > 0 ? `${usd(fix)} of fixable waste open` : "No open waste" },
    { tier: "Shipped work", count: counts[2] ?? 0, detail: drivers.filter((d) => d.tier === 2).flatMap((d) => d.evidence.slice(0, 2)).join(", ") || "None" },
    { tier: "Code still in use", count: s.tier3Arrived ? 27 : 0, detail: s.tier3Arrived ? "27 PRs still in use after 30 days" : "Too early to tell: the code is under 30 days old" },
    { tier: "Team reports", count: counts[4] ?? 0, detail: drivers.filter((d) => d.tier === 4).flatMap((d) => d.evidence).join(", ") || "None" },
  ];
  // Work still at risk today, the same figure the forecast shows; the increase removes it.
  const throttledBase = throttle(s, g).value;
  const rate = overrideRate(s, g);
  const tier = evidenceTier(s, g);
  const recommendation =
    requested === 0
      ? "No increase needed: the budget covers where spend lands."
      : `Approve ${usd(requested)}. The extra spend is new work with ${levelOfTier(Math.min(tier, 4)).toLowerCase()} confidence that it is producing results, not waste.${throttledBase > 0 ? ` Without it, ${usd(throttledBase)} of that work is slowed or held.` : ""}`;
  const name = GROUPS[g].name;
  const outputPer1k = Math.round(((counts[2] ?? 0) / (f.actualToDate / 1000)) * 10) / 10;
  const statusAfter = forecast({ ...s, budgetRevisions: { ...s.budgetRevisions, [g]: newBudget } }, g).status;
  const markdown = [
    `# Budget owner brief: ${name}`,
    ``,
    `**Request:** ${usd(requested)} (budget ${usd(pool)} to ${usd(newBudget)})`,
    ``,
    `| | Now | If approved |`,
    `|---|---|---|`,
    `| Lands at | ${usd(f.p50)} | ${usd(f.p50)} |`,
    `| High case | ${usd(Math.round(f.p90 / 100) * 100)} | ${usd(Math.round(f.p90 / 100) * 100)} |`,
    `| Status | ${f.status} | ${statusAfter} |`,
    ``,
    `**New work to fund:** ${usd(fund)}. **Waste still open:** ${usd(fix)}.`,
    ``,
    `**Evidence:**`,
    ...evidence.map((e) => `- ${e.tier}: ${e.detail}`),
    ``,
    `**Team output:** ${outputPer1k} merged PRs and newly passing tests per $1,000 spent so far.`,
    `**Planned spend approval rate this month:** ${Math.round(rate * 100)}%`,
    `**Work slowed without it:** ${usd(throttledBase)}`,
    ``,
    `**Recommendation:** ${recommendation}`,
  ].join("\n");
  return {
    kind: "cfo_brief", id: `cfo-${g}`, groupId: g, groupName: name, currentBudget: pool, requested, newBudget,
    p50: f.p50, p90: f.p90, statusBefore: f.status, statusAfter, fix, fund, evidence, overrideRate: rate,
    throttledAvoided: throttledBase, recommendation, outputPer1k, markdown,
  };
}

// Re-exported for convenience in UI.
export { kpis };

// ---------- Hand-off preview (agents act only within the admin's permissions) ----------

export const HandoffZ = z.object({
  kind: z.literal("handoff"),
  id: z.string(),
  driverId: z.string(),
  recipient: z.string(),
  channel: z.string(),
  title: z.string(),
  body: z.string(),
});
export type Handoff = z.infer<typeof HandoffZ>;

export function draftHandoff(s: DemoState, g: GroupId, driverId: string): Handoff {
  const d = driverEffects(s, g).find((e) => e.driver.id === driverId)?.driver;
  if (!d) throw new Error(`No driver ${driverId} in ${g}`);
  if (driverId === "a-cache")
    return {
      kind: "handoff", id: `ho-${driverId}`, driverId, recipient: "Dev tools team, shared Claude Code setup",
      channel: "Pre-loaded Claude Code diagnostic session",
      title: "Shared session start breaks the prompt cache since day 12",
      body: `Since day 12 a shared hook adds the date at the top of every Claude Code session, so the start of each session changes and the cache hit rate fell from 78% to 31%, costing ${usd(d.forward)} to month end. The session opens on the shared hook with the cache usage attached; moving the date below the stable part fixes it. Detected from cache telemetry only: no prompt text was read. The fix is yours to apply.`,
    };
  return {
    kind: "handoff", id: `ho-${driverId}`, driverId, recipient: "Connector owner, Jira MCP",
    channel: "Ticket draft",
    title: "Jira MCP create_issue failing with 401",
    body: `9,400 retries since day 14 with 0 successful writes; every create_issue call returns 401. Projected cost if left running: ${usd(d.forward)} to month end. Auto-retry is paused pending admin approval. Likely cause: an expired service token.`,
  };
}
