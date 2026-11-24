// Shared between server and client: the events an agent run streams.
import type { Artifact, DemoState, GroupSelection } from "@/engine";

export type AgentId = "connector" | "cache" | "routing" | "funding" | "chat" | "guide";
export type Backend = "claude-code" | "api" | "replay";
export type StepPhase = "Looked into it" | "Checked the results" | "Drafted the change" | "Checked the result";

export interface AgentRequest {
  agent: AgentId;
  prompt: string;
  demo: DemoState;
  group: GroupSelection;
  pinned: string[];
  /** Driver the alert is about, if any. */
  driverId?: string;
  escalate?: boolean;
  offline?: boolean;
  /** Default or advanced view, so tools leave out what the admin cannot see. */
  advanced?: boolean;
  /** Model selector: auto routes by task, or one model for everything. */
  model?: "auto" | "haiku" | "sonnet" | "opus";
}

export type AgentEvent =
  | { type: "start"; backend: Backend; model: string; agent: AgentId; replayReason?: string }
  | { type: "step"; phase: StepPhase; tool: string; summary: string }
  | { type: "text"; text: string }
  | { type: "artifact"; artifact: Artifact }
  | { type: "done"; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; latencyMs: number; grounded: boolean; steps: number }
  | { type: "error"; message: string };
