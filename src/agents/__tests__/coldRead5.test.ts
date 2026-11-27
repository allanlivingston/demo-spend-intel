// Fifth cold read: the ask holds after a fix is handed off, and all-teams answers say which team a figure is for.
import { expect, test } from "vitest";
import { initialState, newWorkAsk } from "@/engine";
import { scoped } from "@/agents/runAgent";

test("the ask for new work doesn't change when the cache fix is sent to its owner", () => {
  const s = initialState("C");
  const before = newWorkAsk(s);
  const after = newWorkAsk({ ...s, appliedFixes: ["a-connector", "a-subagents"], handedOff: ["a-cache"] });
  expect(after).toBe(before);
});

test("in the all-teams view, the one team over budget is named as such", () => {
  const demo = initialState("C");
  expect(scoped({ demo, group: "all" }, "Platform Engineering is now forecast at $48,200.")).toBe("Platform Engineering, the team over budget, is now forecast at $48,200.");
  expect(scoped({ demo, group: "pe" }, "Platform Engineering is forecast at $48,200.")).toBe("Platform Engineering is forecast at $48,200.");
});

test("a draft that only hands a fix to its owner folds to a line that says what it saves once they ship", async () => {
  const { settledLine } = await import("@/components/Drafts");
  const line = settledLine({ kind: "policy_diff", rows: [{ driverId: "a-cache", savings: 2100 }] } as never);
  expect(line).toBe("Sent 1 to the dev tools team · saves $2,100 once they ship it");
});
