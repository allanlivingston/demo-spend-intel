// Model routing in one place. The app practices what it proposes: route before you throttle.
import type { AgentId } from "./types";

export const MODELS = {
  fast: "claude-haiku-5-5", // short factual answers
  agent: "claude-sonnet-5-5", // agent runs and artifact drafting
  escalate: "claude-opus-5-5", // only when the user clicks Escalate
} as const;

/** USD per million tokens (input, output, cache read), for the demo's own usage footer. */
export const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
};

const ACTION_WORDS = /\b(fix|fund|draft|plan|simulate|rebalance|override|brief|policy|protect|apply|what if|what-if)\b/i;

/** The model selector under the message box. Auto routes by task; the others pin one model. */
export type ModelChoice = "auto" | "haiku" | "sonnet" | "opus";
export const CHOICE_MODEL: Record<Exclude<ModelChoice, "auto">, string> = { haiku: MODELS.fast, sonnet: MODELS.agent, opus: MODELS.escalate };

export function pickModel(agent: AgentId, prompt: string, escalate?: boolean, choice: ModelChoice = "auto"): string {
  if (escalate) return MODELS.escalate;
  if (choice !== "auto") return CHOICE_MODEL[choice];
  if (agent === "guide") return MODELS.fast;
  if (agent !== "chat") return MODELS.agent;
  return ACTION_WORDS.test(prompt) ? MODELS.agent : MODELS.fast;
}
