"use client";
// A small pulsing dot on a feature worth finding, shown until the admin first uses it. Never blocks anything.
import { create } from "zustand";
import { cx } from "./ui";

export type Feature = "chart-day" | "daily-bars" | "tab-users" | "tab-agents" | "situations" | "earlier-copy";

const KEY = "csi-new-seen";
const load = (): Feature[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
};

export const useNew = create<{ seen: Feature[]; mark: (f: Feature) => void; reset: () => void }>((set, get) => ({
  seen: typeof window === "undefined" ? [] : load(),
  mark: (f) => {
    if (get().seen.includes(f)) return;
    const seen = [...get().seen, f];
    try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch {}
    set({ seen });
  },
  reset: () => {
    try { localStorage.removeItem(KEY); } catch {}
    set({ seen: [] });
  },
}));

/** The dot itself; `label` is read by screen readers and shown on hover. */
export function NewDot({ f, label, className }: { f: Feature; label: string; className?: string }) {
  const isNew = useNew((s) => !s.seen.includes(f));
  if (!isNew) return null;
  return (
    <span title={label} aria-label={`New: ${label}`} role="img" className={cx("relative inline-flex h-2 w-2 shrink-0", className)}>
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}

/** Call when the feature is used. */
export const markUsed = (f: Feature) => useNew.getState().mark(f);
