import { chipsFor, stepOpen } from "@/state/chipRules";
// Preference rules: a decline with a lasting reason suggests a rule; saved rules are enforced by the engine and carry to next month.
import { beforeEach, expect, test } from "vitest";
import { isDeclined, ruleSentence } from "@/engine";
import { useStore } from "@/state/store";

const st = () => useStore.getState();
const last = () => st().messages[st().messages.length - 1];

beforeEach(() => {
  st().setScenario("C");
  st().reset();
});

test("decline, give a lasting reason, save: the rule stops suggestions for that kind and team", () => {
  st().declineRec("a-subagents");
  const why = last();
  expect(why.why?.driverId).toBe("a-subagents");
  st().answerWhy(why.id, "needed");
  const proposal = last();
  expect(proposal.rulesStatus).toBe("proposed");
  expect(proposal.rules?.[0]).toMatchObject({ topic: "model", groupId: "pe", level: "skip" });
  st().restoreRec("a-subagents"); // the hand decline is gone...
  st().saveRules(proposal.id, ["skip"]);
  expect(isDeclined(st().demo, "a-subagents")).toBe(true); // ...but the rule still keeps it out
  expect(st().audit.some((e) => e.action === "Saved rule" && e.detail === ruleSentence({ topic: "model", groupId: "pe", level: "skip" }))).toBe(true);
});

test("a short-term reason gives no rule", () => {
  st().declineRec("a-subagents");
  st().answerWhy(last().id, "later");
  expect(st().messages.some((m) => m.rules)).toBe(false);
  expect(last().text).toMatch(/next month/);
});

test("applying a fix suggests a rule (Ask me first by default); saved as Apply without asking, it applies itself next month", () => {
  st().applyPolicy(["a-connector"]);
  // One question at a time: the offer carries the new landing and is last; the forecast waits for the answer.
  const proposal = last();
  expect(proposal.text).toMatch(/^Applied\. Platform Engineering is now forecast at \$[\d,]+ against a \$40,000 budget.* You could apply this change yourself/);
  expect(proposal.held?.view).toBe("forecast");
  // No chips compete with the question.
  expect(chipsFor({ demo: st().demo, group: st().group, messages: st().messages, auditCount: st().audit.length, forecastVisible: false, draftActionsVisible: true })).toEqual([]);
  expect(proposal.rules?.map((r) => [r.topic, r.level])).toEqual([["loop", "ask"]]);
  const count = st().messages.length;
  st().saveRules(proposal.id, ["allow"]);
  // The confirmation is in the rule's card; the held forecast follows it, once.
  expect(st().messages).toHaveLength(count + 1);
  expect(st().messages.at(-2)!.rulesStatus).toBe("saved");
  expect(st().messages.at(-2)!.held).toBeUndefined();
  expect(last().view).toBe("forecast");
  st().setScenario("A");
  expect(st().demo.appliedFixes).toContain("a-connector");
  expect(st().demo.rules).toHaveLength(1);
  expect(st().audit.map((e) => e.action)).toContain("Applied by your rule");
  expect(st().messages[0].text).toMatch(/Your rules already handled one thing/);
});

test("fixes owned by another team are never suggested as automatic", () => {
  st().applyPolicy(["a-cache"]);
  expect(st().messages.some((m) => m.rules)).toBe(false);
});

test("No thanks stops the same suggestion; Reset demo clears rules", () => {
  st().applyPolicy(["a-connector"]);
  st().dismissRules(last().id);
  expect(last().view).toBe("forecast");
  st().undoPolicy(["a-connector"]);
  st().applyPolicy(["a-connector"]);
  expect(st().messages.filter((m) => m.rules)).toHaveLength(1);
  st().declineRec("a-subagents");
  st().answerWhy(last().id, "planned");
  st().saveRules(last().id, ["skip"]);
  st().reset();
  expect(st().demo.rules ?? []).toHaveLength(0);
  expect(st().ruleNoThanks).toEqual([]);
});

test("moving on without answering the rule posts the held forecast first, never blocks", () => {
  st().applyPolicy(["a-connector"]);
  const proposal = last();
  st().say({ role: "user", text: "Why are we over budget?" });
  const msgs = st().messages;
  expect(msgs.at(-2)!.view).toBe("forecast");
  expect(msgs.at(-1)!.text).toBe("Why are we over budget?");
  expect(msgs.find((m) => m.id === proposal.id)!.rulesStatus).toBe("proposed");
  expect(msgs.filter((m) => m.held)).toHaveLength(0);
});

test("declining on the card is one click and posts nothing; a lasting reason after it saves a rule; Undo removes both", () => {
  const count = st().messages.length;
  st().declineInPlace("a-subagents");
  expect(st().messages).toHaveLength(count);
  expect(isDeclined(st().demo, "a-subagents")).toBe(true);
  expect(st().demo.rules ?? []).toHaveLength(0);
  expect(st().giveDeclineReason("a-subagents", "needed")).toBe(true);
  expect(st().demo.rules?.[0]).toMatchObject({ topic: "model", groupId: "pe", level: "skip" });
  expect(st().audit.map((e) => e.action)).toEqual(expect.arrayContaining(["Declined recommendation", "Gave a reason", "Saved rule"]));
  st().restoreRec("a-subagents", true);
  expect(st().messages).toHaveLength(count);
  expect(isDeclined(st().demo, "a-subagents")).toBe(false);
  expect(st().demo.rules ?? []).toHaveLength(0);
  expect(st().declineReasons).toEqual({});
});

test("a short-term reason saves no rule; the recap can keep unexplained declines as rules", () => {
  st().declineInPlace("a-subagents");
  expect(st().giveDeclineReason("a-subagents", "later")).toBe(false);
  expect(st().demo.rules ?? []).toHaveLength(0);
  st().declineInPlace("a-connector");
  st().settleDeclines(["a-connector"], true);
  expect(st().demo.rules).toHaveLength(1);
  expect(st().declineReasons["a-connector"]).toBe("kept");
});

test("declining the last open card keeps the month open while its Undo is up, then closes it", () => {
  const open = () => st().demo && stepOpen(st().demo, st().group, st().messages, st().justDeclined);
  for (const id of ["a-subagents", "a-connector", "a-cache", "b-newhires"]) st().declineInPlace(id);
  expect(st().justDeclined).toBe("b-newhires");
  expect(open()).toBe(true);
  st().setJustDeclined(null);
  expect(open()).toBe(false);
});
