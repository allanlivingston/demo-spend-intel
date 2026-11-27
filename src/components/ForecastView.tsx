"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { breakdown, forecast, GROUP_IDS, GROUPS, kpis, ownerOf, usd100, type GroupSelection } from "@/engine";
import { verdictFor, type Verdict } from "@/state/nextAction";
import { useStore, type Snapshot, type ViewKind } from "@/state/store";
import { Activity, Agents, Users, Workstreams } from "./Details";
import { HealthPanel } from "./HealthPanel";
import { PacingChart } from "./PacingChart";
import { cx, StatusPill, usd } from "./ui";
import { markUsed, NewDot } from "./NewDot";
import { glideTo } from "./glide";
import { SmoothHeight, useJustNow, useRoll } from "./motion";
import { ask, busyOf, same } from "./chatShared";
import { Recs } from "./Recs";

export function Frame({ title, right, children, id, stale }: {
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
export function useView(snap: Snapshot, live: boolean) {
  const { demo, group } = useStore();
  const current = { demo, group };
  return { s: live ? current : snap, stale: live ? undefined : { changed: !same(snap, current) } };
}


export const DOT: Record<Verdict, string> = { fix: "bg-warn", fund: "bg-bad", waiting: "bg-neutral-400", "on-pace": "bg-ok", funded: "bg-ok" };

export function TeamSwitch({ s }: { s: Snapshot }) {
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

export type Learn = { lines: { label: string; value: string }[]; note: string; q: string };

/** The figure's title opens a small breakdown in place; asking Claude is one click further, inside it. */
export function LearnMore({ learn, children }: { learn: Learn; children: React.ReactNode }) {
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

export function Stat({ label, value, tone, learn, hint }: { label: React.ReactNode; value: string; tone?: string; learn?: Learn; hint?: string }) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-wide text-muted">{learn ? <LearnMore learn={learn}>{label}</LearnMore> : label}</div>
      <div className={cx("text-[26px] font-semibold tabular-nums", tone)}>{value}</div>
      {hint && <div className="text-[13px] text-muted">{hint}</div>}
    </div>
  );
}

export type ForecastTab = "chart" | "workstreams" | "users" | "agents" | "health" | "activity";
export const TAB_LABEL: Record<ForecastTab, string> = { chart: "This month", workstreams: "Workstreams", users: "Users", agents: "Agents", health: "Health", activity: "Activity" };

export function ForecastView({ snap, live, id }: { snap: Snapshot; live: boolean; id?: string }) {
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
    : k.waitingOnOwner > 0 ? { label: `Waiting on ${rowsNow.filter((r) => r.state === "sent").map((r) => ownerOf(r.driver.id)?.name.toLowerCase()).filter(Boolean)[0] ?? "owner"}`, value: usd(k.waitingOnOwner), tone: "text-neutral-600", learn: { lines: fixLines("sent"), note: `Sent to ${rowsNow.filter((r) => r.state === "sent").map((r) => ownerOf(r.driver.id)?.short).filter(Boolean)[0] ?? "its owner"}. The forecast drops once they ship it.`, q: "What waits on the dev tools team?" } }
    : k.throttledValue > 0 ? { label: "Work at risk", value: usd(k.throttledValue), tone: "text-bad", learn: { lines: [], note: "Work producing results that would be slowed or held if nothing changes. Funding it removes the risk.", q: "What work is at risk, and for whom?" } }
    : f.p50 > f.pool ? { label: "Over budget", value: usd(f.p50 - f.pool), tone: "text-bad", learn: { lines: [], note: `Forecast ${usd(f.p50)} against a ${usd(f.pool)} budget.`, q: "Why are we over budget?" } }
    : { label: "Under budget", value: usd(f.pool - f.p50), tone: "text-ok-ink", learn: { lines: [], note: `Forecast ${usd(f.p50)}, under its ${usd(f.pool)} budget.`, q: "Summarize spend" } };
  return (
    <Frame
      id={id}
      title={`${s.group === "all" ? "All teams" : GROUPS[s.group].name}: spend forecast`}
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
            <span>{open ? "" : "Earlier copy · "}{s.group === "all" ? "All teams" : GROUPS[s.group].name} forecast <span className="font-medium tabular-nums text-ink">{usd(f.p50)}</span> of {usd(f.pool)}</span>
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
        {s.group === "all" && underTeams(s.demo) && <p className="basis-full text-[13px] text-muted">{underTeams(s.demo)}</p>}
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

/** In the all-teams view: the other teams are under budget, and their unused budget doesn't pay for the team that's over. */
function underTeams(d: Snapshot["demo"]): string | null {
  const over = GROUP_IDS.filter((g) => { const f = forecast(d, g); return f.p50 > f.pool; });
  if (over.length !== 1) return null;
  const spare = GROUP_IDS.filter((g) => g !== over[0]).reduce((t, g) => { const f = forecast(d, g); return t + Math.max(0, f.pool - f.p50); }, 0);
  return spare >= 100 ? `The other teams are ${usd100(spare)} under budget, but unused budget doesn't move between teams.` : null;
}
