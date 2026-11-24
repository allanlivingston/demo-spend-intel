// Engine functions exposed to Claude as tools. One definition serves every backend.
import { isAdvanced } from "@/engine";
// Claude decides what to look at and which artifact to draft; the engine computes every number.
import { z } from "zod";
import { ownerOf,
  breakdown, draftCfoBrief, draftHandoff, draftOverride, draftPolicyDiff, draftRebalance, evidenceTier, forecast,
  GROUPS, kpis, MAX_TARGET_CHANGE, overrideRate, rebalancePlan, throttle, windowsCounterfactual, confidenceOf,
  type Artifact, type DemoState, type GroupId, type GroupSelection, dayInfo, pacing, userNote, evidenceAge, pacingHealth, TODAY, findUser, agentsOf, levelOfTier, WORKSTREAMS, driverEffects, workstreamPaces } from "@/engine";
import type { AgentId, StepPhase } from "./types";
import { bestSection, sections } from "@/knowledge/knowledge";

export interface ToolContext {
  demo: DemoState;
  group: GroupSelection;
  /** Artifacts drafted during this run, in order. */
  artifacts: Artifact[];
}

export interface ToolOutput {
  data: unknown;
  summary: string;
}

export interface ToolDef {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  phase: StepPhase;
  run: (ctx: ToolContext, args: Record<string, unknown>) => ToolOutput;
}

const r = (n: number) => Math.round(n);
const r100 = (n: number) => Math.round(n / 100) * 100;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const GroupArg = z.enum(["pe", "fpa", "mkt", "all"]).describe("SCIM group: pe = Platform Engineering, fpa = FP&A, mkt = Marketing, all = All Enterprise");
const focus = (ctx: ToolContext, g?: unknown): GroupSelection => (typeof g === "string" ? (g as GroupSelection) : ctx.group);
const single = (g: GroupSelection): GroupId => (g === "all" ? "pe" : g);
const WORKSTREAM_ID = (u: { groupId: GroupId; workstream: string }) => WORKSTREAMS.find((w) => w.groupId === u.groupId && w.name === u.workstream)?.id;

