"use client";
// Motion that explains a change, never decoration (UI_CRAFT.md, "Motion"). Everything here runs only when the user
// just did something: a page load or reload shows the end state at once, so nothing replays. Reduced motion: none.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** When this module loaded: the page load. Things that appear in the first moments came with the page, not an action. */
const BOOT = typeof performance !== "undefined" ? performance.now() : 0;
const SETTLE_MS = 1500;

export const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True if this component first appeared because of something the user just did (not a page load), with motion allowed. */
export function useJustNow(): boolean {
  const [v] = useState(() => typeof window !== "undefined" && performance.now() - BOOT > SETTLE_MS && !reducedMotion());
  return v;
}

const TRANSITION = "height 360ms ease-in-out";
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  return null;
}

/**
 * A box whose height glides when its content changes height (a headline that wraps differently, a button row that
 * comes or goes), so what sits below moves smoothly instead of jumping. The first height is set without motion.
 */
export function SmoothHeight({ children, className, enter }: { children: React.ReactNode; className?: string; enter?: boolean }) {
  const inner = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  // With enter, a box that appears in front of the user grows open from nothing instead of popping in at full height.
  const grow = !!enter && !reducedMotion();
  const [h, setH] = useState<number | null>(grow ? 0 : null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => {
      const nh = el.offsetHeight;
      const box = outer.current;
      const sc = box && scrollerOf(box);
      // A box wholly above the screen changes size out of sight: do it at once and move the scroll by the same amount,
      // so what is on screen stays exactly still (the page turns off the browser's own scroll anchoring). A box that is
      // even partly on screen glides instead.
      if (box && sc && box.getBoundingClientRect().bottom <= sc.getBoundingClientRect().top) {
        const was = box.offsetHeight;
        box.style.transition = "none";
        box.style.height = `${nh}px`;
        sc.scrollTop += nh - was;
        requestAnimationFrame(() => { box.style.transition = reducedMotion() ? "" : TRANSITION; });
      }
      setH(nh);
    };
    if (!grow) measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Only changes after the first paint glide.
    const t = requestAnimationFrame(() => { setReady(true); if (grow) requestAnimationFrame(measure); });
    return () => { ro.disconnect(); cancelAnimationFrame(t); };
    // Only on mount: whether to grow is decided once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={outer} className={className} style={{ height: h ?? undefined, overflow: "clip", overflowClipMargin: 6, transition: ready && !reducedMotion() ? TRANSITION : undefined }}>
      <div ref={inner}>{children}</div>
    </div>
  );
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
