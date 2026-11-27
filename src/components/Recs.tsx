"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { breakdown, confidenceOf, forecast, GROUPS, headline, newWorkAsk, ruleFor, usd100, type BreakdownRow, DECLINE_REASONS, topicOf, type GroupId } from "@/engine";
import { startAgentRun } from "@/state/agentClient";
import { runFor } from "@/state/chipRules";
import { nextAction } from "@/state/nextAction";
import { useStore, type Snapshot } from "@/state/store";
import { useUi } from "@/state/ui";
import { doneLine, recapOf } from "@/state/recap";
import { cx, usd } from "./ui";
import { ask, busyOf } from "./chatShared";

export const askAboutRow = (r: BreakdownRow) => {
  const c = confidenceOf(r.driver);
  return {
    q: `Tell me about this: ${r.driver.label}.`,
    context: [`${r.driver.label}: ${r.driver.evidence.join(", ")}. Projected +$${Math.round(r.projected)} to month end. Confidence ${c.level}: ${c.reason}`],
  };
};

export const CONF_TONE = { High: "bg-emerald-50 text-ok-ink", Medium: "bg-amber-50 text-warn-ink", Low: "bg-neutral-100 text-muted" };
export const CARD = "flex h-[192px] w-[280px] max-w-[88%] shrink-0 snap-start flex-col rounded-xl border border-neutral-200 bg-white p-3.5";

