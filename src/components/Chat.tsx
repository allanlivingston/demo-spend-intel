"use client";
// Chat-first: one conversation that only moves forward. Claude opens with a briefing (forecast + recommendations).
// Everything after appends below. Views (forecast, recommendations) can be posted again at the bottom; only the
// newest copy of each is live, older copies render from the state they were posted with, so they match their text.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, LineChart, ListChecks, ShieldCheck, Sparkles, X } from "lucide-react";
import {
  breakdown, confidenceOf, forecast, GROUP_IDS, GROUPS, headline, kpis, TODAY,
  type Artifact, type BreakdownRow, type GroupSelection,
  isAdvanced,
} from "@/engine";
import { startAgentRun, type StartRun } from "@/state/agentClient";
import { chipsFor, isSuperseded, pendingDraft, type ChipSpec } from "@/state/chipRules";
import { nextAction, verdictFor, type Verdict } from "@/state/nextAction";
import { useStore, type ChatMessage, type Snapshot, type ViewKind } from "@/state/store";
import { AgentRunCard } from "./AgentRunCard";
import { ArtifactCard } from "./Artifacts";
import { Activity, Agents, Users, Workstreams } from "./Details";
import { HealthPanel } from "./HealthPanel";
import { PacingChart } from "./PacingChart";
import { cx, usd } from "./ui";

/** Money decisions an auditor or budget owner will ask about open in a full-page review. */
export const NEEDS_REVIEW: Artifact["kind"][] = ["cfo_brief", "governed_override"];

const ask = (q: string, context?: string[]) => startAgentRun({ agent: "chat", prompt: q, echo: true, context });
const busyOf = (messages: ChatMessage[]) => messages.some((m) => m.run?.status === "running");
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

function Frame({ icon, title, right, children, id, stale }: {
  icon: React.ReactNode; title: string; right?: React.ReactNode; children: React.ReactNode; id?: string;
  stale?: { changed: boolean; kind: ViewKind };
}) {
  const postView = useStore((s) => s.postView);
  return (
    <section id={id} className={cx("overflow-hidden rounded-xl border bg-white", stale ? "border-black/[0.06]" : "border-black/10")}>
      <header className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2.5">
        <span className="text-muted">{icon}</span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </header>
      {stale && (
        <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-1.5 text-[13px] text-muted">
          {stale.changed ? "Earlier copy. The numbers have changed since." : "Earlier copy."}
          <button type="button" onClick={() => postView(stale.kind)} className="ml-auto font-medium text-accent hover:underline">
            Show current
          </button>
        </div>
      )}
      <div className={cx(stale && "pointer-events-none opacity-70")}>{children}</div>
    </section>
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
    <div className="flex gap-0.5 rounded-lg bg-neutral-100 p-0.5">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setGroup(t.id)}
          className={cx("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px]", s.group === t.id ? "bg-white font-medium shadow-sm" : "text-neutral-600 hover:text-ink")}
        >
          {t.dot && <span className={cx("h-1.5 w-1.5 rounded-full", t.dot)} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, tone, onLearn, hint }: { label: string; value: string; tone?: string; onLearn?: () => void; hint?: string }) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-wide text-muted">{label}</div>
      <div className={cx("text-[26px] font-semibold tabular-nums", tone)}>{value}</div>
      {hint && <div className="text-[13px] text-muted">{hint}</div>}
      {onLearn && (
        <button type="button" onClick={onLearn} className="text-[13px] text-muted underline decoration-dotted hover:text-accent">
          Learn more
        </button>
      )}
    </div>
  );
}

type ForecastTab = "chart" | "workstreams" | "users" | "agents" | "health" | "activity";
const TAB_LABEL: Record<ForecastTab, string> = { chart: "This month", workstreams: "Workstreams", users: "Users", agents: "Agents", health: "Health", activity: "Activity" };

