// Which suggestion chips show under the message box. Pure: state in, chips out, so every state is testable.
// Order: the next step first, then questions that fit now, then "show again" chips for views that scrolled away.
import { forecast, isAdvanced, ownerOf, pacing, type DemoState, type GroupSelection } from "@/engine";
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
}

export const MAX_CHIPS = 5;
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

export function chipsFor(i: ChipInput): ChipSpec[] {
  if (i.messages.some((m) => m.run?.status === "running")) return [];
  const asked = new Set(i.messages.filter((m) => m.role === "user").map((m) => m.text));
  const next = nextAction(i.demo, i.group);
  const f = forecast(i.demo, i.group);
  const draft = pendingDraft(i.messages);
  const main: ChipSpec[] = [];

  if (draft) {
    const art = draft.artifact!;
    // The draft's own button may be scrolled away, so its approval is always the first chip.
    if (REVIEW_KINDS.includes(art.kind)) main.push({ text: "Open the review", primary: true, action: { type: "review", artifactId: art.id } });
    else if (art.kind === "policy_diff") main.push({ text: art.rows.some((r) => !ownerOf(r.driverId)) ? "Apply the changes" : "Send to the owner", primary: true, action: { type: "approve", artifactId: art.id } });
    else if (art.kind === "rebalance_plan" && art.allowed) main.push({ text: "Move the budget", primary: true, action: { type: "approve", artifactId: art.id } });
    // The question is about the draft on screen, so it travels with it.
    const c = [`Draft waiting: ${draft.artifact!.kind}`, JSON.stringify(draft.artifact).slice(0, 1_000)];
    main.push(ask("Why these changes?", c), ask("What's the risk if I approve it?", c), { text: "Decline it", action: { type: "decline", artifactId: draft.artifact!.id } });
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
