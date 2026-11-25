// Claude words a suggested rule. The app decides what the rule covers (kind of change, team) and which levels are
// allowed; Claude only writes the sentence for each level, as structured output. Anything that fails a check falls
// back to the app's template, so a bad answer can never change what a rule does.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { canAllow, GROUPS, TOPICS, templateSentence, type PrefRule, type RuleLevel } from "@/engine";
import { jargonIn } from "./grounding";
import { MODELS, PRICES } from "./models";
import type { Backend } from "./types";

const Wording = z.object({
  allow: z.string().describe("The rule at level 'apply without asking'. Empty if not offered."),
  ask: z.string().describe("The rule at level 'ask me first'."),
  skip: z.string().describe("The rule at level 'don't suggest'."),
});

/** The schema for the Claude Code CLI, which rejects the "$schema" draft line zod adds. */
const SCHEMA = Object.fromEntries(Object.entries(z.toJSONSchema(Wording)).filter(([k]) => k !== "$schema"));

const SYSTEM = `You word preference rules for the admin of a company's Claude spend. Each rule covers one kind of change for one team.
Write one sentence per level, each starting "For <team>," and under 22 words, in plain everyday words.
Levels: allow = the app makes this kind of change without asking; ask = the app asks the admin first; skip = the app stops suggesting it.
Name the kind of change concretely, using the example change you are given, but cover the kind, not only that one example.
No figures, no product jargon, no dashes. Leave "allow" empty when told it isn't offered.`;

export interface WordRuleInput { rule: PrefRule; decision: "declined" | "applied"; reason?: string }
export interface WordRuleResult { wording?: Partial<Record<RuleLevel, string>>; costUsd: number; model: string }

function userPrompt({ rule, decision, reason }: WordRuleInput): string {
  const team = GROUPS[rule.groupId].name;
  return [
    `Team: ${team}`,
    `Kind of change: ${TOPICS[rule.topic].noun}`,
    `What happened: ${rule.basedOn}`,
    decision === "declined" && reason ? `The admin's reason: ${reason}` : "",
    canAllow(rule.topic) ? "" : "Not offered: allow (leave it empty).",
    `For reference, plain template wording: ${(["allow", "ask", "skip"] as const).map((l) => `${l}: "${templateSentence({ ...rule, level: l })}"`).join("; ")}`,
  ].filter(Boolean).join("\n");
}

/** Keep only sentences that pass: right team, short, plain. */
export function checkWording(rule: PrefRule, w: z.infer<typeof Wording>): Partial<Record<RuleLevel, string>> | undefined {
  const team = GROUPS[rule.groupId].name;
  const out: Partial<Record<RuleLevel, string>> = {};
  for (const level of ["allow", "ask", "skip"] as const) {
    if (level === "allow" && !canAllow(rule.topic)) continue;
    const s = w[level]?.trim().replace(/\s+/g, " ");
    const ok = s && s.startsWith(`For ${team},`) && s.length <= 170 && s.split(" ").length <= 26 && !/[–—]|\d/.test(s) && !jargonIn(s).length;
    if (!ok) return undefined; // all levels or none, so the picker never mixes two voices
    out[level] = s.endsWith(".") ? s : `${s}.`;
  }
  return out;
}

export async function wordRule(input: WordRuleInput, backend: Backend, signal: AbortSignal): Promise<WordRuleResult> {
  const model = MODELS.fast;
  if (backend === "api") {
    const res = await new Anthropic().messages.parse(
      {
        model,
        max_tokens: 2_000,
        output_config: { effort: "low", format: zodOutputFormat(Wording) },
        system: SYSTEM,
        messages: [{ role: "user", content: userPrompt(input) }],
      },
      { signal },
    );
    const p = PRICES[model];
    const costUsd = (res.usage.input_tokens * p.in + res.usage.output_tokens * p.out) / 1e6;
    if (res.stop_reason === "refusal" || !res.parsed_output) return { costUsd, model };
    return { wording: checkWording(input.rule, res.parsed_output), costUsd, model };
  }
  if (backend === "claude-code") {
    // Local testing: the Claude Code login, no API key. Same schema, as the SDK's structured output.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ANTHROPIC_API_KEY" && k !== "ANTHROPIC_AUTH_TOKEN") env[k] = v;
    const abortController = new AbortController();
    signal.addEventListener("abort", () => abortController.abort());
    const q = query({
      prompt: userPrompt(input),
      options: {
        model, systemPrompt: SYSTEM, tools: [], settingSources: [], persistSession: false, effort: "low", env, abortController,
        outputFormat: { type: "json_schema", schema: SCHEMA },
      },
    });
    let out: WordRuleResult = { costUsd: 0, model };
    for await (const msg of q) {
      if (msg.type !== "result") continue;
      const m = msg as unknown as { total_cost_usd?: number; structured_output?: unknown };
      const parsed = Wording.safeParse(m.structured_output);
      out = { costUsd: m.total_cost_usd ?? 0, model, wording: parsed.success ? checkWording(input.rule, parsed.data) : undefined };
    }
    return out;
  }
  return { costUsd: 0, model }; // replay: the template
}