function landing(demo: DemoState, g: GroupSelection) {
  const f = forecast(demo, g);
  return { pool: r(f.pool), p50: r(f.p50), p90: r100(f.p90), status: f.status, delta_vs_budget: r(f.p50 - f.pool) };
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_forecast",
    description: "Where the month lands (likely and high case), the budget, status and nudge level for a group. Call first.",
    shape: { group: GroupArg.optional() },
    phase: "Looked into it",
    run: (ctx, a) => {
      const g = focus(ctx, a.group);
      const f = forecast(ctx.demo, g);
      const k = kpis(ctx.demo, g);
      const data = {
        group: g === "all" ? "All Enterprise" : GROUPS[g].name,
        day: 18, days_in_month: 30,
        ...landing(ctx.demo, g),
        actual_to_date: r(f.actualToDate),
        over_original_forecast_pct: Math.round(f.overForecastPct * 1000) / 10,
        sd_off_pace: Math.round(k.nudge.d * 10) / 10,
        nudge: k.nudge.admin,
        fixable_waste_recoverable: r(k.fixableWaste),
        waste_running_to_month_end: r(k.wasteRunning),
        work_at_risk: r(k.throttledValue),
      };
      return { data, summary: `Lands at ${usd(f.p50)} on a ${usd(f.pool)} budget: ${f.status.toLowerCase()}` };
    },
  },
  {
    name: "list_drivers",
    description: "Drivers off forecast for a group: projected cost to month end, sunk cost, recoverable dollars, confidence (High, Medium, Low) with its reason, evidence, Fund or Fix side, and state.",
    shape: { group: GroupArg.optional() },
    phase: "Looked into it",
    run: (ctx, a) => {
      const g = focus(ctx, a.group);
      const b = breakdown(ctx.demo, g);
      const drivers = b.rows.map((x) => ({
        id: x.driver.id, label: x.driver.label, kind: x.driver.kind, confidence: confidenceOf(x.driver).level, confidence_reason: confidenceOf(x.driver).reason, side: x.side, state: x.state,
        projected_to_month_end: x.projected, sunk_so_far: x.sunk, recoverable: x.recoverable,
        confidence_weighted_roi: Math.round(x.roiWeighted * 100) / 100, evidence: x.driver.evidence, start_day: x.driver.startDay,
      }));
      return {
        data: { hurdle_rate: b.hurdle, underspend_recommended: b.underspend, unclassified_aggregate: b.unclassified, drivers },
        summary: drivers.length ? drivers.map((d) => `${d.label}: ${d.state === "applied" ? "fixed" : d.state === "sent" ? "with the owner" : d.state === "overridden" ? "approved as planned" : d.state === "declined" ? "declined" : `+${usd(d.projected_to_month_end)}`}`).join("; ") : "No drivers off forecast",
      };
    },
  },
  {
    name: "get_evidence",
    description: "Value evidence for a group: confidence that the spend pays off (High, Medium, Low), members blocked under today's per-member limits (counts only), work at risk (evidenced spend those limits would block), override rate, and whether rebalancing is allowed.",
    shape: { group: GroupArg.optional() },
    phase: "Checked the results",
    run: (ctx, a) => {
      const g = single(focus(ctx, a.group));
      const t = throttle(ctx.demo, g);
      const rp = rebalancePlan(ctx.demo, g);
      const cf = windowsCounterfactual(ctx.demo);
      const data = {
        confidence: levelOfTier(evidenceTier(ctx.demo, g)),
        members_blocked_this_month: t.blockedMonth,
        members_blocked_today: t.blockedToday,
        members_blocked_by_day_22: t.blockedByDay22,
        work_at_risk: t.value,
        planned_spend_approval_rate_pct: Math.round(overrideRate(ctx.demo, g) * 100),
        team_shipped_results_per_1000_dollars: draftCfoBrief(ctx.demo, g).outputPer1k,
        rebalance: { sharing_level: rp.rungLabel, allowed: rp.allowed, reason: rp.reason, headroom_movable: rp.moved },
        pacing: (() => {
          const p = pacing(ctx.demo, g);
          return {
            how: "The month's overrun is spread evenly across the team and the month: first a cheaper model, then paused runs, then runs held for a few hours; a hard stop only as a last resort. Work producing results is slowed last.",
            people_affected: p.members.length, share_of_runs_slowed_or_held_pct: Math.round(p.teamShare * 100),
            over_monthly_limit: p.capsBlocked, first_cutoff_day_with_plain_monthly_limit: p.capsFirstBlockDay,
            from_today_cheaper_model: p.split.cheaper, from_today_paused: p.split.deferred, from_today_hard_throttled: p.split.held,
          };
        })(),
        windows_counterfactual: cf && { hours_to_fallback: cf.hoursToFallback, loop_cost_actual: r(cf.actualCost), loop_cost_with_windows: Math.round(cf.windowsOnly / 100) * 100, loop_cost_with_windows_and_detection: Math.round(cf.withDetection / 100) * 100 },
      };
      return { data, summary: `${data.confidence} confidence; ${t.blockedByDay22} engineers go over their monthly limit by day 22; about ${data.pacing.share_of_runs_slowed_or_held_pct}% of runs slowed or held each day; ${usd(t.value)} of work at risk` };
    },
  },
  {
    name: "simulate_policy",
    description: "What-if without applying anything: landing before and after applying fixes (driver ids), the rebalance, overrides (driver ids) and/or a new budget.",
    shape: {
      group: GroupArg.optional(),
      apply_fixes: z.array(z.string()).optional().describe("Waste driver ids to fix"),
      rebalance: z.boolean().optional(),
      overrides: z.array(z.string()).optional().describe("Growth driver ids to count as approved planned spend"),
      new_budget: z.number().optional().describe("Revised pool budget in dollars for the group"),
    },
    phase: "Checked the result",
    run: (ctx, a) => {
      const g = focus(ctx, a.group);
      const d = ctx.demo;
      const after: DemoState = {
        ...d,
        appliedFixes: [...d.appliedFixes, ...((a.apply_fixes as string[]) ?? [])],
        rebalanceApplied: d.rebalanceApplied || Boolean(a.rebalance),
        overrides: [...d.overrides, ...((a.overrides as string[]) ?? [])],
        budgetRevisions: typeof a.new_budget === "number" && g !== "all" ? { ...d.budgetRevisions, [g]: a.new_budget } : d.budgetRevisions,
      };
      const before = landing(d, g);
      const aft = landing(after, g);
      const tg = single(g);
      return {
        data: { before, after: aft, change_in_p50: aft.p50 - before.p50, ...(a.rebalance && tg ? (() => { const rp = rebalancePlan(d, tg); return { moved: rp.moved, max_target_change_pct: Math.round(MAX_TARGET_CHANGE * 100), largest_target_change: { workstream: rp.largestChange.name, pct: Math.round(rp.largestChange.share * 100) } }; })() : {}), ...(typeof a.new_budget === "number" && g !== "all" ? { budget_increase: a.new_budget - forecast(d, g).pool, current_budget: forecast(d, g).pool } : {}), work_at_risk_before: throttle(d, tg).value, work_at_risk_after: throttle(after, tg).value, applied: false },
        summary: `With the fix: lands at ${usd(aft.p50)} instead of ${usd(before.p50)} (${aft.status.toLowerCase()})`,
      };
    },
  },
  {
    name: "draft_policy_diff",
    description: "Draft proposed changes for open waste drivers. Omit driver_ids to include all open waste. Nothing changes until the admin approves.",
    shape: { driver_ids: z.array(z.string()).optional() },
    phase: "Drafted the change",
    run: (ctx, a) => {
      const art = draftPolicyDiff(ctx.demo, "pe", a.driver_ids as string[] | undefined);
      ctx.artifacts.push(art);
      // The admin applies their own rows; rows with an owner are sent to that owner and only count once shipped.
      const mineIds = art.rows.filter((x) => !ownerOf(x.driverId)).map((x) => x.driverId);
      const afterMine = forecast({ ...ctx.demo, appliedFixes: [...ctx.demo.appliedFixes, ...mineIds] }, "pe");
      return { data: {
        drafted: "policy_diff", card_name: "Proposed changes", total_savings: art.total,
        rows: art.rows.map((x) => ({ control: x.control, after: x.after, savings: x.savings, applied_by: ownerOf(x.driverId)?.name ?? "admin, on approval" })),
        p50_before: r(art.before.p50), p50_after_admin_changes: r(afterMine.p50), status_after_admin_changes: afterMine.status,
        ...(mineIds.length < art.rows.length ? { p50_after_owner_fix_too: r(art.after.p50) } : {}),
      }, summary: `Drafted proposed changes: ${art.rows.length} ${art.rows.length === 1 ? "change" : "changes"}, saves ${usd(art.total)}` };
    },
  },
  {
    name: "draft_rebalance_plan",
    description: "Draft a budget move plan moving unused workstream headroom to the evidenced workstream at the current sharing level. Workstream level only, never individuals.",
    shape: {},
    phase: "Drafted the change",
    run: (ctx) => {
      const art = draftRebalance(ctx.demo, "pe");
      ctx.artifacts.push(art);
      return { data: { drafted: "rebalance_plan", card_name: "Move unused budget", allowed: art.allowed, reason: art.reason, moved: art.moved, donors: art.donors, recipient: art.recipientName, work_at_risk_before: art.throttledBefore, work_at_risk_after: art.throttledAfter, p50_after: r(art.after.p50), stability_rules: art.limits }, summary: `Drafted a rebalance: move ${usd(art.moved)} to ${art.recipientName}; work at risk ${usd(art.throttledBefore)} to ${usd(art.throttledAfter)}` };
    },
  },
  {
    name: "draft_override",
    description: "Draft a planned spend approval that counts a growth driver as planned, funded work. The admin must pick a reason and a funding source.",
    shape: { driver_id: z.string() },
    phase: "Drafted the change",
    run: (ctx, a) => {
      const art = draftOverride(ctx.demo, "pe", String(a.driver_id));
      ctx.artifacts.push(art);
      return { data: { drafted: "governed_override", card_name: "Planned spend approval", driver: art.driverLabel, amount: art.amount, confidence: levelOfTier(art.tier), suggested_reason: art.suggestedReason, suggested_funding: art.suggestedFunding }, summary: `Drafted a planned spend approval: ${art.driverLabel}` };
    },
  },
  {
    name: "draft_cfo_brief",
    description: "Draft a budget owner brief requesting a budget increase backed by evidence, the planned spend approval rate and work at risk.",
    shape: {},
    phase: "Drafted the change",
    run: (ctx) => {
      const art = draftCfoBrief(ctx.demo, "pe");
      ctx.artifacts.push(art);
      return { data: { drafted: "cfo_brief", card_name: "Budget owner brief", requested: art.requested, new_budget: art.newBudget, p50: r(art.p50), p90: r100(art.p90), status_after: art.statusAfter, override_rate_pct: Math.round(art.overrideRate * 100), work_at_risk_without_it: art.throttledAvoided, team_shipped_results_per_1000_dollars: art.outputPer1k }, summary: `Drafted a budget owner brief: ask for ${usd(art.requested)} more (budget to ${usd(art.newBudget)})` };
    },
  },
  {
    name: "send_to_owner_preview",
    description: "Preview a hand-off to the owner of a fix outside the admin's permissions (connector owner ticket, or a pre-loaded Claude Code diagnostic session for the setup owner). Nothing is sent.",
    shape: { driver_id: z.enum(["a-connector", "a-cache"]) },
    phase: "Drafted the change",
    run: (ctx, a) => {
      const art = draftHandoff(ctx.demo, "pe", String(a.driver_id));
      ctx.artifacts.push(art);
      return { data: { drafted: "handoff", card_name: "hand-off draft", recipient: art.recipient, channel: art.channel, sent: false }, summary: `Drafted a hand-off to ${art.recipient}` };
    },
  },
];

