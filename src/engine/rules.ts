// The admin's preference rules: learned from approve and decline decisions, approved by the admin, applied here.
// Rules are data the engine enforces. Nothing depends on a model remembering them.
import { GROUPS } from "./data";
import { ownerOf } from "./routing";
import { driverById, SCENARIOS } from "./scenarios";
import type { DemoState, GroupId, PrefRule, RuleLevel, RuleTopic } from "./types";

/** Which kind of recommendation each driver is. */
export const TOPIC_OF: Record<string, RuleTopic> = {
  "a-connector": "loop", "a-subagents": "model", "a-cache": "cache", "b-newhires": "fund-new", "b-soc2": "planned",
};

/** Plain words for each kind: the action (imperative) and the noun phrase. */
export const TOPICS: Record<RuleTopic, { action: string; noun: string; when: string }> = {
  loop: { action: "turn off retries for agents stuck on a broken call", noun: "turning off retries for agents stuck on a broken call", when: "an agent keeps retrying a broken call" },
  model: { action: "move routine work to a cheaper Claude model", noun: "moving work to a cheaper Claude model", when: "routine work runs on an expensive model" },
  cache: { action: "fix broken prompt caching", noun: "fixes to prompt caching", when: "Claude stops reusing earlier work" },
  "fund-new": { action: "fund new engineers while they ramp up", noun: "funding new engineers while they ramp up", when: "new engineers need funding while they start" },
  planned: { action: "approve planned projects as planned spend", noun: "approving planned projects as planned spend", when: "a planned project needs approval" },
};

/** The three levels, in plain words, with the Managed Agents permission policy each matches. */
export const LEVELS: Record<RuleLevel, { label: string; policy: string }> = {
  allow: { label: "Apply without asking", policy: "always_allow" },
  ask: { label: "Ask me first", policy: "always_ask" },
  skip: { label: "Don't suggest", policy: "deny" },
};

/** "Apply without asking" only where the admin can make the change alone: not fixes owned by another team, not new funding. */
export const canAllow = (t: RuleTopic) => t === "loop" || t === "model" || t === "planned";

/** Reasons the admin can give for a decline. Lasting ones lead to a suggested rule. */
export const DECLINE_REASONS = [
  { id: "needed", label: "The team needs it", lasting: true },
  { id: "planned", label: "It's planned work", lasting: true },
  { id: "later", label: "Not this month", lasting: false, reply: "Noted. It will be suggested again next month." },
  { id: "numbers", label: "The numbers look off", lasting: false, reply: "Noted in Activity, so the estimate can be checked." },
] as const;
export type DeclineReasonId = (typeof DECLINE_REASONS)[number]["id"];

export const topicOf = (driverId: string): RuleTopic | undefined => TOPIC_OF[driverId];

/** The saved rule that covers this recommendation, if any. */
export function ruleFor(s: DemoState, driverId: string): PrefRule | undefined {
  const t = TOPIC_OF[driverId];
  const g = driverById(driverId)?.groupId;
  return t && g ? (s.rules ?? []).find((r) => r.topic === t && r.groupId === g) : undefined;
}

/** The rule as one sentence. */
export function ruleSentence(r: Pick<PrefRule, "topic" | "groupId" | "level" | "wording">): string {
  return r.wording?.[r.level] ?? templateSentence(r);
}

/** The app's own wording, used offline and whenever Claude's wording doesn't pass the checks. */
/** The question a suggested rule asks, before a choice is made: neutral, so the choices say what happens. */
export function ruleQuestion(r: Pick<PrefRule, "topic" | "groupId">): string {
  return `Next month in ${GROUPS[r.groupId].name}, when ${TOPICS[r.topic].when}:`;
}

export function templateSentence(r: Pick<PrefRule, "topic" | "groupId" | "level">): string {
  const team = GROUPS[r.groupId].name;
  const t = TOPICS[r.topic];
  if (r.level === "allow") return `For ${team}, ${t.action} without asking.`;
  if (r.level === "ask") return `For ${team}, ask me before ${t.noun}.`;
  return `For ${team}, don't suggest ${t.noun}.`;
}

const newId = (t: RuleTopic, g: GroupId) => `rule-${t}-${g}`;

/** A rule suggested after a decline with a lasting reason: stop suggesting this kind of change for this team. */
export function ruleFromDecline(driverId: string, reasonLabel: string, at = new Date().toISOString()): PrefRule | null {
  const t = TOPIC_OF[driverId];
  const d = driverById(driverId);
  if (!t || !d) return null;
  return { id: newId(t, d.groupId), topic: t, groupId: d.groupId, level: "skip", basedOn: reasonLabel ? `You declined "${d.plain ?? d.label}" because "${reasonLabel.toLowerCase()}".` : `You declined "${d.plain ?? d.label}".`, createdAt: at };
}

/** Rules suggested after the admin applied fixes they could have applied alone: do the same next month without asking. */
export function rulesFromApply(s: DemoState, driverIds: string[], noThanks: string[] = [], at = new Date().toISOString()): PrefRule[] {
  const out: PrefRule[] = [];
  for (const id of driverIds) {
    const t = TOPIC_OF[id];
    const d = driverById(id);
    if (!t || !d || ownerOf(id) || !canAllow(t) || ruleFor(s, id) || noThanks.includes(`${t}:${d.groupId}`)) continue;
    if (out.some((r) => r.topic === t && r.groupId === d.groupId)) continue;
    out.push({ id: newId(t, d.groupId), topic: t, groupId: d.groupId, level: "ask", basedOn: `You applied "${d.plain ?? d.label}".`, createdAt: at });
  }
  return out;
}

/** Add or replace rules (one per kind and team). */
export const withRules = (s: DemoState, rules: PrefRule[]): DemoState => ({
  ...s,
  rules: [...(s.rules ?? []).filter((r) => !rules.some((n) => n.topic === r.topic && n.groupId === r.groupId)), ...rules],
});

/**
 * A new month starts: "Apply without asking" rules act on what they cover before the admin looks.
 * Returns the new state and what was done, so it can be logged and shown.
 */
export function applyRulesAtStart(s: DemoState): { state: DemoState; applied: string[]; approved: string[] } {
  const drivers = SCENARIOS[s.scenarioId].drivers;
  const allowed = drivers.filter((d) => ruleFor(s, d.id)?.level === "allow" && !ownerOf(d.id));
  const applied = allowed.filter((d) => d.kind === "waste" && !s.appliedFixes.includes(d.id)).map((d) => d.id);
  const approved = allowed.filter((d) => TOPIC_OF[d.id] === "planned" && !s.overrides.includes(d.id)).map((d) => d.id);
  return {
    state: { ...s, appliedFixes: [...s.appliedFixes, ...applied], overrides: [...s.overrides, ...approved] },
    applied,
    approved,
  };
}
