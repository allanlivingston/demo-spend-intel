// Which answer architecture the chat agent runs. "shaped" (the default): tools whose output is shaped for the answer
// carry the per-question rules, the rules paragraph is shorter, and a question the app recognizes gets a hint naming
// the tool to start with. "base" (ANSWER_ARCH=base): the earlier setup, one rules paragraph and general tools.
export type AnswerArch = "base" | "shaped";

export const answerArch = (): AnswerArch => (typeof process !== "undefined" && process.env?.ANSWER_ARCH === "base" ? "base" : "shaped");

/** Free routing: chip questions (and typed ones like them) map to the tool that answers them. No model call. */
const ROUTES: [RegExp, string][] = [
  [/\b(do(ing)? nothing|hard (monthly )?limits|turn(ed)? on (the )?(hard )?(monthly )?limits|pacing instead)\b/i, "compare_choices"],
  [/\b(over (their|the|my|our) (monthly )?limits?|spends? the most|top spenders?|who is (affected|slowed|cut off))\b/i, "people_summary"],
  // Typed questions are tolerated: "how much r we over by", "over budgt".
  [/\b(over (the )?b[a-z]{3,6}t|how much\b.{0,12}\bover|under (the )?budget|what('s| is) left|we('ll| will) land|we're fine|are we fine|waits? on|waiting on|wast(e|es|ing)|finance|budget owner|more budget)\b/i, "explain_overage"],
  [/\bhow much has .+ spent\b|^follow up on (?!workstream:|agent:)/i, "get_user"],
];

/** A question about what a term means or how the product works, not about this team's numbers: the FAQ answers it. */
const FAQ_Q = /^(what is|what's|what are|what does|how does)\b/i;
const ABOUT_US = /\b(we|our|us|left|next|over|spend|spent|cost)\b/i;

export function routeHint(prompt: string): string {
  if (FAQ_Q.test(prompt) && !ABOUT_US.test(prompt.replace(FAQ_Q, ""))) return "Hint from the app: start with lookup_faq.";
  const tools = [...new Set(ROUTES.filter(([re]) => re.test(prompt)).map(([, t]) => t))];
  return tools.length ? `Hint from the app: start with ${tools.join(" and ")}.` : "";
}