TOOLS.push({
  name: "get_day",
  description: "What happened, or is forecast, on one day of the month: that day's spend, spend to date, drivers that started, and people who would go over their monthly limit.",
  shape: { day: z.number().int().min(1).max(30), group: GroupArg.optional() },
  phase: "Looked into it",
  run: (ctx, a) => {
    const d = dayInfo(ctx.demo, focus(ctx, a.group), Number(a.day));
    return { data: { day: d.day, already_happened: d.past, spend_that_day: d.spend, spend_to_date: d.cumulative, started_that_day: d.events, people_blocked_that_day: d.blocked }, summary: `Day ${d.day}: ${usd(d.spend)} ${d.past ? "spent" : "forecast"}${d.events.length ? `, ${d.events.length} driver started` : ""}` };
  },
}, {
  name: "get_user",
  description: "One member's spend: team, workstream, new or tenured, spend to date, where they land this month, today's monthly limit, and the day that limit would stop them (null if never). Also what their workstream's work is producing.",
  shape: { user: z.string().describe("Display name (for example 'Vik D.') or member id") },
  phase: "Looked into it",
  run: (ctx, a) => {
    const u = findUser(ctx.demo, String(a.user));
    if (!u) return { data: { error: "No such user" }, summary: "User not found" };
    const growth = driverEffects(ctx.demo, u.groupId).filter((e) => e.driver.kind === "growth" && e.driver.workstreamId === WORKSTREAM_ID(u)).map((e) => ({ driver: e.driver.label, evidence: e.driver.evidence, confidence: confidenceOf(e.driver).level }));
    const pm = pacing(ctx.demo, u.groupId).members.find((m) => m.id === u.id);
    const pacingStatus = pm ? `${Math.round(pm.trim * 100)}% of runs slowed or held from day ${TODAY + 1} (${Math.round(pm.hardShare * 100)}% held for a few hours)` : "not slowed or held";
    return { data: { name: u.name, team: u.team, workstream: u.workstream, new_this_month: u.isNew, spent_to_date: u.spent, lands_at: u.landing, monthly_limit: u.limit, cut_off_day_with_plain_monthly_limit: u.blockDay, with_pacing: pacingStatus, trimmed_share_pct: pm ? Math.round(pm.trim * 100) : 0, note_they_see: userNote(u, pm ?? null), over_limit_by: Math.max(0, u.landing - u.limit), workstream_growth: growth }, summary: `${u.name}: ${usd(u.spent)} so far, lands at ${usd(u.landing)}` };
  },
}, {
  name: "get_workstream",
  description: "One workstream: where it lands against its target, spend to date, how many people would go over their monthly limit, confidence that its spend pays off, and the drivers (waste or growth) inside it.",
  shape: { workstream: z.string().describe("Workstream name, for example 'Payments Refactor'") },
  phase: "Looked into it",
  run: (ctx, a) => {
    const name = String(a.workstream).toLowerCase();
    const w = WORKSTREAMS.find((x) => x.name.toLowerCase() === name);
    if (!w) return { data: { error: "No such workstream" }, summary: "Workstream not found" };
    const p = workstreamPaces(ctx.demo, w.groupId).find((x) => x.ws.id === w.id)!;
    const drivers = driverEffects(ctx.demo, w.groupId).filter((e) => e.driver.workstreamId === w.id).map((e) => ({ driver: e.driver.label, kind: e.driver.kind, adds: e.forward, fixed: e.fixed, confidence: confidenceOf(e.driver).level }));
    return { data: { name: w.name, lands_at: Math.round(p.landing), target: p.target, over_target_by: Math.max(0, Math.round(p.landing - p.target)), spent_to_date: Math.round(p.actualToDate), people_blocked: p.membersBlocked, confidence: levelOfTier(p.tier), drivers, evidence: (() => { const e = evidenceAge(ctx.demo, w.id); return { behind_estimate: e.label, own_data_weight_pct: Math.round(e.ownWeight * 100), team_average_weight_pct: 100 - Math.round(e.ownWeight * 100), new_work: e.isNew, results_still_arriving: e.settles, protected_ramp: e.protectedRamp }; })() }, summary: `${w.name}: lands at ${usd(p.landing)} of ${usd(p.target)}` };
  },
}, {
  name: "get_pacing_health",
  description: "The Health tab: how forecasting and pacing did over the last six full months (forecast range accuracy, forecast miss on day 10, month-end spend vs budget, budget moved between workstreams, funded workstreams cut, merged PRs per $1,000).",
  shape: {},
  phase: "Checked the results",
  run: () => {
    const h = pacingHealth();
    const val = (v: number, f: string) => (f === "pct" ? Math.round(v * 100) : Math.round(v * 10) / 10);
    const measures = h.rows.map((row) => ({
      measure: row.metric.label, good: row.metric.good, unit: row.metric.format === "pct" ? "percent" : row.metric.format === "count" ? "workstreams per month" : "per $1,000",
      six_month_average: val(row.average.pacing, row.metric.format),
    }));
    return {
      data: {
        months: h.months, measures,
        retry_loop_cost: h.wasteSpend.pacing,
        new_work_own_data_weight_pct_by_month: h.newOwnWeight.map((x) => Math.round(x * 100)),
      },
      summary: `Results, ${h.months[0]} to ${h.months[h.months.length - 1]}: ${measures.length} checks`,
    };
  },
}, {
  name: "list_agents",
  description: "Autonomous agent sources for a group (scheduled runs and service accounts, Claude Code subagents, MCP connectors, cache-dependent tools): what each lands at this month and whether it is running, fixed or waiting on its owner.",
  shape: { group: GroupArg.optional() },
  phase: "Looked into it",
  run: (ctx, a) => {
    const rows = agentsOf(ctx.demo, focus(ctx, a.group));
    return { data: { agents: rows.map((x) => ({ source: x.label, team: x.team, lands_at: x.landing, state: x.state })) }, summary: `${rows.length} agents` };
  },
}, {
  name: "lookup_faq",
  description: "Look up how the product works or what a term means (lands at, high case, confidence levels, fixable waste, work at risk, workstreams, proposed changes, rebalance, planned spend, budget owner brief, privacy, offline replay). Use for any 'what is' or 'how does' question.",
  shape: { question: z.string().describe("The admin's question, in their words") },
  phase: "Checked the results",
  run: (_ctx, a) => {
    const hit = bestSection(String(a.question), sections("FAQ.md"), 1);
    return hit
      ? { data: { question: hit.q, answer: hit.a }, summary: `Looked up: ${hit.q}` }
      : { data: { answer: null, questions: sections("FAQ.md").map((x) => x.q) }, summary: "No saved answer matched" };
  },
});

