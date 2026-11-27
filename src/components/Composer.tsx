"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown } from "lucide-react";
import { type ChipSpec } from "@/state/chipRules";
import { useStore } from "@/state/store";
import { cx } from "./ui";
import { ask, busyOf, declineByText } from "./chatShared";

export const MODEL_OPTIONS: { id: "auto" | "haiku" | "sonnet" | "opus"; name: string; hint: string }[] = [
  { id: "auto", name: "Auto", hint: "Haiku for quick answers, Sonnet for agents" },
  { id: "haiku", name: "Haiku 5.5", hint: "Fastest and cheapest" },
  { id: "sonnet", name: "Sonnet 5.5", hint: "Finds the cause and drafts the fix" },
  { id: "opus", name: "Opus 5.5", hint: "Most capable, highest cost" },
];

/** Claude-style model selector under the message box. */
export function ModelSelect() {
  const { model, setModel } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const current = MODEL_OPTIONS.find((o) => o.id === model) ?? MODEL_OPTIONS[0];
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} title={`Which Claude model answers: ${current.hint}`}
        className="flex h-7 items-center gap-1 rounded-lg px-2.5 text-[14px] font-[450] leading-[19px] text-ink hover:bg-black/5">
        {current.name}
        {model === "auto" && <span className="ml-1 hidden text-muted sm:inline">Haiku + Sonnet</span>}
        <ChevronDown size={13} className="ml-0.5 text-muted" />
      </button>
      {open && (
        <div role="listbox" className="absolute bottom-10 right-0 z-30 w-[260px] rounded-xl bg-white p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.08)]">
          {MODEL_OPTIONS.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={o.id === model}
              onClick={() => { setModel(o.id); setOpen(false); }}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-black/5">
              <span className="flex-1">
                <span className="block text-[15px] font-[450] text-ink">{o.name}</span>
                <span className="block text-[13px] text-muted">{o.hint}</span>
              </span>
              {o.id === model && <Check size={15} className="mt-0.5 text-accent-ink" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Composer({ chips, onChip, onJump }: { chips: ChipSpec[]; onChip: (c: ChipSpec) => void; onJump?: () => void }) {
  const busy = busyOf(useStore((s) => s.messages));
  const [text, setText] = useState("");
  const send = () => {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    if (!declineByText(q)) ask(q);
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-canvas via-canvas to-transparent pb-4 pt-10">
      <div id="composer" className="pointer-events-auto mx-auto w-full max-w-[816px] px-4 sm:px-6 2xl:max-w-[1008px]">
        <div className="rounded-[14px] bg-white py-2 pl-3.5 pr-2 shadow-[0_4px_20px_rgba(0,0,0,0.075),0_0_0_1px_rgba(0,0,0,0.12)] focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.075),0_0_0_1px_rgba(0,0,0,0.2)]">
          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={busy}
              placeholder={busy ? "Claude is working…" : "Ask about spend, or tell Claude what to fix"}
              className="h-7 min-w-0 flex-1 bg-transparent text-[16px] leading-[23px] text-ink outline-none placeholder:text-faint"
            />
            {/* In the box, not in the chip row, so it never covers a card's buttons or pushes a chip onto a second line. */}
            {onJump && (
              <button type="button" aria-label="Scroll to the newest message" title="Scroll to the newest message" onClick={onJump}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-neutral-100 hover:text-ink">
                <ArrowDown size={16} />
              </button>
            )}
            <ModelSelect />
            <button type="button" onClick={send} disabled={busy || !text.trim()} aria-label="Send" className="rounded-lg bg-accent p-1.5 text-white disabled:opacity-30">
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
        {chips.length > 0 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
            {chips.map((c) => (
              <button
                key={c.text}
                type="button"
                onClick={() => onChip(c)}
                className={cx(
                  "h-7 shrink-0 whitespace-nowrap rounded-lg border px-2.5 text-[14px] leading-[19px]",
                  c.primary ? "border-accent/40 bg-orange-50 font-[450] text-accent-ink hover:bg-orange-100" : "border-black/10 bg-white text-ink hover:bg-black/[0.03]",
                )}
              >
                {c.text}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
