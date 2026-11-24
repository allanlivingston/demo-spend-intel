// Records canonical agent runs into src/replay using the Claude Code login backend (no API tokens).
// Usage: npm run record            (all)
//        npm run record -- connector   (only keys containing "connector")
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { initialState, type DemoState, type ScenarioId } from "@/engine";
import { REPLAY_DIR, replayKey, type Recording } from "@/agents/backends/replay";
import { runAgent } from "@/agents/runAgent";
import type { AgentId, AgentRequest } from "@/agents/types";

interface Canon { agent: AgentId; scenario: ScenarioId; driverId?: string; prompt: string; pinned?: string[]; setup?: Partial<DemoState> }

const AFTER_FIXES: Partial<DemoState> = { appliedFixes: ["a-connector", "a-subagents"], handedOff: ["a-cache"] };

export const CANON: Canon[] = [
  { agent: "connector", scenario: "A", driverId: "a-connector", prompt: "Fix with agent: Jira MCP connector retrying in a loop.", pinned: ["Day 14: connector loop starts"] },
  { agent: "cache", scenario: "A", driverId: "a-cache", prompt: "Fix with agent: prompt cache hit rate fell from 78% to 31%.", pinned: ["Day 12: cache hit rate drops"] },
  { agent: "routing", scenario: "A", driverId: "a-subagents", prompt: "Fix with agent: Claude Code subagents inheriting Opus." },
  { agent: "routing", scenario: "A", prompt: "Fix all open waste with one policy." },
  { agent: "funding", scenario: "B", driverId: "b-newhires", prompt: "Fund with agent: 14 new engineers ramping on the payments refactor. Plan a rebalance." },
  { agent: "funding", scenario: "B", driverId: "b-soc2", prompt: "Fund with agent: planned SOC 2 documentation sprint. Draft the planned spend approval.", setup: { rebalanceApplied: true } },
  { agent: "funding", scenario: "B", prompt: "Draft the budget owner brief.", setup: { rebalanceApplied: true, overrides: ["b-soc2"] } },
  { agent: "connector", scenario: "C", driverId: "a-connector", prompt: "Fix with agent: Jira MCP connector retrying in a loop.", pinned: ["Day 14: connector loop starts"] },
  { agent: "cache", scenario: "C", driverId: "a-cache", prompt: "Fix with agent: prompt cache hit rate fell from 78% to 31%.", pinned: ["Day 12: cache hit rate drops"] },
  { agent: "routing", scenario: "C", driverId: "a-subagents", prompt: "Fix with agent: Claude Code subagents inheriting Opus." },
  { agent: "routing", scenario: "C", prompt: "Fix all open waste with one policy." },
  { agent: "funding", scenario: "C", driverId: "b-newhires", prompt: "Fund with agent: 14 new engineers ramping on the payments refactor. Plan a rebalance.", setup: AFTER_FIXES },
  { agent: "funding", scenario: "C", driverId: "b-soc2", prompt: "Fund with agent: planned SOC 2 documentation sprint. Draft the planned spend approval.", setup: { ...AFTER_FIXES, rebalanceApplied: true } },
  { agent: "funding", scenario: "C", prompt: "Draft the budget owner brief.", setup: { ...AFTER_FIXES, rebalanceApplied: true, overrides: ["b-soc2"] } },
];

async function main() {
  const filter = process.argv[2];
  await fs.mkdir(REPLAY_DIR, { recursive: true });
  for (const c of CANON) {
    const key = replayKey(c.agent, c.scenario, c.driverId);
    if (filter && !key.includes(filter)) continue;
    const demo: DemoState = { ...initialState(c.scenario), ...c.setup };
    const req: AgentRequest = { agent: c.agent, prompt: c.prompt, demo, group: "pe", pinned: c.pinned ?? [], driverId: c.driverId };
    process.stdout.write(`\n== ${key}\n`);
    let saved = false;
    for await (const e of runAgent(req, {
      backend: "claude-code",
      onDone: (o, d) => {
        const rec: Recording = { agent: c.agent, scenario: c.scenario, key, prompt: c.prompt, model: o.model, calls: o.calls.map(({ tool, input }) => ({ tool, input })), text: o.text, recordedAt: new Date().toISOString() };
        writeFileSync(path.join(REPLAY_DIR, `${key}.json`), JSON.stringify(rec, null, 2) + "\n");
        saved = true;
        process.stdout.write(`   saved (${d.steps} steps, ${(d.latencyMs / 1000).toFixed(1)}s, grounded ${d.grounded})\n`);
      },
    })) {
      if (e.type === "start") process.stdout.write(`   ${e.backend} ${e.model}${e.replayReason ? ` (${e.replayReason})` : ""}\n`);
      if (e.type === "step") process.stdout.write(`   [${e.phase}] ${e.tool}: ${e.summary}\n`);
      if (e.type === "text") process.stdout.write(`   > ${e.text}\n`);
      if (e.type === "artifact") process.stdout.write(`   artifact: ${e.artifact.kind}\n`);
      if (e.type === "error") process.stdout.write(`   ERROR ${e.message}\n`);
    }
    if (!saved) process.stdout.write("   not saved\n");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
