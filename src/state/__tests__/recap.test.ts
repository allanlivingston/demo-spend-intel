// The end of the work: a recap once everything open is handled, and chips that point forward instead of trailing off.
import { beforeAll, describe, expect, test } from "vitest";
import { forecast, initialState, setAdvancedView, type DemoState } from "@/engine";
import { anythingDone, peopleLine, questionOpen, recapOf, recapText, shouldRecap, stillTrue, whatNext } from "@/state/recap";
import { offlinePlan } from "@/agents/offline";
import { chipsFor } from "@/state/chipRules";
import { nextAction } from "@/state/nextAction";

beforeAll(() => setAdvancedView(false));

/** "Waste and new work" after Fix all (the cache fix goes to its owner), Apply, and the approved brief. */
function finished(): DemoState {
  const fixed = { ...initialState("C"), appliedFixes: ["a-connector", "a-subagents"], handedOff: ["a-cache"] };
  const budget = Math.ceil((forecast(fixed, "pe").p50 - 40_000) / 500) * 500 + 40_000;
  return { ...fixed, budgetRevisions: { pe: budget } };
}

describe("recap", () => {
  test("says where the month was heading, where it lands now, and what is still waiting", () => {
    const r = recapOf(finished(), "pe");
    expect(r.team).toBe("Platform Engineering");
    expect(r.before).toEqual({ lands: forecast(initialState("C"), "pe").p50, budget: 40_000 });
    expect(r.after.status).toBe("On track");
    expect(r.after.lands).toBeLessThan(r.before.lands);
    expect(r.fixed).toBe(8_700);
    expect(r.budgetAdded).toBe(r.after.budget - 40_000);
    expect(r.waiting).toEqual([{ owner: "the dev tools team", fix: "the cache fix", amount: 2_100 }]);
    expect(r.declined).toBe(0);
  });

  test("the copied summary is plain lines, one per change", () => {
    const text = recapText(recapOf(finished(), "pe"));
    expect(text.split("\n")[0]).toBe("Platform Engineering, this month (day 18 of 30)");
    expect(text).toMatch(/^Forecast \$[\d,]+ against a \$[\d,]+ budget: on track\./m);
    expect(text).toContain("Waste fixed: $8,700.");
    expect(text).toContain("Waiting on the dev tools team: the cache fix ($2,100).");
    expect(text).not.toMatch(/Declined|Rules saved/);
  });

  test("done for the admin but still over budget says so, and when that changes", () => {
    // "Agents wasting spend" after Apply: the owner's cache fix is what brings it under.
    const waiting = recapOf({ ...initialState("A"), appliedFixes: ["a-connector", "a-subagents"], handedOff: ["a-cache"] }, "pe");
    expect(waiting.after.status).toBe("Over budget");
    expect(stillTrue(waiting)).toBe(`Platform Engineering stays over budget until the dev tools team ships the cache fix, which brings it to $${(Math.round((waiting.after.lands - 2_100) / 100) * 100).toLocaleString("en-US")}, under budget.`);
    expect(recapText(waiting)).toContain(stillTrue(waiting));
    // On track but still waiting: says what the fix will do.
    expect(stillTrue(recapOf(finished(), "pe"))).toMatch(/^The dev tools team still has the cache fix to ship, which brings Platform Engineering to \$[\d,]+\.$/);
    expect(stillTrue(recapOf(finished(), "pe"), "It")).toMatch(/which brings it to \$[\d,]+\.$/);
    // Over with nothing left to do (the funding declined): says how far over.
    expect(stillTrue(recapOf({ ...initialState("B"), declined: ["b-newhires"] }, "pe"))).toMatch(/^Platform Engineering is still forecast \$[\d,]+ over budget\.$/);
  });

  test("the people line comes from the engine: nobody cut off, and the new engineers when budget was added", () => {
    expect(peopleLine(recapOf(finished(), "pe"))).toBe("Nobody was cut off this month, and the 14 new engineers were not slowed.");
    expect(peopleLine(recapOf({ ...initialState("A"), appliedFixes: ["a-connector"] }, "pe"))).toBe("Nobody was cut off this month.");
    expect(peopleLine({ ...recapOf(finished(), "pe"), cutOff: 2 })).toBe("");
  });

  test("What happens next? says what is still true before saying nothing else needs you", () => {
    const ask = (demo: DemoState) => offlinePlan({ agent: "chat", prompt: "What happens next?", demo, group: "pe", pinned: [] }).text;
    const over = { ...initialState("A"), appliedFixes: ["a-connector", "a-subagents"], handedOff: ["a-cache"] };
    expect(ask(over)).toBe(whatNext(recapOf(over, "pe")));
    expect(ask(over)).toMatch(/^Platform Engineering stays over budget until the dev tools team ships the cache fix, .*You'll see it here when they ship it, and nothing else needs you this month\./);
    expect(ask({ ...over, appliedFixes: [...over.appliedFixes, "a-cache"], handedOff: [] })).toMatch(/^Nothing else needs you this month\./);
    // With something still open, that comes first.
    expect(ask(initialState("C"))).toMatch(/Next step: fix the waste\.$/);
  });

  test("a month nothing was done in gets no recap", () => {
    expect(anythingDone(initialState("C"))).toBe(false);
    expect(anythingDone(finished())).toBe(true);
  });
});

describe("when the recap is posted", () => {
  const at = (hasStep: boolean, verdict: "fix" | "fund" | "waiting" | "funded" | "on-pace", key = "k") => ({ key, hasStep, verdict });
  test("when the last open step closes", () => expect(shouldRecap(at(true, "fund"), at(false, "waiting"), true)).toBe(true));
  test("when the owner ships the fix being waited on", () => expect(shouldRecap(at(false, "waiting"), at(false, "funded"), true)).toBe(true));
  test("not on first load, a team or situation switch, a step still open, or nothing done", () => {
    expect(shouldRecap(null, at(false, "funded"), true)).toBe(false);
    expect(shouldRecap(at(true, "fix", "pe"), at(false, "on-pace", "fpa"), true)).toBe(false);
    expect(shouldRecap(at(true, "fix"), at(true, "fund"), true)).toBe(false);
    expect(shouldRecap(at(true, "fix"), at(false, "on-pace"), false)).toBe(false);
    expect(shouldRecap(at(false, "funded"), at(false, "funded"), true)).toBe(false);
  });
});

test("an unanswered Why or suggested rule holds the recap back", () => {
  expect(questionOpen([{ why: {} }])).toBe(true);
  expect(questionOpen([{ why: { answer: "The team needs it" } }])).toBe(false);
  expect(questionOpen([{ rulesStatus: "proposed" }])).toBe(true);
  expect(questionOpen([{ rulesStatus: "dismissed" }, { rulesStatus: "saved" }])).toBe(false);
});

describe("chips once everything is handled", () => {
  const base = { messages: [], auditCount: 4, forecastVisible: true };
  test("point forward: the owner's side (demo), another situation, what happens next; Activity gives way", () => {
    const demo = finished();
    expect(nextAction(demo, "pe").cta).toBeNull();
    const chips = chipsFor({ ...base, demo, group: "pe" });
    expect(chips.map((c) => c.text)).toEqual(["Owner shipped the fix (demo)", "Try another situation", "What happens next?", "Summarize spend"]);
    expect(chips.find((c) => c.primary)).toBeUndefined();
    expect(chips[1].action).toEqual({ type: "situations" });
  });

  test("another team with work comes first, as the next step", () => {
    const chips = chipsFor({ ...base, demo: initialState("C"), group: "fpa" });
    expect(chips[0]).toEqual({ text: "Check Platform Engineering", primary: true, action: { type: "group", group: "pe" } });
  });

  test("a month that starts on pace offers other situations, with no headline button", () => {
    const chips = chipsFor({ ...base, auditCount: 0, demo: initialState("baseline"), group: "pe" });
    expect(chips.map((c) => c.text)).toContain("Try another situation");
    expect(chips.some((c) => c.primary && c.action.type === "run")).toBe(false);
  });
});
