import { breakdown } from "@/engine";
import { startAgentRun } from "@/state/agentClient";
import { pendingDraft } from "@/state/chipRules";
import { useStore, type ChatMessage, type Snapshot } from "@/state/store";

export const ask = (q: string, context?: string[]) => startAgentRun({ agent: "chat", prompt: q, echo: true, context });
export const busyOf = (messages: ChatMessage[]) => messages.some((m) => m.run?.status === "running");
/**
 * "deny it", "decline", "reject this"... declines the draft waiting for an answer, or else the recommendation the
 * admin last asked about. Returns false when there is nothing clear to decline, so the message goes to Claude.
 */
export const DECLINE = /^(please\s+)?(deny|decline|reject|dismiss|skip|no thanks)(\s+(it|this|that|the draft|this draft|the recommendation|this recommendation))?[.!]?$/i;
export function declineByText(q: string): boolean {
  if (!DECLINE.test(q.trim())) return false;
  const st = useStore.getState();
  const draft = pendingDraft(st.messages);
  if (draft?.artifact) {
    st.say({ role: "user", text: q });
    st.declineDraft(draft.artifact.id);
    return true;
  }
  const lastAsked = [...st.messages].reverse().find((m) => m.role === "user" && /^(tell me about this|follow up on agent): /i.test(m.text ?? ""));
  const label = lastAsked?.text?.replace(/^(tell me about this|follow up on agent): /i, "").replace(/\.$/, "").toLowerCase();
  const row = label ? breakdown(st.demo, "all").rows.find((r) => r.driver.label.toLowerCase() === label && r.state === "open") : undefined;
  if (!row) return false;
  st.say({ role: "user", text: q });
  st.declineRec(row.driver.id);
  return true;
}
export const same = (a: Snapshot, b: Snapshot) => a.group === b.group && JSON.stringify(a.demo) === JSON.stringify(b.demo);
