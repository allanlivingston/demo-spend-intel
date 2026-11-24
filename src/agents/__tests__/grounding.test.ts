import { describe, expect, test } from "vitest";
import { figuresIn, ground, stripDashes } from "@/agents/grounding";
import { callTool, TOOLS, type ToolContext } from "@/agents/tools";
import { initialState } from "@/engine";

describe("grounding", () => {
  const results = [{ p50: 50_400, recoverable: 4_100, pct: 0.286, evidence: ["9,400 retries since day 14"] }];
  test("accepts figures that tools produced, including display rounding", () => {
    expect(ground("P50 is $50,400, or $50.4k, and 4,100 is recoverable. 28.6% over. 9,400 retries.", results).ok).toBe(true);
  });
  test("rejects figures no tool produced, with or without a $ sign", () => {
    expect(ground("This saves $5,000.", results).unmatched).toEqual(["$5,000"]);
    expect(ground("It recovers 4,700 this month.", results).unmatched).toEqual(["4,700"]);
    expect(ground("About 35% over.", results).ok).toBe(false);
  });
  test("ignores small counts like days", () => {
    expect(figuresIn("since day 14, 3 failures").length).toBe(0);
  });
  test("strips em and en dashes", () => expect(stripDashes("a — b–c")).toBe("a, b, c"));
});

describe("tools", () => {
  const ctx = (): ToolContext => ({ demo: initialState("A"), group: "pe", artifacts: [] });
  test("every tool validates input and returns data from the engine", () => {
    const c = ctx();
    expect(callTool(c, "get_forecast", {}).isError).toBe(false);
    expect(callTool(c, "draft_policy_diff", {}).isError).toBe(false);
    expect(c.artifacts[0].kind).toBe("policy_diff");
    expect(callTool(c, "draft_override", {}).isError).toBe(true); // driver_id required
    expect(callTool(c, "nope", {}).isError).toBe(true);
  });
  test("simulate_policy never mutates state", () => {
    const c = ctx();
    const before = JSON.stringify(c.demo);
    callTool(c, "simulate_policy", { apply_fixes: ["a-connector"] });
    expect(JSON.stringify(c.demo)).toBe(before);
  });
  test("tool outputs never include member IDs", () => {
    const c: ToolContext = { demo: initialState("B"), group: "pe", artifacts: [] };
    for (const t of TOOLS) {
      const args = t.name === "draft_override" ? { driver_id: "b-soc2" } : t.name === "send_to_owner_preview" ? null : {};
      if (args === null) continue;
      expect(callTool(c, t.name, args).text).not.toMatch(/\b(PE|FPA|MKT)-\d{2}\b/);
    }
  });
});

describe("polish", () => {
  test("adds thousands separators to dollar amounts", async () => {
    const { polish } = await import("@/agents/grounding");
    expect(polish("from $50400 to $39600, $538")).toBe("from $50,400 to $39,600, $538");
  });
});

describe("answer length", () => {
  test("flags more than 3 sentences and trims to 3", async () => {
    const { isTooLong, trimToLimit } = await import("@/agents/grounding");
    const long = "One. Two is here. Three, with $4,100. Four.";
    expect(isTooLong(long)).toBe(true);
    expect(trimToLimit(long)).toBe("One. Two is here. Three, with $4,100.");
    expect(isTooLong("Spend lands at $39,600. Review the proposed changes below.")).toBe(false);
  });
});

test("a word starting with m or k after an amount is not a suffix", () => {
  expect(figuresIn("under the $1,500 monthly limit, $200 more, $4.1k total").map((f) => f.value)).toEqual([1500, 200, 4100]);
});

test("the model selector pins one model; Auto routes by task", async () => {
  const { pickModel } = await import("@/agents/models");
  expect(pickModel("chat", "why are we over?", false, "auto")).toBe("claude-haiku-5-5");
  expect(pickModel("routing", "fix it", false, "auto")).toBe("claude-sonnet-5-5");
  expect(pickModel("chat", "why are we over?", false, "opus")).toBe("claude-opus-5-5");
  expect(pickModel("routing", "fix it", false, "haiku")).toBe("claude-haiku-5-5");
});
