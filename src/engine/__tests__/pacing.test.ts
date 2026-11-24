import { describe, expect, test } from "vitest";
import { draftRebalance, evidenceAge, initialState, MAX_TARGET_CHANGE, pacing, pacingHealth, throttle } from "@/engine";

const fixed = { ...initialState("C"), appliedFixes: ["a-connector", "a-subagents", "a-cache"] };

describe("pacing this month", () => {
  test("slows before it blocks, and blocks later than caps", () => {
    const p = pacing(initialState("A"), "pe");
    expect(p.capsBlocked).toBe(6);
    expect(p.blocked).toBe(0); // small overages are absorbed by a cheaper model and deferred runs
    expect(p.lateShare.caps).toBe(1); // caps hold everything back in the last five days
    expect(p.lateShare.pacing).toBeLessThan(0.5);
  });
  test("growth beyond what slowing covers: the team shares the slowdown, nobody cut off this month", () => {
    const p = pacing(fixed, "pe");
    expect(p.blocked).toBe(0); // nobody is stopped for the month
    expect(p.capsBlocked).toBe(9); // 9 would be cut off by a plain monthly limit
    expect(p.teamShare).toBeGreaterThan(0.05);
    expect(p.split.cheaper + p.split.deferred + p.split.held).toBeGreaterThan(0);
  });
  test("held-back work follows demand, with no month-end pile-up", () => {
    const p = pacing(fixed, "pe");
    const future = p.heldPacing.slice(18);
    // Weekdays hold back the same amount; the share held never rises toward month end.
    expect(Math.max(...future) - Math.min(...future.filter((v) => v > Math.max(...future) * 0.75))).toBeLessThan(1);
    const late = (x: number[]) => x.slice(25).reduce((a, b) => a + b, 0) / x.reduce((a, b) => a + b, 0);
    expect(late(p.heldPacingMonth)).toBeLessThan(late(p.heldCaps));
  });
  test("over the whole month, pacing starts when run rates point over limits, long before caps bite", () => {
    const p = pacing(initialState("C"), "all");
    expect(p.pacingStartDay).toBeLessThan(p.capsFirstBlockDay!);
    expect(p.heldPacingMonth.slice(0, (p.pacingStartDay ?? 1) - 1).every((v) => v === 0)).toBe(true);
    expect(p.heldPacingMonth[(p.pacingStartDay ?? 1) - 1]).toBeGreaterThan(0);
    expect(p.heldCaps.slice(0, 18).some((v) => v > 0)).toBe(true); // caps bite before today too
    expect(p.throttledPacingMonth.slice(0, 18).some((v) => v > 0)).toBe(true);
  });
  test("work producing results is slowed last: here the rest of the team absorbs it", () => {
    const p = pacing(fixed, "pe");
    expect(p.members.some((m) => m.cohort === "new")).toBe(false);
    expect(p.capsBlocked).toBe(throttle(fixed, "pe").blockedMonth);
  });
});

describe("stability rules", () => {
  test("the rebalance stays inside the 20% change limit and keeps its figures", () => {
    const a = draftRebalance(fixed, "pe");
    expect(a.moved).toBe(2800);
    expect(a.limits?.length).toBe(3);
    expect(a.limits?.[0]).toContain(`${MAX_TARGET_CHANGE * 100}%`);
  });
  test("new work leans less on its own data than established work", () => {
    const n = evidenceAge(fixed, "pe-pay");
    const e = evidenceAge(fixed, "pe-infra");
    expect(n.isNew && n.protectedRamp).toBe(true);
    expect(n.ownWeight).toBeLessThan(e.ownWeight);
  });
});

describe("pacing health, six months of the same demand", () => {
  const h = pacingHealth();
  const avg = (id: string) => h.rows.find((r) => r.metric.id === id)!.average;
  test("shows the six months before this one, one row per measure", () => {
    expect(h.months).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
    expect(h.rows.map((r) => r.metric.id)).not.toContain("blockedShare");
  });
  test("allocations settle: fewer reshuffles, no funded work cut", () => {
    expect(avg("reshuffle").pacing).toBeLessThan(avg("reshuffle").caps / 2);
    expect(avg("fundedCut").pacing).toBe(0);
  });
  test("lands close to budget and the forecast band is honest", () => {
    expect(avg("landingError").pacing).toBeLessThan(avg("landingError").caps);
    expect(avg("forecastInBand").pacing).toBeGreaterThan(0.7);
  });
  test("new work earns weight on its own data month by month", () => {
    const w = h.newOwnWeight.filter((x) => x > 0);
    expect(w).toEqual([...w].sort((a, b) => a - b));
  });
  test("deterministic", () => expect(pacingHealth()).toEqual(h));
});

describe("the whole month for everyone who hits a limit", () => {
  test("pacing throttles and the hard caps backstop blocks, from the first days of the month, every week", async () => {
    const { monthStrip } = await import("@/engine");
    const m = monthStrip(initialState("C"), "all");
    for (let w = 0; w < 4; w++) {
      expect(m.blocked.slice(w * 7, w * 7 + 7).some((v) => v > 0)).toBe(true);
      expect(m.throttled.slice(w * 7, w * 7 + 7).some((v) => v > 0)).toBe(true);
    }
    expect(m.blocked[0]).toBeGreaterThan(0);
  });
  test("blocks and throttles are evenly distributed over the month: every week the same", async () => {
    const { monthStrip } = await import("@/engine");
    for (const id of ["A", "B", "C"] as const) {
      const m = monthStrip(initialState(id), "all");
      const week = (x: number[], w: number) => x.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0);
      for (const x of [m.blocked, m.throttled]) {
        const weeks = [0, 1, 2, 3].map((w) => week(x, w));
        expect(Math.max(...weeks) - Math.min(...weeks)).toBeLessThan(0.01 * Math.max(...weeks) + 1);
      }
    }
  });
});

import { userNote } from "../pacing";
describe("user notes", () => {
  test("tells protected new engineers they are not slowed, and slowed people how much", () => {
    expect(userNote({ spent: 300, limit: 250, landing: 650, blockDay: 18, isNew: true }, null)).toMatch(/won't be slowed/);
    expect(userNote({ spent: 100, limit: 1000, landing: 300, blockDay: null }, null)).toBeNull();
    const pm = { id: "x", cohort: "tenured", workstreamId: "w", step: "cheaper", trim: 0.08, hardShare: 0, blockDay: null, capsBlockDay: null } as never;
    expect(userNote({ spent: 500, limit: 1500, landing: 1467, blockDay: null }, pm)).toBe("About 8% of your runs now use Sonnet or wait a little, to keep the team on budget.");
  });
});
