import { describe, expect, test } from "vitest";
import {
  breakdown, distanceOffPace, forecast, headline, initialState, kpis, levelWithHysteresis, nudge,
  rebalancePlan, recoveryOf, SCENARIOS, throttle, workstreamPaces, gate, rng, type DemoState, type NudgeLevel,
} from "@/engine";

const within1 = (actual: number, target: number) => expect(Math.abs(actual - target) / target).toBeLessThanOrEqual(0.01);
const ALL_FIXES = ["a-connector", "a-subagents", "a-cache"];
const B_REBAL = (): DemoState => ({ ...initialState("B"), rebalanceApplied: true });

describe("section 3 target numbers (Platform Engineering)", () => {
  const cases: [string, DemoState, number, number | null, string][] = [
    ["Baseline", initialState("baseline"), 38_900, 41_200, "On track"],
    ["A before", initialState("A"), 50_400, 53_800, "Over budget"],
    ["A after Apply Policy", { ...initialState("A"), appliedFixes: ALL_FIXES }, 39_600, 41_900, "On track"],
    ["B before", initialState("B"), 48_000, 50_900, "Over budget"],
    ["B after rebalance", B_REBAL(), 48_400, 51_200, "Over budget"],
    ["B after revision approved", { ...B_REBAL(), overrides: ["b-soc2"], budgetRevisions: { pe: 48_500 } }, 48_400, null, "On track"],
  ];
  test.each(cases)("%s", (_n, s, p50, p90, status) => {
    const f = forecast(s, "pe");
    within1(f.p50, p50);
    if (p90) within1(f.p90, p90);
    expect(f.status).toBe(status);
  });
  test("B after rebalance is flagged as funded variance", () => expect(forecast(B_REBAL(), "pe").fundedVariance).toBe(true));
  test("over-forecast percentages", () => {
    expect(forecast(initialState("A"), "pe").overForecastPct).toBeCloseTo(0.286, 2);
    expect(forecast(initialState("B"), "pe").overForecastPct).toBeCloseTo(0.224, 2);
  });
  test("Scenario A drivers and recoveries", () => {
    expect(SCENARIOS.A.drivers.map((d) => d.forward)).toEqual([4_100, 4_800, 2_300]);
    expect(SCENARIOS.A.drivers.map(recoveryOf)).toEqual([4_100, 4_600, 2_100]);
    expect(kpis(initialState("A"), "pe").fixableWaste).toBe(10_800);
  });
  test("throttled value: 9 new engineers blocked by day 22, $3,400 to $600 after rebalance", () => {
    const t = throttle(initialState("B"), "pe");
    expect(t.newHiresBlockedByDay22).toBe(9);
    expect(t.value).toBe(3_400);
    expect(throttle(B_REBAL(), "pe").value).toBe(600);
  });
  test("other groups and baseline", () => {
    const s = initialState("baseline");
    within1(forecast(s, "fpa").p50, 16_400);
    within1(forecast(s, "mkt").p50, 9_800);
    within1(forecast(s, "all").p50, 65_100);
    expect(throttle(s, "pe").value).toBe(0);
  });
});

describe("headlines", () => {
  test("computed per scenario", () => {
    expect(headline(initialState("baseline"))).toBe("All teams on pace.");
    expect(headline(initialState("A"))).toBe("Platform Engineering: $10,800 of waste to fix.");
    expect(headline(initialState("B"))).toBe("Platform Engineering: About 7% of runs are slowed or held each day to stay within limits. Move unused budget to the payments refactor.");
  });
});

describe("rebalance", () => {
  test("Share up to 20% never moves more than 20% of any donor's remaining target", () => {
    const p = rebalancePlan(initialState("B"), "pe");
    expect(p.allowed).toBe(true);
    for (const d of p.donors) expect(d.move).toBeLessThanOrEqual(0.2 * d.remaining + 0.5);
    expect(p.moved).toBe(2_800);
    expect(p.donors.map((d) => d.name).sort()).toEqual(["Code Review", "Infra and On-call"]);
  });
  test("donors pace under 50% of target", () => {
    const paces = workstreamPaces(initialState("B"), "pe");
    for (const d of rebalancePlan(initialState("B"), "pe").donors) expect(paces.find((p) => p.ws.id === d.id)!.pace).toBeLessThan(0.5);
  });
  test("output never references an individual member ID", () => {
    const json = JSON.stringify(rebalancePlan(initialState("B"), "pe"));
    expect(json).not.toMatch(/\b(PE|FPA|MKT)-\d{2}\b/);
  });
  test("refused below tier 2 and when Fully pooled lacks tier 3", () => {
    expect(rebalancePlan({ ...initialState("B"), sharingLevel: "fixed" }, "pe").allowed).toBe(false);
    const pooled = rebalancePlan({ ...initialState("B"), sharingLevel: "pooled" }, "pe");
    expect(pooled.allowed).toBe(false);
    expect(pooled.reason).toMatch(/high-confidence/);
    expect(rebalancePlan({ ...initialState("B"), sharingLevel: "pooled", tier3Arrived: true }, "pe").allowed).toBe(true);
    expect(gate("rebalanceShare20", 1).ok).toBe(false);
  });
});

