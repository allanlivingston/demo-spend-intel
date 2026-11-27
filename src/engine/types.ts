// Core engine types. The engine is pure and deterministic: same inputs, same numbers.

export type GroupId = "pe" | "fpa" | "mkt";
export type GroupSelection = GroupId | "all";
export type ScenarioId = "baseline" | "A" | "B" | "C";
export type Tier = 1 | 2 | 3 | 4 | 5;
export type Surface = "Chat" | "Cowork" | "Claude Code";
export type Status = "On track" | "Budget remaining" | "Over budget";
export type SharingLevel = "fixed" | "share20" | "pooled";

export type Category =
  | "Production Code"
  | "Code Review"
  | "Infra and On-call"
  | "Documentation"
  | "Financial Modeling"
  | "Month-end Close"
  | "Campaign Copy"
  | "Research"
  | "Unclassified";

export interface Workstream {
  id: string;
  groupId: GroupId;
  name: string;
  category: Category;
  /** Monthly pace target in dollars (share of the pool). */
  target: number;
  /** Baseline month landing of normal work, before scenario drivers. */
  baseLanding: number;
  /** Highest evidence tier this workstream has reached in the baseline. */
  tier: Tier;
}

export interface Group {
  id: GroupId;
  name: string;
  pool: number;
  surfaces: Surface[];
  tenuredMembers: number;
  /** Start-of-month forecast, for "% over forecast". */
  originalForecast: number;
  /** One standard deviation of the normal-work landing (dollars). */
  baseSigma: number;
  /** Per-member monthly limit: today's setup, the "before" state. */
  memberLimit: number;
  /** Default limit for newly provisioned members ("start conservatively"). */
  newMemberLimit: number;
  /** Share of normal spend that is attributable to named members (rest is service and automation). */
  memberShare: number;
  /** Hurdle rate: minimum confidence-weighted ROI worth funding. */
  hurdle: number;
}

export type DriverKind = "waste" | "growth";

export interface Driver {
  id: string;
  groupId: GroupId;
  workstreamId: string;
  kind: DriverKind;
  label: string;
  /** A plain name for cards and chart markers; `label` (the technical name) is what Claude and the docs use. */
  plain?: string;
  /** The evidence in plain words for the card; Claude and the evals keep `evidence`. */
  plainEvidence?: string[];
  /** Short label for the action that resolves it. */
  actionLabel: string;
  tier: Tier;
  category: Category;
  startDay: number;
  /** Dollars already spent by this driver through today (sunk, in actuals). */
  sunk: number;
  /** Projected cost from tomorrow to month end if left alone. This is the "projected cost" shown. */
  forward: number;
  /** Forward dollars a fix recovers (waste only). */
  recoverable: number;
  /** One standard deviation this driver adds to the landing. */
  sigma: number;
  /** Share of this driver's spend run by autonomous agents. */
  agentShare: number;
  /** Share of this driver's spend attributable to named members (vs service identities). */
  memberShare: number;
  evidence: string[];
  /** If set, this driver's member-attributed spend lands only on that cohort. */
  cohort?: "new";
  /** Expected ROI multiple and confidence (0..1), for the fund-or-fix ranking. */
  roi: number;
  confidence: number;
  /** Chart marker for when this driver started. */
  marker?: string;
}

export interface Member {
  id: string; // pseudonymous, e.g. PE-07
  groupId: GroupId;
  workstreamId: string;
  cohort: "tenured" | "new";
  /** Baseline monthly demand in dollars (unconstrained). */
  baseDemand: number;
  joinDay: number;
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  answer: "none" | "fix" | "fund" | "fix-then-fund";
  drivers: Driver[];
  /** Workstream base landings overrides (work shifting between workstreams within a group). */
  workstreamShift: Record<string, number>;
  /** Extra members (Scenario B new hires). */
  newMembers: Member[];
}

export interface DemoState {
  scenarioId: ScenarioId;
  /** Driver ids whose fix policy is applied. */
  appliedFixes: string[];
  /** Driver ids whose fix was sent to the owner (outside the admin's permissions). */
  handedOff: string[];
  /** Driver ids approved as planned spend. */
  overrides: string[];
  /** Recommendations the admin declined: they stay in the forecast but stop being suggested. */
  declined?: string[];
  /** The admin's saved rules. They carry over to the next month; Reset demo clears them. */
  rules?: PrefRule[];
  rebalanceApplied: boolean;
  sharingLevel: SharingLevel;
  /** Approved budget revisions by group (new pool budget). */
  budgetRevisions: Partial<Record<GroupId, number>>;
  /** Demo toggles that simulate higher-tier evidence arriving. */
  tier3Arrived: boolean;
  tier5Imported: boolean;
  hurdleOverrides: Partial<Record<GroupId, number>>;
}

export interface DayPoint {
  day: number;
  actual?: number; // cumulative, days 1..today
  p50?: number; // cumulative, today..30
  p90?: number;
  band?: [number, number];
  plan: number; // cumulative pacing plan
  ceiling: number;
}

export interface Forecast {
  groupId: GroupSelection;
  pool: number;
  actualToDate: number;
  p50: number;
  p90: number;
  sigma: number;
  status: Status;
  fundedVariance: boolean;
  overForecastPct: number;
  series: DayPoint[];
}

/** What a rule does with recommendations of its kind. Same three levels as Managed Agents permission policies. */
export type RuleLevel = "allow" | "ask" | "skip";
/** The kind of recommendation a rule covers. */
export type RuleTopic = "loop" | "model" | "cache" | "fund-new" | "planned";

/** A preference the admin approved. Stored as data and enforced by the engine, never left to the prompt. */
export interface PrefRule {
  id: string;
  topic: RuleTopic;
  groupId: GroupId;
  level: RuleLevel;
  /** The decision it came from, in a sentence. */
  basedOn: string;
  /** Claude's wording of the rule at each level. Unset: the app's template. Scope and level always come from the app. */
  wording?: Partial<Record<RuleLevel, string>>;
  createdAt: string;
}
