// Claude's wording of a rule is kept only if every level passes: right team, short, plain, no figures.
import { expect, test } from "vitest";
import { checkWording } from "../ruleWording";
import type { PrefRule } from "@/engine";

const rule: PrefRule = { id: "rule-model-pe", topic: "model", groupId: "pe", level: "skip", basedOn: "You declined it.", createdAt: "" };
const good = {
  allow: "For Platform Engineering, move routine agent work to a cheaper Claude model without asking",
  ask: "For Platform Engineering, ask me before moving any work to a cheaper Claude model.",
  skip: "For Platform Engineering, stop suggesting cheaper Claude models for their work.",
};

test("good wording is kept, with a full stop added", () => {
  expect(checkWording(rule, good)?.allow).toBe(`${good.allow}.`);
});

test("one bad level drops all of it, so the template is used", () => {
  expect(checkWording(rule, { ...good, ask: "For FP&A, ask me first." })).toBeUndefined();
  expect(checkWording(rule, { ...good, skip: "For Platform Engineering, don't suggest saving $4,600 on models." })).toBeUndefined();
});

test("allow is ignored where it isn't offered", () => {
  const owner = { ...rule, topic: "cache" as const };
  expect(checkWording(owner, { ...good, allow: "" })?.allow).toBeUndefined();
});
