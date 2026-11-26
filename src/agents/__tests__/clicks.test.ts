// Evals for every click within two clicks of loading, offline (no Claude calls):
// chips, recommendation Ask / Fix it / Fund it, chart markers and Learn more, for each scenario and team.
// Questions must be on topic, grounded in the engine's tool results, short, and never draft anything.
// Actions must have a recording to replay and move the chips forward.
import { describe, expect, test } from "vitest";
import {
  agentsOf, breakdown, confidenceOf, draftPolicyDiff, driverEffects, forecast, GROUP_IDS, initialState, kpis, throttle, usersOf, workstreamPaces,
  type DemoState, type GroupSelection, type ScenarioId,
} from "@/engine";
import { offlineGuide, offlinePlan } from "@/agents/offline";
import { callTool } from "@/agents/tools";
import { ground, isTooLong } from "@/agents/grounding";
import { findRecording } from "@/agents/backends/replay";
import { chipsFor, MAX_CHIPS, type ChipSpec } from "@/state/chipRules";
import { nextAction } from "@/state/nextAction";
import type { ChatMessage } from "@/state/store";
import { GUIDE_CHIPS } from "@/components/DemoGuide";
import { freshSummary } from "@/agents/offline";
import { setAdvancedView } from "@/engine";

const SCENARIOS: ScenarioId[] = ["C", "baseline", "A", "B"];
const GROUPS: GroupSelection[] = ["all", ...GROUP_IDS];

function answer(demo: DemoState, group: GroupSelection, prompt: string, pinned: string[] = []) {
  const plan = offlinePlan({ agent: "chat", prompt, demo, group, pinned });
  const ctx = { demo, group, artifacts: [] };
  const results = plan.calls.map((c) => callTool(ctx, c.tool, c.input).output.data);
  return { plan, results, artifacts: ctx.artifacts };
}

function expectGoodAnswer(demo: DemoState, group: GroupSelection, q: string, pinned: string[] = []) {
  const { plan, results, artifacts } = answer(demo, group, q, pinned);
  expect(plan.text.length, q).toBeGreaterThan(20);
  expect(artifacts, `${q} drafted something`).toHaveLength(0);
  expect(isTooLong(plan.text), `${q} too long: ${plan.text}`).toBe(false);
  // Every figure must come from the tool steps shown with the answer, the same check live answers pass.
  const g = ground(plan.text, results);
  expect(g.unmatched, `${q}: ${plan.text}`).toEqual([]);
  return plan.text;
}

const user = (text: string): ChatMessage => ({ id: `u-${text}`, role: "user", text }) as ChatMessage;
const chips = (demo: DemoState, group: GroupSelection, messages: ChatMessage[] = []) =>
  chipsFor({ demo, group, messages, auditCount: 0, forecastVisible: true });

