// Production backend: the Messages API with a manual tool-use loop.
// Cached prefix: tools + system prompt (base, agent, engine snapshot). Refusals fall back server-side.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PRICES } from "../models";
import { toolsFor } from "../tools";
import type { BackendResult, BackendRun } from "./types";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export async function runApi(run: BackendRun): Promise<BackendResult> {
  const defs = toolsFor(run.agent);
  const tools: Anthropic.Beta.BetaTool[] = defs.map((d, i) => ({
    name: d.name,
    description: d.description,
    input_schema: z.toJSONSchema(z.object(d.shape)) as Anthropic.Beta.BetaTool.InputSchema,
    ...(i === defs.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: run.user }];
  const res: BackendResult = { text: "", costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const price = PRICES[run.model] ?? PRICES["claude-sonnet-5-5"];

  for (let step = 0; step <= run.maxToolSteps; step++) {
    const msg = await getClient().beta.messages.create(
      {
        model: run.model,
        max_tokens: 4_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: [{ type: "text", text: run.system, cache_control: { type: "ephemeral" } }],
        ...(tools.length ? { tools } : {}),
        messages,
      },
      { signal: run.signal },
    );
    const u = msg.usage;
    res.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0);
    res.outputTokens += u.output_tokens;
    res.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    res.costUsd += (u.input_tokens * price.in + (u.cache_creation_input_tokens ?? 0) * price.in * 1.25 + (u.cache_read_input_tokens ?? 0) * price.cacheRead + u.output_tokens * price.out) / 1e6;

    if (msg.stop_reason === "refusal") throw new Error("Model declined the request");
    const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
    if (text.trim()) res.text = text;
    if (msg.stop_reason !== "tool_use") break;

    // Append the full content (thinking blocks included, unchanged), then all tool results in one user turn.
    messages.push({ role: "assistant", content: msg.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = msg.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => {
        const r = run.invoke(b.name, b.input);
        return { type: "tool_result", tool_use_id: b.id, content: r.text, is_error: r.isError };
      });
    messages.push({ role: "user", content: results });
  }
  return res;
}
