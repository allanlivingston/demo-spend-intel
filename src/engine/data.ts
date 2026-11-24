// Synthetic, deterministic dataset: 3 SCIM groups, workstreams as SCIM sub-groups, pseudonymous members.
import { rng } from "./calendar";
import type { Group, GroupId, Member, Workstream } from "./types";
import type { ProfileName } from "./calendar";

export const GROUPS: Record<GroupId, Group> = {
  pe: {
    id: "pe", name: "Platform Engineering", pool: 40_000, surfaces: ["Claude Code", "Chat"],
    tenuredMembers: 34, originalForecast: 39_200, baseSigma: 1_794.6,
    memberLimit: 1_200, newMemberLimit: 250, memberShare: 0.7, hurdle: 1.0,
  },
  fpa: {
    id: "fpa", name: "FP&A", pool: 18_000, surfaces: ["Cowork", "Chat"],
    tenuredMembers: 14, originalForecast: 16_600, baseSigma: 858.3,
    memberLimit: 1_500, newMemberLimit: 250, memberShare: 0.8, hurdle: 1.0,
  },
  mkt: {
    id: "mkt", name: "Marketing", pool: 12_000, surfaces: ["Chat", "Cowork"],
    tenuredMembers: 22, originalForecast: 10_200, baseSigma: 546.2,
    memberLimit: 600, newMemberLimit: 250, memberShare: 0.85, hurdle: 1.0,
  },
};

export const GROUP_IDS: GroupId[] = ["pe", "fpa", "mkt"];

export const PROFILES: Record<GroupId, ProfileName> = { pe: "engineering", fpa: "close", mkt: "flat" };

export const WORKSTREAMS: Workstream[] = [
  { id: "pe-pay", groupId: "pe", name: "Payments Refactor", category: "Production Code", target: 15_000, baseLanding: 14_600, tier: 2 },
  { id: "pe-infra", groupId: "pe", name: "Infra and On-call", category: "Infra and On-call", target: 10_000, baseLanding: 9_800, tier: 2 },
  { id: "pe-cr", groupId: "pe", name: "Code Review", category: "Code Review", target: 9_000, baseLanding: 8_800, tier: 2 },
  { id: "pe-tool", groupId: "pe", name: "Developer Tooling", category: "Documentation", target: 6_000, baseLanding: 5_700, tier: 2 },
  { id: "fpa-close", groupId: "fpa", name: "Month-end Close", category: "Month-end Close", target: 10_000, baseLanding: 9_200, tier: 2 },
  { id: "fpa-fcst", groupId: "fpa", name: "Forecasting Models", category: "Financial Modeling", target: 8_000, baseLanding: 7_200, tier: 2 },
  { id: "mkt-camp", groupId: "mkt", name: "Campaigns", category: "Campaign Copy", target: 7_000, baseLanding: 5_900, tier: 2 },
  { id: "mkt-res", groupId: "mkt", name: "Research", category: "Research", target: 5_000, baseLanding: 3_900, tier: 1 },
];

export const workstreamsOf = (g: GroupId) => WORKSTREAMS.filter((w) => w.groupId === g);

/** Group base landing = sum of its workstreams' normal work. */
export const baseLanding = (g: GroupId) => workstreamsOf(g).reduce((a, w) => a + w.baseLanding, 0);

const pad = (n: number) => String(n).padStart(2, "0");
const PREFIX: Record<GroupId, string> = { pe: "PE", fpa: "FPA", mkt: "MKT" };

/** Tenured members: seeded demand spread, scaled so member-attributed spend matches the group's member share. */
export function tenuredMembers(g: GroupId): Member[] {
  const grp = GROUPS[g];
  const ws = workstreamsOf(g);
  const r = rng(g === "pe" ? 1807 : g === "fpa" ? 2211 : 3301);
  const raw: number[] = [];
  for (let i = 0; i < grp.tenuredMembers; i++) {
    // Approximate lognormal with sd 0.15 from a sum of uniforms.
    const n = (r() + r() + r() + r() - 2) * Math.sqrt(3);
    raw.push(Math.exp(0.15 * n));
  }
  const target = grp.memberShare * baseLanding(g);
  const scale = target / raw.reduce((a, b) => a + b, 0);
  return raw.map((x, i) => ({
    id: `${PREFIX[g]}-${pad(i + 1)}`,
    groupId: g,
    workstreamId: ws[i % ws.length].id,
    cohort: "tenured" as const,
    baseDemand: x * scale,
    joinDay: 1,
  }));
}

/** Scenario B: 14 engineers join on day 9 to ramp on the payments refactor. Demand sums to the driver's $6,500 month (sunk + forward). */
export const NEW_HIRE_DEMAND = [612, 615, 618, 622, 626, 630, 635, 642, 650, 140, 155, 170, 185, 200];

export function newHires(): Member[] {
  return NEW_HIRE_DEMAND.map((d, i) => ({
    id: `PE-${pad(35 + i)}`,
    groupId: "pe" as const,
    workstreamId: "pe-pay",
    cohort: "new" as const,
    baseDemand: d,
    joinDay: 9,
  }));
}
