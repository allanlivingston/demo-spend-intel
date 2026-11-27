"use client";
import { useState } from "react";
import { Check, ChevronDown, ClipboardCheck, Copy } from "lucide-react";
import { driverById, ownerOf, ruleFor, usd100, type Artifact, topicOf } from "@/engine";
import { isSuperseded } from "@/state/chipRules";
import { useStore, type ChatMessage } from "@/state/store";
import { peopleLine, recapText, stillTrue, type Recap } from "@/state/recap";
import { ArtifactCard } from "./Artifacts";
import { cx, StatusPill, usd } from "./ui";
import { useJustNow } from "./motion";
import { busyOf } from "./chatShared";
import { Frame } from "./ForecastView";

/** The page headline; a new one (another team) fades in, but not on page load. */
export function Headline({ text }: { text: string }) {
  const justNow = useJustNow();
  return <h1 id="headline" className={cx("font-serif text-[28px] font-light leading-[34px] sm:text-[34px] sm:leading-[41px]", justNow && "settle-in")}>{text}</h1>;
}

/** What an approved card did, in one line. */
export function settledLine(a: Artifact): string {
  if (a.kind === "policy_diff") {
    const mine = a.rows.filter((r) => !ownerOf(r.driverId));
    const theirs = a.rows.filter((r) => ownerOf(r.driverId));
    const sum = (rows: typeof a.rows) => usd(rows.reduce((t, r) => t + r.savings, 0));
    const applied = mine.length ? `Applied ${mine.length === 1 ? "1 fix" : `${mine.length} fixes`}` : "";
    const sent = theirs.length ? `sent ${theirs.length === 1 ? "1" : theirs.length} to ${ownerOf(theirs[0].driverId)!.short}` : "";
    const done = [applied, sent].filter(Boolean).join(" and ");
    // Only what the admin applied is in effect now; a fix sent to another team saves nothing until they ship it.
    const now = mine.length ? `saves ${sum(mine)} now` : "";
    const later = theirs.length ? `${mine.length ? "" : "saves "}${sum(theirs)} once ${mine.length ? `${ownerOf(theirs[0].driverId)!.short} ships their fix` : "they ship it"}` : "";
    return `${done.charAt(0).toUpperCase()}${done.slice(1)} · ${[now, later].filter(Boolean).join(", ")}`;
  }
  if (a.kind === "cfo_brief") return `Budget owner approved · budget now ${usd(a.newBudget)}`;
  if (a.kind === "governed_override") return `Approved as planned spend · ${driverById(a.driverId)?.label ?? a.driverId}`;
  if (a.kind === "rebalance_plan") return `Moved ${usd(a.moved)} of unused budget to ${a.recipientName}`;
  if (a.kind === "handoff") return `Sent to ${a.recipient}`;
  return "Done";
}

/** Once approved, a card folds to one line saying what it did; it opens again on click (Undo lives inside). */
export function Settled({ a, children }: { a: Artifact; children: React.ReactNode }) {
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

export function Draft({ x, all }: { x: ChatMessage; all: ChatMessage[] }) {
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
export function RecapCard({ r, earlier }: { r: Recap; earlier: boolean }) {
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
          <span>Earlier recap · {r.team} forecast <span className="font-medium tabular-nums text-ink">{usd100(r.after.lands)}</span> of {usd(r.after.budget)}</span>
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
export function KeepSkipping() {
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
