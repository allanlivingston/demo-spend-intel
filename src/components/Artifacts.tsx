"use client";
import { useState } from "react";
import { ArrowRight, Check, Copy, Send } from "lucide-react";
import {
  FUNDING_PATHS, handoffTo, handoffWhat, landing, ownerOf, REASON_CODES, type Artifact, type CfoBrief, type Handoff, type OverrideArtifact, type PolicyDiff, type RebalanceArtifact, levelOfTier } from "@/engine";
import { useStore, type ArtifactStatus } from "@/state/store";
import { Button, StatusPill, usd, pct, cx } from "./ui";

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Shell({ title, tag, status, children }: { title: string; tag?: string; status?: ArtifactStatus; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50/60 px-3 py-2 text-[15px] font-semibold">
        {title}
        {tag && <span className="rounded border border-neutral-300 px-1.5 py-px text-[11px] font-medium text-muted">{tag}</span>}
        {status && status !== "proposed" && (
          <span className={cx("ml-auto rounded-full px-2 py-0.5 text-[12px] font-medium capitalize", status === "reverted" || status === "declined" ? "bg-neutral-100 text-muted" : "bg-emerald-50 text-ok-ink")}>{status}</span>
        )}
      </div>
      <div className="space-y-3 p-3 text-[15px]">{children}</div>
    </div>
  );
}

function LandingChange({ before, after, label = "Lands at" }: { before: { p50: number; status: PolicyDiff["before"]["status"] }; after: { p50: number; status: PolicyDiff["before"]["status"] }; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 px-3 py-2">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="tabular-nums text-muted">{usd(before.p50)}</span>
      <ArrowRight size={14} className="text-muted" />
      <span className="font-semibold tabular-nums">{usd(after.p50)}</span> <StatusPill status={after.status} />
    </div>
  );
}

function DiffRow({ r }: { r: PolicyDiff["rows"][number] }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{r.control}</span>
        <span className="tabular-nums text-ok-ink">-{usd(r.savings)}</span>
      </div>
      <dl className="mt-1 grid grid-cols-[48px_1fr] gap-x-2 gap-y-0.5 text-[13px] leading-5">
        <dt className="text-muted">Now</dt><dd className="text-neutral-600">{r.before}</dd>
        <dt className="text-muted">After</dt><dd className="font-medium text-ink">{r.after}</dd>
      </dl>
      <div className="mt-1 text-[12px] text-muted">{r.method}</div>
    </div>
  );
}

/** The message a fix sends its owner, shown on the fix itself, with the text one click away. */
function TicketLine({ t, children }: { t: Handoff; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-3 pb-2 text-[13px]">
      <div className="flex gap-2 text-muted">
        <Send size={12} className="mt-[3px] shrink-0" />
        <div>
        {children}{" "}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="whitespace-nowrap text-accent-ink hover:underline">
          {open ? "Hide" : `Preview ${t.channel === "Ticket draft" ? "the ticket" : "it"}`}
        </button>
        </div>
      </div>
      {open && (
        <div className="mt-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
          <div className="text-[12px] text-muted">{t.channel} · to {t.recipient}</div>
          <div className="mt-0.5 font-medium text-ink">{t.title}</div>
          <p className="mt-0.5 leading-5 text-neutral-700">{t.body}</p>
        </div>
      )}
    </div>
  );
}