function ForecastView({ snap, live, id }: { snap: Snapshot; live: boolean; id?: string }) {
  const { s, stale } = useView(snap, live);
  const [open, setOpen] = useState(true);
  const [tab0, setTab] = useState<ForecastTab>("chart");
  const advanced = useStore((st) => st.advanced);
  const tabs = (Object.keys(TAB_LABEL) as ForecastTab[]).filter((t) => advanced || t === "chart" || t === "users" || t === "agents");
  const tab = tabs.includes(tab0) ? tab0 : "chart";
  const auditCount = useStore((st) => st.audit.length);
  const busy = busyOf(useStore((st) => st.messages));
  const f = forecast(s.demo, s.group);
  const k = kpis(s.demo, s.group);
  const third =
    k.fixableWaste > 0 ? { label: "Fixable waste", value: usd(k.fixableWaste), tone: "text-warn", q: "Where does the fixable waste come from?" }
    : k.waitingOnOwner > 0 ? { label: "Waiting on owner", value: usd(k.waitingOnOwner), tone: "text-neutral-600", q: "What waits on the dev tools team?" }
    : k.throttledValue > 0 ? { label: "Work at risk", value: usd(k.throttledValue), tone: "text-bad", q: "What work is at risk, and for whom?" }
    : f.p50 > f.pool ? { label: "Over budget", value: usd(f.p50 - f.pool), tone: "text-bad", q: "Why are we over budget?" }
    : { label: "Under budget", value: usd(f.pool - f.p50), tone: "text-ok", q: "Summarize spend" };
  return (
    <Frame
      id={id}
      icon={<LineChart size={15} />}
      title="Spend forecast"
      stale={stale && { ...stale, kind: "forecast" }}
      right={
        <>
          {live ? <TeamSwitch s={s} /> : <span className="text-[13px] text-muted">{s.group === "all" ? "All teams" : GROUPS[s.group].name}</span>}
          <button type="button" onClick={() => setOpen(!open)} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink">
            {open ? "Collapse" : "Expand"}
          </button>
        </>
      }
    >
      <div className="flex gap-10 px-4 py-3">
        <Stat label="Lands at" value={usd(f.p50)} tone={f.p50 > f.pool ? "text-bad" : undefined} hint="if nothing changes" />
        <Stat label="Budget" value={usd(f.pool)} />
        <Stat label={third.label} value={third.value} tone={third.tone} onLearn={live ? () => ask(third.q) : undefined} />
        <div className="ml-auto self-end text-[13px] text-muted">Day {TODAY} of 30</div>
      </div>
      {open && live && (
        <>
          <div className="flex gap-4 border-y border-neutral-100 px-4 text-[15px]">
            {tabs.map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cx("-mb-px border-b-2 py-2", tab === t ? "border-accent font-medium" : "border-transparent text-muted hover:text-ink")}>
                {TAB_LABEL[t]}{t === "activity" && auditCount > 0 ? ` (${auditCount})` : ""}
              </button>
            ))}
          </div>
          {tab === "chart" && <PacingChart onDay={(q, c) => ask(q, [c])} />}
          {tab === "workstreams" && <Workstreams onFollowUp={(q, c) => ask(q, [c])} busy={busy} />}
          {tab === "users" && <Users onFollowUp={(q, c) => ask(q, [c])} busy={busy} />}
          {tab === "agents" && <Agents onFollowUp={(q, c) => ask(q, [c])} busy={busy} />}
          {tab === "health" && <HealthPanel onAsk={(q, c) => ask(q, [c])} busy={busy} />}
          {tab === "activity" && <Activity />}
        </>
      )}
      <Recs s={s} live={live} id={id ? "actions" : undefined} />
    </Frame>
  );
}

// ---------- Recommendations view: a compact carousel ----------

const SHORT: Record<string, string> = { "a-subagents": "Opus subagents", "a-connector": "Jira retry loop", "a-cache": "Prompt cache drop" };

