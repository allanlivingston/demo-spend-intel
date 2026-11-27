"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { evidenceAge, levelOfTier, pacing, userNote, SCENARIOS, TODAY, RUNG_LABEL as LEVEL_LABEL, GROUP_IDS, GROUPS, agentsOf, usersOf, workstreamPaces, type GroupId } from "@/engine";
import { useStore } from "@/state/store";
import { TierBadge, cx, usd } from "./ui";
import { YourRules } from "./Rules";

const groupsOf = (g: GroupId | "all"): GroupId[] => (g === "all" ? GROUP_IDS : [g]);

type FollowUp = (question: string, context: string) => void;
// Shown on the row the pointer is on (or keyboard focus is in); always shown where there is no hover, like touch screens.
const FOLLOW = "rounded-md px-2 py-1 text-[13px] text-neutral-600 hover:bg-neutral-100 hover:text-ink disabled:opacity-40 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";

// ---------- Workstreams ----------

export function Workstreams({ onFollowUp, busy }: { onFollowUp: FollowUp; busy: boolean }) {
  const { demo, group } = useStore();
  return (
    <div className="py-2">
      {groupsOf(group).map((g) => (
        <div key={g}>
          {group === "all" && <div className="px-4 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{GROUPS[g].name}</div>}
          {workstreamPaces(demo, g).map((w) => {
            const pm = pacing(demo, g).members.filter((m) => m.workstreamId === w.ws.id);
            const share = pm.length ? pm.reduce((a, m) => a + m.trim, 0) / pm.length : 0;
            const who = pm.length ? `${Math.round(share * 100)}% slowed or held` : "Not slowed";
            const over = w.landing > w.target;
            const barPct = Math.min(100, (w.landing / Math.max(w.target, w.landing)) * 100);
            return (
              <div key={w.ws.id} className="group grid grid-cols-[250px_1fr_90px_90px_140px_80px] items-center gap-3 px-4 py-2 text-[15px] hover:bg-neutral-50/70">
                <span className="flex min-w-0 items-center gap-2">
                  <TierBadge tier={w.tier} />
                  <span className="min-w-0">
                    <span className="block truncate">{w.ws.name}</span>
                    {(() => {
                      const a = evidenceAge(demo, w.ws.id);
                      return (
                        <span className={cx("block truncate text-[12px]", a.isNew ? "text-sky-700" : "text-muted")}
                          title={`Forecast based ${Math.round(a.ownWeight * 100)}% on this workstream's own history and ${100 - Math.round(a.ownWeight * 100)}% on the team average.${a.settles ? ` ${a.settles.charAt(0).toUpperCase() + a.settles.slice(1)}.` : ""}${a.protectedRamp ? " Budget moved here is not taken back before then." : ""}`}>
                          {a.isNew ? `New · ${a.label}` : a.label}
                        </span>
                      );
                    })()}
                  </span>
                </span>
                <div className="h-1.5 rounded-full bg-neutral-100">
                  <div className={cx("h-1.5 rounded-full", over ? "bg-bad" : w.pace < 0.5 ? "bg-neutral-400" : "bg-ok")} style={{ width: `${barPct}%` }} />
                </div>
                <span className={cx("text-right tabular-nums", over && "text-bad")}>{usd(w.landing)}<span className="block text-[12px] text-muted">forecast</span></span>
                <span className="text-right tabular-nums">{usd(w.target)}<span className="block text-[12px] text-muted">target</span></span>
                <span className={cx("text-right text-[13px]", share >= 0.2 ? "text-bad" : pm.length ? "text-warn-ink" : "text-muted")} title={pm.length ? `${pm.length} people. Cheaper model first, then paused runs, then runs held for a few hours.` : undefined}>{who}</span>
                <button type="button" disabled={busy} className={FOLLOW}
                  onClick={() => onFollowUp(`Follow up on workstream: ${w.ws.name}`, `${w.ws.name} (${GROUPS[g].name}): is forecast at ${usd(w.landing)} against a ${usd(w.target)} target, ${who.toLowerCase()}, ${levelOfTier(w.tier)} confidence; ${(() => { const a = evidenceAge(demo, w.ws.id); return `${a.label}, the estimate leans ${Math.round(a.ownWeight * 100)}% on its own data${a.settles ? `, ${a.settles}` : ""}${a.protectedRamp ? ", in a protected ramp" : ""}`; })()}.`)}>
                  Follow up
                </button>
              </div>
            );
          })}
        </div>
      ))}
      <p className="px-4 pb-1 pt-2 text-[13px] text-muted">Confidence shows how much evidence there is that a workstream&apos;s spend is producing results. New workstreams are forecast from the team average until they have their own history.</p>
    </div>
  );
}

// ---------- Users ----------


export function Users({ onFollowUp, busy }: { onFollowUp: FollowUp; busy: boolean }) {
  const { demo, group } = useStore();
  const simple = !useStore((st) => st.advanced);
  const users0 = usersOf(demo, group);
  const pace = new Map(pacing(demo, group).members.map((m) => [m.id, m]));
  // Over their monthly limit first, then others slowed by the team's pacing, then the rest.
  const statusOf = (id: string, capsDay: number | null, isNew = false) => {
    const p = pace.get(id);
    if (!p && capsDay && isNew) return { text: "Protected: fund it", tone: "text-ok-ink", rank: 0, title: `Over their monthly limit, but their work is producing results, so other spend is slowed first. A plain monthly limit would cut them off on day ${capsDay}.` };
    if (!p) return { text: "Under limit", tone: "text-muted", rank: 2, title: capsDay ? "Funded: moved budget covers this person." : undefined };
    if (p.step === "blocked") return { text: `Blocked day ${p.blockDay}`, tone: "text-bad", rank: 0, title: `Hard caps would block them on day ${p.capsBlockDay}.` };
    const title = `From day ${TODAY + 1}: ${Math.round(p.trim * 100)}% of runs slowed or held, ${Math.round(p.hardShare * 100)}% of them held for a few hours.${p.capsBlockDay ? ` A plain monthly limit would cut them off on day ${p.capsBlockDay}.` : ""}`;
    return { text: `${Math.round(p.trim * 100)}% slowed or held`, tone: p.capsBlockDay ? "text-bad" : "text-warn-ink", rank: p.capsBlockDay ? 0 : 1, title };
  };
  const users = users0.map((u) => ({ ...u, st: statusOf(u.id, u.blockDay, u.isNew), note: userNote(u, pace.get(u.id) ?? null) })).sort((a, b) => a.st.rank - b.st.rank || (a.blockDay ?? 99) - (b.blockDay ?? 99) || b.landing - a.landing);
  // In the default view with one team selected, every row would show the same team, so the column is dropped.
  const showTeam = !simple || group === "all";
  const cols = showTeam ? "grid-cols-[1.2fr_1.3fr_80px_80px_70px_150px_80px]" : "grid-cols-[2fr_80px_80px_70px_150px_80px]";
  const blocked = users.filter((u) => u.st.rank === 0).length;
  const slowed = users.filter((u) => u.st.rank === 1).length;
  // The first rows, then the rest on request: no scroll box inside the scrolling page.
  const [all, setAll] = useState(false);
  const FIRST = 10;
  const shown = all ? users : users.slice(0, FIRST);
  return (
    <div className="pb-2">
      <div className="flex items-center px-4 pb-1 pt-3 text-[13px] text-muted">
        {users.length} people{blocked ? <span className="text-bad">&nbsp;· {blocked} over their monthly limit</span> : null}{slowed ? <span className="text-warn-ink">&nbsp;· {slowed} more slowed</span> : null}
        <span className="ml-auto">Over limit first</span>
      </div>
      <div>
        <div className={cx("grid gap-2", cols, " bg-white px-4 py-1.5 text-[12px] uppercase tracking-wide text-muted")}>
          <span>Name</span>{showTeam && <span>{simple ? "Team" : "Workstream"}</span>}<span className="text-right">So far</span><span className="text-right">Forecast</span><span className="text-right">Limit</span><span className="pl-3">Status</span><span />
        </div>
        {shown.map((u) => {
          const status = u.st.text;
          const isProtected = status.startsWith("Protected");
          return (
            <div key={u.id} className={cx("group grid items-center gap-2", cols, " border-t border-neutral-50 px-4 py-1.5 text-[15px] hover:bg-neutral-50/70")}>
              <span className="truncate">
                {u.name}
                {u.isNew && <span className="ml-1.5 rounded bg-sky-50 px-1 text-[11px] text-sky-700">New</span>}
              </span>
              {showTeam && <span className="truncate text-[13px] text-muted">{simple ? u.team : `${group === "all" ? `${u.team} · ` : ""}${u.workstream}`}</span>}
              <span className="text-right tabular-nums">{usd(u.spent)}</span>
              {/* Over the limit is only a warning when the work isn't protected; protected work is the case for funding. */}
              <span className={cx("text-right tabular-nums", u.landing > u.limit && !isProtected && "text-bad")}>{usd(u.landing)}</span>
              <span className="text-right tabular-nums text-muted">{usd(u.limit)}</span>
              <span className={cx("truncate pl-3 text-[13px]", u.st.tone)} title={`${u.st.title ? `${u.st.title}\n\n` : ""}${u.note ? `What they see: "${u.note}"` : "No note shown to them yet."}`}>{status}</span>
              <button type="button" disabled={busy} className={FOLLOW}
                onClick={() => onFollowUp(`Follow up on ${u.name}`, `${u.name}, ${u.team}${simple ? "" : `, ${u.workstream}`}${u.isNew ? ", joined this month" : ""}: ${usd(u.spent)} so far, is forecast at ${usd(u.landing)}, limit ${usd(u.limit)}, ${status.toLowerCase()}${u.st.title ? ` (${u.st.title})` : ""}.${u.note ? ` They see: "${u.note}"` : ""}`)}>
                Follow up
              </button>
            </div>
          );
        })}
        {users.length > FIRST && (
          <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-neutral-100 px-4 py-2 text-left text-[13px] font-medium text-accent-ink hover:bg-neutral-50">
            {all ? "Show fewer" : `Show all ${users.length} people`}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Agents ----------

/** What each agent source is doing, in words that say whether to act. */
function agentStatus(a: { state: "running" | "fixed" | "waiting"; kind: "base" | "waste" | "growth" }) {
  if (a.state === "fixed") return { text: "Fixed", tone: "text-ok-ink" };
  if (a.state === "waiting") return { text: "With owner", tone: "text-warn-ink" };
  if (a.kind === "waste") return { text: "Waste: fix it", tone: "text-warn-ink" };
  if (a.kind === "growth") return { text: "New work", tone: "text-ok-ink" };
  return { text: "Running", tone: "text-muted" };
}

export function Agents({ onFollowUp, busy }: { onFollowUp: FollowUp; busy: boolean }) {
  const { demo, group } = useStore();
  // Most expensive first, as the caption says.
  const agents = agentsOf(demo, group).slice().sort((a, b) => b.landing - a.landing);
  // One team selected: every row would show the same team, so the column is dropped.
  const showTeam = group === "all";
  const cols = showTeam ? "grid-cols-[2fr_1fr_100px_110px_80px]" : "grid-cols-[3fr_100px_110px_80px]";
  return (
    <div className="pb-2">
      <div className={cx("grid gap-2 px-4 pb-1.5 pt-3 text-[12px] uppercase tracking-wide text-muted", cols)}>
        <span>Agent source</span>{showTeam && <span>Team</span>}<span className="text-right">This month</span><span className="pl-3">Status</span><span />
      </div>
      {agents.map((a) => {
        const st = agentStatus(a);
        return (
        <div key={a.id} className={cx("group grid items-center gap-2 border-t border-neutral-50 px-4 py-1.5 text-[15px] hover:bg-neutral-50/70", cols)}>
          <span className="leading-snug" title={a.label}>{a.label}</span>
          {showTeam && <span className="truncate text-[13px] text-muted">{a.team}</span>}
          <span className="text-right tabular-nums">{usd(a.landing)}</span>
          <span className={cx("pl-3 text-[13px]", st.tone)}>{st.text}</span>
          <button type="button" disabled={busy} className={FOLLOW}
            onClick={() => onFollowUp(`Follow up on agent: ${a.label}`, `${a.label} (${a.team}): is forecast at ${usd(a.landing)} this month, ${st.text.toLowerCase()}.`)}>
            Follow up
          </button>
        </div>
        );
      })}
      <p className="px-4 pt-2 text-[13px] text-muted">Claude Code helpers, connectors to other tools and scheduled runs, most expensive first: what each costs by month end.</p>
    </div>
  );
}

// ---------- Activity ----------

/** Audit rows store ids; show names. */
const NAMES: Record<string, string> = {
  ...Object.fromEntries(Object.values(SCENARIOS).flatMap((sc) => sc.drivers.map((d) => [d.id, d.label]))),
  ...Object.fromEntries(GROUP_IDS.map((g) => [g, GROUPS[g].name])),
  ...LEVEL_LABEL,
};
const readable = (s: string) => s.startsWith("Sharing level ") ? `Within ${(NAMES[s.slice(14)] ?? s.slice(14)).toLowerCase()} sharing` : readable0(s);
const readable0 = (s: string) => s.replace(/[a-z0-9]+(?:-[a-z0-9]+)*/gi, (w) => NAMES[w] ?? w);

/** Plain past-tense titles for audit actions, with a dot color by kind. */
function activityTitle(action: string): { title: string; tone: string } {
  if (action === "Apply policy") return { title: "Applied fix", tone: "bg-ok" };
  if (action === "Revert policy") return { title: "Undid fix", tone: "bg-neutral-400" };
  if (action === "Apply rebalance") return { title: "Moved unused budget", tone: "bg-ok" };
  if (action === "Shipped fix") return { title: "Owner shipped fix", tone: "bg-ok" };
  if (action.startsWith("Sent")) return { title: "Sent fix to owner", tone: "bg-accent" };
  if (action.startsWith("Declined")) return { title: action, tone: "bg-neutral-400" };
  if (action.endsWith("by your rule")) return { title: action, tone: "bg-ok" };
  if (action === "Removed rule" || action === "Gave a reason") return { title: action, tone: "bg-neutral-400" };
  return { title: action, tone: "bg-accent" };
}

export function Activity() {
  const audit = useStore((s) => s.audit);
  const [copied, setCopied] = useState(false);
  const rows = [...audit].reverse();
  const csv = () => {
    const head = "seq,time,actor,action,detail,confidence,reason,funding_path";
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = audit.map((e) => [e.seq, e.at, e.actor, e.action, e.detail, e.evidenceTier ? levelOfTier(e.evidenceTier) : "", e.reasonCode, e.fundingPath].map(q).join(","));
    navigator.clipboard?.writeText([head, ...body].join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="pb-2">
      <YourRules />
      {!rows.length && <p className="px-4 py-6 text-[15px] text-muted">No policy changes yet. Everything you apply, send or approve in the chat is recorded here.</p>}
      {rows.length > 0 && <div className="flex justify-end px-4 pt-2">
        <button type="button" onClick={csv} className="flex items-center gap-1 text-[13px] text-muted hover:text-ink">
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy as CSV"}
        </button>
      </div>}
      <div className="divide-y divide-black/[0.06]">
        {rows.map((e) => {
          const what = activityTitle(e.action);
          return (
            <div key={e.seq} className="flex items-start gap-3 px-4 py-2.5">
              <span className={cx("mt-[7px] h-2 w-2 shrink-0 rounded-full", what.tone)} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-[450] text-ink">{what.title}</div>
                <div className={cx("text-[14px] text-muted", !/rule/i.test(e.action) && "truncate")}>{/rule/i.test(e.action) && !e.action.endsWith("by your rule") ? e.detail : readable(e.detail)}</div>
                {(e.reasonCode || e.fundingPath) && <div className="text-[13px] text-muted">{[e.reasonCode, e.fundingPath].filter(Boolean).join(" · ")}</div>}
              </div>
              <div className="shrink-0 text-right text-[13px] leading-5 text-muted">
                <div className="tabular-nums">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
                <div className="max-w-[180px] truncate" title={e.actor}>{e.actor}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
