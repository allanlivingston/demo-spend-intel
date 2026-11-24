// Local testing backend: the Claude Agent SDK, authenticated by this machine's Claude Code login.
// No ANTHROPIC_API_KEY is used: we strip it from the subprocess env so the CLI falls back to the login.
// The engine tools run in-process as an SDK MCP server; built-in Claude Code tools are disabled.
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { toolsFor } from "../tools";
import type { BackendResult, BackendRun } from "./types";

const SERVER = "spend";

export async function runClaudeCode(run: BackendRun): Promise<BackendResult> {
  const defs = toolsFor(run.agent);
  const server = createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: defs.map((d) =>
      tool(d.name, d.description, d.shape, async (args) => {
        const r = run.invoke(d.name, args);
        return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
      }),
    ),
  });

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ANTHROPIC_API_KEY" && k !== "ANTHROPIC_AUTH_TOKEN") env[k] = v;

  const abortController = new AbortController();
  run.signal.addEventListener("abort", () => abortController.abort());

  const q = query({
    prompt: run.user,
    options: {
      model: run.model,
      systemPrompt: run.system,
      mcpServers: { [SERVER]: server },
      tools: [],
      allowedTools: defs.map((d) => `mcp__${SERVER}__${d.name}`),
      maxTurns: run.maxToolSteps + 2,
      settingSources: [],
      persistSession: false,
      effort: "low",
      env,
      abortController,
    },
  });

  let text = "";
  const res: BackendResult = { text: "", costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  for await (const msg of q) {
    if (msg.type === "assistant") {
      const blocks = msg.message.content ?? [];
      const t = blocks.filter((b) => b.type === "text").map((b) => ("text" in b ? b.text : "")).join("");
      if (t.trim()) text = t; // keep the latest text turn: the final answer
    } else if (msg.type === "result") {
      // Field names read defensively: the result message carries cost and usage on success and error subtypes.
      const m = msg as unknown as { total_cost_usd?: number; usage?: Record<string, number>; subtype: string; errors?: string[] };
      res.costUsd = m.total_cost_usd ?? 0;
      res.inputTokens = (m.usage?.input_tokens ?? 0) + (m.usage?.cache_creation_input_tokens ?? 0);
      res.outputTokens = m.usage?.output_tokens ?? 0;
      res.cacheReadTokens = m.usage?.cache_read_input_tokens ?? 0;
      if (m.subtype !== "success") throw new Error(`Claude Code run ended: ${m.subtype}${m.errors?.length ? `: ${m.errors.join("; ")}` : ""}`);
    }
  }
  res.text = text;
  return res;
}
