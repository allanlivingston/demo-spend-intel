// Loads the FAQ and the demo guide (markdown, one "## Question" per section) and finds the best section for a question.
// Server-only: reads the files at request time so edits show up without a rebuild.
import fs from "node:fs";
import path from "node:path";

export interface Section { q: string; a: string }

const DIR = path.join(process.cwd(), "src", "knowledge");
const cache: Record<string, Section[]> = {};

export function sections(file: "FAQ.md" | "DEMO_GUIDE.md"): Section[] {
  if (cache[file] && process.env.NODE_ENV === "production") return cache[file];
  const md = fs.readFileSync(path.join(DIR, file), "utf8");
  const out = md.split(/^## /m).slice(1).map((chunk) => {
    const [q, ...rest] = chunk.split("\n");
    return { q: q.trim(), a: rest.join("\n").trim() };
  });
  cache[file] = out;
  return out;
}

export const fullText = (file: "FAQ.md" | "DEMO_GUIDE.md") => fs.readFileSync(path.join(DIR, file), "utf8");

const STOP = new Set("a an the is are was what why how do does did we our you your i it this that of to in on for and or with be can about me tell there".split(" "));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/s$/, ""));

/** Best section by word overlap, weighting the question line. Null when nothing overlaps enough. */
export function bestSection(question: string, list: Section[], minScore = 1.5): Section | null {
  const qw = new Set(words(question));
  let best: Section | null = null;
  let score = 0;
  for (const s of list) {
    const head = words(s.q).filter((w) => qw.has(w)).length * 2;
    const body = new Set(words(s.a).filter((w) => qw.has(w))).size * 0.5;
    if (head + body > score) {
      score = head + body;
      best = s;
    }
  }
  return score >= minScore ? best : null;
}

/** First n sentences of an answer, for short chat replies. */
export const firstSentences = (text: string, n = 3) => (text.match(/[^.!?]+[.!?]+/g) ?? [text]).slice(0, n).join("").trim();
