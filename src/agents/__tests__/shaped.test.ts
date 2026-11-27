// The shaped answer architecture (the default; ANSWER_ARCH=base gives the earlier setup): tools that return what each
// question needs, so the figures and the rules come from the tool rather than the prompt.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { initialState, setAdvancedView, type DemoState } from "@/engine";
import { callTool, toolsFor } from "@/agents/tools";
import { systemPrompt, userPrompt } from "@/agents/prompts";
import { routeHint } from "@/agents/arch";

beforeAll(() => setAdvancedView(false));
afterEach(() => { delete process.env.ANSWER_ARCH; });
const shaped = () => { process.env.ANSWER_ARCH = "shaped"; };
const base = () => { process.env.ANSWER_ARCH = "base"; };

const afterFixes = (id: "A" | "C"): DemoState => ({ ...initialState(id), appliedFixes: ["a-connector", "a-subagents"], handedOff: ["a-cache"] });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (demo: DemoState, name: string): any => callTool({ demo, group: "pe", artifacts: [] }, name, {}).output.data;

describe("on by default", () => {
  test("with no flag set, the chat agent gets the answer-shaped tools", () => {
    expect(toolsFor("chat").map((t) => t.name)).toContain("explain_overage");
    expect(userPrompt("Why are we over budget?", [])).toMatch(/start with explain_overage\.$/);
  });
  test("ANSWER_ARCH=base: the chat agent gets neither the tools, the shorter rules nor the hint", () => {
    base();
    const names = toolsFor("chat").map((t) => t.name);
    expect(names).not.toContain("explain_overage");
    expect(systemPrompt("chat", initialState("C"), "pe")).toContain("When you say why a team is over budget");
    expect(userPrompt("Why are we over budget?", [])).toBe("Why are we over budget?");
  });
});

