// Demo scenarios as pure data on top of the baseline.
import { newHires } from "./data";
import type { Driver, Scenario, ScenarioId } from "./types";

const CONNECTOR: Driver = {
  id: "a-connector", groupId: "pe", workstreamId: "pe-infra", kind: "waste",
  label: "Jira MCP connector retrying in a loop", plain: "Jira link stuck retrying", actionLabel: "Connector auto-retry off after 3 failures",
  tier: 1, category: "Infra and On-call", startDay: 14, sunk: 140, forward: 4_100, recoverable: 4_100,
  sigma: 1_310, agentShare: 1, memberShare: 0,
  evidence: ["9,400 retries since day 14", "0 successful writes", "create_issue returns 401"],
  plainEvidence: ["9,400 retries since day 14", "none of them worked", "the Jira login is being refused"],
  roi: 0.05, confidence: 0.9, marker: "Day 14: Jira link starts retrying",
};

const SUBAGENTS: Driver = {
  id: "a-subagents", groupId: "pe", workstreamId: "pe-pay", kind: "waste",
  label: "Claude Code subagents inheriting Opus", plain: "Helper tasks on the priciest model", actionLabel: "Subagents use Sonnet, Opus still available on request",
  tier: 1, category: "Production Code", startDay: 17, sunk: 60, forward: 4_800, recoverable: 4_600,
  sigma: 1_381, agentShare: 0.9, memberShare: 1,
  evidence: ["71% of subagent calls on Opus", "Search and lint tasks", "Sonnet does them as well"],
  plainEvidence: ["71% of helper tasks run on Opus", "searching and checking code", "Sonnet does these just as well"],
  roi: 0.3, confidence: 0.8, marker: "Day 17: helper tasks move to Opus",
};

const CACHE: Driver = {
  id: "a-cache", groupId: "pe", workstreamId: "pe-tool", kind: "waste",
  label: "Prompt cache hit rate fell from 78% to 31%", plain: "Saved context stopped being reused", actionLabel: "Move the date to the end of the shared session start so the cache works",
  tier: 1, category: "Documentation", startDay: 12, sunk: 100, forward: 2_300, recoverable: 2_100,
  sigma: 441, agentShare: 0.6, memberShare: 0.7,
  evidence: ["Cache reads down 60%", "A shared Claude Code hook adds the date at the top of every session since day 12", "Found from cache usage only, no prompt text read"],
  plainEvidence: ["Saved context reused 60% less since day 12", "a shared setup step puts the date first in every session", "found from usage alone, no prompts read"],
  roi: 0.1, confidence: 0.85, marker: "Day 12: saved context stops being reused",
};

const NEW_HIRES: Driver = {
  id: "b-newhires", groupId: "pe", workstreamId: "pe-pay", kind: "growth",
  label: "14 new engineers ramping on the payments refactor", actionLabel: "Fund: move unused budget, then ask the budget owner",
  tier: 2, category: "Production Code", startDay: 9, sunk: 300, forward: 6_200, recoverable: 0,
  sigma: 1_346, agentShare: 0.5, memberShare: 1, cohort: "new",
  evidence: ["31 PRs merged", "212 tests newly passing", "too early to tell if the code lasts"],
  plainEvidence: ["31 pull requests merged", "212 tests newly passing", "too early to tell if the code lasts"],
  roi: 3.0, confidence: 0.7, marker: "Day 9: 14 new engineers join",
};

const SOC2: Driver = {
  id: "b-soc2", groupId: "pe", workstreamId: "pe-tool", kind: "growth",
  label: "Planned SOC 2 documentation sprint", actionLabel: "Approve as planned spend",
  tier: 4, category: "Documentation", startDay: 19, sunk: 0, forward: 2_600, recoverable: 0,
  sigma: 297, agentShare: 0.3, memberShare: 0.8,
  evidence: ["Team report: audit documentation", "9 survey responses"],
  roi: 1.8, confidence: 0.6, marker: "Day 19: SOC 2 sprint starts",
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  baseline: { id: "baseline", name: "Baseline", answer: "none", drivers: [], workstreamShift: {}, newMembers: [] },
  A: {
    id: "A", name: "Scenario A: Silent agent drift", answer: "fix",
    drivers: [CONNECTOR, SUBAGENTS, CACHE], workstreamShift: {}, newMembers: [],
  },
  B: {
    id: "B", name: "Scenario B: Healthy adoption surge", answer: "fund",
    drivers: [NEW_HIRES, SOC2],
    // Engineers move from Infra and Code Review onto the refactor: work shifts, group total unchanged.
    workstreamShift: { "pe-infra": -5_800, "pe-cr": -4_600, "pe-pay": 10_400 },
    newMembers: newHires(),
  },
  // The default demo: both at once. Fix the waste first, then fund the growth that is left.
  C: {
    id: "C", name: "Drift and growth", answer: "fix-then-fund",
    drivers: [CONNECTOR, SUBAGENTS, CACHE, NEW_HIRES, SOC2],
    workstreamShift: { "pe-infra": -5_800, "pe-cr": -4_600, "pe-pay": 10_400 },
    newMembers: newHires(),
  },
};

export const ALL_DRIVERS = [...new Map(Object.values(SCENARIOS).flatMap((s) => s.drivers).map((d) => [d.id, d])).values()];
export const driverById = (id: string) => ALL_DRIVERS.find((d) => d.id === id);