export function runFor(r: BreakdownRow): StartRun {
  const fix = r.side === "fix";
  return {
    agent: r.agent,
    // Default view has no workstreams: funding goes to the brief, so no driver (its recording is a budget move).
    driverId: fix || isAdvanced() || r.driver.id === "b-soc2" ? r.driver.id : undefined,
    prompt: fix ? `Fix with agent: ${r.driver.label}.`
      : r.driver.id === "b-soc2" ? `Fund with agent: ${r.driver.label}. Draft the planned spend approval.`
      : isAdvanced() ? `Fund with agent: ${r.driver.label}. Plan a rebalance.` : "Draft the budget owner brief.",
    say: fix ? `Fix the ${(SHORT[r.driver.id] ?? r.driver.label).toLowerCase()}.` : r.driver.id === "b-soc2" ? "Approve the SOC 2 sprint as planned spend." : `Fund ${r.driver.label.toLowerCase()}.`,
  };
}

export const askAboutRow = (r: BreakdownRow) => {
  const c = confidenceOf(r.driver);
  return {
    q: `Tell me about this: ${r.driver.label}.`,
    context: [`${r.driver.label}: ${r.driver.evidence.join(", ")}. Projected +$${Math.round(r.projected)} to month end. Confidence ${c.level}: ${c.reason}`],
  };
};

const CONF_TONE = { High: "bg-emerald-50 text-ok", Medium: "bg-amber-50 text-warn", Low: "bg-neutral-100 text-muted" };
const CARD = "flex h-[192px] w-[280px] shrink-0 snap-start flex-col rounded-xl border border-neutral-200 bg-white p-3.5";