export function RecCard({ r, live, draftWaiting, id, onDecline, ask: askFor }: { r: BreakdownRow; live: boolean; draftWaiting: boolean; id?: string; onDecline: (driverId: string) => void; ask?: number | null }) {
  const busy = busyOf(useStore((s) => s.messages));
  const { restoreRec } = useStore();
  // Not suggested because of a saved rule (rather than declined by hand): changed under Activity, not restored here.
  const byRule = useStore((s) => r.state === "declined" && !(s.demo.declined ?? []).includes(r.driver.id) && ruleFor(s.demo, r.driver.id)?.level === "skip");
  const fix = r.side === "fix";
  const c = confidenceOf(r.driver);
  const done = { applied: "Fixed", funded: "Funded", overridden: "Approved as planned", sent: "Sent to owner", declined: byRule ? "Skipped by your rule" : "Declined" }[r.state as string];
  const notWorth = fix && r.driver.kind === "growth";
  return (
    <div id={id} className={cx(CARD, done && "bg-neutral-50", r.state === "declined" && "opacity-75")}
      onMouseEnter={() => live && useUi.getState().set({ hoverDriver: r.driver.id })} onMouseLeave={() => useUi.getState().set({ hoverDriver: null })}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide">
        <span className={fix ? "text-warn-ink" : "text-ok-ink"}>{fix ? "Fix" : "Fund"}</span>
        <span title={c.reason} className={cx("cursor-help rounded px-1.5 py-px text-[11px] normal-case tracking-normal", CONF_TONE[c.level])}>{c.level} confidence</span>
        <span className="ml-auto text-[14px] normal-case tracking-normal tabular-nums">
          {fix
            ? <span className="text-warn-ink" title="What fixing it saves by month end"><span className="text-[12px] font-normal text-muted">saves </span>{usd(r.recoverable)}</span>
            : askFor != null && askFor >= 100 && askFor < r.projected
              ? <span className="text-ink" title={`This work adds ${usd(r.projected)} by month end; ${usd(r.projected - askFor)} of the budget is still free once the waste is fixed`}><span className="text-[12px] font-normal text-muted">ask </span>{usd100(askFor)}</span>
              : <span className="text-ink" title="What this work adds by month end"><span className="text-[12px] font-normal text-muted">adds </span>{usd(r.projected)}</span>}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-snug">{r.driver.plain ?? r.driver.label}</div>
      <div className="mt-1 line-clamp-2 text-[13px] text-muted">{(r.driver.plainEvidence ?? r.driver.evidence).join(" · ")}</div>
      <div className="mt-auto flex items-center justify-end gap-1.5 pt-2">
        {done ? (
          <>
            <span className={cx("text-[13px] font-medium", r.state === "sent" || r.state === "declined" ? "text-muted" : "text-ok-ink")}>{done}</span>
            {r.state === "declined" && live && !byRule && (
              <button type="button" disabled={busy} onClick={() => restoreRec(r.driver.id, true)} className="rounded-md px-2 py-1 text-[13px] text-neutral-600 hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
                Undo
              </button>
            )}
          </>
        ) : notWorth ? (
          <span className="text-[13px] text-muted">Not worth funding</span>
        ) : live ? (
          <>
            <button type="button" disabled={busy} onClick={() => onDecline(r.driver.id)} title="Logged in Activity; Undo brings it back."
              className="mr-auto rounded-md px-1.5 py-1.5 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
              Decline
            </button>
            <button type="button" disabled={busy} onClick={() => { const a = askAboutRow(r); ask(a.q, a.context); }}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-neutral-600 hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
              Ask
            </button>
            {draftWaiting ? (
              <span className="rounded-md border border-accent px-2.5 py-1.5 text-[13px] font-medium text-accent-ink">Draft waiting</span>
            ) : (
              <button type="button" disabled={busy} onClick={() => startAgentRun(runFor(r))}
                className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-40">
                {fix ? "Fix it" : "Fund it"}
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Decline reasons, short enough to sit on one line under the cards. */
export const SHORT_REASON: Record<string, string> = { needed: "Team needs it", planned: "Planned", later: "Not now", numbers: "Numbers look off" };

/** The recommendations carousel: part of the forecast artifact, so every copy of the forecast shows its recommendations. */
export function Recs({ s, live, id }: { s: Snapshot; live: boolean; id?: string }) {
  const messages = useStore((st) => st.messages);
  const track = useRef<HTMLDivElement>(null);
  const rank = (r: BreakdownRow) => (r.state === "open" ? 0 : 1);
  const sorted = breakdown(s.demo, s.group).rows.slice()
    .sort((a, b) => rank(a) - rank(b) || (a.side === b.side ? b.recoverable - a.recoverable : a.side === "fix" ? -1 : 1));
  // While this copy is on screen the cards keep their places, so a change to one card never reshuffles the row.
  const order = useRef<string[]>([]);
  for (const r of sorted) if (!order.current.includes(r.driver.id)) order.current.push(r.driver.id);
  const rows = sorted.slice().sort((a, b) => order.current.indexOf(a.driver.id) - order.current.indexOf(b.driver.id));
  const draftFor = (r: BreakdownRow) => messages.some((m) => m.artifact && m.artifactStatus === "proposed" && m.artifact.kind !== "handoff"
    && messages.find((x) => x.id === m.runOf)?.run?.driverId === r.driver.id);
  // When every fix and fund is done but the team is still over, the open step is the budget owner brief.
  const next = nextAction(s.demo, s.group);
  const briefOpen = next.cta?.label === "Draft the budget owner brief" && !rows.some((r) => r.state === "open");
  const fc = forecast(s.demo, s.group);
  const busy = busyOf(messages);
  // Declined cards leave the row; they wait behind "N declined". Right after a decline, one line under the row offers
  // Undo and an optional reason, and clears itself after a few seconds or on the next thing the user does.
  const { declineInPlace, giveDeclineReason, restoreRec } = useStore();
  const [showDeclined, setShowDeclined] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [just, setJust] = useState<{ id: string; rule?: boolean; reason?: boolean } | null>(null);
  const declinedRows = rows.filter((r) => r.state === "declined");
  // "Show the N finished" opens every card, declined ones included (they come last).
  const shownRows = [...rows.filter((r) => r.state !== "declined"), ...(showDeclined || showDone ? declinedRows : [])];
  const msgCount = messages.length;
  const seenCount = useRef(msgCount);
  useEffect(() => {
    if (msgCount !== seenCount.current) { seenCount.current = msgCount; setJust(null); }
  }, [msgCount]);
  useEffect(() => {
    if (!just) return;
    const t = setTimeout(() => setJust(null), just.reason ? 3000 : 10000);
    return () => clearTimeout(t);
  }, [just]);
  const onDecline = (driverId: string) => { useUi.getState().set({ hoverDriver: null }); declineInPlace(driverId); setJust({ id: driverId }); };
  // While the line is up the decline can still be undone, so the month isn't closed yet (the recap waits).
  const setJustDeclined = useStore((st) => st.setJustDeclined);
  useEffect(() => { if (live) setJustDeclined(just?.id ?? null); }, [just, live, setJustDeclined]);
  const justRow = just && rows.find((r) => r.driver.id === just.id);
  const open = rows.filter((r) => r.state === "open").length + (briefOpen ? 1 : 0);
  // Everything handled: one card says so; the finished cards (with Restore on declined ones) open on request.
  const allDone = rows.length > 0 && open === 0 && !next.cta && !showDone && !just;
  const page = (dir: number) => track.current?.scrollBy({ left: dir * 280, behavior: "smooth" });
  const [edge, setEdge] = useState({ left: false, right: false });
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () => setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [shownRows.length]);
  const fade = edge.left && edge.right ? "[mask-image:linear-gradient(to_right,transparent,black_32px,black_calc(100%-48px),transparent)]"
    : edge.right ? "[mask-image:linear-gradient(to_right,black_calc(100%-48px),transparent)]"
    : edge.left ? "[mask-image:linear-gradient(to_right,transparent,black_32px)]" : "";
  return (
    <div id={id} className="border-t border-neutral-100">
      <div className="flex items-center gap-2 px-4 pt-3">
        <h3 className="text-[15px] font-semibold">Recommendations</h3>
        {/* How many are still open, as a small count beside the title; none open shows nothing. */}
        {open > 0 && <span aria-label={`${open} open`} className="rounded-full bg-neutral-100 px-1.5 text-[12px] font-medium tabular-nums leading-5 text-muted">{open}</span>}
        <span className="ml-auto flex items-center gap-1">
        {live && declinedRows.length > 0 && !allDone && (
          <button type="button" onClick={() => setShowDeclined(!showDeclined)} aria-expanded={showDeclined} className="mr-1 rounded-md px-1.5 py-0.5 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink">
            {showDeclined ? "Hide declined" : `${declinedRows.length} declined`}
          </button>
        )}
        {shownRows.length > 2 && !allDone && (
          <>
            <button type="button" onClick={() => page(-1)} aria-label="Previous" className="rounded-md p-1 text-muted hover:bg-neutral-100 hover:text-ink"><ChevronLeft size={15} /></button>
            <button type="button" onClick={() => page(1)} aria-label="Next" className="rounded-md p-1 text-muted hover:bg-neutral-100 hover:text-ink"><ChevronRight size={15} /></button>
          </>
        )}
        </span>
      </div>
      <div ref={track} className={cx("flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 py-3 [scrollbar-width:none]", fade)}>
        {briefOpen && (
          <div className={CARD} id={id ? "first-rec" : undefined}>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-accent-ink">Budget<span className="ml-auto font-semibold normal-case tracking-normal tabular-nums text-bad">+{usd(Math.ceil((fc.p50 - fc.pool) / 500) * 500)}</span></div>
            <div className="mt-1.5 text-[15px] font-medium leading-snug">Ask the budget owner for more</div>
            <div className="mt-1 line-clamp-2 text-[13px] text-muted">Fixes, budget moves and approvals are done. Forecast still {usd(fc.p50)} of {usd(fc.pool)}.</div>
            {live && (
              <div className="mt-auto flex justify-end">
                <button type="button" disabled={busy} onClick={() => startAgentRun({ ...next.cta!.run, say: next.cta!.label })}
                  className="rounded-md bg-ink px-2.5 py-1 text-[13px] font-medium text-white disabled:opacity-40">Draft brief</button>
              </div>
            )}
          </div>
        )}
        {allDone ? (
          <div className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3.5 py-2.5 text-[14px]">
            {/* Room for the sentence first: where the button doesn't fit beside it, it goes underneath. */}
            <span className="min-w-0 flex-[1_1_16rem]"><Check size={14} className="-mt-0.5 mr-1.5 inline-block text-ok-ink" /><span className="font-medium">All done for you.</span> <span className="text-muted">{doneLine(recapOf(s.demo, s.group))}</span></span>
            <button type="button" onClick={() => setShowDone(true)} className="whitespace-nowrap text-[13px] font-medium text-accent-ink hover:underline">
              Show the {rows.length} finished
            </button>
          </div>
        ) : rows.length ? (
          shownRows.map((r, i) => <RecCard key={r.driver.id} r={r} ask={r.driver.groupId === "pe" ? newWorkAsk(s.demo) : null} live={live} draftWaiting={draftFor(r)} onDecline={onDecline} id={id && i === 0 && !briefOpen ? "first-rec" : undefined} />)
        ) : (
          <div className={cx(CARD, "w-full items-start justify-center bg-emerald-50/40")}>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ok-ink">Nothing to do</div>
            <div className="mt-1.5 text-[15px] font-medium">{s.group === "all" ? "Every team" : GROUPS[s.group].name} is pacing to plan.</div>
            <div className="mt-1 text-[13px] text-muted">{headline(s.demo, s.group)} No waste to fix and no growth that needs funding.</div>
          </div>
        )}
      </div>
      {live && justRow && (
        <div role="status" className="settle-in -mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-3 text-[13px] text-muted">
          {just!.reason ? (
            <span>{just!.rule ? `Won't suggest this for ${GROUPS[justRow.driver.groupId as GroupId]?.name ?? "this team"} again.` : "Thanks, noted."}</span>
          ) : (
            <>
              <span className="min-w-0 max-w-[45%] truncate">Declined <span className="text-ink">{justRow.driver.plain ?? justRow.driver.label}</span></span>
              {topicOf(justRow.driver.id) && <span>· Why?</span>}
              {topicOf(justRow.driver.id) && DECLINE_REASONS.map((x) => (
                <button key={x.id} type="button" onClick={() => setJust({ id: just!.id, reason: true, rule: giveDeclineReason(just!.id, x.id) })}
                  className="rounded-full border border-neutral-200 px-2 py-px text-[12px] text-ink hover:bg-neutral-100">{SHORT_REASON[x.id]}</button>
              ))}
            </>
          )}
          <button type="button" onClick={() => { restoreRec(just!.id, true); setJust(null); }} className="ml-auto rounded-md px-1.5 py-0.5 font-medium text-ink hover:bg-neutral-100">Undo</button>
        </div>
      )}
    </div>
  );
}

/** Every view is the forecast with its recommendations; "actions" is kept for older saved chats. */
