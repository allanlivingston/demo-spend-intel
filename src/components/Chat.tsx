"use client";
// Chat-first: one conversation that only moves forward. Claude opens with a briefing (forecast + recommendations).
// Everything after appends below. Views (forecast, recommendations) can be posted again at the bottom; only the
// newest copy of each is live, older copies render from the state they were posted with, so they match their text.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Copy, X } from "lucide-react";
import {
  breakdown, confidenceOf, driverById, forecast, GROUP_IDS, GROUPS, headline, kpis, ownerOf, ruleFor, usd100,
  type Artifact, type BreakdownRow, type GroupSelection,
  DECLINE_REASONS, topicOf, type GroupId,
} from "@/engine";
import { dropEarlyRun, keepEarlyRun, runKey, startEarlyRun, startAgentRun } from "@/state/agentClient";
import { chipsFor, isSuperseded, pendingDraft, runFor, type ChipSpec } from "@/state/chipRules";
import { nextAction, verdictFor, type Verdict } from "@/state/nextAction";
import { useStore, type ChatMessage, type Snapshot, type ViewKind } from "@/state/store";
import { useUi } from "@/state/ui";
import { anythingDone, doneLine, peopleLine, questionOpen, recapOf, recapText, shouldRecap, stillTrue, type Recap } from "@/state/recap";
import { AgentRunCard } from "./AgentRunCard";
import { ArtifactCard } from "./Artifacts";
import { Activity, Agents, Users, Workstreams } from "./Details";
import { HealthPanel } from "./HealthPanel";
import { PacingChart } from "./PacingChart";
import { cx, StatusPill, usd } from "./ui";
import { markUsed, NewDot } from "./NewDot";
import { RuleSuggestion, WhyAsk } from "./Rules";
import { glide, glideTo } from "./glide";
import { SmoothHeight, useJustNow, useRoll } from "./motion";

/** Money decisions an auditor or budget owner will ask about open in a full-page review. */

const ask = (q: string, context?: string[]) => startAgentRun({ agent: "chat", prompt: q, echo: true, context });
const busyOf = (messages: ChatMessage[]) => messages.some((m) => m.run?.status === "running");
/** How long the page has to sit still before the likely next step starts early. */
const EARLY_RUN_DELAY_MS = 2_000;
/**
 * "deny it", "decline", "reject this"... declines the draft waiting for an answer, or else the recommendation the
 * admin last asked about. Returns false when there is nothing clear to decline, so the message goes to Claude.
 */
const DECLINE = /^(please\s+)?(deny|decline|reject|dismiss|skip|no thanks)(\s+(it|this|that|the draft|this draft|the recommendation|this recommendation))?[.!]?$/i;
function declineByText(q: string): boolean {
  if (!DECLINE.test(q.trim())) return false;
  const st = useStore.getState();
  const draft = pendingDraft(st.messages);
  if (draft?.artifact) {
    st.say({ role: "user", text: q });
    st.declineDraft(draft.artifact.id);
    return true;
  }
  const lastAsked = [...st.messages].reverse().find((m) => m.role === "user" && /^(tell me about this|follow up on agent): /i.test(m.text ?? ""));
  const label = lastAsked?.text?.replace(/^(tell me about this|follow up on agent): /i, "").replace(/\.$/, "").toLowerCase();
  const row = label ? breakdown(st.demo, "all").rows.find((r) => r.driver.label.toLowerCase() === label && r.state === "open") : undefined;
  if (!row) return false;
  st.say({ role: "user", text: q });
  st.declineRec(row.driver.id);
  return true;
}

const same = (a: Snapshot, b: Snapshot) => a.group === b.group && JSON.stringify(a.demo) === JSON.stringify(b.demo);

// ---------- Shared frame ----------

function Frame({ title, right, children, id, stale }: {
  title: string; right?: React.ReactNode; children: React.ReactNode; id?: string;
  stale?: { changed: boolean; kind: ViewKind; open: boolean };
}) {
  const postView = useStore((s) => s.postView);
  // The live copy is already in the conversation (the newest one): go to it rather than add another.
  const toCurrent = (kind: ViewKind) => {
    const el = document.querySelector<HTMLElement>(`[data-live-view][data-view="${kind}"]`);
    if (el) glideTo(el);
    else postView(kind);
  };
  // An earlier copy folds to one line when a newer message arrives: the height glides, so the page never jumps.
  return (
    <SmoothHeight>
    <section id={id} className={cx("overflow-hidden rounded-xl border bg-white", stale ? "border-black/[0.06]" : "border-black/10")}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-neutral-100 px-4 py-2.5">
        <h2 className="whitespace-nowrap text-[15px] font-semibold">{title}</h2>
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-2">{right}</div>
      </header>
      {stale?.open && (
        <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-1.5 text-[13px] text-muted">
          {stale.changed ? "Earlier copy, as it was at this point. The numbers have changed since." : "Earlier copy, as it was at this point."}
          <button type="button" onClick={() => toCurrent(stale.kind)} className="ml-auto whitespace-nowrap font-medium text-accent-ink hover:underline">
            Go to current
          </button>
        </div>
      )}
      <div className={cx(stale && "pointer-events-none opacity-80")}>{children}</div>
    </section>
    </SmoothHeight>
  );
}

/** Live views read the store; earlier copies read their snapshot. */
function useView(snap: Snapshot, live: boolean) {
  const { demo, group } = useStore();
  const current = { demo, group };
  return { s: live ? current : snap, stale: live ? undefined : { changed: !same(snap, current) } };
}

