"use client";
import { levelOfTier } from "@/engine";
import { useEffect, useState, type ReactNode } from "react";
import type { Status } from "@/engine";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const usdK = (n: number) => (n === 0 ? "$0" : `$${+(n / 1000).toFixed(1)}k`);

/** Consecutive steps with the same phase read as one: "Looked into it: a; b". */
export function mergeSteps<T extends { phase: string; summary: string }>(steps: T[]): T[] {
  const out: T[] = [];
  for (const s of steps) {
    const prev = out.at(-1);
    if (prev && prev.phase === s.phase) out[out.length - 1] = { ...prev, summary: `${prev.summary}; ${s.summary}` };
    else out.push(s);
  }
  return out;
}
export const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A phone-width window (under Tailwind's sm, 640px). */
export const PHONE = "(max-width: 639.98px)";

/** Whether a media query matches, kept up to date. Read on first render (the app renders in the browser) so nothing flashes. */
export function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return on;
}

export function Card({ children, className, title, right }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <section className={cx("rounded-lg border border-neutral-200 bg-card", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  "On track": "bg-emerald-50 text-ok-ink border-emerald-200",
  "Budget remaining": "bg-neutral-50 text-neutral-600 border-neutral-200",
  "Over budget": "bg-red-50 text-bad border-red-200",
};

export function StatusPill({ status, funded }: { status: Status; funded?: boolean }) {
  if (funded) return <span className="rounded-full border border-amber-300 bg-amber-50 whitespace-nowrap px-2 py-0.5 text-[13px] font-medium text-warn-ink" title="Still over budget; funding steps are underway">Over budget, funding underway</span>;
  return <span className={cx("whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-medium", STATUS_STYLE[status])}>{status}</span>;
}

const LEVEL_TONE = { High: "bg-emerald-50 text-ok-ink border-emerald-200", Medium: "bg-amber-50 text-warn-ink border-amber-200", Low: "bg-neutral-50 text-muted border-neutral-200" };

/** Evidence strength as High / Medium / Low (the engine's tiers stay internal). */
export function TierBadge({ tier }: { tier: number | string }) {
  const level = levelOfTier(tier);
  return <span className={cx("w-[58px] shrink-0 rounded border px-1.5 py-px text-center text-[12px] font-medium", LEVEL_TONE[level])}>{level}</span>;
}

export function Button({
  children, onClick, variant = "primary", disabled, title, className, size = "md",
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; title?: string; className?: string; size?: "sm" | "md";
}) {
  const v = {
    primary: "bg-ink text-white hover:bg-black border-transparent",
    secondary: "bg-white text-ink border-neutral-300 hover:bg-neutral-50",
    ghost: "bg-transparent text-accent-ink border-transparent hover:bg-orange-50",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-2 py-1 text-[13px]" : "px-3 py-1.5 text-[15px]",
        v,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Delta({ value }: { value: number }) {
  const over = value > 0;
  return <span className={over ? "text-bad" : "text-ok-ink"}>{over ? "+" : "-"}{usd(Math.abs(value))} vs budget</span>;
}

/** Plain-word definitions for the app's terms, shown in place. */
export const TERMS = {
  landsAt: "Where this month's spend will likely end: spend so far plus the forecast for the rest of the month.",
  slowed: "Pacing slows runs instead of stopping people: a run moves to a cheaper model, waits for a quieter time, or is held for a few hours.",
  likely: "The shaded band. The month most likely ends inside it; the top edge is a bad-luck month.",
  fixable: "Spend that produced nothing, like a connector retrying a broken call. Fixing it doesn't slow anyone's work.",
  waiting: "Fixes sent to another team. They count once that team ships them.",
} as const;

/** A term with a dotted underline; hover, focus or tap shows its definition. */
export function Term({ children, def }: { children: ReactNode; def: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} aria-expanded={open}
        className="cursor-help underline decoration-dotted decoration-from-font underline-offset-[3px] [text-transform:inherit]">
        {children}
      </button>
      {open && (
        <span role="tooltip" className="absolute left-0 top-full z-30 mt-1 block w-64 rounded-lg bg-ink px-3 py-2 text-left text-[13px] font-normal normal-case leading-[18px] tracking-normal text-white shadow-lg">
          {def}
        </span>
      )}
    </span>
  );
}
