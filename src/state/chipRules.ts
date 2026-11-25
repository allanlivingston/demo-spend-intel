// Which suggestion chips show under the message box. Pure: state in, chips out, so every state is testable.
// Order: the next step first, then questions that fit now, then "show again" chips for views that scrolled away.
import { breakdown, forecast, isAdvanced, ownerOf, pacing, type BreakdownRow, type DemoState, type GroupSelection } from "@/engine";
import type { StartRun } from "./agentClient";
import { nextAction, wasteSources } from "./nextAction";
import type { ChatMessage, ViewKind } from "./store";

export type ChipAction =
  | { type: "run"; run: StartRun }
  | { type: "ask"; q: string; context?: string[] }
  | { type: "view"; kind: ViewKind }
  | { type: "review"; artifactId: string }
  | { type: "decline"; artifactId: string }
  | { type: "approve"; artifactId: string }
  | { type: "shipped"; driverId: string }
  | { type: "activity" };

export interface ChipSpec { text: string; primary?: boolean; action: ChipAction }

export interface ChipInput {
  demo: DemoState;
  group: GroupSelection;
  messages: ChatMessage[];
  auditCount: number;
  /** Whether the newest forecast (with its recommendations) is on screen. */
  forecastVisible: boolean;
  /** Whether the waiting draft's own approve and Decline buttons are on screen (then the chips don't repeat them). */
  draftActionsVisible?: boolean;
}

export const MAX_CHIPS = 4;
const REVIEW_KINDS = ["cfo_brief", "governed_override"];

/** The newest draft still waiting for the admin (older drafts of the same kind are superseded). */
export function pendingDraft(messages: ChatMessage[]): ChatMessage | null {
  return [...messages].reverse().find((m) => m.artifact && m.artifactStatus === "proposed" && m.artifact.kind !== "handoff") ?? null;
}

/** True when a newer draft of the same kind replaced this one. */
export function isSuperseded(m: ChatMessage, messages: ChatMessage[]): boolean {
  if (!m.artifact || m.artifactStatus !== "proposed") return false;
  const i = messages.indexOf(m);
  return messages.slice(i + 1).some((x) => x.artifact?.kind === m.artifact!.kind && x.artifactStatus === "proposed");
}

const ask = (q: string, context?: string[]): ChipSpec => ({ text: q, action: { type: "ask", q, context } });

const SHORT: Record<string, string> = { "a-subagents": "Opus subagents", "a-connector": "Jira retry loop", "a-cache": "prompt cache drop" };

/** The agent run behind a recommendation's Fix it / Fund it button. */
export function runFor(r: BreakdownRow): StartRun {
  const fix = r.side === "fix";
  return {
    agent: r.agent,
    // Default view has no workstreams: funding goes to the brief, so no driver (its recording is a budget move).
    driverId: fix || isAdvanced() || r.driver.id === "b-soc2" ? r.driver.id : undefined,
    prompt: fix ? `Fix with agent: ${r.driver.label}.`
      : r.driver.id === "b-soc2" ? `Fund with agent: ${r.driver.label}. Draft the planned spend approval.`
      : isAdvanced() ? `Fund with agent: ${r.driver.label}. Plan a rebalance.` : "Draft the budget owner brief.",
    say: fix ? `Fix the ${SHORT[r.driver.id] ?? r.driver.label.charAt(0).toLowerCase() + r.driver.label.slice(1)}.` : r.driver.id === "b-soc2" ? "Approve the SOC 2 sprint as planned spend." : `Fund ${r.driver.label.toLowerCase()}.`,
  };
}

/** The open fix the admin just asked about from its card ("Tell me about this: …"), so the next chip can fix that one. */
function askedFix(i: ChipInput): BreakdownRow | undefined {
  const lastUser = [...i.messages].reverse().find((m) => m.role === "user")?.text ?? "";
  const label = /^Tell me about this: (.+)\.$/.exec(lastUser)?.[1];
  if (!label) return undefined;
  return breakdown(i.demo, "all").rows.find((r) => r.driver.label === label && r.side === "fix" && r.state === "open");
}

