// Route before throttle. Savings are measured on cost per completed task, not cost per token:
// a cheaper model that fails and retries pays for its retries here.
import type { Driver } from "./types";

export interface PolicyRow {
  driverId: string;
  control: string;
  before: string;
  after: string;
  savings: number;
  method: string;
}

export const ROUTING = {
  /** Subagent tasks currently on Opus this month (forward), and what Sonnet would cost for the same completed tasks. */
  subagentOpusCost: 9_800,
  subagentSonnetCost: 5_000,
  /** Share of down-routed tasks that retry on Sonnet. */
  sonnetRetryRate: 0.04,
  cacheHealthy: 0.78,
  cacheBroken: 0.31,
  /** Hit rate the restored prefix is expected to reach (slightly under the old peak). */
  cacheRestored: 0.7392,
  connectorRetryCapAfter: 3,
};

export function policyRow(d: Driver): PolicyRow | null {
  switch (d.id) {
    case "a-connector":
      return {
        driverId: d.id,
        control: "Jira MCP connector",
        before: "auto-retry on, unlimited",
        after: `auto-retry off after ${ROUTING.connectorRetryCapAfter} failures`,
        savings: d.forward,
        method: "Loop removed: 0 of 9,400 retries completed a write, so no completed tasks are lost.",
      };
    case "a-subagents": {
      const excess = ROUTING.subagentOpusCost - ROUTING.subagentSonnetCost;
      const penalty = ROUTING.sonnetRetryRate * ROUTING.subagentSonnetCost;
      return {
        driverId: d.id,
        control: "Claude Code subagents",
        before: "inherit Opus from parent session",
        after: "use Sonnet, Opus still available on request",
        savings: Math.round(excess - penalty),
        method: `This month's subagent work: Opus $${ROUTING.subagentOpusCost.toLocaleString()} on Sonnet $${ROUTING.subagentSonnetCost.toLocaleString()}, less ${ROUTING.sonnetRetryRate * 100}% Sonnet retries.`,
      };
    }
    case "a-cache": {
      const share = (ROUTING.cacheRestored - ROUTING.cacheBroken) / (ROUTING.cacheHealthy - ROUTING.cacheBroken);
      return {
        driverId: d.id,
        control: "Shared session start",
        before: "a hook puts the date first, so every session starts differently (hit rate 31%)",
        after: "date moved to the end, so the cache works (hit rate about 74%)",
        savings: Math.round(d.forward * share),
        method: "Gets back most of the loss: the hit rate returns to about 74%, against 78% before the drop.",
      };
    }
    default:
      return null;
  }
}

/** Fixes the admin can't apply: they go to the owner, and only count once the owner ships them. */
export const OWNER: Record<string, { name: string; short: string; owns: string }> = {
  "a-cache": { name: "Dev tools team", short: "the dev tools team", owns: "the shared Claude Code setup" },
};
export const ownerOf = (driverId: string) => OWNER[driverId];

/** Dollars a fix recovers, computed from the policy, never typed in. */
export const recoveryOf = (d: Driver) => policyRow(d)?.savings ?? 0;