describe.each(SCENARIOS)("scenario %s", (sc) => {
  const demo = initialState(sc);

  test.each(GROUPS)("chips on load for %s are short, unique and lead with the next step", (group) => {
    const cs = chips(demo, group);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.length).toBeLessThanOrEqual(MAX_CHIPS);
    expect(new Set(cs.map((c) => c.text)).size).toBe(cs.length);
    const primary = cs.filter((c) => c.primary);
    expect(primary.length).toBeLessThanOrEqual(1);
    if (primary.length) expect(cs[0].primary).toBe(true);
  });

  test.each(GROUPS)("every question chip for %s answers on topic, twice deep", async (group) => {
    const first = chips(demo, group).filter((c) => c.action.type === "ask");
    for (const c of first) {
      const q = (c.action as Extract<ChipSpec["action"], { type: "ask" }>).q;
      expectGoodAnswer(demo, group, q);
      // Second click: the asked chip is gone and the remaining questions still answer.
      const next = chips(demo, group, [user(c.text)]);
      expect(next.map((x) => x.text)).not.toContain(c.text);
      for (const n of next.filter((x) => x.action.type === "ask")) expectGoodAnswer(demo, group, (n.action as { q: string }).q);
    }
  });

  test("on-topic answers name what was asked", () => {
    if (sc === "A") {
      expect(expectGoodAnswer(demo, "pe", "Why are we over budget?")).toMatch(/over/);
      expect(expectGoodAnswer(demo, "pe", "What happens if we do nothing?")).toMatch(/waste/);
      expect(expectGoodAnswer(demo, "pe", "Where does the fixable waste come from?")).toMatch(/retry|subagent|cache/i);
    }
    if (sc === "B") expect(expectGoodAnswer(demo, "pe", "What work is at risk, and for whom?")).toMatch(/engineers/);
    expect(expectGoodAnswer(demo, "all", "What does lands at mean?")).toMatch(/month/);
  });

  test("Ask on every recommendation explains that recommendation", () => {
    for (const g of GROUP_IDS) {
      for (const r of breakdown(demo, g).rows) {
        const text = expectGoodAnswer(demo, g, `Tell me about this: ${r.driver.label}.`);
        expect(text).toContain(r.driver.label);
        expect(text).toContain(confidenceOf(r.driver).level);
      }
    }
  });

  test("clicking any day on the chart answers", () => {
    for (const g of GROUP_IDS) {
      for (const d of driverEffects(demo, g).map((e) => e.driver).filter((d) => d.marker))
        expect(expectGoodAnswer(demo, g, `What happened on day ${d.startDay}?`)).toContain(d.label);
      const starts = new Set(driverEffects(demo, g).map((e) => e.driver.startDay));
      // Days where an event started answer about the event; other block days answer about the block.
      for (const day of Object.keys(throttle(demo, g).blockDays).filter((d) => !starts.has(+d)))
        expect(expectGoodAnswer(demo, g, `What's expected on day ${day}?`)).toMatch(/monthly limit/);
      // Any day on the chart, past or future, answers.
      for (const day of [1, 5, 18, 25, 30]) expect(expectGoodAnswer(demo, g, day > 18 ? `What's expected on day ${day}?` : `What happened on day ${day}?`)).toMatch(new RegExp(`[Dd]ay ${day}`));
    }
  });

  test("Follow up on every user and every agent answers", () => {
    for (const g of GROUPS) {
      for (const u of usersOf(demo, g).slice(0, 12)) expect(expectGoodAnswer(demo, g, `Follow up on ${u.name}`)).toContain(u.name);
      for (const a of agentsOf(demo, g)) expectGoodAnswer(demo, g, `Follow up on agent: ${a.label}`);
      for (const w of g === "all" ? [] : workstreamPaces(demo, g)) expect(expectGoodAnswer(demo, g, `Follow up on workstream: ${w.ws.name}`)).toContain(w.ws.name);
    }
  });

  test("Fix it / Fund it on every open recommendation has a recording to replay", async () => {
    for (const g of GROUP_IDS)
      for (const r of breakdown(demo, g).rows.filter((x) => x.state === "open" && !(x.side === "fix" && x.driver.kind === "growth")))
        expect(await findRecording(r.agent, sc, r.driver.id), r.driver.id).toBeTruthy();
    const cta = chips(demo, "pe").find((c) => c.action.type === "run");
    if (cta && cta.action.type === "run") expect(await findRecording(cta.action.run.agent, sc, cta.action.run.driverId)).toBeTruthy();
  });
});

