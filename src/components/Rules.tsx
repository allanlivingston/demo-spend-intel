"use client";
// Preference rules in the chat and in Activity: Claude asks why after a decline, suggests a rule when the reason
// will hold, and the admin approves it where it is. Saved rules are listed under Activity, where they can be changed.
import { useState } from "react";
import { BookmarkCheck, Sparkles, Trash2 } from "lucide-react";
import { canAllow, DECLINE_REASONS, LEVELS, ruleSentence, type PrefRule, type RuleLevel } from "@/engine";
import { useStore, type ChatMessage } from "@/state/store";
import { cx } from "./ui";

const ORDER: RuleLevel[] = ["allow", "ask", "skip"];

/** Three-way choice of what a rule does. "Apply without asking" is left out where the admin can't act alone. */
export function LevelPicker({ value, topic, onChange, disabled }: { value: RuleLevel; topic: PrefRule["topic"]; onChange: (l: RuleLevel) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="What the rule does" className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
      {ORDER.filter((l) => l !== "allow" || canAllow(topic)).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={value === l} disabled={disabled} onClick={() => onChange(l)}
          className={cx("rounded-md px-2.5 py-1 text-[13px]", value === l ? "bg-white font-medium text-ink shadow-sm" : "text-muted hover:text-ink", disabled && "cursor-default")}>
          {LEVELS[l].label}
        </button>
      ))}
    </div>
  );
}

function Note({ text, children }: { text?: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <Sparkles size={14} className="mt-1.5 shrink-0 text-accent-ink" />
      <div className="min-w-0 flex-1">
        {text && <p className="font-serif text-[17px] leading-[26px]">{text}</p>}
        {children}
      </div>
    </div>
  );
}

/** "Why decline it?" with one-tap reasons. */
export function WhyAsk({ m }: { m: ChatMessage }) {
  const answerWhy = useStore((s) => s.answerWhy);
  const answer = m.why?.answer;
  return (
    <Note text={m.text}>
      {answer ? (
        <div className="mt-2 w-fit rounded-xl bg-black/5 px-3 py-1.5 text-[15px]">{answer}</div>
      ) : (
        <div data-why="" className="mt-2 flex flex-wrap gap-2">
          {DECLINE_REASONS.map((r) => (
            <button key={r.id} type="button" onClick={() => answerWhy(m.id, r.id)}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-[14px] text-neutral-700 hover:border-neutral-400 hover:text-ink">
              {r.label}
            </button>
          ))}
        </div>
      )}
    </Note>
  );
}

/** A suggested rule: shown as a draft, changed or approved in place, then folded to one line. */
/** The admin answered a question in place: the chat scrolls the next message to the top (Chat.tsx). */
export const ANSWERED_EVENT = "csi:answered-in-place";
const answered = (id: string) => window.dispatchEvent(new CustomEvent(ANSWERED_EVENT, { detail: id }));

export function RuleSuggestion({ m }: { m: ChatMessage }) {
  const { saveRules, dismissRules } = useStore();
  const [levels, setLevels] = useState<RuleLevel[]>(() => (m.rules ?? []).map((r) => r.level));
  const rules = m.rules ?? [];
  if (m.rulesStatus === "saved")
    return (
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px]">
        <BookmarkCheck size={15} className="shrink-0 text-ok-ink" />
        <span className="flex-1">
          {rules.length > 1 ? "Rules saved" : "Rule saved"}: {rules.map((r) => ruleSentence(r)).join(" ")}{" "}
          <span className="text-muted">
            {rules.some((r) => r.level === "allow") ? `${rules.length > 1 ? "They start" : "It starts"} next month: try another situation to see ${rules.length > 1 ? "them" : "it"}. ` : ""}
            Change or remove {rules.length > 1 ? "them" : "it"} under Activity.
          </span>
        </span>
      </div>
    );
  if (m.rulesStatus === "dismissed")
    return <Note><p className="text-[14px] text-muted">Not saved. I won&apos;t suggest {rules.length > 1 ? "these rules" : "this rule"} again.</p></Note>;
  return (
    <Note text={m.text}>
      <div data-rule-suggestion="" className="mt-2 rounded-xl border border-neutral-200 bg-white p-3.5">
        <div className="flex items-center text-[12px] font-semibold uppercase tracking-wide text-accent-ink">
          Suggested rule
          <span className="ml-auto text-[12px] font-normal normal-case tracking-normal text-muted">
            {m.rulesWording === "pending" ? "Claude is wording it…" : null}
          </span>
        </div>
        {rules.map((r, i) => {
          const shown = { ...r, level: levels[i] ?? r.level };
          return (
            <div key={r.id} className={cx("mt-1.5", i > 0 && "border-t border-neutral-100 pt-2.5")}>
              <div className="text-[16px] font-medium leading-snug">{ruleSentence(shown)}</div>
              <div className="mt-0.5 text-[13px] text-muted">{r.basedOn}</div>
              <div className="mt-2"><LevelPicker value={shown.level} topic={r.topic} onChange={(l) => setLevels(levels.map((x, j) => (j === i ? l : x)))} /></div>
            </div>
          );
        })}
        <div className="mt-3 flex items-center justify-end gap-1.5">
          <button type="button" onClick={() => { dismissRules(m.id); answered(m.id); }} className="rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink">No thanks</button>
          <button type="button" onClick={() => { saveRules(m.id, levels); answered(m.id); }} className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black">
            {rules.length > 1 ? "Save rules" : "Save rule"}
          </button>
        </div>
      </div>
    </Note>
  );
}

// One shared empty list: a selector that returns a new [] each time makes React re-render forever.
const NO_RULES: PrefRule[] = [];

/** Saved rules, at the top of Activity. */
export function YourRules() {
  const rules = useStore((s) => s.demo.rules ?? NO_RULES);
  const { setRuleLevel, removeRule } = useStore();
  return (
    <section data-your-rules="" className="border-b border-neutral-100 px-4 py-3">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Your rules</h3>
      {rules.length === 0 ? (
        <p className="mt-1 text-[14px] text-muted">None yet. When you decline something and say why, or apply a fix you could have made alone, Claude suggests a rule for you to approve.</p>
      ) : (
        <ul className="mt-1 divide-y divide-black/[0.06]">
          {rules.map((r) => (
            <li key={r.id} className="py-2.5">
              <div className="flex items-start gap-2">
                <span className="flex-1 text-[15px] leading-snug">{ruleSentence(r)}</span>
                <button type="button" onClick={() => removeRule(r.id)} aria-label="Remove rule" title="Remove rule" className="rounded p-1 text-muted hover:bg-neutral-100 hover:text-ink">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-0.5 text-[13px] text-muted">{r.basedOn}</div>
              <div className="mt-1.5"><LevelPicker value={r.level} topic={r.topic} onChange={(l) => setRuleLevel(r.id, l)} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