export function chipsFor(i: ChipInput): ChipSpec[] {
  if (i.messages.some((m) => m.run?.status === "running")) return [];
  const asked = new Set(i.messages.filter((m) => m.role === "user").map((m) => m.text));
  const next = nextAction(i.demo, i.group);
  const f = forecast(i.demo, i.group);
  const draft = pendingDraft(i.messages);
  const main: ChipSpec[] = [];

  if (draft) {
    const art = draft.artifact!;
    // The draft's own buttons may be scrolled away; only then do the chips repeat its approval and Decline.
    const repeat = !i.draftActionsVisible;
    if (repeat && REVIEW_KINDS.includes(art.kind)) main.push({ text: "Open the review", primary: true, action: { type: "review", artifactId: art.id } });
    else if (repeat && art.kind === "policy_diff") main.push({ text: art.rows.some((r) => !ownerOf(r.driverId)) ? "Apply the changes" : "Send to the owner", primary: true, action: { type: "approve", artifactId: art.id } });
    else if (repeat && art.kind === "rebalance_plan" && art.allowed) main.push({ text: "Move the budget", primary: true, action: { type: "approve", artifactId: art.id } });
    // The question is about the draft on screen, so it travels with it.
    const c = [`Draft waiting: ${draft.artifact!.kind}`, JSON.stringify(draft.artifact).slice(0, 1_000)];
    main.push(ask("Why these changes?", c), ask("What's the risk if I approve it?", c));
    if (repeat) main.push({ text: "Decline it", action: { type: "decline", artifactId: draft.artifact!.id } });
    if (draft.artifact!.kind === "policy_diff" && draft.artifact!.rows.length > 1) main.push(ask("What if I only approve part of it?", c));
  } else {
    if (next.cta) {
      const sources = wasteSources(i.demo, i.group);
      const text = next.verdict === "fix" ? (sources.length > 1 ? "Fix all the waste" : `Fix the ${sources[0].name.toLowerCase()}`) : next.cta.label;
      main.push({ text, primary: true, action: { type: "run", run: { ...next.cta.run, say: text } } });
    }
    if (next.verdict === "waiting") {
      main.push(ask("What waits on the dev tools team?"));
      // Demo control: play the owner's side so the story can finish.
      for (const id of i.demo.handedOff.filter((x) => !i.demo.appliedFixes.includes(x))) main.push({ text: "Owner shipped the fix (demo)", action: { type: "shipped", driverId: id } });
    }
    // Just asked about one fix from its card: fixing that one is the next step (the answer says "Fix it drafts the change").
    const one = askedFix(i);
    if (one) {
      const run = runFor(one);
      const text = `Fix the ${SHORT[one.driver.id] ?? one.driver.label.toLowerCase()}`;
      for (let k = main.length - 1; k >= 0; k--) if (main[k].text.toLowerCase() === text.toLowerCase()) main.splice(k, 1);
      main.forEach((c) => (c.primary = false));
      main.unshift({ text, primary: true, action: { type: "run", run: { ...run, say: text } } });
    }
    main.push(ask(f.p50 > f.pool ? "Why are we over budget?" : "Summarize spend"));
    if (next.verdict === "fix" || next.verdict === "fund") main.push(ask("What happens if we do nothing?"));
    // The pacing story: how it slows spend while people are over, and how we know it works once the decisions are made.
    if (next.verdict === "fund" && pacing(i.demo, i.group).capsBlocked > 0) main.push(ask("How is spend slowed?"));
    else if (next.verdict !== "fix" && isAdvanced()) main.push(ask("How do we know this pacing is any good?"));
  }

  const fresh = main.filter((c) => !asked.has(c.text));
  const extra: ChipSpec[] = [];
  if (!i.forecastVisible) extra.push({ text: "Show forecast", action: { type: "view", kind: "forecast" } });
  if (i.auditCount > 0) extra.push({ text: "View activity", action: { type: "activity" } });
  // "Show again" chips always fit: questions give way first.
  return [...fresh.slice(0, Math.max(1, MAX_CHIPS - extra.length)), ...extra].slice(0, MAX_CHIPS);
}
