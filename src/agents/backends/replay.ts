// Recorded replay: tool calls and the final text from a real run, re-executed against the current engine state
// so every artifact's numbers are still computed live. Used offline, on errors, timeouts and spend caps.
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "../types";
import type { ScenarioId } from "@/engine";

export interface Recording {
  agent: AgentId;
  scenario: ScenarioId;
  key: string;
  prompt: string;
  model: string;
  calls: { tool: string; input: unknown }[];
  text: string;
  recordedAt: string;
}

export const REPLAY_DIR = path.join(process.cwd(), "src", "replay");

export function replayKey(agent: AgentId, scenario: ScenarioId, driverId?: string) {
  return [agent, scenario, driverId].filter(Boolean).join("--");
}

export async function loadRecording(key: string): Promise<Recording | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(REPLAY_DIR, `${key}.json`), "utf8")) as Recording;
  } catch {
    return null;
  }
}

/** Best recording for a request: exact key first, then the agent's scenario-level run. */
export async function findRecording(agent: AgentId, scenario: ScenarioId, driverId?: string) {
  return (await loadRecording(replayKey(agent, scenario, driverId))) ?? (await loadRecording(replayKey(agent, scenario)));
}