// ---------- Forecast view ----------

const DOT: Record<Verdict, string> = { fix: "bg-warn", fund: "bg-bad", waiting: "bg-neutral-400", "on-pace": "bg-ok", funded: "bg-ok" };

function TeamSwitch({ s }: { s: Snapshot }) {
  const setGroup = useStore((st) => st.setGroup);
  const items: { id: GroupSelection; label: string; dot?: string }[] = [
    { id: "all", label: "All teams" },
    ...GROUP_IDS.map((g) => ({ id: g as GroupSelection, label: GROUPS[g].name, dot: DOT[verdictFor(s.demo, g)] })),
  ];
  return (
    <div role="group" aria-label="Team" className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-neutral-100 p-0.5 [scrollbar-width:none]">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setGroup(t.id)}
          aria-pressed={s.group === t.id}
          className={cx("flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[13px]", s.group === t.id ? "bg-white font-medium shadow-sm" : "text-neutral-600 hover:text-ink")}
        >
          {t.dot && <span className={cx("h-1.5 w-1.5 rounded-full", t.dot)} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

type Learn = { lines: { label: string; value: string }[]; note: string; q: string };

/** The figure's title opens a small breakdown in place; asking Claude is one click further, inside it. */
function LearnMore({ learn, children }: { learn: Learn; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-0.5 uppercase tracking-wide underline decoration-dotted underline-offset-2 hover:text-ink">
        {children}<ChevronDown size={12} className={cx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="dialog" className="absolute left-0 top-6 z-30 w-[320px] normal-case tracking-normal rounded-xl border border-neutral-200 bg-white p-3 text-[13px] shadow-lg">
          {learn.lines.length > 0 && (
            <ul className="mb-2 space-y-1">
              {learn.lines.map((l) => (
                <li key={l.label} className="flex gap-3"><span className="flex-1 text-ink">{l.label}</span><span className="tabular-nums text-ink">{l.value}</span></li>
              ))}
            </ul>
          )}
          <p className="text-muted">{learn.note}</p>
          <button type="button" onClick={() => { setOpen(false); ask(learn.q); }} className="mt-2 inline-flex items-center gap-1 font-medium text-accent-ink hover:underline">
            Ask Claude <ArrowRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, learn, hint }: { label: React.ReactNode; value: string; tone?: string; learn?: Learn; hint?: string }) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-wide text-muted">{learn ? <LearnMore learn={learn}>{label}</LearnMore> : label}</div>
      <div className={cx("text-[26px] font-semibold tabular-nums", tone)}>{value}</div>
      {hint && <div className="text-[13px] text-muted">{hint}</div>}
    </div>
  );
}

type ForecastTab = "chart" | "workstreams" | "users" | "agents" | "health" | "activity";
const TAB_LABEL: Record<ForecastTab, string> = { chart: "This month", workstreams: "Workstreams", users: "Users", agents: "Agents", health: "Health", activity: "Activity" };

function ForecastView({ snap, live, id }: { snap: Snapshot; live: boolean; id?: string }) {
  const { s, stale } = useView(snap, live);
  // Unset: the live copy is open and earlier copies are collapsed, so a copy collapses as soon as a newer one is posted.
  // Once the admin opens or collapses a copy, that choice sticks.
  const [userOpen, setOpen] = useState<boolean | null>(null);
  const open = userOpen ?? live;
  const [tab0, setTab] = useState<ForecastTab>("chart");
  // The chart can be hidden; the figures above it always show. A copy follows the reader's last choice. Until they
  // make one, the opening copy hides its chart once the conversation starts (the reader has moved on); later copies
  // show theirs, since the chart after a change shows what it did.
  const chartPref = useStore((st) => st.chartHidden);
  const setChartHidden = useStore((st) => st.setChartHidden);
  const started = useStore((st) => st.messages.length > 0);
  const [chartMine, setChartMine] = useState<boolean | null>(null);
  const chartHidden = chartMine ?? chartPref ?? (id === "forecast" && started);
  const toggleChart = () => { setChartMine(!chartHidden); setChartHidden(!chartHidden); };
  const advanced = useStore((st) => st.advanced);
  const tabs = (Object.keys(TAB_LABEL) as ForecastTab[]).filter((t) => advanced || t === "chart" || t === "users" || t === "agents");
  const tab = tabs.includes(tab0) ? tab0 : "chart";
  const auditCount = useStore((st) => st.audit.length);
  const busy = busyOf(useStore((st) => st.messages));
  const f = forecast(s.demo, s.group);
  // A change the user just made: the landing rolls from where it was heading (the store's ghost of the last forecast).
  const ghost = useStore((st) => st.ghost);
  const justNow = useJustNow();
  // Same timing as the chart line (PacingChart): a short pause, then 600ms, so the number and the line move together.
  const lands = useRoll(f.p50, live && justNow && ghost ? ghost.at(-1)?.p50 ?? null : null, 600, 250);
  const k = kpis(s.demo, s.group);
  const rowsNow = breakdown(s.demo, s.group).rows;
  const fixLines = (state: string) => rowsNow.filter((r) => r.side === "fix" && r.state === state).sort((a, b) => b.recoverable - a.recoverable).map((r) => ({ label: r.driver.plain ?? r.driver.label, value: usd(r.recoverable) }));
  const third: { label: string; value: string; tone: string; learn: Learn } =
    k.fixableWaste > 0 ? { label: "Fixable waste", value: usd(k.fixableWaste), tone: "text-warn-ink", learn: { lines: fixLines("open"), note: "Spend that produced no completed work by month end. Fixing it loses nothing.", q: "Where does the fixable waste come from?" } }
    : k.waitingOnOwner > 0 ? { label: "Waiting on owner", value: usd(k.waitingOnOwner), tone: "text-neutral-600", learn: { lines: fixLines("sent"), note: `Sent to ${rowsNow.filter((r) => r.state === "sent").map((r) => ownerOf(r.driver.id)?.short).filter(Boolean)[0] ?? "its owner"}. The forecast drops once they ship it.`, q: "What waits on the dev tools team?" } }
    : k.throttledValue > 0 ? { label: "Work at risk", value: usd(k.throttledValue), tone: "text-bad", learn: { lines: [], note: "Work producing results that would be slowed or held if nothing changes. Funding it removes the risk.", q: "What work is at risk, and for whom?" } }
    : f.p50 > f.pool ? { label: "Over budget", value: usd(f.p50 - f.pool), tone: "text-bad", learn: { lines: [], note: `Lands at ${usd(f.p50)} against a ${usd(f.pool)} budget.`, q: "Why are we over budget?" } }
    : { label: "Under budget", value: usd(f.pool - f.p50), tone: "text-ok-ink", learn: { lines: [], note: `Lands at ${usd(f.p50)}, under its ${usd(f.pool)} budget.`, q: "Summarize spend" } };
  return (
    <Frame
      id={id}
      title="Spend forecast"
      stale={stale && { ...stale, kind: "forecast", open }}
      right={
        live ? (
          <>
            <TeamSwitch s={s} />
            <button type="button" onClick={() => setOpen(!open)} className="shrink-0 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink">
              {open ? "Collapse" : "Expand"}
            </button>
          </>
        ) : (
          // An earlier copy: one line with its numbers at that point; the whole line opens it.
          <button type="button" onClick={() => { setOpen(!open); markUsed("earlier-copy"); }} aria-expanded={open}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-neutral-100">
            <span>{open ? "" : "Earlier copy · "}{s.group === "all" ? "All teams" : GROUPS[s.group].name} lands at <span className="font-medium tabular-nums text-ink">{usd(f.p50)}</span> of {usd(f.pool)}</span>
            <StatusPill status={f.status} funded={f.fundedVariance} />
            <NewDot f="earlier-copy" label="Open this copy to see the numbers as they were then" />
            <span className="inline-flex items-center gap-0.5 hover:text-ink">{open ? "Collapse" : "Expand"}<ChevronDown size={13} className={cx("transition-transform", open && "rotate-180")} /></span>
          </button>
        )
      }
    >
      {(live || open) && <div className="flex flex-wrap gap-x-10 gap-y-2 px-4 py-3">
        <Stat label="Forecast" value={usd(lands === f.p50 ? f.p50 : Math.round(lands / 100) * 100)} tone={lands > f.pool ? "text-bad" : undefined} />
        <Stat label="Budget" value={usd(f.pool)} />
        <Stat label={third.label} value={third.value} tone={third.tone} learn={live ? third.learn : undefined} />
      </div>}
      {/* An earlier copy shows its chart as it was then; the tabs read today's numbers, so only the live copy has them. */}
      {open && !live && <div className="border-t border-neutral-100"><PacingChart snap={s} /></div>}
      {open && live && (
        <>
          <div role="tablist" aria-label="Forecast views" className="flex gap-4 overflow-x-auto border-y border-neutral-100 px-4 text-[15px] [scrollbar-width:none]">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); if (t === "users") markUsed("tab-users"); if (t === "agents") markUsed("tab-agents"); }} className={cx("-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 py-2", tab === t ? "border-accent font-medium" : "border-transparent text-muted hover:text-ink")}>
                {TAB_LABEL[t]}{t === "activity" && auditCount > 0 ? ` (${auditCount})` : ""}
              </button>
            ))}
            {tab === "chart" && (
              <button type="button" onClick={toggleChart} aria-expanded={!chartHidden}
                className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap py-2 text-[13px] text-muted hover:text-ink">
                {chartHidden ? "Show chart" : "Hide chart"}<ChevronDown size={14} className={cx("transition-transform", !chartHidden && "rotate-180")} />
              </button>
            )}
          </div>
          {tab === "chart" && !chartHidden && <PacingChart onDay={(q, c) => ask(q, [c])} />}
          {tab === "workstreams" && <Workstreams onFollowUp={(q, c) => ask(q, [c])} busy={busy} />}
          {tab === "users" && <Users onFollowUp={(q, c) => ask(q, [c])} busy={busy} />}
          {tab === "agents" && <Agents onFollowUp={(q, c) => ask(q, [c])} busy={busy} />}
          {tab === "health" && <HealthPanel onAsk={(q, c) => ask(q, [c])} busy={busy} />}
          {tab === "activity" && <Activity />}
        </>
      )}
      {(live || open) && <Recs s={s} live={live} id={id ? "actions" : undefined} />}
    </Frame>
  );
}