describe("state moves the chips forward", () => {
  test("waste fixed by the admin leaves only what waits on the repo owner", () => {
    const demo: DemoState = { ...initialState("A"), appliedFixes: ["a-connector", "a-subagents"], handedOff: ["a-cache"] };
    const texts = chips(demo, "pe").map((c) => c.text);
    // The recap says what waits on the owner; the chips offer the owner's side (demo) and point forward.
    expect(texts).toContain("Owner shipped the fix (demo)");
    expect(texts).not.toContain("Fix all the waste");
    // Still asked from Learn more under Waiting on owner.
    expectGoodAnswer(demo, "pe", "What waits on the dev tools team?");
  });

  test("a pending draft swaps in questions about that draft, with the draft as context", () => {
    const demo = initialState("A");
    const ctx = { demo, group: "pe" as const, artifacts: [] as never[] };
    callTool(ctx, "draft_policy_diff", {});
    const art = ctx.artifacts[0] as { kind: string; id: string; rows: unknown[] };
    const msgs = [user("Fix all the waste"), { id: "d", role: "assistant", artifact: art, artifactStatus: "proposed" } as unknown as ChatMessage];
    const cs = chips(demo, "pe", msgs);
    expect(cs.map((c) => c.text)).toContain("Why these changes?");
    for (const c of cs.filter((x) => x.action.type === "ask")) {
      const a = c.action as { q: string; context?: string[] };
      expect(a.context?.[0]).toBe("Draft waiting: policy_diff");
      expectGoodAnswer(demo, "pe", a.q, a.context);
    }
  });

  test("views that scrolled away come back as chips without crowding out the next step", () => {
    const cs = chipsFor({ demo: initialState("A"), group: "pe", messages: [], auditCount: 3, forecastVisible: false });
    const texts = cs.map((c) => c.text);
    expect(texts).toEqual(expect.arrayContaining(["Show forecast", "View activity"]));
    expect(cs[0].primary).toBe(true);
    expect(cs.length).toBeLessThanOrEqual(MAX_CHIPS);
  });

  test("after asking about one fix from its card, the next step fixes that one, with a recording to replay", async () => {
    const demo = initialState("C");
    for (const r of breakdown(demo, "pe").rows.filter((x) => x.side === "fix" && x.state === "open")) {
      const cs = chips(demo, "pe", [user(`Tell me about this: ${r.driver.label}.`)]);
      expect(cs[0].primary).toBe(true);
      expect(cs[0].text).toMatch(/^Fix the /);
      expect(cs.filter((c) => c.primary)).toHaveLength(1);
      expect(new Set(cs.map((c) => c.text.toLowerCase())).size).toBe(cs.length);
      const run = cs[0].action.type === "run" ? cs[0].action.run : null;
      expect(run?.driverId).toBe(r.driver.id);
      expect(await findRecording(run!.agent, "C", run!.driverId)).not.toBeNull();
    }
  });

  test("no chips while Claude is working", () => {
    const running = { id: "r", role: "assistant", run: { status: "running", steps: [] } } as unknown as ChatMessage;
    expect(chips(initialState("A"), "pe", [running])).toEqual([]);
  });
});

describe("Ask about this demo", () => {
  test.each(GUIDE_CHIPS)("%s answers from the guide", (q) => {
    const a = offlineGuide(q);
    expect(a).not.toMatch(/^I can answer questions/);
    expect(a.length).toBeGreaterThan(60);
  });
  test("chat-first and dashboard questions land on the layout section", () => {
    expect(offlineGuide("Why chat-first instead of a dashboard?")).toMatch(/dashboard/);
    expect(offlineGuide("What problem does this solve, and for whom?")).toMatch(/admin|platform owner/);
  });
});

describe("Decline", () => {
  test("a declined fix drops out of waste to fix, the next step and the Policy Diff, but stays in the forecast", () => {
    const base = initialState("C");
    const demo: DemoState = { ...base, declined: ["a-connector"] };
    expect(kpis(demo, "pe").fixableWaste).toBe(kpis(base, "pe").fixableWaste - 4_100);
    expect(forecast(demo, "pe").p50).toBe(forecast(base, "pe").p50);
    expect(breakdown(demo, "pe").rows.find((r) => r.driver.id === "a-connector")?.state).toBe("declined");
    expect(draftPolicyDiff(demo, "pe").driverIds).not.toContain("a-connector");
    expect(expectGoodAnswer(demo, "pe", "Why are we over budget?")).not.toContain("$10,800");
  });

  test("declining every fix moves the next step to funding; declining the rebalance skips to the SOC 2 approval", () => {
    setAdvancedView(true);
    const fixes = ["a-connector", "a-subagents", "a-cache"];
    const demo: DemoState = { ...initialState("C"), declined: fixes };
    expect(nextAction(demo, "pe").verdict).toBe("fund");
    expect(nextAction({ ...demo, declined: [...fixes, "b-newhires"] }, "pe").cta?.label).toBe("Approve the planned SOC 2 sprint");
  });

  test("a waiting draft offers Decline it", () => {
    const demo = initialState("A");
    const ctx = { demo, group: "pe" as const, artifacts: [] as never[] };
    callTool(ctx, "draft_policy_diff", {});
    const msgs = [{ id: "d", role: "assistant", artifact: ctx.artifacts[0], artifactStatus: "proposed" } as unknown as ChatMessage];
    expect(chips(demo, "pe", msgs).find((c) => c.text === "Decline it")?.action.type).toBe("decline");
    // Once declined, it no longer counts as waiting.
    const declined = [{ ...msgs[0], artifactStatus: "declined" } as ChatMessage];
    expect(chips(demo, "pe", declined).map((c) => c.text)).not.toContain("Decline it");
  });
});

