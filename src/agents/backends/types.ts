import type { ToolContext } from "../tools";
import type { AgentId } from "../types";

export interface ToolCallRecord {
  tool: string;
  input: unknown;
  result: unknown;
}

export interface BackendRun {
  agent: AgentId;
  model: string;
  system: string;
  user: string;
  ctx: ToolContext;
  /** Runs a tool against the engine, emits its step, and records it. */
  invoke: (name: string, input: unknown) => { text: string; isError: boolean };
  signal: AbortSignal;
  maxToolSteps: number;
}

export interface BackendResult {
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** The model that actually served the last call (from the response), when the backend reports it. */
  servedModel?: string;
}
