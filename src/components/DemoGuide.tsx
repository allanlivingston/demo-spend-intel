"use client";
// "Ask about this demo": a small Claude-style chat about the demo itself (problem, workflows, layout and nav choices).
// Answers come from DEMO_GUIDE.md via the guide agent; its conversation is separate from the spend conversation.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, CircleHelp, X } from "lucide-react";
import type { AgentEvent } from "@/agents/types";
import { useStore } from "@/state/store";
import { cx } from "./ui";

export const GUIDE_CHIPS = [
  "What problem does this solve, and for whom?",
  "What does the app do?",
  "Why slow spend instead of cutting people off?",
  "What research backs this up?",
  "What are the steps?",
  "How does Claude fit in?",
  "How does it learn what I prefer?",
  "What's real and what's simulated?",
  "What is the advanced view?",
  "How do companies handle AI cost overruns today?",
  "Is AI ROI really that hard to measure?",
  "Why borrow pacing from advertising?",
  "What does Anthropic recommend for Claude spend?",
  "Are runaway agents a real cost problem?",
];

interface Turn { role: "user" | "assistant"; text: string; status?: "running" | "done" | "error" }

async function askGuide(q: string, history: Turn[], onText: (t: string) => void): Promise<void> {
  const s = useStore.getState();
  // Earlier turns go along as context so follow-ups ("and the second one?") make sense.
  const pinned = history.slice(-6).map((t) => `${t.role === "user" ? "Reviewer" : "Guide"}: ${t.text}`.slice(0, 1_200));
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-session": s.sessionId },
    body: JSON.stringify({ agent: "guide", prompt: q, offline: s.offline, model: s.model, demo: s.demo, group: s.group, pinned }),
  });
  if (!res.ok || !res.body) throw new Error("The guide couldn't answer that. Try again.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!chunk.startsWith("data: ")) continue;
      const e = JSON.parse(chunk.slice(6)) as AgentEvent;
      if (e.type === "text") onText(e.text);
      if (e.type === "error") throw new Error(e.message);
    }
  }
}

export function DemoGuide({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.status === "running");
  const asked = new Set(turns.filter((t) => t.role === "user").map((t) => t.text));
  const chips = GUIDE_CHIPS.filter((c) => !asked.has(c)).slice(0, turns.length ? 3 : 4);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => {
    const el = scroller.current;
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
  }, [turns]);

  const send = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setText("");
    const history = turns;
    setTurns((t) => [...t, { role: "user", text: q }, { role: "assistant", text: "", status: "running" }]);
    const patch = (p: Partial<Turn>) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, ...p } : x)));
    try {
      await askGuide(q, history, (answer) => patch({ text: answer }));
      patch({ status: "done" });
    } catch (e) {
      patch({ status: "error", text: e instanceof Error ? e.message : "The guide couldn't answer that. Try again." });
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25 p-6" onClick={onClose}>
      <div role="dialog" aria-label="Ask about this demo" className="flex h-[min(640px,85vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-canvas shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
          <CircleHelp size={16} className="text-accent-ink" />
          <h2 className="font-serif text-lg">Ask about this demo</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-muted hover:bg-black/5 hover:text-ink"><X size={16} /></button>
        </header>
        <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {turns.length === 0 && (
            <p className="font-serif text-[17px] leading-[26px]">
              Ask why this demo is built the way it is: the problem it solves, the workflows, and the layout, navigation and artifact choices.
            </p>
          )}
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="ml-auto w-fit max-w-[80%] rounded-xl bg-black/5 px-4 py-3 text-[16px] leading-[23px]">{t.text}</div>
            ) : (
              <div key={i} className="flex gap-2">
                <p className={cx("font-serif text-[17px] leading-[26px]", t.status === "error" && "text-bad")}>
                  {t.text || (t.status === "running" ? <span className="text-muted">Thinking…</span> : null)}
                </p>
              </div>
            ),
          )}
        </div>
        <div className="border-t border-neutral-200 px-5 pb-4 pt-3">
          {chips.length > 0 && !busy && (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {chips.map((c) => (
                <button key={c} type="button" onClick={() => send(c)} className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-[13px] text-neutral-700 hover:border-neutral-400 hover:text-ink">
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 rounded-2xl border border-neutral-300 bg-white px-4 py-2.5 focus-within:border-neutral-400">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(text)}
              disabled={busy}
              placeholder="Ask what the app does and why"
              className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            />
            <button type="button" onClick={() => send(text)} disabled={busy || !text.trim()} aria-label="Send" className="rounded-lg bg-accent p-1.5 text-white disabled:opacity-30">
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