// ---------- Recommendations view: a compact carousel ----------

export const askAboutRow = (r: BreakdownRow) => {
  const c = confidenceOf(r.driver);
  return {
    q: `Tell me about this: ${r.driver.label}.`,
    context: [`${r.driver.label}: ${r.driver.evidence.join(", ")}. Projected +$${Math.round(r.projected)} to month end. Confidence ${c.level}: ${c.reason}`],
  };
};

const CONF_TONE = { High: "bg-emerald-50 text-ok-ink", Medium: "bg-amber-50 text-warn-ink", Low: "bg-neutral-100 text-muted" };
const CARD = "flex h-[192px] w-[280px] max-w-[88%] shrink-0 snap-start flex-col rounded-xl border border-neutral-200 bg-white p-3.5";

function RecCard({ r, live, draftWaiting, id, onDecline }: { r: BreakdownRow; live: boolean; draftWaiting: boolean; id?: string; onDecline: (driverId: string) => void }) {
  const busy = busyOf(useStore((s) => s.messages));
  const { restoreRec } = useStore();
  // Not suggested because of a saved rule (rather than declined by hand): changed under Activity, not restored here.
  const byRule = useStore((s) => r.state === "declined" && !(s.demo.declined ?? []).includes(r.driver.id) && ruleFor(s.demo, r.driver.id)?.level === "skip");
  const fix = r.side === "fix";
  const c = confidenceOf(r.driver);
  const done = { applied: "Fixed", funded: "Funded", overridden: "Approved as planned", sent: "Sent to owner", declined: byRule ? "Skipped by your rule" : "Declined" }[r.state as string];
  const notWorth = fix && r.driver.kind === "growth";
  return (
    <div id={id} className={cx(CARD, done && "bg-neutral-50", r.state === "declined" && "opacity-75")}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide">
        <span className={fix ? "text-warn-ink" : "text-ok-ink"}>{fix ? "Fix" : "Fund"}</span>
        <span title={c.reason} className={cx("cursor-help rounded px-1.5 py-px text-[11px] normal-case tracking-normal", CONF_TONE[c.level])}>{c.level} confidence</span>
        <span className="ml-auto text-[14px] normal-case tracking-normal tabular-nums">
          {fix
            ? <span className="text-warn-ink" title="What fixing it saves by month end"><span className="text-[12px] font-normal text-muted">saves </span>{usd(r.recoverable)}</span>
            : <span className="text-ink" title="What this work adds by month end"><span className="text-[12px] font-normal text-muted">adds </span>{usd(r.projected)}</span>}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-snug">{r.driver.plain ?? r.driver.label}</div>
      <div className="mt-1 line-clamp-2 text-[13px] text-muted">{r.driver.evidence.join(" · ")}</div>
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
const SHORT_REASON: Record<string, string> = { needed: "Team needs it", planned: "Planned", later: "Not now", numbers: "Numbers look off" };

/** The recommendations carousel: part of the forecast artifact, so every copy of the forecast shows its recommendations. */
function Recs({ s, live, id }: { s: Snapshot; live: boolean; id?: string }) {
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
  const [just, setJust] = useState<{ id: string; rule?: boolean; reason?: boolean } | null>(null);
  const declinedRows = rows.filter((r) => r.state === "declined");
  const shownRows = [...rows.filter((r) => r.state !== "declined"), ...(showDeclined ? declinedRows : [])];
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
  const onDecline = (driverId: string) => { declineInPlace(driverId); setJust({ id: driverId }); };
  const justRow = just && rows.find((r) => r.driver.id === just.id);
  const open = rows.filter((r) => r.state === "open").length + (briefOpen ? 1 : 0);
  // Everything handled: one card says so; the finished cards (with Restore on declined ones) open on request.
  const [showDone, setShowDone] = useState(false);
  const allDone = rows.length > 0 && open === 0 && !next.cta && !showDone;
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
            <div className="mt-1 line-clamp-2 text-[13px] text-muted">Fixes, budget moves and approvals are done. Still lands at {usd(fc.p50)} of {usd(fc.pool)}.</div>
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
          shownRows.map((r, i) => <RecCard key={r.driver.id} r={r} live={live} draftWaiting={draftFor(r)} onDecline={onDecline} id={id && i === 0 && !briefOpen ? "first-rec" : undefined} />)
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
              <span className="min-w-0 truncate">Declined <span className="text-ink">{justRow.driver.plain ?? justRow.driver.label}</span></span>
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
function View({ snap, live, id }: { kind?: ViewKind; snap: Snapshot; live: boolean; id?: string }) {
  return <ForecastView snap={snap} live={live} id={id} />;
}

// ---------- Conversation ----------

/** A draft grows open when it arrives now (not on reload) and folds smoothly when approved. */
function DraftBox({ x, all }: { x: ChatMessage; all: ChatMessage[] }) {
  const justNow = useJustNow();
  return <SmoothHeight enter={justNow}><Draft x={x} all={all} /></SmoothHeight>;
}

/** The page headline; a new one (another team) fades in, but not on page load. */
function Headline({ text }: { text: string }) {
  const justNow = useJustNow();
  return <h1 id="headline" className={cx("font-serif text-[28px] font-light leading-[34px] sm:text-[34px] sm:leading-[41px]", justNow && "settle-in")}>{text}</h1>;
}

/** What an approved card did, in one line. */
function settledLine(a: Artifact): string {
  if (a.kind === "policy_diff") {
    const mine = a.rows.filter((r) => !ownerOf(r.driverId));
    const theirs = a.rows.filter((r) => ownerOf(r.driverId));
    const saves = usd(a.rows.reduce((t, r) => t + r.savings, 0));
    const applied = mine.length ? `Applied ${mine.length === 1 ? "1 fix" : `${mine.length} fixes`}` : "";
    const sent = theirs.length ? `sent ${theirs.length === 1 ? "1" : theirs.length} to ${ownerOf(theirs[0].driverId)!.short}` : "";
    const done = [applied, sent].filter(Boolean).join(" and ");
    return `${done.charAt(0).toUpperCase()}${done.slice(1)} · saves ${saves}`;
  }
  if (a.kind === "cfo_brief") return `Budget owner approved · budget now ${usd(a.newBudget)}`;
  if (a.kind === "governed_override") return `Approved as planned spend · ${driverById(a.driverId)?.label ?? a.driverId}`;
  if (a.kind === "rebalance_plan") return `Moved ${usd(a.moved)} of unused budget to ${a.recipientName}`;
  if (a.kind === "handoff") return `Sent to ${a.recipient}`;
  return "Done";
}

/** Once approved, a card folds to one line saying what it did; it opens again on click (Undo lives inside). */
function Settled({ a, children }: { a: Artifact; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const justNow = useJustNow();
  return (
    <div className={cx("overflow-hidden rounded-xl border border-black/10 bg-white", justNow && "settle-in")}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[14px] hover:bg-neutral-50">
        <Check size={15} className={cx("shrink-0 text-ok-ink", justNow && "check-draw")} />
        <span className="flex-1 text-ink">{settledLine(a)}</span>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] text-muted">{open ? "Hide" : "Show"}<ChevronDown size={13} className={cx("transition-transform", open && "rotate-180")} /></span>
      </button>
      {open && <div className="border-t border-neutral-100 p-2">{children}</div>}
    </div>
  );
}

function Draft({ x, all }: { x: ChatMessage; all: ChatMessage[] }) {
  const superseded = isSuperseded(x, all);
  const declineDraft = useStore((s) => s.declineDraft);
  const busy = busyOf(all);
  // Every draft is reviewed and approved where it is, in the conversation; nothing opens a separate page.
  const body = <ArtifactCard a={x.artifact!} status={x.artifactStatus} runOf={x.runOf} />;
  if (x.artifactStatus === "declined")
    return (
      <div>
        <div className="mb-1 text-[13px] text-muted">Declined. Nothing changed.</div>
        <div className="pointer-events-none opacity-50">{body}</div>
      </div>
    );
  if (!superseded && x.artifactStatus === "proposed")
    return (
      <div id={`draft-${x.artifact!.id}`}>
        {body}
        <div data-draft-actions="" className="mt-1.5 flex justify-end">
          <button type="button" disabled={busy} onClick={() => declineDraft(x.artifact!.id)} title="Nothing changes. Logged in Activity."
            className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
            Decline
          </button>
        </div>
      </div>
    );
  if (!superseded && (x.artifactStatus === "applied" || x.artifactStatus === "approved" || x.artifactStatus === "confirmed"))
    return <Settled a={x.artifact!}>{body}</Settled>;
  if (!superseded) return body;
  return (
    <div>
      <div className="mb-1 text-[13px] text-muted">Replaced by a newer draft below.</div>
      <div className="pointer-events-none opacity-60">{body}</div>
    </div>
  );
}

/** What the month came to, posted once everything open is handled. Facts only, with a copy for the team or budget owner. */
function RecapCard({ r, earlier }: { r: Recap; earlier: boolean }) {
  const [copied, setCopied] = useState(false);
  // Closing the month: its lines arrive one after another, once, when it is posted.
  const justNow = useJustNow();
  // Like earlier forecast copies: folded once a newer recap is posted, until the admin opens it.
  const [userOpen, setOpen] = useState<boolean | null>(null);
  const open = userOpen ?? !earlier;
  const copy = () => {
    navigator.clipboard?.writeText(recapText(r));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const lines: [string, React.ReactNode][] = [
    ["Forecast", <>{usd100(r.after.lands)} <span className="text-muted">(was heading for {usd100(r.before.lands)})</span></>],
    ["Budget", r.budgetAdded > 0 ? <>{usd(r.after.budget)} <span className="text-muted">(was {usd(r.before.budget)})</span></> : usd(r.after.budget)],
  ];
  if (r.fixed > 0) lines.push(["Waste fixed", usd(r.fixed)]);
  for (const a of r.approved) lines.push(["Approved as planned", a]);
  for (const w of r.waiting) lines.push(["Waiting on", <>{w.fix.charAt(4).toUpperCase() + w.fix.slice(5)}, with {w.owner} <span className="text-muted">({usd(w.amount)})</span></>]);
  if (r.declined > 0) lines.push(["Declined", `${r.declined} ${r.declined === 1 ? "recommendation" : "recommendations"}`]);
  if (r.rules > 0) lines.push(["Rules saved", String(r.rules)]);
  const toggle = (
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink">
      {open ? "Collapse" : "Expand"}<ChevronDown size={13} className={cx("transition-transform", open && "rotate-180")} />
    </button>
  );
  if (!open)
    return (
      <section className="overflow-hidden rounded-xl border border-black/[0.06] bg-white">
        <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-left text-[13px] text-muted hover:bg-neutral-50">
          <ClipboardCheck size={15} className="shrink-0" />
          <span>Earlier recap · {r.team} lands at <span className="font-medium tabular-nums text-ink">{usd100(r.after.lands)}</span> of {usd(r.after.budget)}</span>
          <StatusPill status={r.after.status} />
          <span className="ml-auto inline-flex items-center gap-0.5">Expand<ChevronDown size={13} /></span>
        </button>
      </section>
    );
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <p className="font-serif text-[17px] leading-[26px]">That&rsquo;s everything open for {r.team === "All teams" ? "every team" : r.team}. {stillTrue(r, "It")} {peopleLine(r)}</p>
      </div>
      <Frame
        title={`${r.team}, this month`}
        right={<>
          <StatusPill status={r.after.status} />
          <button type="button" onClick={copy} className="flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy summary"}
          </button>
          {earlier && toggle}
        </>}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 px-4 py-3 text-[15px]">
          {lines.map(([k, v], i) => {
            const enter = justNow && !earlier ? { className: "settle-in", style: { animationDelay: `${120 + i * 90}ms` } } : { className: "", style: undefined };
            return (
              <div key={k + String(v)} className="contents">
                <dt className={cx("whitespace-nowrap text-muted", enter.className)} style={enter.style}>{k}</dt>
                <dd className={cx("min-w-0 tabular-nums", enter.className)} style={enter.style}>{v}</dd>
              </div>
            );
          })}
        </dl>
        {!earlier && <KeepSkipping />}
      </Frame>
    </div>
  );
}

/** The one question a decline leaves for the month's end: declines with no reason given, kept as rules or not. */
function KeepSkipping() {
  const { demo, declineReasons, settleDeclines } = useStore();
  const ids = (demo.declined ?? []).filter((id) => !declineReasons[id] && topicOf(id) && !ruleFor(demo, id));
  if (!ids.length) return null;
  const names = ids.map((id) => driverById(id)?.plain ?? driverById(id)?.label ?? id);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-neutral-100 px-4 py-3 text-[14px]">
      <span className="min-w-0 flex-[1_1_16rem]">Keep skipping {ids.length === 1 ? <span className="font-medium">{names[0]}</span> : <>the {ids.length} you declined</>} next month?</span>
      <span className="flex gap-1.5">
        <button type="button" onClick={() => settleDeclines(ids, false)} className="rounded-md px-2.5 py-1 text-[13px] text-neutral-600 hover:bg-neutral-100 hover:text-ink">No</button>
        <button type="button" onClick={() => settleDeclines(ids, true)} className="rounded-md bg-ink px-3 py-1 text-[13px] font-medium text-white hover:bg-black">Keep skipping</button>
      </span>
    </div>
  );
}

function Message({ m, all, liveIds }: { m: ChatMessage; all: ChatMessage[]; liveIds: Set<string> }) {
  if (m.role === "user")
    return <div className="ml-auto w-fit max-w-[75%] rounded-xl bg-black/5 px-4 py-3 text-[16px] leading-[23px]">{m.text}</div>;
  if (m.view) {
    const live = liveIds.has(m.id);
    return (
      <div className="space-y-3">
        {m.text && (
          <div className="flex gap-2">
            <p className="font-serif text-[17px] leading-[26px]">{m.text}</p>
          </div>
        )}
        <View snap={m.snap!} live={live} />
      </div>
    );
  }
  if (m.recap) {
    const team = m.recap.team;
    return <RecapCard r={m.recap} earlier={all.slice(all.indexOf(m) + 1).some((x) => x.recap?.team === team)} />;
  }
  if (m.why) return <WhyAsk m={m} />;
  if (m.rules) return <RuleSuggestion m={m} />;
  if (!m.run) {
    // A plain note from Claude (for example after a decline).
    if (!m.text || m.artifact) return null;
    return (
      <div className="flex gap-2">
        <p className="font-serif text-[17px] leading-[26px]">{m.text}</p>
      </div>
    );
  }
  // A hand-off drafted with a fix shows on that fix's card (one Apply sends it), not as a second card with its own button.
  const diffIds = new Set(all.filter((x) => x.runOf === m.id && x.artifact?.kind === "policy_diff").flatMap((x) => (x.artifact as { driverIds: string[] }).driverIds));
  const artifacts = all.filter((x) => x.runOf === m.id && x.artifact && !(x.artifact.kind === "handoff" && diffIds.has(x.artifact.driverId)));
  return (
    <div className="space-y-3">
      <AgentRunCard m={m} />
      {/* A draft folds to one line when approved: its height glides instead of snapping, so the page doesn't jerk. */}
      {artifacts.map((x) => <DraftBox key={x.id} x={x} all={all} />)}
    </div>
  );
}

// ---------- Composer ----------

const MODEL_OPTIONS: { id: "auto" | "haiku" | "sonnet" | "opus"; name: string; hint: string }[] = [
  { id: "auto", name: "Auto", hint: "Haiku for quick answers, Sonnet for agents" },
  { id: "haiku", name: "Haiku 5.5", hint: "Fastest and cheapest" },
  { id: "sonnet", name: "Sonnet 5.5", hint: "Finds the cause and drafts the fix" },
  { id: "opus", name: "Opus 5.5", hint: "Most capable, highest cost" },
];

/** Claude-style model selector under the message box. */
function ModelSelect() {
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
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
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

function Composer({ chips, onChip, onJump }: { chips: ChipSpec[]; onChip: (c: ChipSpec) => void; onJump?: () => void }) {
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

// ---------- Activity sheet ----------

function ActivitySheet({ onClose }: { onClose: () => void }) {
  const auditLen = useStore((s) => s.audit.length);
  const markAuditSeen = useStore((s) => s.markAuditSeen);
  useEffect(() => markAuditSeen(), [auditLen, markAuditSeen]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/20" onClick={onClose}>
      <aside className="h-full w-[520px] overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center border-b border-neutral-100 px-4 py-3">
          <h2 className="text-[15px] font-semibold">Activity</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink"><X size={16} /></button>
        </header>
        <Activity />
      </aside>
    </div>
  );
}

// ---------- Page ----------

export function ChatApp({ activityOpen, setActivityOpen }: { activityOpen: boolean; setActivityOpen: (v: boolean) => void }) {
  const { messages, chatStart, demo, group, audit, postView, epoch, currentChatId } = useStore();
  const shown = messages.filter((m) => !m.runOf);
  const scroller = useRef<HTMLDivElement>(null);

  // The newest copy of each view is the live one; the briefing's copies are live until a newer one is posted.
  // Only the newest forecast copy is live; the briefing's copy is live until another is posted.
  const lastView = [...messages].reverse().find((m) => m.view)?.id;
  const liveIds = new Set(lastView ? [lastView] : []);
  const briefingLive = !lastView;
  const briefingSnap = briefingLive ? { demo, group } : chatStart;

  // Track whether the live copies are on screen (the floating composer covers the bottom 140px).
  const [vis, setVis] = useState({ forecast: true });
  const liveKey = lastView ?? "briefing";
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        const k = (e.target as HTMLElement).dataset.view as ViewKind;
        setVis((v) => ({ ...v, [k]: e.isIntersecting }));
      }),
      { root, threshold: 0, rootMargin: "0px 0px -200px 0px" },
    );
    document.querySelectorAll<HTMLElement>("[data-live-view]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [liveKey]);

  // Whether the waiting draft's own Apply/Review and Decline buttons are on screen; if so, the chips don't repeat them.
  const [draftVisible, setDraftVisible] = useState(false);
  const draftKey = messages.filter((m) => m.artifactStatus === "proposed").map((m) => m.id).join(",");
  useEffect(() => {
    const root = scroller.current;
    setDraftVisible(false);
    if (!root || !draftKey) return;
    const io = new IntersectionObserver((entries) => setDraftVisible(entries.some((e) => e.isIntersecting)), { root, threshold: 0, rootMargin: "0px 0px -200px 0px" });
    const els = document.querySelectorAll<HTMLElement>("[data-draft-actions]");
    if (els.length) io.observe(els[els.length - 1]);
    return () => io.disconnect();
  }, [draftKey]);

  const chips = chipsFor({ demo, group, messages, auditCount: audit.length, forecastVisible: vis.forecast, draftActionsVisible: draftVisible });

  // Start the likely next step early, while the admin reads (see agentClient): only when it is a draft, the tour is
  // closed, nothing else is running and nothing has changed for a moment. Anything else stops it.
  const tourOpen = useUi((u) => u.tour);
  const primary = chips.find((c) => c.primary);
  const nextRun = primary?.action.type === "run" ? primary.action.run : null;
  const nextKey = nextRun ? runKey(nextRun) : "";
  const runningNow = busyOf(messages);
  const nextRunRef = useRef(nextRun);
  nextRunRef.current = nextRun;
  useEffect(() => {
    const run = nextKey ? nextRunRef.current : null;
    keepEarlyRun(run);
    if (!run || tourOpen || runningNow) return;
    const t = setTimeout(() => { if (document.visibilityState === "visible") startEarlyRun(run); }, EARLY_RUN_DELAY_MS);
    return () => clearTimeout(t);
  }, [nextKey, tourOpen, runningNow]);
  useEffect(() => () => dropEarlyRun(), []);

  // When the last open step for the team on screen closes, say what the month came to (see recap.ts).
  const stepNow = nextAction(demo, group);
  const doneKey = `${epoch}|${currentChatId}|${demo.scenarioId}|${group}`;
  const hasStep = !!stepNow.cta || !!pendingDraft(messages) || questionOpen(messages);
  const prevDone = useRef<{ key: string; hasStep: boolean; verdict: typeof stepNow.verdict } | null>(null);
  useEffect(() => {
    const now = { key: doneKey, hasStep, verdict: stepNow.verdict };
    const prev = prevDone.current;
    prevDone.current = now;
    const st = useStore.getState();
    if (shouldRecap(prev, now, anythingDone(st.demo))) st.say({ role: "assistant", recap: recapOf(st.demo, st.group) });
  }, [doneKey, hasStep, stepNow.verdict]);
  const onChip = (c: ChipSpec) => {
    const a = c.action;
    if (a.type === "run") startAgentRun(a.run);
    else if (a.type === "ask") ask(a.q, a.context);
    else if (a.type === "view") postView(a.kind);
    else if (a.type === "review") glideTo(document.getElementById(`draft-${a.artifactId}`));
    else if (a.type === "decline") useStore.getState().declineDraft(a.artifactId);
    else if (a.type === "shipped") useStore.getState().ownerShipped(a.driverId);
    else if (a.type === "approve") {
      const st = useStore.getState();
      const art = st.messages.find((m) => m.artifact?.id === a.artifactId)?.artifact;
      if (art?.kind === "policy_diff") st.applyPolicy(art.driverIds, art.id);
      else if (art?.kind === "rebalance_plan") st.applyRebalance(art.id);
    }
    else if (a.type === "group") useStore.getState().setGroup(a.group);
    else if (a.type === "situations") useUi.getState().set({ situations: true });
    else setActivityOpen(true);
  };

  // Like claude.ai: a new question moves to the top of the screen and the reply streams in below it. Streaming text
  // and new steps never scroll the page, so the start of a long reply stays put; a button jumps to the end.
  const seen = useRef(messages.length);
  const [viewH, setViewH] = useState(0);
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight);
    const onScroll = () => setBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
    measure();
    const ro = new ResizeObserver(() => { measure(); onScroll(); });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, []);
  // A layout effect, so the reply can be placed before the first paint (see below).
  useLayoutEffect(() => {
    const el = scroller.current;
    const before = seen.current;
    seen.current = messages.length;
    if (!el || messages.length === before) return;
    if (!messages.length) return void glide(el, () => 0);
    if (messages.length < before) return;
    const added = messages.slice(before);
    const user = [...added].reverse().find((m) => m.role === "user");
    // A new question goes to the top, like claude.ai, and its answer streams in below it. New replies ("Applied your
    // changes…", "Why decline it?") arrive whole: scroll down as far as possible to show them, but never so far that
    // the first new line leaves the top. A run starting or its drafts don't move the page.
    const target = user ?? added.find((m) => m.role === "assistant" && !m.runOf && !m.run && (m.text || m.view));
    if (!target) return;
    // The aim is re-read every frame, so a chart that gets its height mid-scroll doesn't make it land short. Earlier
    // forecast copies fold when a new one arrives, so this can mean scrolling up a little.
    const msg = document.getElementById(`msg-${target.id}`);
    if (!msg) return;
    // A draft folding to one line, or an earlier forecast copy folding, can leave the new reply above the screen. Then
    // the page would jump and scroll back. Instead, put it mid-screen before the first paint, where the reader was
    // looking, and let it glide up from there.
    const top = msg.getBoundingClientRect().top - el.getBoundingClientRect().top;
    if (top < 0) el.scrollTop += top - el.clientHeight * 0.5;
    const aim = () => {
      const firstLine = el.scrollTop + msg.getBoundingClientRect().top - el.getBoundingClientRect().top - 24;
      return target === user ? firstLine : Math.min(firstLine, el.scrollHeight - el.clientHeight);
    };
    requestAnimationFrame(() => glide(el, aim));
    // A card folding on screen (an approved draft) can finish after the scroll has landed and leave the reply's first
    // line above the screen. Once folds have settled, bring it back into view.
    const settle = setTimeout(() => {
      if (msg.isConnected && msg.getBoundingClientRect().top < el.getBoundingClientRect().top) glide(el, aim);
    }, 450);
    return () => clearTimeout(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);
  // A floor under the conversation: the page never gets shorter than the bottom of what is on screen. Otherwise, when
  // something folds (an approved draft), the browser pulls the scroll back and the content above slides down.
  const floorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sc = scroller.current, el = floorRef.current;
    if (!sc || !el) return;
    const set = () => { el.style.minHeight = `${sc.scrollTop + sc.clientHeight - el.offsetTop}px`; };
    set();
    sc.addEventListener("scroll", set, { passive: true });
    return () => sc.removeEventListener("scroll", set);
  }, []);
  // Room under the newest question so it can sit at the top while the reply is still short: whatever the question and
  // its reply don't fill of (screen - 240px).
  const lastUser = shown.map((m) => m.role).lastIndexOf("user");
  const lastUserId = lastUser >= 0 ? shown[lastUser].id : null;
  const roomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const room = roomRef.current, list = floorRef.current;
    if (!room || !list) return;
    const fit = () => {
      const q = lastUserId ? document.getElementById(`msg-${lastUserId}`) : null;
      if (!q) { room.style.height = "0px"; return; }
      const used = room.getBoundingClientRect().top - q.getBoundingClientRect().top;
      room.style.height = `${Math.max(0, viewH - 240 - used)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    [...list.children].forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [lastUserId, viewH, shown.length]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The browser's scroll anchoring is off: it locks onto a message below a folding card and pushes everything above
          down. Folds glide (SmoothHeight) and scrolls glide (glide.ts), so nothing needs it. */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]">
        <div ref={floorRef} className="mx-auto w-full max-w-[816px] 2xl:max-w-[1008px] space-y-7 px-4 pb-56 pt-6 sm:px-6 sm:pt-8">
          <div className="space-y-4">
            {/* Switching teams changes the headline's length and whether there is a button: the height glides instead of
                jumping, and the new headline fades in. */}
            <SmoothHeight>
            <Headline key={briefingSnap.group} text={headline(briefingSnap.demo, briefingSnap.group)} />
            {!messages.length && chips.find((c) => c.primary)?.action.type === "run" && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button type="button" onClick={() => onChip(chips.find((c) => c.primary)!)}
                  className="shrink-0 whitespace-nowrap rounded-lg bg-ink px-4 py-2 text-[15px] font-medium text-white hover:bg-neutral-800">
                  {chips.find((c) => c.primary)!.text}
                </button>
              </div>
            )}
            </SmoothHeight>
            <div data-live-view={briefingLive ? "" : undefined} data-view="forecast">
              <View key={epoch} snap={chatStart} live={briefingLive} id="forecast" />
            </div>
          </div>
          {/* One flat list: a message never changes parent, so posting a question doesn't rebuild the messages above it
              (that made the browser re-anchor the scroll and jump). */}
          {shown.map((m) => (
            <div key={m.id} id={`msg-${m.id}`} data-live-view={liveIds.has(m.id) ? "" : undefined} data-view={m.view}>
              <Message m={m} all={messages} liveIds={liveIds} />
            </div>
          ))}
          {/* Room under the newest question, so it can sit at the top while the reply is still short. */}
          <div ref={roomRef} aria-hidden className="!mt-0" />
        </div>
      </div>
      <Composer chips={chips} onChip={onChip}
        onJump={below && messages.length > 0 ? () => { const el = scroller.current; if (el) glide(el, () => el.scrollHeight); } : undefined} />
      {activityOpen && <ActivitySheet onClose={() => setActivityOpen(false)} />}
    </div>
  );
}
