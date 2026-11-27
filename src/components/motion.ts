"use client";
// Motion that explains a change, never decoration (UI_CRAFT.md, "Motion"). Everything here runs only when the user
// just did something: a page load or reload shows the end state at once, so nothing replays. Reduced motion: none.
import { useEffect, useRef, useState } from "react";

/** When this module loaded: the page load. Things that appear in the first moments came with the page, not an action. */
const BOOT = typeof performance !== "undefined" ? performance.now() : 0;
const SETTLE_MS = 1500;

export const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True if this component first appeared because of something the user just did (not a page load), with motion allowed. */
export function useJustNow(): boolean {
  const [v] = useState(() => typeof window !== "undefined" && performance.now() - BOOT > SETTLE_MS && !reducedMotion());
  return v;
}

/** Eases out: fast at first, settling gently. */
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

/**
 * A figure that rolls to `to`: from `from` when it first appears (when given), and from where it was whenever `to`
 * changes after that. Lands exactly on `to`.
 */
export function useRoll(to: number, from: number | null, ms = 600, delay = 0): number {
  const [v, setV] = useState(from ?? to);
  const shown = useRef(from ?? to);
  useEffect(() => {
    const start = shown.current;
    if (start === to || reducedMotion()) {
      shown.current = to;
      setV(to);
      return;
    }
    let raf = 0;
    let t0 = 0;
    const step = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / ms);
      const x = p < 1 ? start + (to - start) * easeOut(p) : to;
      shown.current = x;
      setV(x);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    const wait = setTimeout(() => (raf = requestAnimationFrame(step)), delay);
    return () => { clearTimeout(wait); cancelAnimationFrame(raf); };
  }, [to, ms, delay]);
  return v;
}
