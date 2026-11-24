// Rejects any figure in Claude's prose that no tool result produced. This is what makes live answers safe in front of a CFO.

/** Every number appearing anywhere in the tool results of a run. */
export function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (typeof value === "string") for (const m of value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) out.push(Number(m[0].replace(/,/g, "")));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

export interface Figure {
  raw: string;
  value: number;
  kind: "usd" | "pct" | "num";
}

/** Dollar amounts ($11,200, $50.4k, $4.1K) and percentages (28%, 28.6%) in prose. */
export function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  // A k/m suffix only counts as a whole word: "$1,500 monthly" or "$1,500 more" is not $1.5 million.
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s?([kKmM])(?![a-zA-Z]))?/g)) {
    const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
    out.push({ raw: m[0], value: Number(m[1].replace(/,/g, "")) * mult, kind: "usd" });
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) out.push({ raw: m[0], value: Number(m[1]), kind: "pct" });
  // Bare amounts of 100 or more (e.g. "4,100", "50,400") that are not part of a $ figure or a percentage.
  for (const m of text.matchAll(/(?<![$\d.,])(\d{1,3}(?:,\d{3})+|\d{3,})(?![\d.,]*\s?[%kKmM])/g)) out.push({ raw: m[0], value: Number(m[1].replace(/,/g, "")), kind: "num" });
  return out;
}

function matches(f: Figure, known: number[]): boolean {
  return known.some((n) => {
    const a = Math.abs(n);
    if (f.kind === "pct") {
      // Accept the percent itself, or a fraction shown as a percent, rounded to whole or one decimal.
      return [a, a * 100].some((p) => Math.abs(p - f.value) <= 0.51);
    }
    // Exact, or a legitimate display rounding (to $100, or $0.1k).
    if (Math.abs(a - f.value) <= 1) return true;
    if (Math.round(a / 100) * 100 === f.value) return true;
    return f.value >= 1_000 && Math.abs(a - f.value) <= 50;
  });
}

export function ground(text: string, toolResults: unknown[]): { ok: boolean; unmatched: string[] } {
  const known = numbersIn(toolResults);
  const unmatched = figuresIn(text).filter((f) => !matches(f, known)).map((f) => f.raw);
  return { ok: unmatched.length === 0, unmatched };
}

/** Copy rule: no em dashes or en dashes in assistant output. */
export const stripDashes = (s: string) => s.replace(/\s?[–—]\s?/g, ", ");

/** Display polish for prose: no dashes, thousands separators on dollar amounts ($48000 to $48,000). */
export const polish = (s: string) =>
  stripDashes(s).replace(/\$(\d{4,})(?!\d|[.,]\d)/g, (_, n: string) => `$${Number(n).toLocaleString("en-US")}`);

/** Answer length rule: at most 3 sentences and 70 words. */
export const MAX_SENTENCES = 3;
export const MAX_WORDS = 70;
const sentences = (s: string) => s.trim().match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [];
export const isTooLong = (s: string) => sentences(s).length > MAX_SENTENCES || s.trim().split(/\s+/).length > MAX_WORDS;
/** Last resort when a retry still runs long: keep the first sentences. */
export const trimToLimit = (s: string) => sentences(s).slice(0, MAX_SENTENCES).join("").trim();

/** Words a live answer must not use; each maps to the plain word we use instead. */
export const JARGON: [RegExp, string][] = [
  [/\brebalanc(e|ing)\b/gi, "budget move"], [/\bheadroom\b/gi, "unused budget"], [/\bpool\b/gi, "budget"],
  [/\bP50\b/g, "likely landing"], [/\bP90\b/g, "high case"], [/\btier [0-9]\b/gi, "confidence"],
  [/\btelemetry\b/gi, "usage data"], [/\bmetadata\b/gi, "usage data"], [/\bdrivers?\b/gi, "causes"],
  [/\bcohort\b/gi, "group"], [/\bthrottl(e|ed|ing)\b/gi, "slowed"], [/\bhurdle\b/gi, "minimum return"],
  [/\bfan-?out\b/gi, "parallel runs"], [/\bdown-?rout(e|ed|ing)\b/gi, "moved to a cheaper model"],
  [/\bgoverned override\b/gi, "planned spend approval"], [/\bvariance\b/gi, "difference"],
];
export const jargonIn = (s: string) => [...new Set(JARGON.flatMap(([re]) => s.match(re) ?? []).map((w) => w.toLowerCase()))];
/** Last resort when a retry still uses jargon: swap in the plain word. */
export const plainWords = (s: string) => JARGON.reduce((t, [re, w]) => t.replace(re, w), s);
