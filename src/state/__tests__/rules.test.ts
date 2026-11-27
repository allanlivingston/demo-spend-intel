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

test("applying a fix suggests doing it without asking; saved, it applies itself next month", () => {
  st().applyPolicy(["a-connector"]);
  // The offer comes with "Applied.", above the updated forecast, which stays last.
  const proposal = st().messages.at(-2)!;
  expect(proposal.text).toMatch(/^Applied\. You could apply this change yourself/);
  expect(last().view).toBe("forecast");
  expect(last().rules).toBeUndefined();
  expect(proposal.rules?.map((r) => [r.topic, r.level])).toEqual([["loop", "allow"]]);
  st().saveRules(proposal.id, ["allow"]);
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
  st().dismissRules(st().messages.at(-2)!.id);
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