describe("ANSWER_ARCH=shaped", () => {
  test("adds the three tools, swaps the per-question rules and hints the tool to start with", () => {
    shaped();
    expect(toolsFor("chat").map((t) => t.name)).toEqual(expect.arrayContaining(["explain_overage", "compare_choices", "people_summary"]));
    const sys = systemPrompt("chat", initialState("C"), "pe");
    expect(sys).toContain("call explain_overage");
    expect(sys).not.toContain("When you say why a team is over budget");
    // A request to block people leads with what it would stop.
    expect(sys).toContain("If asked to block, cut off or limit people, say plainly that you won't and what it would stop");
    expect(sys).toContain('A change you draft is not approved yet: say what it does once the admin approves it, never "your approved changes".');
    // The steps line under an answer gives what a waste fix saves, like the answer and the app.
    const steps = callTool({ demo: initialState("C"), group: "pe", artifacts: [] }, "list_drivers", {}).output.summary;
    expect(steps).toContain("Prompt cache hit rate fell from 78% to 31%: fix saves $2,100");
    expect(steps).toContain("14 new engineers ramping on the payments refactor: +$6,200");
    expect(steps).not.toContain("$2,300");
    expect(userPrompt("Why are we over budget?", [])).toMatch(/start with explain_overage\.$/);
    // Other agents are unchanged.
    expect(systemPrompt("routing", initialState("C"), "pe")).not.toContain("explain_overage");
  });

  test("routing: chip questions map to the tool that answers them; others get no hint", () => {
    expect(routeHint("What happens if we do nothing?")).toContain("compare_choices");
    expect(routeHint("What if we turned on hard monthly limits for everyone today?")).toContain("compare_choices");
    expect(routeHint("Who is over their monthly limit?")).toContain("people_summary");
    expect(routeHint("Who on the team spends the most?")).toContain("people_summary");
    expect(routeHint("How much are we over, and is the new engineers' spend worth it?")).toContain("explain_overage");
    expect(routeHint("Finance says we'll land at $45,000, so we're fine, right?")).toContain("explain_overage");
    expect(routeHint("What waits on the dev tools team?")).toContain("explain_overage");
    expect(routeHint("Follow up on Vik D.")).toContain("get_user");
    expect(routeHint("Follow up on workstream: Payments Refactor")).toBe("");
    // Typed questions, the Finance ask and a false premise about waste.
    expect(routeHint("how much r we over by??")).toContain("explain_overage");
    expect(routeHint("why r we over budgt??")).toContain("explain_overage");
    expect(routeHint("How much more budget do we need from Finance?")).toContain("explain_overage");
    expect(routeHint("Why are the new engineers wasting so much money?")).toContain("explain_overage");
    // A definition goes to the FAQ alone; a question about our numbers doesn't.
    expect(routeHint("What is fixable waste?")).toBe("Hint from the app: start with lookup_faq.");
    expect(routeHint("What is a budget owner brief?")).toBe("Hint from the app: start with lookup_faq.");
    expect(routeHint("What's left?")).toContain("explain_overage");
    expect(routeHint("What happens next?")).toBe("");
    expect(routeHint("this is useless, just give me the number")).toBe("");
  });

  test("explain_overage after the fixes: what is left, with what the fix saves, and the fixed items apart", () => {
    const d = run(afterFixes("C"), "explain_overage");
    expect(d).toMatchObject({ lands_at: 48_200, budget: 40_000, over_by: 8_200 });
    expect(d.open_causes.map((c: { fix_saves_by_month_end?: number; costs_to_month_end?: number }) => c.fix_saves_by_month_end ?? c.costs_to_month_end).sort()).toEqual([2_100, 6_200]);
    expect(d.open_causes.find((c: { kind: string }) => c.kind === "waste").who_acts).toMatch(/dev tools team: the fix is with them/i);
    expect(d.already_fixed).toHaveLength(2);
    expect(JSON.stringify(d)).not.toMatch(/2,?300(?!\d)/);
    // The owner's fix says what shipping it does: still over, so the answer can't imply it ends the overage.
    expect(d.open_causes.find((c: { kind: string }) => c.kind === "waste")).toMatchObject({ lands_at_once_shipped: 46_100, still_over_by_then: 6_100 });
    expect(d.how_to_answer).toMatch(/Never say how many causes/);
    // The Finance ask is the brief's request, not a cause's figure.
    expect(d.budget_owner_request).toEqual({ short_by: 8_200, the_brief_asks_for: 8_500, new_budget: 48_500, what_it_covers: "It covers $6,100 of new work and $2,100 until the dev tools team ships their fix, rounded up." });
    expect(run(initialState("C"), "explain_overage").budget_owner_request.what_it_covers).toBe("It covers $6,100 of new work and $10,800 of waste not yet fixed, rounded up.");
    expect(run(initialState("C"), "explain_overage").open_waste_total).toBe(10_800);
    expect(run(initialState("A"), "explain_overage").who_does_what).toEqual({
      you_apply_on_approval: { items: expect.arrayContaining([expect.stringMatching(/subagent/i), expect.stringMatching(/connector|jira/i)]), total: 8_700 },
      with_an_owner: { items: [expect.stringMatching(/cache.*\(Dev tools team\)/i)], total: 2_100 }, to_fund: { items: [], total: 0 },
    });
    // Scenario A after the fixes: only the owner's fix is left.
    expect(run(afterFixes("A"), "explain_overage").open_causes).toHaveLength(1);
  });

  test("compare_choices keeps doing nothing (limits) and pacing apart", () => {
    const d = run(initialState("C"), "compare_choices");
    expect(d.doing_nothing.people_cut_off_this_month).toBe(15);
    expect(d.doing_nothing.lands_at).toBe(56_900);
    expect(d.doing_nothing.work_at_risk).toBe(3_900);
    expect(d.pacing_instead.people_cut_off).toBe(0);
    expect(d.fixing_the_waste.of_it_waiting_on_an_owner).toBe(2_100);
  });

  test("get_user carries its answer note only in the shaped architecture", () => {
    const user = () => callTool({ demo: initialState("C"), group: "pe", artifacts: [] }, "get_user", { user: "Vik D." }).output.data as { how_to_answer?: string };
    base();
    expect(user().how_to_answer).toBeUndefined();
    shaped();
    expect(user().how_to_answer).toMatch(/their workstream/);
    expect((user() as { why_pacing_treats_them_this_way?: string }).why_pacing_treats_them_this_way).toBe("Pacing doesn't slow them because their workstream, Payments Refactor, is producing results (31 PRs merged, 212 tests newly passing), and work producing results is slowed last.");
  });

  test("people_summary gives counts and points to the Users tab for names", () => {
    const d = run(initialState("C"), "people_summary");
    expect(d.over_monthly_limit_this_month).toBe(15);
    expect(d.names_and_ranking).toMatch(/Users tab/);
    // The 9 new engineers over their limit aren't slowed; the 34 slowed include the other 6.
    expect(d.of_them_new_engineers).toBe(9);
    expect(d.under_pacing).toMatchObject({ people_slowed_or_held: 34, of_them_over_their_limit: 6, new_engineers_slowed: 0 });
    expect(d.of_them_new_engineers_already_over_today).toBe(9);
    expect(d.about_the_new_engineers).toBe("9 of the 15 over their limit are new engineers. The results so far belong to all 14 new engineers ramping on the payments refactor together, not only those over their limit: 31 PRs merged, 212 tests newly passing. Too early to tell if the code lasts. Confidence that this spend is paying off: Medium.");
    expect(d.under_pacing.how_the_groups_overlap).toBe("The 34 slowed include 6 of the 15 over their limit; the 9 new engineers over their limit are not slowed, because the workstream they are on is producing results.");
    expect(JSON.stringify(d)).not.toMatch(/\b[A-Z][a-z]+ [A-Z]\./);
  });
});