describe("nudges", () => {
  test("calendar invariance: same d gives the same level on any day (no day input exists)", () => {
    expect(nudge.length).toBeLessThanOrEqual(3);
    expect(nudge(2.4, "fix").level).toBe(nudge(2.4, "fix").level);
    expect(distanceOffPace(50_400, 40_000, 2_653)).toBeCloseTo(3.92, 1);
  });
  test("above 3: waste gets routing, evidence gets the fund prompt", () => {
    expect(nudge(3.5, "fix").action).toBe("urgent-routing");
    expect(nudge(3.5, "fund").action).toBe("fund-prompt");
    expect(kpis(initialState("A"), "pe").nudge.action).toBe("urgent-routing");
    expect(kpis(initialState("B"), "pe").nudge.action).toBe("fund-prompt");
  });
  test("hysteresis: steps down only 0.5 below the level's lower bound", () => {
    expect(levelWithHysteresis(1.8, 2)).toBe(2);
    expect(levelWithHysteresis(1.4, 2)).toBe(1);
    expect(levelWithHysteresis(2.6, 1)).toBe(2);
  });
  test("no oscillation over a noisy 10-day replay near a boundary", () => {
    const r = rng(42);
    let lvl: NudgeLevel | null = null;
    const levels: number[] = [];
    for (let i = 0; i < 10; i++) {
      lvl = levelWithHysteresis(2 + (r() - 0.5) * 0.8, lvl);
      levels.push(lvl);
    }
    const changes = levels.filter((l, i) => i > 0 && l !== levels[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(1);
  });
});

describe("fund or fix", () => {
  test("Scenario A is all Fix; Scenario B is all Fund", () => {
    expect(breakdown(initialState("A"), "pe").rows.every((r) => r.side === "fix")).toBe(true);
    expect(breakdown(initialState("B"), "pe").rows.every((r) => r.side === "fund")).toBe(true);
  });
  test("raising the hurdle moves rows from Fund to Fix, then recommends underspend", () => {
    const s = initialState("B");
    const mid = breakdown({ ...s, hurdleOverrides: { pe: 1.5 } }, "pe");
    expect(mid.rows.find((r) => r.driver.id === "b-soc2")!.side).toBe("fix");
    expect(mid.rows.find((r) => r.driver.id === "b-newhires")!.side).toBe("fund");
    expect(mid.underspend).toBe(false);
    expect(breakdown({ ...s, hurdleOverrides: { pe: 3 } }, "pe").underspend).toBe(true);
  });
});

describe("determinism", () => {
  test("same state, same numbers", () => {
    expect(JSON.stringify(forecast(initialState("B"), "all"))).toBe(JSON.stringify(forecast(initialState("B"), "all")));
  });
});

describe("fixes owned by someone else", () => {
  test("counts the dev tools team's cache fix only once it ships", () => {
    const a = initialState("A");
    const sent = { ...a, appliedFixes: ["a-connector", "a-subagents"], handedOff: ["a-cache"] };
    expect(Math.round(forecast(sent, "pe").p50)).toBe(41_700);
    expect(kpis(sent, "pe").fixableWaste).toBe(0);
    expect(kpis(sent, "pe").waitingOnOwner).toBe(2_100);
    expect(headline(sent, "pe")).toBe("$1,700 over budget until the dev tools team fixes the prompt cache.");
    const shipped = { ...sent, appliedFixes: [...sent.appliedFixes, "a-cache"] };
    expect(Math.round(forecast(shipped, "pe").p50)).toBe(39_600);
    expect(kpis(shipped, "pe").waitingOnOwner).toBe(0);
  });
});
