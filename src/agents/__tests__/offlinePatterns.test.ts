// Typed questions Offline replay answers: over by how much, a what-if on one fix, a fix by name, and out of scope.
import { expect, test } from "vitest";
import { initialState } from "@/engine";
import { offlinePlan } from "@/agents/offline";

const ask = (prompt: string) => offlinePlan({ agent: "chat", prompt, demo: initialState("C"), group: "pe", pinned: [] }).text;

test("how much over: the overage against the budget", () => {
  expect(ask("how much r we over by??")).toMatch(/forecast at \$[\d,]+ against \$40,000, \$[\d,]+ over/);
});

test("what if we only fix one thing: the engine's forecast with just that fix", () => {
  expect(ask("What if we only fix the connector?")).toMatch(/With only that fix, .* forecast at \$[\d,]+ against \$40,000, down from \$[\d,]+/);
});

test("a fix by name points to its card; offline drafts nothing", () => {
  expect(ask("Fix the connector.")).toMatch(/Press Fix it on the "Jira link stuck retrying" card.*saves \$4,100/);
});

test("out of scope says so with no figures", () => {
  const t = ask("What's the weather in Paris today?");
  expect(t).toMatch(/outside what I can help with/);
  expect(t).not.toMatch(/\$\d/);
});