function RecCard({ r, live, draftWaiting }: { r: BreakdownRow; live: boolean; draftWaiting: boolean }) {
  const busy = busyOf(useStore((s) => s.messages));
  const { declineRec, restoreRec } = useStore();
  const fix = r.side === "fix";
  const c = confidenceOf(r.driver);
  const done = { applied: "Fixed", funded: "Funded", overridden: "Approved as planned", sent: "Sent to owner", declined: "Declined" }[r.state as string];
  const notWorth = fix && r.driver.kind === "growth";
  return (
    <div className={cx(CARD, done && "bg-neutral-50", r.state === "declined" && "opacity-75")}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide">
        <span className={fix ? "text-warn" : "text-ok"}>{fix ? "Fix" : "Fund"}</span>
        <span title={c.reason} className={cx("cursor-help rounded px-1.5 py-px text-[11px] normal-case tracking-normal", CONF_TONE[c.level])}>{c.level} confidence</span>
        <span className="ml-auto text-[14px] normal-case tracking-normal tabular-nums">
          {fix ? <span className="text-warn">{usd(r.recoverable)}</span> : <span className="text-ink">+{usd(r.projected)}</span>}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-snug">{r.driver.label}</div>
      <div className="mt-1 line-clamp-2 text-[13px] text-muted">{r.driver.evidence.join(" · ")}</div>
      <div className="mt-auto flex items-center justify-end gap-1.5 pt-2">
        {done ? (
          <>
            <span className={cx("text-[13px] font-medium", r.state === "sent" || r.state === "declined" ? "text-muted" : "text-ok")}>{done}</span>
            {r.state === "declined" && live && (
              <button type="button" disabled={busy} onClick={() => restoreRec(r.driver.id)} className="rounded-md px-2 py-1 text-[13px] text-neutral-600 hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
                Restore
              </button>
            )}
          </>
        ) : notWorth ? (
          <span className="text-[13px] text-muted">Not worth funding</span>
        ) : live ? (
          <>
            <button type="button" disabled={busy} onClick={() => declineRec(r.driver.id)} title="Don't suggest this again. Logged in Activity; Restore undoes it."
              className="mr-auto rounded-md px-1.5 py-1.5 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
              Decline
            </button>
            <button type="button" disabled={busy} onClick={() => { const a = askAboutRow(r); ask(a.q, a.context); }}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-neutral-600 hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
              Ask
            </button>
            {draftWaiting ? (
              <span className="rounded-md border border-accent px-2.5 py-1.5 text-[13px] font-medium text-accent">Draft waiting</span>
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

/** The recommendations carousel: part of the forecast artifact, so every copy of the forecast shows its recommendations. */
function Recs({ s, live, id }: { s: Snapshot; live: boolean; id?: string }) {
  const messages = useStore((st) => st.messages);
  const track = useRef<HTMLDivElement>(null);
  const rank = (r: BreakdownRow) => (r.state === "open" ? 0 : 1);
  const rows = breakdown(s.demo, s.group).rows.slice()
    .sort((a, b) => rank(a) - rank(b) || (a.side === b.side ? b.recoverable - a.recoverable : a.side === "fix" ? -1 : 1));
  const draftFor = (r: BreakdownRow) => messages.some((m) => m.artifact && m.artifactStatus === "proposed" && m.artifact.kind !== "handoff"
    && messages.find((x) => x.id === m.runOf)?.run?.driverId === r.driver.id);
  // When every fix and fund is done but the team is still over, the open step is the budget owner brief.
  const next = nextAction(s.demo, s.group);
  const briefOpen = next.cta?.label === "Draft the budget owner brief" && !rows.some((r) => r.state === "open");
  const fc = forecast(s.demo, s.group);
  const busy = busyOf(messages);
  const open = rows.filter((r) => r.state === "open").length + (briefOpen ? 1 : 0);
  const page = (dir: number) => track.current?.scrollBy({ left: dir * 280, behavior: "smooth" });
  return (
    <div id={id} className="border-t border-neutral-100">
      <div className="flex items-center gap-2 px-4 pt-3">
        <ListChecks size={14} className="text-muted" />
        <h3 className="text-[15px] font-semibold">Recommendations</h3>
        <span className="ml-auto text-[13px] text-muted">{open ? `${open} open` : "Nothing open"}</span>
        {rows.length > 2 && (
          <>
            <button type="button" onClick={() => page(-1)} aria-label="Previous" className="rounded-md p-1 text-muted hover:bg-neutral-100 hover:text-ink"><ChevronLeft size={15} /></button>
            <button type="button" onClick={() => page(1)} aria-label="Next" className="rounded-md p-1 text-muted hover:bg-neutral-100 hover:text-ink"><ChevronRight size={15} /></button>
          </>
        )}
      </div>
      <div ref={track} className="flex snap-x gap-3 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
        {briefOpen && (
          <div className={CARD}>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-accent">Budget<span className="ml-auto font-semibold normal-case tracking-normal tabular-nums text-bad">+{usd(Math.ceil((fc.p50 - fc.pool) / 500) * 500)}</span></div>
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
        {rows.length ? (
          rows.map((r) => <RecCard key={r.driver.id} r={r} live={live} draftWaiting={draftFor(r)} />)
        ) : (
          <div className={cx(CARD, "w-full items-start justify-center bg-emerald-50/40")}>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ok">Nothing to do</div>
            <div className="mt-1.5 text-[15px] font-medium">{s.group === "all" ? "Every team" : GROUPS[s.group].name} is pacing to plan.</div>
            <div className="mt-1 text-[13px] text-muted">{headline(s.demo, s.group)} No waste to fix and no growth that needs funding.</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Every view is the forecast with its recommendations; "actions" is kept for older saved chats. */
function View({ snap, live, id }: { kind?: ViewKind; snap: Snapshot; live: boolean; id?: string }) {
  return <ForecastView snap={snap} live={live} id={id} />;
}

// ---------- Conversation ----------

function ReviewLink({ m }: { m: ChatMessage }) {
  const setReview = useStore((s) => s.setReview);
  const kind = m.artifact!.kind;
  const Icon = kind === "cfo_brief" ? FileText : ShieldCheck;
  const done = m.artifactStatus === "approved" || m.artifactStatus === "confirmed";
  return (
    <button type="button" onClick={() => setReview(m.artifact!.id)} className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm hover:border-accent">
      <Icon size={16} className="text-accent" />
      <span className="flex-1 text-[15px]">
        <span className="font-medium">{kind === "cfo_brief" ? "Budget owner brief" : "Planned spend approval"}</span>
        <span className="block text-[13px] text-muted">{done ? "Approved. Open to view the record." : "Drafted. Review it before approving."}</span>
      </span>
      <span className="flex items-center gap-1 text-[15px] font-medium text-accent">{done ? "View" : "Review"} <ArrowRight size={14} /></span>
    </button>
  );
}

function Draft({ x, all }: { x: ChatMessage; all: ChatMessage[] }) {
  const superseded = isSuperseded(x, all);
  const declineDraft = useStore((s) => s.declineDraft);
  const busy = busyOf(all);
  const body = NEEDS_REVIEW.includes(x.artifact!.kind) ? <ReviewLink m={x} /> : <ArtifactCard a={x.artifact!} status={x.artifactStatus} />;
  if (x.artifactStatus === "declined")
    return (
      <div>
        <div className="mb-1 text-[13px] text-muted">Declined. Nothing changed.</div>
        <div className="pointer-events-none opacity-50">{body}</div>
      </div>
    );
  if (!superseded && x.artifactStatus === "proposed")
    return (
      <div>
        {body}
        <div className="mt-1.5 flex justify-end">
          <button type="button" disabled={busy} onClick={() => declineDraft(x.artifact!.id)} title="Nothing changes. Logged in Activity."
            className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
            Decline
          </button>
        </div>
      </div>
    );
  if (!superseded) return body;
  return (
    <div>
      <div className="mb-1 text-[13px] text-muted">Replaced by a newer draft below.</div>
      <div className="pointer-events-none opacity-60">{body}</div>
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
            <Sparkles size={14} className="mt-1.5 shrink-0 text-accent" />
            <p className="font-serif text-[17px] leading-[26px]">{m.text}</p>
          </div>
        )}
        <View snap={m.snap!} live={live} />
      </div>
    );
  }
  if (!m.run) {
    // A plain note from Claude (for example after a decline).
    if (!m.text || m.artifact) return null;
    return (
      <div className="flex gap-2">
        <Sparkles size={14} className="mt-1.5 shrink-0 text-accent" />
        <p className="font-serif text-[17px] leading-[26px]">{m.text}</p>
      </div>
    );
  }
  const artifacts = all.filter((x) => x.runOf === m.id && x.artifact);
  return (
    <div className="space-y-3">
      <AgentRunCard m={m} />
      {artifacts.map((x) => <Draft key={x.id} x={x} all={all} />)}
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
        {model === "auto" && <span className="ml-1 text-muted">Haiku + Sonnet</span>}
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
              {o.id === model && <Check size={15} className="mt-0.5 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({ chips, onChip }: { chips: ChipSpec[]; onChip: (c: ChipSpec) => void }) {
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
      <div id="composer" className="pointer-events-auto mx-auto w-full max-w-[816px] px-6 2xl:max-w-[1008px]">
        <div className="rounded-[14px] bg-white py-2 pl-3.5 pr-2 shadow-[0_4px_20px_rgba(0,0,0,0.075),0_0_0_1px_rgba(0,0,0,0.12)] focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.075),0_0_0_1px_rgba(0,0,0,0.2)]">
          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={busy}
              placeholder={busy ? "Claude is working…" : "Ask about spend, or tell Claude what to fix"}
              className="h-7 flex-1 bg-transparent text-[16px] leading-[23px] text-ink outline-none placeholder:text-faint"
            />
            <ModelSelect />
            <button type="button" onClick={send} disabled={busy || !text.trim()} aria-label="Send" className="rounded-lg bg-accent p-1.5 text-white disabled:opacity-30">
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.text}
                type="button"
                onClick={() => onChip(c)}
                className={cx(
                  "h-7 rounded-lg border px-2.5 text-[14px] leading-[19px]",
                  c.primary ? "border-accent/40 bg-orange-50 font-[450] text-accent hover:bg-orange-100" : "border-black/10 bg-white text-ink hover:bg-black/[0.03]",
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
  const { messages, chatStart, demo, group, audit, postView, setReview } = useStore();
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

  const chips = chipsFor({ demo, group, messages, auditCount: audit.length, forecastVisible: vis.forecast });
  const onChip = (c: ChipSpec) => {
    const a = c.action;
    if (a.type === "run") startAgentRun(a.run);
    else if (a.type === "ask") ask(a.q, a.context);
    else if (a.type === "view") postView(a.kind);
    else if (a.type === "review") setReview(a.artifactId);
    else if (a.type === "decline") useStore.getState().declineDraft(a.artifactId);
    else if (a.type === "shipped") useStore.getState().ownerShipped(a.driverId);
    else if (a.type === "approve") {
      const st = useStore.getState();
      const art = st.messages.find((m) => m.artifact?.id === a.artifactId)?.artifact;
      if (art?.kind === "policy_diff") st.applyPolicy(art.driverIds, art.id);
      else if (art?.kind === "rebalance_plan") st.applyRebalance(art.id);
    }
    else setActivityOpen(true);
  };

  // Like claude.ai: a new question moves to the top of the screen and the reply streams in below it. Streaming text
  // and new steps never scroll the page, so the start of a long reply stays put; a button jumps to the end.
  const last = messages.at(-1);
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
  useEffect(() => {
    const el = scroller.current;
    const before = seen.current;
    seen.current = messages.length;
    if (!el || messages.length === before) return;
    if (!messages.length) return void el.scrollTo({ top: 0, behavior: "smooth" });
    if (messages.length < before) return;
    const added = messages.slice(before);
    const user = [...added].reverse().find((m) => m.role === "user");
    // A new question goes to the top; otherwise a new forecast ("Applied your changes…") is shown from its first line.
    const target = user ?? (last?.view && last.text ? last : null);
    if (!target) return;
    requestAnimationFrame(() => {
      const msg = document.getElementById(`msg-${target.id}`);
      if (msg) el.scrollTo({ top: el.scrollTop + msg.getBoundingClientRect().top - el.getBoundingClientRect().top - 24, behavior: "smooth" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);
  // Room under the newest question so it can sit at the top while the reply is still short.
  const lastUser = shown.map((m) => m.role).lastIndexOf("user");

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[816px] 2xl:max-w-[1008px] space-y-7 px-6 pb-56 pt-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Sparkles size={13} className="text-accent" /> Today, day {TODAY} of the month
            </div>
            <h1 id="headline" className="font-serif text-[34px] font-light leading-[41px]">{headline(briefingSnap.demo, briefingSnap.group)}</h1>
            {!messages.length && chips.find((c) => c.primary) && (
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => onChip(chips.find((c) => c.primary)!)}
                  className="rounded-lg bg-ink px-4 py-2 text-[15px] font-medium text-white hover:bg-neutral-800">
                  {chips.find((c) => c.primary)!.text}
                </button>
                <span className="text-[13px] text-muted">Claude drafts the change. Nothing is applied until you approve it.</span>
              </div>
            )}
            <div data-live-view={briefingLive ? "" : undefined} data-view="forecast">
              <View snap={chatStart} live={briefingLive} id="forecast" />
            </div>
          </div>
          {shown.slice(0, Math.max(0, lastUser)).map((m) => (
            <div key={m.id} id={`msg-${m.id}`} data-live-view={liveIds.has(m.id) ? "" : undefined} data-view={m.view}>
              <Message m={m} all={messages} liveIds={liveIds} />
            </div>
          ))}
          {lastUser >= 0 && (
            <div className="space-y-7" style={{ minHeight: Math.max(0, viewH - 240) }}>
              {shown.slice(lastUser).map((m) => (
                <div key={m.id} id={`msg-${m.id}`} data-live-view={liveIds.has(m.id) ? "" : undefined} data-view={m.view}>
                  <Message m={m} all={messages} liveIds={liveIds} />
                </div>
              ))}
            </div>
          )}
          {lastUser < 0 && shown.map((m) => (
            <div key={m.id} id={`msg-${m.id}`} data-live-view={liveIds.has(m.id) ? "" : undefined} data-view={m.view}>
              <Message m={m} all={messages} liveIds={liveIds} />
            </div>
          ))}
        </div>
      </div>
      {below && (
        <button type="button" aria-label="Scroll to the newest message" onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
          className="absolute bottom-40 left-1/2 z-10 -translate-x-1/2 rounded-full border border-neutral-200 bg-white p-1.5 text-muted shadow-md hover:text-ink">
          <ChevronDown size={18} />
        </button>
      )}
      <Composer chips={chips} onChip={onChip} />
      {activityOpen && <ActivitySheet onClose={() => setActivityOpen(false)} />}
    </div>
  );
}