const ALL = TOOLS.map((t) => t.name);
const READ = ["get_forecast", "list_drivers", "get_evidence", "simulate_policy", "get_day", "get_user", "get_workstream", "get_pacing_health", "list_agents"];

/** Tool subset per agent. */
export const AGENT_TOOLS: Record<AgentId, string[]> = {
  connector: [...READ, "draft_policy_diff", "send_to_owner_preview"],
  cache: [...READ, "draft_policy_diff", "send_to_owner_preview"],
  routing: [...READ, "draft_policy_diff"],
  funding: [...READ, "draft_rebalance_plan", "draft_override", "draft_cfo_brief"],
  chat: ALL,
  guide: [],
};

// Moving budget between workstreams and planned workstream work only exist in the advanced view.
const ADVANCED_ONLY = ["draft_rebalance_plan", "draft_override"];
export const toolsFor = (agent: AgentId) => TOOLS.filter((t) => AGENT_TOOLS[agent].includes(t.name) && (isAdvanced() || !ADVANCED_ONLY.includes(t.name)));

/** Validate input with zod, run, and return JSON text for the model. */
export function callTool(ctx: ToolContext, name: string, input: unknown): { output: ToolOutput; text: string; isError: boolean } {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { output: { data: null, summary: `Unknown tool ${name}` }, text: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true };
  const parsed = z.object(def.shape).safeParse(input ?? {});
  if (!parsed.success) return { output: { data: null, summary: "Invalid input" }, text: JSON.stringify({ error: parsed.error.message }), isError: true };
  try {
    const output = def.run(ctx, parsed.data as Record<string, unknown>);
    return { output, text: JSON.stringify(output.data), isError: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { output: { data: null, summary: msg }, text: JSON.stringify({ error: msg }), isError: true };
  }
}
