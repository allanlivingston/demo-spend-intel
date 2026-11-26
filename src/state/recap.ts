// The month recap: posted once the admin has handled everything open, so the work ends with what it achieved rather
// than a row of finished cards. Pure: state in, recap out.
import { breakdown, forecast, GROUPS, initialState, ownerOf, pacing, scenarioOf, TODAY, usd, usd100, type DemoState, type GroupSelection, type Status } from "@/engine";
import type { Verdict } from "./nextAction";

export interface Recap {
  team: string;
  day: number;
  /** Where the month was heading with nothing changed, and where it lands now. */
  before: { lands: number; budget: number };
  after: { lands: number; budget: number; status: Status };
  fixed: number;
  budgetAdded: number;
  approved: string[];
  waiting: { owner: string; fix: string; amount: number }[];
  declined: number;
  rules: number;
  /** People cut off this month under pacing. */
  cutOff: number;
  /** New engineers kept at full speed by the extra budget (0 when no budget was added). */
  newcomers: number;
}

export function recapOf(demo: DemoState, group: GroupSelection): Recap {
  const start = forecast(initialState(demo.scenarioId), group);
  const now = forecast(demo, group);
  const rows = breakdown(demo, group).rows;
  const sum = (state: string) => rows.filter((r) => r.state === state).reduce((t, r) => t + r.recoverable, 0);
  return {
    team: group === "all" ? "All teams" : GROUPS[group].name,
    day: TODAY,
    before: { lands: start.p50, budget: start.pool },
    after: { lands: now.p50, budget: now.pool, status: now.status },
    fixed: sum("applied"),
    budgetAdded: Math.max(0, now.pool - start.pool),
    approved: rows.filter((r) => r.state === "overridden").map((r) => r.driver.label),
    waiting: rows.filter((r) => r.state === "sent").map((r) => ({ owner: ownerOf(r.driver.id)?.short ?? "its owner", fix: FIX_NAME[r.driver.id] ?? "the fix", amount: r.recoverable })),
    declined: rows.filter((r) => r.state === "declined").length,
    rules: demo.rules?.length ?? 0,
    cutOff: pacing(demo, group).blocked,
    newcomers: now.pool > start.pool ? scenarioOf(demo).newMembers.filter((m) => group === "all" || m.groupId === group).length : 0,
  };
}

/** The people side, in one sentence, when the engine says it holds: nobody cut off, new engineers kept at full speed. */
export function peopleLine(r: Recap): string {
  if (r.cutOff > 0) return "";
  return `Nobody was cut off this month${r.newcomers ? `, and the ${r.newcomers} new engineers were not slowed` : ""}.`;
}

/** What the owner's fix is called, as the headline says it ("the dev tools team's cache fix"). */
const FIX_NAME: Record<string, string> = { "a-cache": "the cache fix", "a-connector": "the connector fix", "a-subagents": "the subagent model change" };

/** What is still true once nothing is left for the admin: over budget until an owner's fix ships, or still over.
 *  `subject` is "It" where the team was just named. */
export function stillTrue(r: Recap, subject?: string): string {
  const waitSum = r.waiting.reduce((t, w) => t + w.amount, 0);
  const over = r.after.lands > r.after.budget;
  const w = r.waiting[0];
  const team = subject ?? (r.team === "All teams" ? "Spend" : r.team);
  if (w && over) {
    const then = r.after.lands - waitSum;
    return `${team} stays over budget until ${w.owner} ships ${w.fix}, which brings it to ${usd100(then)}${then <= r.after.budget ? ", under budget" : ""}.`;
  }
  if (w) return `${w.owner.charAt(0).toUpperCase() + w.owner.slice(1)} still has ${w.fix} to ship, which brings ${subject ? subject.toLowerCase() : r.team === "All teams" ? "spend" : r.team} to ${usd100(r.after.lands - waitSum)}.`;
  if (over) return `${team} still lands ${usd100(r.after.lands - r.after.budget)} over budget.`;
  return "";
}

/** "What happens next?" once nothing is open: what is still true, then what to expect. */
export function whatNext(r: Recap): string {
  // Three sentences at most, like every answer.
  return [
    stillTrue(r),
    r.waiting.length ? "You'll see it here when they ship it, and nothing else needs you this month." : "Nothing else needs you this month.",
    `Anything new, such as another source of waste, shows up here as a recommendation${r.rules ? ", and your saved rules carry over to next month" : ""}.`,
  ].filter(Boolean).join(" ");
}

/** The short form, for the line where the recommendations were: what, if anything, is still to come. */
export function doneLine(r: Recap): string {
  const w = r.waiting[0];
  if (w) return `Waiting on ${w.owner} to ship ${w.fix}.`;
  if (r.after.lands > r.after.budget) return `Still ${usd100(r.after.lands - r.after.budget)} over budget.`;
  return "Nothing else needs you this month.";
}

/** A question waiting for the admin's answer (why they declined, or a suggested rule). The recap waits for it. */
export function questionOpen(messages: { why?: { answer?: string }; rulesStatus?: string }[]): boolean {
  return messages.some((m) => (m.why && !m.why.answer) || m.rulesStatus === "proposed");
}

/** The recap as plain text, to paste into a message to the team or the budget owner. */
export function recapText(r: Recap): string {
  const lines = [
    `${r.team}, this month (day ${r.day} of 30)`,
    `Lands at ${usd100(r.after.lands)} against a ${usd(r.after.budget)} budget: ${r.after.status.toLowerCase()}. With nothing changed it was heading for ${usd100(r.before.lands)}.`,
  ];
  if (stillTrue(r)) lines.push(stillTrue(r));
  if (peopleLine(r)) lines.push(peopleLine(r));
  if (r.fixed > 0) lines.push(`Waste fixed: ${usd(r.fixed)}.`);
  if (r.budgetAdded > 0) lines.push(`Budget added: ${usd(r.budgetAdded)}, from ${usd(r.before.budget)} to ${usd(r.after.budget)}.`);
  for (const a of r.approved) lines.push(`Approved as planned: ${a}.`);
  for (const w of r.waiting) lines.push(`Waiting on ${w.owner}: ${w.fix} (${usd(w.amount)}).`);
  if (r.declined > 0) lines.push(`Declined: ${r.declined} ${r.declined === 1 ? "recommendation" : "recommendations"}.`);
  if (r.rules > 0) lines.push(`Rules saved: ${r.rules}.`);
  return lines.join("\n");
}

/** Whether anything was done this month (a fix, a decline, funding). A month that started on pace gets no recap. */
export function anythingDone(d: DemoState): boolean {
  return d.appliedFixes.length + d.handedOff.length + d.overrides.length + (d.declined?.length ?? 0) + Object.keys(d.budgetRevisions).length > 0 || d.rebalanceApplied;
}

/** What the recap trigger watches. `hasStep`: a next step for the admin, or a draft waiting for them. */
export interface DoneState { key: string; hasStep: boolean; verdict: Verdict }

/** Post a recap when the last open step for the team on screen closes, or when the owner ships the fix being waited
 *  on. Never on switching team, chat or situation (a different key), and never when nothing was done. */
export function shouldRecap(prev: DoneState | null, now: DoneState, done: boolean): boolean {
  if (!prev || prev.key !== now.key || now.hasStep || !done) return false;
  return prev.hasStep || (prev.verdict === "waiting" && now.verdict !== "waiting");
}
