// Offline answers for questions (no Claude call): built from the engine's numbers and the FAQ, scoped to what was asked.
import { isAdvanced } from "@/engine";
// Used when Offline replay is on, and as the fallback when a live chat run fails. Never drafts anything.
import {
  agentsOf, breakdown, confidenceOf, dayInfo, draftCfoBrief, findUser, WORKSTREAMS, workstreamPaces, draftOverride, draftRebalance, driverEffects, forecast, GROUP_IDS, GROUPS,
  headline, kpis, MAX_TARGET_CHANGE, ownerOf, rebalancePlan, recoveryOf, throttle, waitingOnOwner,
  type DemoState, type Driver, type GroupId, type GroupSelection, pacing, pacingHealth, evidenceAge, PACE_STEP_LABEL, TODAY } from "@/engine";
import { bestSection, firstSentences, sections } from "@/knowledge/knowledge";
import type { AgentRequest } from "./types";
import { nextAction } from "@/state/nextAction";
import { recapOf, whatNext } from "@/state/recap";

/** The next step in plain words, so every answer ends with what to do. */
function nextStep(s: DemoState, sel: GroupSelection): string {
  const n = nextAction(s, sel);
  if (n.verdict === "fix") return " Next step: fix the waste.";
  if (n.cta) return ` Next step: ${n.cta.label.charAt(0).toLowerCase() + n.cta.label.slice(1)}.`;
  if (n.verdict === "waiting") return " Next step: wait for the dev tools team to ship the cache fix.";
  return "";
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const usd100 = (n: number) => usd(Math.round(n / 100) * 100);
const name = (g: GroupSelection) => (g === "all" ? "All teams" : GROUPS[g].name);

export interface OfflinePlan {
  /** Engine tools to run first, so the steps shown are real. */
  calls: { tool: string; input: Record<string, unknown> }[];
  text: string;
}

function allDrivers(s: DemoState): { d: Driver; g: GroupId; fixed: boolean }[] {
  return GROUP_IDS.flatMap((g) => driverEffects(s, g).map((e) => ({ d: e.driver, g, fixed: e.fixed })));
}

/** The team a question is about: the selected one, or the team with problems when viewing all teams. */
function focus(s: DemoState, sel: GroupSelection): GroupId {
  if (sel !== "all") return sel;
  return GROUP_IDS.find((g) => driverEffects(s, g).length > 0) ?? "pe";
}

/** A driver label mid-sentence: "Prompt cache…" becomes "prompt cache…", but "Jira", "Claude Code" and "SOC 2" keep their capitals. */
const lc = (label: string) => label.replace(/^(Prompt|Planned)\b/, (w) => w.toLowerCase());

function aboutDriver(s: DemoState, d: Driver, fixed: boolean): string {
  const c = confidenceOf(d);
  if (d.kind === "waste") {
    const owner = ownerOf(d.id);
    const state = fixed ? "It is already fixed." : waitingOnOwner(s, d.id) ? `The fix is with ${owner!.short}; it counts once they ship it.` : owner ? `The fix belongs to ${owner.short}, so Fix it drafts a hand-off.` : "Fix it drafts the change for you to approve.";
    return `${d.plain ?? d.label} adds ${usd(d.forward)} by month end, and fixing it saves ${usd(recoveryOf(d))}. ${c.level} confidence: ${c.reason} ${state}`;
  }
  return `${d.plain ?? d.label} adds ${usd(d.forward)} by month end, and it is producing work: ${d.evidence.slice(0, 2).join(", ")}. ${c.level} confidence: ${c.reason}`;
}

const DRAFT_Q = /why these changes|risk if i approve|only approve part/;

/** A live summary of a draft, used when a recorded run's wording no longer matches the numbers. */
/**
 * What a replayed draft does, from today's numbers, when the recorded wording no longer matches them.
 * A fix draft is described from its own rows, so a one-fix draft never talks about the others.
 */
export function freshSummary(s: DemoState, kind: string, art?: { kind: string; groupId?: GroupId; rows?: { driverId: string; savings: number }[] }): string {
  if (art?.kind === "policy_diff" && art.rows?.length && art.groupId) {
    const g = art.groupId;
    const label = (id: string) => { const d = driverEffects(s, g).find((e) => e.driver.id === id)?.driver; return lc(d ? d.plain ?? d.label : id); };
    const mine = art.rows.filter((r) => !ownerOf(r.driverId));
    const theirs = art.rows.filter((r) => ownerOf(r.driverId));
    const owner = theirs.length ? ownerOf(theirs[0].driverId)! : null;
    const after = forecast({ ...s, appliedFixes: [...s.appliedFixes, ...mine.map((r) => r.driverId)] }, g).p50;
    if (mine.length)
      return `It ${mine.map((r) => doesOf(r.driverId, label(r.driverId))).join(" and ")}. With ${mine.length > 1 ? "those" : "that"} applied, ${GROUPS[g].name} is forecast at ${usd100(after)}.${owner ? ` The cache fix is a code change, so it goes to ${owner.short}.` : ""}`;
    if (owner) {
      const what = label(theirs[0].driverId);
      return `${what.charAt(0).toUpperCase()}${what.slice(1)}. The fix is a code change, so it goes to ${owner.short}. It saves ${usd(theirs[0].savings)} once they ship it.`;
    }
  }
  return draftAnswer(s, "", kind);
}

/** What applying a fix does, in plain words. */
const DOES: Record<string, string> = {
  "a-connector": "stops the Jira link retrying after 3 failures",
  "a-subagents": "moves helper tasks from Opus to Sonnet",
};
const doesOf = (id: string, label: string) => DOES[id] ?? `fixes ${label}`;

function draftAnswer(s: DemoState, p: string, kind: string): string {
  const g: GroupId = "pe";
  if (kind === "policy_diff") {
    const open = driverEffects(s, g).filter((e) => e.driver.kind === "waste" && !e.fixed && !waitingOnOwner(s, e.driver.id)).map((e) => e.driver);
    const mine = open.filter((d) => !ownerOf(d.id));
    const theirs = open.filter((d) => ownerOf(d.id));
    const after = forecast({ ...s, appliedFixes: [...s.appliedFixes, ...mine.map((d) => d.id)] }, g).p50;
    if (/risk/.test(p)) return "Low. Nobody is capped or blocked, Opus stays one click away for anyone who needs it, and Sonnet's occasional retries are already counted in the savings. You can undo it from the card.";
    if (/part/.test(p)) return `Each row stands on its own: ${open.map((d) => `${lc(d.plain ?? d.label)} saves ${usd(recoveryOf(d))}`).join(", ")}. Tell me which to leave out and I will redraft it.`;
    return `It ${mine.map((d) => doesOf(d.id, lc(d.plain ?? d.label))).join(" and ")}. With those applied, ${GROUPS[g].name} is forecast at ${usd100(after)}.${theirs.length ? ` The cache fix is a code change, so it goes to ${ownerOf(theirs[0].id)!.short}.` : ""}`;
  }
  if (kind === "rebalance_plan") {
    const r = draftRebalance(s, g);
    if (/risk/.test(p)) { const rp = rebalancePlan(s, g); return `Low. Budget moves between workstreams, never people, and no workstream's target changes by more than ${Math.round(MAX_TARGET_CHANGE * 100)}% (the largest is ${rp.largestChange.name} at ${Math.round(rp.largestChange.share * 100)}%). The donors keep enough to finish their month.`; }
    return `It moves ${usd(r.moved)} of unused budget to ${r.recipientName}, so work at risk drops from ${usd(r.throttledBefore)} to ${usd(r.throttledAfter)}. The budget comes from workstreams that have used less than half their target, and it is not taken back before the 30-day check.`;
  }
  if (kind === "governed_override") {
    const o = draftOverride(s, g);
    if (/risk/.test(p)) return "The approval, its reason and funding source are recorded in Activity, and the approval rate is visible to the budget owner, so it stays accountable.";
    return `The ${o.driverLabel.replace(/^Planned /, "")} was planned, so approving it counts its ${usd(o.amount)} as expected spend rather than a problem to fix. Check the suggested reason and source, then approve.`;
  }
  const b = draftCfoBrief(s, g);
  if (/risk/.test(p)) return `If the budget owner says no, ${GROUPS[g].name} stays over budget and the new engineers' runs stay slowed for the rest of the month.`;
  return `${s.rebalanceApplied ? "After moving budget and the approvals" : s.overrides.length ? "After the approvals" : "As things stand"}, ${GROUPS[g].name} is still forecast at ${usd100(b.p50)}. The brief asks for ${usd(b.requested)} more, taking the budget to ${usd(b.newBudget)}. ${b.covers}`;
}

export function offlinePlan(req: AgentRequest): OfflinePlan {
  const s = req.demo;
  const sel = req.group;
  const p = req.prompt.toLowerCase();
  const ctx = req.pinned.join(" ");
  const g = focus(s, sel);
  const f = forecast(s, g);
  const k = kpis(s, g);
  const t = throttle(s, g);
  const base: OfflinePlan["calls"] = [{ tool: "get_forecast", input: { group: g } }, { tool: "list_drivers", input: { group: g } }];
  const plan = (text: string, calls = base): OfflinePlan => ({ calls, text });

  if (DRAFT_Q.test(p)) {
    const kind = ctx.match(/Draft waiting: (\w+)/)?.[1] ?? (s.scenarioId === "B" || (s.scenarioId === "C" && kpis(s, "pe").fixableWaste === 0) ? (isAdvanced() ? "rebalance_plan" : "cfo_brief") : "policy_diff");
    // Figures about "after you approve" come from a real what-if step, not arithmetic in this file.
    const mine = driverEffects(s, "pe").filter((e) => e.driver.kind === "waste" && !e.fixed && !waitingOnOwner(s, e.driver.id) && !ownerOf(e.driver.id)).map((e) => e.driver.id);
    const sim = kind === "policy_diff" ? [{ tool: "simulate_policy", input: { group: "pe", apply_fixes: mine } }]
      : kind === "rebalance_plan" ? [{ tool: "simulate_policy", input: { group: "pe", rebalance: true } }]
      : kind === "cfo_brief" ? [{ tool: "simulate_policy", input: { group: "pe", new_budget: draftCfoBrief(s, "pe").newBudget } }, { tool: "get_evidence", input: { group: "pe" } }] : [];
    return plan(draftAnswer(s, p, kind), [...base, ...sim]);
  }

  const wsQ = req.prompt.match(/follow up on workstream: (.+?)\.?$/i)?.[1];
  if (wsQ) {
    const w = WORKSTREAMS.find((x) => x.name.toLowerCase() === wsQ.toLowerCase());
    if (w) {
      const p = workstreamPaces(s, w.groupId).find((x) => x.ws.id === w.id)!;
      const calls: OfflinePlan["calls"] = [{ tool: "get_workstream", input: { workstream: w.name } }];
      const inside = driverEffects(s, w.groupId).filter((e) => e.driver.workstreamId === w.id && !e.fixed);
      const over = p.landing > p.target;
      const lead = `${w.name} is forecast at ${usd(p.landing)} against its ${usd(p.target)} target${over ? "" : ", within it"}${p.membersBlocked ? `, and ${p.membersBlocked} people would go over their monthly limit` : ""}.`;
      const blocked = "";
      const why = inside.length ? ` Driving it: ${inside.map((e) => `${lc(e.driver.plain ?? e.driver.label)} (${usd(e.forward)})`).join(", ")}.` : " Nothing unusual is driving it.";
      const age = evidenceAge(s, w.id);
      const conf = age.isNew ? ` It is new (${age.label}), so its forecast is based mostly on the team average, and budget moved to it is not taken back before its 30-day check.` : "";
      return plan(`${lead}${why}${blocked}${conf}`.trim(), calls);
    }
  }

  const agentQ = req.prompt.match(/follow up on agent: (.+?)\.?$/i)?.[1];
  if (agentQ) {
    const calls: OfflinePlan["calls"] = [{ tool: "list_agents", input: { group: sel } }];
    const hit = allDrivers(s).find((x) => x.d.label.toLowerCase() === agentQ.toLowerCase());
    if (hit) return plan(aboutDriver(s, hit.d, hit.fixed), [...calls, ...base]);
    const row = agentsOf(s, sel).find((x) => x.label.toLowerCase() === agentQ.toLowerCase());
    if (row) return plan(`${row.label} on ${row.team} is forecast at ${usd(row.landing)} this month, in line with its usual pattern. It is normal automation, so there is nothing to fix.`, calls);
  }

  const userQ = req.prompt.match(/follow up on (?!agent:)(.+?)$/i)?.[1];
  if (userQ) {
    const u = findUser(s, userQ.trim());
    if (u) {
      const calls: OfflinePlan["calls"] = [{ tool: "get_user", input: { user: u.name } }];
      const pm = pacing(s, u.groupId).members.find((m) => m.id === u.id);
      if (!pm && u.blockDay !== null && u.isNew) return plan(`${u.name} is forecast at ${usd(u.landing)} against a ${usd(u.limit)} limit, but their work is producing results, so other spend is slowed first (a plain monthly limit would cut them off on day ${u.blockDay}).${nextStep(s, u.groupId)}`, calls);
      if (!pm) return plan(`${u.name} has spent ${usd(u.spent)} so far and is forecast at ${usd(u.landing)}, under the ${usd(u.limit)} monthly limit. Nothing to do.`, calls);
      if (u.blockDay === null) return plan(`${u.name} is forecast at ${usd(u.landing)}, under the ${usd(u.limit)} monthly limit. As part of the team's pacing, about ${Math.round(pm.trim * 100)}% of their runs from day ${TODAY + 1} go to a cheaper model, wait, or are held for a few hours.`, calls);
      if (pm.step === "rationed") {
        const growth = driverEffects(s, u.groupId).find((e) => e.driver.kind === "growth" && WORKSTREAMS.find((w) => w.id === e.driver.workstreamId)?.name === u.workstream);
        const why = growth ? `Their work is producing results (${growth.driver.evidence[0]}), so fund it.` : "Check what their work is producing before raising the limit.";
        return plan(`${u.name} is forecast at ${usd(u.landing)} against a ${usd(u.limit)} limit, so a plain monthly limit would cut them off on day ${u.blockDay}; with pacing about ${Math.round(pm.trim * 100)}% of their runs are slowed or held instead. ${why}`, calls);
      }
      if (pm.step !== "blocked") return plan(`${u.name} is forecast at ${usd(u.landing)} against a ${usd(u.limit)} limit. A plain monthly limit would cut them off on day ${u.blockDay}; with pacing about ${Math.round(pm.trim * 100)}% of their runs from day ${TODAY + 1} are slowed or held instead (${PACE_STEP_LABEL[pm.step].toLowerCase()}).`, calls);
      const growth = driverEffects(s, u.groupId).find((e) => e.driver.kind === "growth" && WORKSTREAMS.find((w) => w.id === e.driver.workstreamId)?.name === u.workstream);
      const why = growth ? `Their work is producing results (${growth.driver.evidence.slice(0, 2).join(", ")}), so fund it rather than slow it.` : "Check what their work is producing before raising the limit.";
      return plan(`${u.name} is forecast at ${usd(u.landing)} against a ${usd(u.limit)} limit and is stopped for the month. ${why}`, calls);
    }
  }

  const about = req.prompt.match(/tell me about this: (.+?)\.?$/i)?.[1];
  if (about) {
    const hit = allDrivers(s).find((x) => x.d.label.toLowerCase() === about.toLowerCase());
    if (hit) return plan(aboutDriver(s, hit.d, hit.fixed));
  }

  const day = Number(p.match(/day (\d+)/)?.[1] ?? 0);
  if (day >= 1 && day <= 30) {
    const d = dayInfo(s, sel, day);
    const calls: OfflinePlan["calls"] = [{ tool: "get_day", input: { day, group: sel } }];
    const started = allDrivers(s).find((x) => x.d.startDay === day && (sel === "all" || x.g === sel));
    if (started) return plan(`Day ${day}: ${aboutDriver(s, started.d, started.fixed)}`, [...calls, ...base]);
    const spent = d.past ? `${name(sel)} spent ${usd(d.spend)} on day ${day}, ${usd(d.cumulative)} to date.` : `${name(sel)} is forecast to spend about ${usd(d.spend)} on day ${day}, ${usd(d.cumulative)} to date by then.`;
    if (d.blocked) return plan(`${spent} ${d.blocked} engineers reach their monthly limit that day. Their work is producing results, so other spend is slowed first; funding it covers the overrun.`, calls);
    return plan(`${spent} Nothing unusual started that day.`, calls);
  }

  if (/pacing.*(good|work|tell)|how do we know|pacing health|health tab|is pacing better/.test(p)) {
    const h = pacingHealth();
    const row = (id: string) => h.rows.find((x) => x.metric.id === id)!.average;
    const pc = (v: number) => `${Math.round(v * 100)}%`;
    const [band, re, cut] = ["forecastInBand", "reshuffle", "fundedCut"].map(row);
    return plan(
      `Over the last six months (${h.months[0]} to ${h.months[h.months.length - 1]}), month-end spend landed inside the forecast range ${pc(band.pacing)} of the time, against a target of about 80%. ` +
      `About ${pc(re.pacing)} of the budget moved between workstreams each month, and ${cut.pacing === 0 ? "no funded workstream was cut the next month" : "funded workstreams were rarely cut the next month"}. ` +
      `The Health tab shows each month.`,
      [{ tool: "get_pacing_health", input: {} }],
    );
  }

  if (/slow.*(instead|down)|instead of block|cheaper model|defer|spend slowed/.test(p)) {
    const pc = pacing(s, g);
    if (!pc.members.length) return plan(`Nothing on ${GROUPS[g].name} needs slowing this month.`, [...base, { tool: "get_evidence", input: { group: g } }]);
    return plan(
      `From today to month end, ${usd(pc.split.cheaper)} of runs move to a cheaper model, ${usd(pc.split.deferred)} wait and ${usd(pc.split.held)} are held for a few hours, spread evenly across the team and the month. ` +
      (pc.blocked ? "A few runs still hit a hard stop as a last resort." : "Nobody is cut off this month.") + nextStep(s, sel),
      [...base, { tool: "get_evidence", input: { group: g } }],
    );
  }

  if (/confidence grow|own data|precision|how sure|team average|protected ramp/.test(p)) {
    const w = WORKSTREAMS.find((x) => evidenceAge(s, x.id).isNew) ?? WORKSTREAMS[0];
    const a = evidenceAge(s, w.id);
    return plan(
      `New workstreams are forecast from the team average until they have their own history. ${w.name} has ${a.label}, so its forecast is based ${Math.round(a.ownWeight * 100)}% on its own data${a.settles ? `; ${a.settles}` : ""}. Established workstreams have ${evidenceAge(s, "pe-infra").label}, so theirs is based ${Math.round(evidenceAge(s, "pe-infra").ownWeight * 100)}% on their own.`,
      [{ tool: "get_workstream", input: { workstream: w.name } }, { tool: "get_workstream", input: { workstream: "Infra and On-call" } }],
    );
  }

  if (/waits on|repo owner|owner/.test(p) && k.waitingOnOwner > 0) {
    const shipped = forecast({ ...s, appliedFixes: [...s.appliedFixes, ...s.handedOff] }, g).p50;
    return plan(`The prompt cache fix, worth ${usd(k.waitingOnOwner)}, is with the dev tools team, who own the shared Claude Code setup. Until they ship it, ${GROUPS[g].name} is forecast at ${usd100(f.p50)}; once they do, ${usd100(shipped)}.`, [...base, { tool: "simulate_policy", input: { group: g, apply_fixes: s.handedOff } }]);
  }

  if (/waste come from|where.*waste|fixable waste/.test(p)) {
    const rows = breakdown(s, g).rows.filter((r) => r.side === "fix" && r.state === "open" && r.driver.kind === "waste");
    if (rows.length) return plan(`${usd(k.fixableWaste)} of waste across ${rows.length} sources: ${rows.map((r) => `${lc(r.driver.plain ?? r.driver.label)} (${usd(r.recoverable)})`).join(", ")}. None of it produced completed work, so fixing it loses nothing.`);
  }

  if (/work.*risk|at risk/.test(p)) {
    return plan(t.value > 0
      ? `${usd(t.value)} of useful work is at risk: ${t.blockedMonth} engineers on ${GROUPS[g].name} go over their monthly limit this month, ${t.newHiresBlockedByDay22} of them new engineers on the payments refactor by day 22. ${(() => { const pc = pacing(s, g); return pc.members.length ? `With pacing, about ${Math.round(pc.teamShare * 100)}% of the team's runs are slowed or held each day instead.` : "Pacing slows them instead of cutting them off."; })()}`
      : `No work is at risk on ${GROUPS[g].name}: nobody doing useful work goes over their limit this month.`, [...base, { tool: "get_evidence", input: { group: g } }]);
  }

  if (/over budget/.test(p)) {
    if (f.p50 <= f.pool) return plan(`${GROUPS[g].name} is not over budget: it is forecast at ${usd100(f.p50)} of ${usd(f.pool)}.`);
    // Name each growth driver with its own figure: a sum would be a number no tool returned.
    const growth = driverEffects(s, g).filter((e) => e.driver.kind === "growth").map((e) => `${lc(e.driver.plain ?? e.driver.label)} (${usd(e.driver.forward)}${s.overrides.includes(e.driver.id) ? ", approved as planned" : ""})`);
    const parts = [k.fixableWaste > 0 && `${usd(k.fixableWaste)} of fixable waste`, k.waitingOnOwner > 0 && `${usd(k.waitingOnOwner)} waiting on the dev tools team`, growth.length > 0 && `new work that is producing results: ${growth.join(", ")}`].filter(Boolean);
    return plan(`${GROUPS[g].name} is forecast at ${usd100(f.p50)} against ${usd(f.pool)}, ${usd100(f.p50 - f.pool)} over. It comes from ${parts.join(" and ")}.${nextStep(s, sel)}`);
  }

  if (/do nothing/.test(p)) {
    const pc = pacing(s, g);
    const waste = k.fixableWaste > 0 ? ` and ${usd(k.fixableWaste)} of waste keeps running` : "";
    const people = t.blockedMonth > 0 ? ` ${t.blockedMonth} engineers go over their limit and about ${Math.round(pc.teamShare * 100)}% of the team's runs stay slowed each day.` : "";
    return plan(`${GROUPS[g].name} is forecast at ${usd100(f.p50)} against ${usd(f.pool)}${waste}.${people}${nextStep(s, sel)}`, [...base, { tool: "get_evidence", input: { group: g } }]);
  }

  if (/summari[sz]e|how is each team|how are the teams/.test(p)) {
    const teams = sel === "all" ? GROUP_IDS : [sel];
    const lines = teams.map((x) => { const fx = forecast(s, x); return `${GROUPS[x].name} is forecast at ${usd100(fx.p50)} of ${usd(fx.pool)}, ${fx.status.toLowerCase()}`; });
    const kx = kpis(s, g);
    const left = sel === "all" ? headline(s, sel)
      : kx.waitingOnOwner > 0 ? `${usd(kx.waitingOnOwner)} of waste is waiting on the dev tools team; nothing else needs you.`
      : kx.fixableWaste > 0 ? `${usd(kx.fixableWaste)} of waste is still open to fix.` : "Nothing needs you right now.";
    if (sel !== "all" && nextStep(s, sel)) return plan(`${lines.join("; ")}.${nextStep(s, sel)}`, [...teams.map((x) => ({ tool: "get_forecast", input: { group: x } })), { tool: "list_drivers", input: { group: g } }]);
    return plan(`${lines.join("; ")}. ${left}`.trim(), [...teams.map((x) => ({ tool: "get_forecast", input: { group: x } })), ...(sel === "all" ? [] : [{ tool: "list_drivers", input: { group: g } }])]);
  }

  if (/what happens next|what(?:'s| is) next/.test(p)) {
    // Something still open comes first; otherwise what is still true (over budget until a fix ships) and what to expect.
    if (nextAction(s, sel).cta) return plan(`${name(sel)}: ${headline(s, sel)}${nextStep(s, sel)}`);
    // The figure once the owner ships comes from a what-if step, like every figure in an answer.
    return plan(whatNext(recapOf(s, g)), s.handedOff.length ? [...base, { tool: "simulate_policy", input: { group: g, apply_fixes: s.handedOff } }] : base);
  }

  const faq = bestSection(req.prompt, sections("FAQ.md"), 2);
  if (faq) return plan(firstSentences(faq.a, 3), [{ tool: "lookup_faq", input: { question: req.prompt } }]);

  return plan(`${name(sel)}: ${headline(s, sel)} Offline mode answers questions about the forecast, the recommendations and the terms in the FAQ.`);
}

/** Demo guide questions, offline: the matching section of DEMO_GUIDE.md. */
export function offlineGuide(question: string): string {
  const hit = bestSection(question, sections("DEMO_GUIDE.md"), 1);
  return hit ? firstSentences(hit.a, 5) : "I can answer questions about what this demo solves and for whom, how it works, the workflows, and why the layout, navigation and artifacts are built the way they are.";
}