describe("the whole guided flow, start to finish", () => {
  // Follows the primary chip each step: replays the recording on the live state, checks its figures, asks every
  // question chip (with and without the draft), approves the draft, and checks the flow ends on track or waiting.
  test.each([
    ["C", true], ["A", true], ["B", true], ["C", false], ["B", false],
  ] as [ScenarioId, boolean][])("scenario %s, advanced view %s", async (sc, adv) => {
    setAdvancedView(adv);
    let demo = initialState(sc);
    const msgs: ChatMessage[] = [];
    for (let step = 0; step < 8; step++) {
      const cs = chips(demo, "pe", msgs);
      for (const c of cs.filter((x) => x.action.type === "ask")) expectGoodAnswer(demo, "pe", (c.action as { q: string }).q);
      const p = cs.find((c) => c.primary);
      if (!p) break;
      expect(p.action.type).toBe("run");
      const run = (p.action as Extract<ChipSpec["action"], { type: "run" }>).run;
      const rec = (await findRecording(run.agent, sc, run.driverId))!;
      const ctx = { demo, group: "pe" as const, artifacts: [] as never[] };
      const res = rec.calls.map((c) => callTool(ctx, c.tool, c.input).output.data);
      const art = ctx.artifacts.at(-1) as unknown as { kind: string; driverIds?: string[]; newBudget?: number };
      // Advanced view replays the recorded wording; the default view skips the budget move, so its funding
      // replies come from the live numbers instead.
      if (adv) expect(ground(rec.text, res).unmatched, `${rec.key} is stale: ${rec.text}`).toEqual([]);
      else expect(art.kind).not.toBe("rebalance_plan");
      if (!ground(rec.text, res).ok) expect(ground(freshSummary(demo, art.kind), res).unmatched).toEqual([]);
      const draftMsgs = [...msgs, { id: `d${step}`, role: "assistant", artifact: art, artifactStatus: "proposed" } as unknown as ChatMessage];
      for (const c of chips(demo, "pe", draftMsgs).filter((x) => x.action.type === "ask")) {
        const a = c.action as { q: string; context?: string[] };
        expectGoodAnswer(demo, "pe", a.q, a.context);
      }
      if (art.kind === "policy_diff") {
        const ids = art.driverIds ?? [];
        demo = { ...demo, appliedFixes: [...demo.appliedFixes, ...ids.filter((x) => x !== "a-cache")], handedOff: ids.includes("a-cache") ? [...demo.handedOff, "a-cache"] : demo.handedOff };
      } else if (art.kind === "rebalance_plan") demo = { ...demo, rebalanceApplied: true };
      else if (art.kind === "governed_override") demo = { ...demo, overrides: [...demo.overrides, run.driverId!] };
      else if (art.kind === "cfo_brief") demo = { ...demo, budgetRevisions: { ...demo.budgetRevisions, pe: art.newBudget! } };
      msgs.push(user(p.text));
    }
    expect(["waiting", "funded", "on-pace"]).toContain(nextAction(demo, "pe").verdict);
    setAdvancedView(true);
  });
});