function PolicyDiffCard({ a, status, runOf }: { a: PolicyDiff; status?: ArtifactStatus; runOf?: string }) {
  const { applyPolicy, undoPolicy, ownerShipped, demo, messages } = useStore();
  // Hand-offs drafted in the same run belong to this fix: shown on its rows instead of as separate cards.
  const ticketOf = (driverId: string) =>
    messages.find((m) => runOf && m.runOf === runOf && m.artifact?.kind === "handoff" && m.artifact.driverId === driverId)?.artifact as Handoff | undefined;
  const applied = status === "applied";
  const mine = a.rows.filter((r) => !ownerOf(r.driverId));
  const theirs = a.rows.filter((r) => ownerOf(r.driverId));
  // "After your changes" never counts the owner's rows, even once they ship.
  const others = demo.appliedFixes.filter((x) => !theirs.some((r) => r.driverId === x));
  const withMine = { ...demo, appliedFixes: Array.from(new Set([...others, ...mine.map((r) => r.driverId)])) };
  const withAll = { ...withMine, appliedFixes: Array.from(new Set([...withMine.appliedFixes, ...theirs.map((r) => r.driverId)])) };
  const afterMine = landing(withMine, a.groupId);
  const afterAll = landing(withAll, a.groupId);
  return (
    <Shell title="Proposed changes" status={status}>
      {mine.length > 0 && (
        <div>
          {theirs.length > 0 && <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">You apply</div>}
          <div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {mine.map((r) => {
              const t = ticketOf(r.driverId);
              const sent = (demo.handedOff ?? []).includes(r.driverId);
              return (
                <div key={r.driverId}>
                  <DiffRow r={r} />
                  {t && <TicketLine t={t}>{sent ? <span>Sent {handoffWhat(t)} to {handoffTo(t)}.</span> : <span>Applying also sends {handoffWhat(t)} to {handoffTo(t)}.</span>}</TicketLine>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {theirs.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Needs {ownerOf(theirs[0].driverId)!.short}</div>
          <div className="divide-y divide-neutral-100 rounded-md border border-dashed border-neutral-300">
            {theirs.map((r) => {
              const shipped = demo.appliedFixes.includes(r.driverId);
              const sent = (demo.handedOff ?? []).includes(r.driverId);
              const t = ticketOf(r.driverId);
              const what = t ? ` as ${handoffWhat(t)}` : "";
              const line = shipped ? <span className="text-ok-ink">Fixed by {ownerOf(r.driverId)!.short}.</span>
                : sent ? <span>Sent to {ownerOf(r.driverId)!.short}{what}. Not counted until they ship it.</span>
                : <span>{cap(ownerOf(r.driverId)!.short)} owns {ownerOf(r.driverId)!.owns}. Applying sends them a ticket{what}.</span>;
              return (
                <div key={r.driverId}>
                  <DiffRow r={r} />
                  {t ? <TicketLine t={t}>{line}</TicketLine> : (
                  <div className="flex items-center gap-2 px-3 pb-2 text-[13px] text-muted">
                    <Send size={12} />
                    {line}
                  </div>
                  )}
                  {sent && !shipped && (
                  <div className="flex px-3 pb-2">
                      <button type="button" onClick={() => ownerShipped(r.driverId)} className="ml-auto rounded border border-neutral-300 px-2 py-0.5 text-[12px] hover:border-ok hover:text-ok-ink" title="Demo control: play the owner's side">
                        Mark as shipped
                      </button>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <LandingChange before={a.before} after={afterMine} label={theirs.length && mine.length ? "After your changes" : "Lands at"} />
      {theirs.length > 0 && mine.length > 0 && <LandingChange before={afterMine} after={afterAll} label="After the owner's fix" />}
      {!applied && mine.length > 0 && <p className="text-[13px] text-muted">Nobody is cut off. Undo any time{theirs.length ? "; the owner gets a ticket" : ""}. Every change is logged in Activity.</p>}
      <div className="flex gap-2">
        {!applied ? (
          <Button onClick={() => applyPolicy(a.driverIds, a.id)} disabled={!a.rows.length}>{mine.length ? "Apply the changes" : "Send to owner"}</Button>
        ) : mine.length > 0 ? (
          <Button variant="secondary" onClick={() => undoPolicy(a.driverIds, a.id)}>Undo</Button>
        ) : null}
      </div>
    </Shell>
  );
}

function RebalanceCard({ a, status }: { a: RebalanceArtifact; status?: ArtifactStatus }) {
  const applyRebalance = useStore((s) => s.applyRebalance);
  return (
    <Shell title="Move unused budget" status={status}>
      <div className="grid grid-cols-2 gap-2 text-[13px]">
        <div><span className="text-muted">Sharing level</span><div className="font-medium">{a.rungLabel}</div></div>
        <div><span className="text-muted">Confidence</span><div className="font-medium">{levelOfTier(a.tier)}{a.tier < a.requiredTier ? ` (needs ${levelOfTier(a.requiredTier)})` : ""}</div></div>
      </div>
      <div className="rounded-md border border-neutral-200">
        {a.donors.map((d) => (
          <div key={d.name} className="flex justify-between border-b border-neutral-100 px-3 py-1.5 text-[13px]">
            <span>{d.name} <span className="text-muted">(pacing {pct(d.pace)} of target)</span></span>
            <span className="tabular-nums">-{usd(d.move)}</span>
          </div>
        ))}
        <div className="flex justify-between px-3 py-1.5 text-[13px] font-semibold">
          <span>To {a.recipientName}</span>
          <span className="tabular-nums text-ok-ink">+{usd(a.moved)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-neutral-50 px-3 py-2">
        <span className="text-[13px] text-muted">Work at risk</span>
        <span className="tabular-nums text-bad">{usd(a.throttledBefore)}</span>
        <ArrowRight size={14} className="text-muted" />
        <span className="font-semibold tabular-nums">{usd(a.throttledAfter)}</span>
      </div>
      <LandingChange before={a.before} after={a.after} />
      {a.limits && a.limits.length > 0 && (
        <div className="space-y-1">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">Limits checked</div>
          {a.limits.map((l) => (
            <div key={l} className="flex gap-2 text-[13px] leading-5"><Check size={13} className="mt-[3px] shrink-0 text-ok-ink" /><span>{l}</span></div>
          ))}
        </div>
      )}
      <p className="text-[13px] text-muted">{a.after.p50 > a.before.p50 ? `Lands ${usd(Math.round((a.after.p50 - a.before.p50) / 100) * 100)} higher because less of the payments refactor's work is slowed. ` : ""}Budget moves between workstreams, never between people. Everyone who receives it keeps full access to Opus.</p>
      {!a.allowed && <p className="text-[13px] text-bad">{a.reason}</p>}
      {status !== "applied" && (
        <Button onClick={() => applyRebalance(a.id)} disabled={!a.allowed} title={a.allowed ? "" : a.reason}>Move the budget</Button>
      )}
    </Shell>
  );
}

function OverrideCard({ a, status }: { a: OverrideArtifact; status?: ArtifactStatus }) {
  const confirmOverride = useStore((s) => s.confirmOverride);
  // A confirmed override shows what was recorded in the audit trail, so it survives a reload.
  const recorded = useStore((s) => s.audit.findLast((e) => e.action === "Approved as planned spend" && e.detail === a.driverId));
  const [reason, setReason] = useState<string>(recorded?.reasonCode?.startsWith("Other") ? "Other" : recorded?.reasonCode ?? a.suggestedReason);
  const [other, setOther] = useState(recorded?.reasonCode?.replace(/^Other: /, "") ?? "");
  const [funding, setFunding] = useState<string>(recorded?.fundingPath ?? a.suggestedFunding);
  const reasonOk = reason !== "" && (reason !== "Other" || other.trim().length > 2);
  const done = status === "confirmed";
  return (
    <Shell title="Planned spend approval" status={status}>
      <div>
        <div className="font-medium">{a.driverLabel}</div>
        <div className="text-[13px] text-muted">+{usd(a.amount)} to month end · {levelOfTier(a.tier)} confidence: {a.evidence.join(", ")}</div>
      </div>
      <div className="text-[13px]">Count as <span className="font-semibold text-ok-ink">planned, funded work</span></div>
      <label className="block text-[13px]">
        <span className="text-muted">Reason</span>
        <select disabled={done} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-[15px]" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {REASON_CODES.map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      {reason === "Other" && <input disabled={done} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-[15px]" placeholder="Describe the reason" value={other} onChange={(e) => setOther(e.target.value)} />}
      <label className="block text-[13px]">
        <span className="text-muted">Paid from</span>
        <select disabled={done} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-[15px]" value={funding} onChange={(e) => setFunding(e.target.value)}>
          <option value="">Choose a funding path</option>
          {FUNDING_PATHS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      <p className="text-[12px] text-muted">Claude filled in a suggested reason and source. Change them if needed. The budget owner sees every approval.</p>
      {!done && (
        <Button disabled={!reasonOk || !funding} onClick={() => confirmOverride(a.driverId, reason === "Other" ? `Other: ${other}` : reason, funding, a.id)}>
          Approve as planned
        </Button>
      )}
    </Shell>
  );
}

function CfoBriefCard({ a, status }: { a: CfoBrief; status?: ArtifactStatus }) {
  const approveRevision = useStore((s) => s.approveRevision);
  const advanced = useStore((s) => s.advanced);
  const [copied, setCopied] = useState(false);
  return (
    <Shell title="Budget owner brief" status={status}>
      <div className="text-base font-semibold">
        Request +{usd(a.requested)} <span className="text-[15px] font-normal text-muted">({a.groupName}: {usd(a.currentBudget)} to {usd(a.newBudget)})</span>
      </div>
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-muted"><th className="font-normal" /><th className="font-normal">Now</th><th className="font-normal">If approved</th></tr></thead>
        <tbody className="tabular-nums">
          <tr><td className="text-muted">Budget</td><td>{usd(a.currentBudget)}</td><td className="font-semibold">{usd(a.newBudget)}</td></tr>
          <tr><td className="text-muted">Lands at</td><td>{usd(a.p50)}</td><td>{usd(a.p50)}</td></tr>
          <tr><td className="text-muted">High case</td><td>{usd(Math.round(a.p90 / 100) * 100)}</td><td>{usd(Math.round(a.p90 / 100) * 100)}{Math.round(a.p90 / 100) * 100 > a.newBudget && <span className="text-warn-ink"> ({usd(Math.round(a.p90 / 100) * 100 - a.newBudget)} over)</span>}</td></tr>
          <tr><td className="text-muted">Status</td><td><StatusPill status={a.statusBefore} /></td><td><StatusPill status={a.statusAfter} /></td></tr>
        </tbody>
      </table>
      {a.covers && <div className="text-[13px] text-muted">{a.covers}</div>}
      <ul className="space-y-0.5 text-[13px]">
        {a.evidence.filter((e) => e.detail !== "None").map((e) => (
          <li key={e.tier}><span className="font-semibold">{e.tier}</span><span className="block text-muted">{e.detail}</span></li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 text-[13px]">
        {advanced && <div><span className="text-muted">Planned spend approved this month</span><div className="font-medium">{pct(a.overrideRate)}</div></div>}
        <div><span className="text-muted">Work slowed without it</span><div className="font-medium">{usd(a.throttledAvoided)}</div></div>
      </div>
      <p className="rounded-md bg-emerald-50/60 px-3 py-2 text-[13px]">{a.recommendation}</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(a.markdown); setCopied(true); }}>
          <Copy size={13} /> {copied ? "Copied" : "Copy text"}
        </Button>
        {status !== "approved" && <Button onClick={() => approveRevision(a.groupId, a.newBudget, a.id)} disabled={a.requested <= 0}>Budget owner approved (demo)</Button>}
      </div>
    </Shell>
  );
}

function HandoffCard({ a }: { a: Handoff }) {
  const sent = useStore((s) => (s.demo.handedOff ?? []).includes(a.driverId));
  const sendHandoff = useStore((s) => s.sendHandoff);
  return (
    <Shell title={a.channel} tag={sent ? "Sent" : "Draft"}>
      <div className="text-[13px]"><span className="text-muted">To</span> {a.recipient}</div>
      <div className="font-medium">{a.title}</div>
      <p className="text-[13px] leading-relaxed text-neutral-700">{a.body}</p>
      {!sent && <Button variant="secondary" onClick={() => sendHandoff(a.driverId)}>Send</Button>}
    </Shell>
  );
}

export function ArtifactCard({ a, status, runOf }: { a: Artifact; status?: ArtifactStatus; runOf?: string }) {
  switch (a.kind) {
    case "handoff": return <HandoffCard a={a} />;
    case "policy_diff": return <PolicyDiffCard a={a} status={status} runOf={runOf} />;
    case "rebalance_plan": return <RebalanceCard a={a} status={status} />;
    case "governed_override": return <OverrideCard a={a} status={status} />;
    case "cfo_brief": return <CfoBriefCard a={a} status={status} />;
  }
}
