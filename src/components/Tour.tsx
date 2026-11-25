"use client";
// First-visit walkthrough. Each step highlights the real element it describes. Dismiss with ✕, Skip, Esc or a click outside.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { cx } from "./ui";
import { track } from "@/lib/track";
import { useStore } from "@/state/store";

/** fallback: what to highlight when the target isn't on screen (nobody is slowed, so there is no summary line). */
interface Step { target?: string; fallback?: string; title: string; body: string; advancedBody?: string; narrowBody?: string }

const STEPS: Step[] = [
  {
    title: "Stay on budget without cutting anyone off",
    body: "Spending limits per person stop your busiest engineers, while an AI agent stuck in a loop keeps spending. This app finds that waste, helps you fund the work that's paying off, and slows spending a little instead of locking anyone out.",
  },
  {
    target: "headline",
    title: "Start here",
    body: "The headline says what needs doing. Press the button under it and Claude drafts the change. Nothing changes until you approve it.",
  },
  {
    target: "forecast",
    title: "Where spending is headed",
    body: "Spend so far, and where it will likely end the month compared with the budget. Switch teams at the top. Click any day to ask what happened.",
  },
  {
    target: "actions",
    title: "Fix it or fund it",
    body: "Fix spending that produced nothing, like a Jira connection retrying a broken call over and over. Fund new work that's paying off, like new engineers shipping code.",
  },
  {
    target: "slowed",
    fallback: "forecast",
    title: "If a team still goes over",
    body: "Some of its work moves to a cheaper Claude model or waits a few hours. Nobody is locked out. The Users and Agents tabs show who and what is affected.",
    advancedBody: "Some of its work moves to a cheaper Claude model or waits a few hours. Nobody is locked out. Workstreams and Users show who is affected, and Health shows the last six months.",
  },
  {
    target: "composer",
    title: "Ask anything",
    body: "Type a question about spending in your own words. The first suggestion under the box is always your next step.",
  },
  {
    target: "sidebar",
    title: "Try another month",
    body: "Try another situation plays out a different month. Activity lists everything you approved. Orange dots mark features you haven't tried yet.",
    narrowBody: "Open the sidebar to try another situation or see Activity. Orange dots mark features you haven't tried yet.",
  },
];

const KEY = "csi-tour-done";
export const tourSeen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(280);
  // Measure the real card so placement never pushes it off screen.
  useLayoutEffect(() => {
    if (card.current) setH(card.current.offsetHeight);
  }, [i, rect]);
  const step = STEPS[i];
  const advanced = useStore((st) => st.advanced);
  const last = i === STEPS.length - 1;

  const close = () => {
    track(last ? "Tour finished" : "Tour skipped", { step: i + 1 });
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
    // Back to the top of the chat so the headline and its next-step button are in view.
    let el = document.getElementById("headline")?.parentElement ?? null;
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    el?.scrollTo({ top: 0, behavior: "smooth" });
    onClose();
  };

  useLayoutEffect(() => {
    const el = (step.target && document.getElementById(step.target)) || (step.fallback && document.getElementById(step.fallback)) || null;
    if (!el) return setRect(null);
    if (step.target !== "sidebar" && step.target !== "composer") el.scrollIntoView({ block: "center" });
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    const t = setTimeout(update, 250);
    return () => {
      window.removeEventListener("resize", update);
      clearTimeout(t);
    };
  }, [step.target, step.fallback]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && !last) setI(i + 1);
      if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // Place the card beside the highlighted element, always fully inside the window: right of the sidebar; below or
  // above other targets when it fits; otherwise over the target's lower right (tall targets like the forecast).
  const W = 360;
  const M = 16;
  let pos: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  let arrow: "left" | "up" | "down" | null = null;
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampTop = (t: number) => Math.max(M, Math.min(t, vh - h - M));
    const left = Math.min(Math.max(rect.left, M), vw - W - M);
    if (step.target === "sidebar") {
      pos = { left: Math.min(rect.right + M, vw - W - M), top: clampTop(rect.top + 80) };
      arrow = "left";
    } else if (rect.bottom + 14 + h <= vh - M) {
      pos = { left, top: rect.bottom + 14 };
      arrow = "up";
    } else if (rect.top - 14 - h >= M) {
      pos = { left, top: rect.top - 14 - h };
      arrow = "down";
    } else {
      pos = { left: Math.min(Math.max(rect.right - W - 24, M), vw - W - M), top: clampTop(Math.min(rect.bottom, vh) - h - 24) };
    }
  }

  return (
    <div className="fixed inset-0 z-50" onClick={close}>
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent transition-all duration-300"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgba(20,20,19,0.45)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(20,20,19,0.45)]" />
      )}
      <div ref={card} className="absolute" style={{ ...pos, width: W }} onClick={(e) => e.stopPropagation()}>
        {arrow && (
          <span
            className={cx(
              "absolute h-3 w-3 rotate-45 bg-white",
              arrow === "up" && "-top-1.5 left-8",
              arrow === "down" && "-bottom-1.5 left-8",
              arrow === "left" && "-left-1.5 top-8",
            )}
          />
        )}
        <div className="relative max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border-t-4 border-accent bg-[#FBF7F4] p-5 shadow-2xl">
          <button type="button" onClick={close} aria-label="Close tour" className="absolute right-3 top-3 text-muted hover:text-ink">
            <X size={16} />
          </button>
          <div className="text-[13px] font-medium uppercase tracking-wide text-accent-ink">Welcome tour · {i + 1} of {STEPS.length}</div>
          <h2 className="mt-1 font-serif text-xl">{step.title}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-neutral-700">{(typeof window !== "undefined" && window.innerWidth < 1024 && step.narrowBody) || (advanced && step.advancedBody) || step.body}</p>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex gap-1">
              {STEPS.map((_, j) => <span key={j} className={cx("h-1.5 w-1.5 rounded-full", j === i ? "bg-accent" : "bg-neutral-200")} />)}
            </div>
            {!last && <button type="button" onClick={close} className="ml-auto text-[15px] text-muted hover:text-ink">Skip</button>}
            {i > 0 && <button type="button" onClick={() => setI(i - 1)} className={cx("rounded-full px-3 py-1 text-[15px] text-accent-ink hover:bg-accent/10", last && "ml-auto")}>Back</button>}
            <button
              type="button"
              onClick={() => (last ? close() : setI(i + 1))}
              className={cx("inline-flex items-center gap-1 rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-white shadow-sm hover:brightness-95", i === 0 && "ml-auto")}
            >
              {last ? "Done" : i === 0 ? "Show me" : "Next"}{!last && <ArrowRight size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
