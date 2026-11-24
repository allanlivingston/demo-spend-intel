"use client";
import { levelOfTier } from "@/engine";
import type { ReactNode } from "react";
import type { Status } from "@/engine";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const usdK = (n: number) => `$${(n / 1000).toFixed(1)}k`;
export const pct = (n: number) => `${Math.round(n * 100)}%`;

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
  "On track": "bg-emerald-50 text-ok border-emerald-200",
  "Budget remaining": "bg-neutral-50 text-neutral-600 border-neutral-200",
  "Over budget": "bg-red-50 text-bad border-red-200",
};

export function StatusPill({ status, funded }: { status: Status; funded?: boolean }) {
  if (funded) return <span className="rounded-full border border-amber-300 bg-amber-50 whitespace-nowrap px-2 py-0.5 text-[13px] font-medium text-warn" title="Still over budget; funding steps are underway">Over budget, funding underway</span>;
  return <span className={cx("whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-medium", STATUS_STYLE[status])}>{status}</span>;
}

const LEVEL_TONE = { High: "bg-emerald-50 text-ok border-emerald-200", Medium: "bg-amber-50 text-warn border-amber-200", Low: "bg-neutral-50 text-muted border-neutral-200" };

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
    primary: "bg-accent text-white hover:brightness-95 border-transparent",
    secondary: "bg-white text-ink border-neutral-300 hover:bg-neutral-50",
    ghost: "bg-transparent text-accent border-transparent hover:bg-orange-50",
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
  return <span className={over ? "text-bad" : "text-ok"}>{over ? "+" : "-"}{usd(Math.abs(value))} vs budget</span>;
}
