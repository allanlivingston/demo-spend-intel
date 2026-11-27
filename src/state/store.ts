"use client";
// Client store. Engine inputs (DemoState) plus UI state. Persisted per browser; Reset demo clears it.
import { create } from "zustand";
import type { Recap } from "./recap";
import { persist } from "zustand/middleware";
import { ownerOf, headline, usd, usd100, GROUPS,
  setAdvancedView, draftCfoBrief, draftOverride, draftPolicyDiff, draftRebalance, forecast, initialState,
  type Artifact, type DayPoint, type DemoState, type GroupId, type GroupSelection, type ScenarioId, type SharingLevel, isDeclined, driverById,
  handoffTo, type Handoff, applyRulesAtStart, DECLINE_REASONS, ruleFor, ruleFromDecline, rulesFromApply, ruleSentence, topicOf, withRules,
  type PrefRule, type RuleLevel, type DeclineReasonId,
} from "@/engine";
import type { AgentId, Backend, StepPhase } from "@/agents/types";

export interface PinnedContext {
  id: string;
  label: string;
  detail?: string;
  /** What the pin is, so the chat can suggest the right questions. */
  kind?: "fix" | "fund" | "draft" | "verdict";
  /** The action the admin can take on it from the chat (first suggestion chip). */
  action?: { label: string; agent: AgentId; driverId?: string; prompt: string };
}

export interface AuditEvent {
  seq: number;
  at: string; // ISO time
  actor: string;
  action: string;
  detail: string;
  evidenceTier?: number;
  reasonCode?: string;
  fundingPath?: string;
}

export type ArtifactStatus = "proposed" | "applied" | "reverted" | "approved" | "confirmed" | "declined";

export interface AgentRunView {
  agent: AgentId;
  backend?: Backend;
  model?: string;
  replayReason?: string;
  steps: { phase: StepPhase; tool: string; summary: string }[];
  status: "running" | "done" | "error";
  error?: string;
  costUsd?: number;
  latencyMs?: number;
  /** The request, kept so the answer can be escalated to Opus or revised. */
  prompt: string;
  /** The admin's change request, when this run redrafts an earlier one. */
  request?: string;
  /** Where it ran and with what context, so a failed run can be retried as-is. */
  anchor?: string;
  context?: string[];
  revision?: string;
  driverId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** A name for the chat when no question has been asked yet. */
  title?: string;
  text?: string;
  model?: string;
  artifact?: Artifact;
  artifactStatus?: ArtifactStatus;
  run?: AgentRunView;
  /** Where the result shows: "verdict", a driver id, or unset for the assistant drawer. */
  anchor?: string;
  /** For artifacts: the run message that drafted it. */
  runOf?: string;
  /** Closed by the admin (inline results only). */
  dismissed?: boolean;
  /** A live view posted into the conversation (forecast or recommended actions). */
  view?: ViewKind;
  /** A view held back while this message's question is open: posted once it is answered or the admin moves on. */
  held?: { view: ViewKind; text: string; snap?: Snapshot };
  /** The state when this message was posted. Older copies render from it, so they match the text around them. */
  snap?: Snapshot;
  /** After a decline: Claude asks why. The answer is kept here. */
  why?: { driverId: string; answer?: string };
  /** Suggested rules, waiting for the admin's approval. */
  rules?: PrefRule[];
  rulesStatus?: "proposed" | "saved" | "dismissed";
  /** Who wrote the rule's sentence: Claude, or the app's template (offline, or Claude's answer failed a check). */
  rulesWording?: "pending" | "claude" | "template";
  /** The month so far, posted once everything open is handled. */
  recap?: Recap;
}

export type ViewKind = "forecast" | "actions";
export interface Snapshot { demo: DemoState; group: GroupSelection }

interface Store {
  demo: DemoState;
  group: GroupSelection;
  pinned: PinnedContext[];
  messages: ChatMessage[];
  audit: AuditEvent[];
  ghost: DayPoint[] | null;
  seq: number;
  msgSeq: number;
  offline: boolean;
  /** Advanced view: workstreams, agents, Health, activity and budget moves. Off by default. */
  advanced: boolean;
  setAdvanced: (v: boolean) => void;
  /** The model selector under the message box. */
  model: "auto" | "haiku" | "sonnet" | "opus";
  setModel: (m: "auto" | "haiku" | "sonnet" | "opus") => void;
  sessionId: string;
  usage: { calls: number; costUsd: number };
  lastBackend: { backend: Backend; model: string; replayReason?: string } | null;
  drawerOpen: boolean;
  /** Daily bars under the chart: closed behind a one-line summary until the admin opens them. */
  dailyOpen: boolean;
  /** The reader's last Show/Hide chart choice; null until they make one (the chart shows). */
  chartHidden: boolean | null;
  setChartHidden: (hidden: boolean) => void;
  /** Bumped on reset and scenario switch, so views return to their first tab. */
  epoch: number;
  /** How many Activity entries the admin has seen; the sidebar badge counts the rest. */
  auditSeen: number;
  markAuditSeen: () => void;
  setDailyOpen: (open: boolean) => void;
  /** The drawer received something while closed. */
  unseen: boolean;
  /** Artifact id open in the full-page review, or null. */
  review: string | null;

  setDrawer: (open: boolean) => void;
  setReview: (artifactId: string | null) => void;
  dismissAnchor: (anchor: string) => void;
  /** Bumped to move focus to a thread input. */
  threadTick: number;
  /** Spots on the page ("verdict" or a driver id) with an open conversation under them. */
  threads: string[];
  openThread: (anchor: string) => void;
  closeThread: (anchor: string) => void;
  /** Bumped to move focus to the chat input. */
  composerTick: number;
  /** Open the chat about one item: pin it as context and focus the input. */
  askAbout: (c: PinnedContext) => void;
  setScenario: (id: ScenarioId) => void;
  setOffline: (v: boolean) => void;
  addMessage: (m: Omit<ChatMessage, "id">) => string;
  patchMessage: (id: string, fn: (m: ChatMessage) => ChatMessage) => void;
  noteRun: (e: { backend: Backend; model: string; replayReason?: string }) => void;
  addUsage: (costUsd: number) => void;
  setGroup: (g: GroupSelection) => void;
  pin: (c: PinnedContext) => void;
  unpin: (id: string) => void;
  say: (m: Omit<ChatMessage, "id">) => void;
  openArtifact: (a: Artifact, where?: { anchor?: string; runOf?: string }) => void;
  setArtifactStatus: (artifactId: string, status: ArtifactStatus) => void;

  applyPolicy: (driverIds: string[], artifactId?: string) => void;
  undoPolicy: (driverIds: string[], artifactId?: string) => void;
  /** Decline a recommendation: it stays in the forecast but is no longer suggested. Logged; Restore undoes it. */
  declineRec: (driverId: string) => void;
  restoreRec: (driverId: string, quiet?: boolean) => void;
  /** Decline from the card: one click, no reason needed, nothing posted to the chat. Logged in Activity. */
  declineInPlace: (driverId: string) => void;
  /**
   * The optional reason for a decline, given just after it. A lasting reason ("The team needs it") keeps it as a rule
   * for the team; returns true when it did.
   */
  giveDeclineReason: (driverId: string, reasonId: DeclineReasonId) => boolean;
  /** Reasons given for this month's declines (driver id → reason id), so the recap only asks about the rest. */
  declineReasons: Record<string, string>;
  /** From the recap: keep skipping these declines next month (saves a rule each), or not. */
  settleDeclines: (driverIds: string[], keep: boolean) => void;
  /** Decline a draft: nothing changes, and it is logged. */
  declineDraft: (artifactId: string) => void;
  /** Answer "why decline it?". A lasting reason leads to a suggested rule. */
  answerWhy: (messageId: string, reason: DeclineReasonId) => void;
  /** Save suggested rules, with the level the admin picked for each. */
  saveRules: (messageId: string, levels: RuleLevel[]) => void;
  dismissRules: (messageId: string) => void;
  setRuleLevel: (ruleId: string, level: RuleLevel) => void;
  removeRule: (ruleId: string) => void;
  /** Kinds of rule the admin said no to ("topic:group"), so they aren't suggested again. */
  ruleNoThanks: string[];
  /** Send a hand-off to the owner of a fix the admin can't apply. */
  sendHandoff: (driverId: string) => void;
  /** Demo control: the owner ships their fix. */
  ownerShipped: (driverId: string) => void;
  applyRebalance: (artifactId?: string) => void;
  confirmOverride: (driverId: string, reasonCode: string, fundingPath: string, artifactId?: string) => void;
  approveRevision: (g: GroupId, newBudget: number, artifactId?: string) => void;
  setSharing: (level: SharingLevel) => void;
  setToggle: (key: "tier3Arrived" | "tier5Imported", value: boolean) => void;
  setHurdle: (g: GroupId, value: number) => void;
  reset: () => void;
  /** Earlier conversations, saved when the admin starts a new chat. */
  /** Every saved conversation, newest first. The open one is updated in place when you switch away. */
  pastChats: PastChat[];
  /** Id of the open conversation in pastChats, or null while it is new and not saved yet. */
  currentChatId: string | null;
  /** The state when this conversation started: the opening briefing renders from it once it is out of date. */
  chatStart: Snapshot;
  /** Post a fresh copy of a view at the bottom of the conversation (the conversation only moves forward). */
  postView: (kind: ViewKind, text?: string) => void;
  newChat: () => void;
  openPastChat: (id: string) => void;
}

export interface PastChat {
  id: string;
  title: string;
  messages: ChatMessage[];
  start?: Snapshot;
}

/** Name a conversation after what got done in it, else what was asked first. */
export function chatTitle(messages: ChatMessage[]): string {
  const done = messages.find((m) => m.artifact && m.artifactStatus && m.artifactStatus !== "proposed" && m.artifactStatus !== "reverted");
  const TITLE: Record<string, string> = {
    policy_diff: "Applied waste fixes", rebalance_plan: "Rebalanced budget", governed_override: "Approved planned spend", cfo_brief: "Budget owner brief",
  };
  if (done?.artifact) return TITLE[done.artifact.kind] ?? "Approved a change";
  return messages.find((m) => m.role === "user")?.text ?? messages.find((m) => m.title)?.title ?? "Conversation";
}

const fresh = (scenario: ScenarioId = "C") => ({
  demo: initialState(scenario),
  pinned: [] as PinnedContext[],
  messages: [] as ChatMessage[],
  ghost: null as DayPoint[] | null,
  dailyOpen: false,
  chartHidden: null as boolean | null,
  pastChats: [] as PastChat[],
  currentChatId: null as string | null,
});

/** Group that the scenario is about, so switching lands on the interesting view. */
const focusGroup = (id: ScenarioId): GroupSelection => (id === "baseline" ? "all" : "pe");

const DRAFT_NAME: Partial<Record<Artifact["kind"], string>> = {
  policy_diff: "Proposed changes", rebalance_plan: "rebalance plan", governed_override: "planned spend approval", cfo_brief: "budget owner brief", handoff: "hand-off",
};

const interrupted = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((m) => (m.run?.status === "running" ? { ...m, run: { ...m.run, status: "error" as const, error: "Interrupted by a page reload. Try again." } } : m));

setAdvancedView(false);

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      /** Append-only audit trail: events are only ever added. */
      const log = (e: Omit<AuditEvent, "seq" | "at">) => {
        const seq = get().seq + 1;
        set({ seq, audit: [...get().audit, { ...e, seq, at: new Date().toISOString() }] });
      };
      /** Change engine inputs, keeping a ghost of the previous forecast curve. */
      const mutate = (next: DemoState) => {
        const g = get().group;
        set({ ghost: forecast(get().demo, g).series, demo: next });
      };
      /** The chat list with the open conversation saved into it: updated in place, or added at the top if new. */
      const saveCurrent = (): PastChat[] => {
        const { messages, currentChatId, pastChats, chatStart } = get();
        if (!messages.length) return pastChats;
        const entry = { title: chatTitle(messages), messages, start: chatStart };
        if (currentChatId && pastChats.some((c) => c.id === currentChatId))
          return pastChats.map((c) => (c.id === currentChatId ? { ...c, ...entry } : c));
        return [{ id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, ...entry }, ...pastChats].slice(0, 12);
      };
      /** After a decline: ask why, so a lasting reason can become a rule. */
      const askWhy = (driverId?: string) => {
        if (!driverId || !topicOf(driverId)) return;
        get().addMessage({ role: "assistant", text: "Why decline it? Your answer helps me suggest better changes next month.", why: { driverId } });
      };
      /** Suggest rules from what the admin just approved. */
      const suggestRules = (rules: PrefRule[], text: string, why: { decision: "declined" | "applied"; reason?: string }) => {
        if (!rules.length) return;
        // Offline (and in tests) the app's template words the rule. Live, Claude words it; the scope never changes.
        const live = !get().offline && typeof window !== "undefined";
        const id = get().addMessage({ role: "assistant", text, rules, rulesStatus: "proposed", rulesWording: live ? "pending" : "template" });
        if (live) void wordRules(id, rules, why);
      };
      /** Ask Claude to word each suggested rule; keep the template for any it can't. */
      const wordRules = async (id: string, rules: PrefRule[], why: { decision: "declined" | "applied"; reason?: string }) => {
        const worded = await Promise.all(rules.map((rule) =>
          fetch("/api/rule", { method: "POST", headers: { "content-type": "application/json", "x-demo-session": get().sessionId }, body: JSON.stringify({ rule, ...why }) })
            .then((r) => (r.ok ? r.json() : null))
            .then((j: { wording?: PrefRule["wording"] | null } | null) => j?.wording ?? undefined)
            .catch(() => undefined)));
        const m = get().messages.find((x) => x.id === id);
        if (!m?.rules || m.rulesStatus !== "proposed") return;
        const all = worded.every(Boolean);
        get().patchMessage(id, (x) => ({ ...x, rules: all ? x.rules!.map((r, i) => ({ ...r, wording: worded[i] })) : x.rules, rulesWording: all ? "claude" : "template" }));
      };
      /** After any approved change: say what it did and show the updated forecast, at the bottom. */
      /** Post the view a question was holding back (see ChatMessage.held). */
      const releaseHeld = () => {
        const h = get().messages.find((m) => m.held);
        if (!h?.held) return;
        const msgSeq = get().msgSeq + 1;
        const { view, text, snap } = h.held;
        set({ msgSeq, messages: [...get().messages.map((m) => (m.id === h.id ? { ...m, held: undefined } : m)), { role: "assistant", view, text, snap, id: `m${msgSeq}` }] });
      };
      const update = (what: string) => get().postView("forecast", `${what} ${headline(get().demo, get().group)}`);
      return {
        ...fresh(),
        group: "pe",
        chatStart: { demo: initialState("C"), group: "pe" },
        postView: (kind, text) => get().addMessage({ role: "assistant", view: kind, text, snap: { demo: get().demo, group: get().group } }),
        audit: [],
        epoch: 0,
        auditSeen: 0,
        markAuditSeen: () => set({ auditSeen: get().audit.length }),
        seq: 0,
        msgSeq: 0,
        offline: false,
        advanced: false,
        model: "auto",
        sessionId: Math.random().toString(36).slice(2, 10),
        usage: { calls: 0, costUsd: 0 },
        lastBackend: null,
        drawerOpen: true,
        unseen: false,
        review: null,
        ruleNoThanks: [],
        declineReasons: {},

        setDailyOpen: (dailyOpen) => set({ dailyOpen }),
        setChartHidden: (chartHidden) => set({ chartHidden }),
        setDrawer: (drawerOpen) => set({ drawerOpen, unseen: drawerOpen ? false : get().unseen }),
        setReview: (review) => set({ review }),
        threads: [],
        threadTick: 0,
        openThread: (anchor) => set({ threads: get().threads.includes(anchor) ? get().threads : [...get().threads, anchor], threadTick: get().threadTick + 1 }),
        closeThread: (anchor) => {
          get().dismissAnchor(anchor);
          set({ threads: get().threads.filter((t) => t !== anchor) });
        },
        composerTick: 0,
        askAbout: (c) => {
          get().pin(c);
          set({ drawerOpen: true, unseen: false, composerTick: get().composerTick + 1 });
        },
        dismissAnchor: (anchor) => set({ messages: get().messages.map((m) => (m.anchor === anchor ? { ...m, dismissed: true } : m)) }),

        setOffline: (offline) => set({ offline }),
        setAdvanced: (advanced) => {
          const before = forecast(get().demo, "pe").p50;
          setAdvancedView(advanced);
          set({ advanced });
          const after = forecast(get().demo, "pe").p50;
          // Say why the forecast moved: the advanced view adds planned workstream work.
          if (before !== after && get().messages.length)
            get().postView("forecast", advanced
              ? `Advanced view adds planned workstream work, like the SOC 2 documentation sprint, so Platform Engineering now lands at ${"$" + (Math.round(after / 100) * 100).toLocaleString("en-US")}.`
              : `Default view leaves out planned workstream work, so Platform Engineering now lands at ${"$" + (Math.round(after / 100) * 100).toLocaleString("en-US")}.`);
        },
        setModel: (model) => set({ model }),
        addMessage: (m) => {
          // One question at a time: a held view is posted before anything that follows, so ignoring the question never
          // loses it or blocks anything.
          releaseHeld();
          const msgSeq = get().msgSeq + 1;
          const id = `m${msgSeq}`;
          set({ msgSeq, messages: [...get().messages, { ...m, id }], unseen: get().unseen || (!m.anchor && !get().drawerOpen) });
          return id;
        },
        patchMessage: (id, fn) => set({ messages: get().messages.map((m) => (m.id === id ? fn(m) : m)) }),
        noteRun: (e) => set({ lastBackend: e }),
        addUsage: (costUsd) => set({ usage: { calls: get().usage.calls + 1, costUsd: get().usage.costUsd + costUsd } }),

        // A new month. Saved rules carry over and act first; everything else starts fresh.
        setScenario: (id) => {
          const rules = get().demo.rules ?? [];
          const { state, applied, approved } = applyRulesAtStart({ ...initialState(id), rules });
          set({ ...fresh(id), demo: state, group: focusGroup(id), review: null, audit: [], auditSeen: 0, epoch: get().epoch + 1, seq: 0, threads: [], chatStart: { demo: state, group: focusGroup(id) } });
          applied.forEach((x) => log({ actor: "Your rule", action: "Applied by your rule", detail: x, evidenceTier: 1 }));
          approved.forEach((x) => log({ actor: "Your rule", action: "Approved by your rule", detail: x }));
          const done = [...applied, ...approved].map((x) => driverById(x)?.label).filter(Boolean);
          if (done.length)
            get().say({ role: "assistant", title: "Handled by your rules", text: `Your rules already handled ${done.length === 1 ? "one thing" : `${done.length} things`} this month: ${done.join("; ")}. ${done.length === 1 ? "It is" : "They are"} listed in Activity, under your rules.` });
        },
        setGroup: (group) => set({ group, ghost: null }),
        pin: (c) => set({ pinned: get().pinned.some((p) => p.id === c.id) ? get().pinned : [...get().pinned, c] }),
        unpin: (id) => set({ pinned: get().pinned.filter((p) => p.id !== id) }),
        say: (m) => {
          get().addMessage(m);
        },
        openArtifact: (a, where) => get().say({ role: "assistant", artifact: a, artifactStatus: "proposed", ...where }),
        setArtifactStatus: (artifactId, status) =>
          set({ messages: get().messages.map((m) => (m.artifact?.id === artifactId ? { ...m, artifactStatus: status } : m)) }),

        // The admin applies only their own changes. Fixes owned by someone else are sent to that owner.
        applyPolicy: (driverIds, artifactId) => {
          // A ticket drafted with the fix (same run) goes out with it: one approval, nothing left behind to send.
          const runOf = artifactId ? get().messages.find((m) => m.artifact?.id === artifactId)?.runOf : undefined;
          const tickets = runOf
            ? get().messages.map((m) => (m.runOf === runOf && m.artifact?.kind === "handoff" ? m.artifact : null))
              .filter((h): h is Handoff => !!h && driverIds.includes(h.driverId) && !ownerOf(h.driverId))
            : [];
          tickets.forEach((h) => get().sendHandoff(h.driverId));
          const d = get().demo;
          const mine = driverIds.filter((x) => !ownerOf(x));
          const theirs = driverIds.filter((x) => ownerOf(x));
          mutate({
            ...d,
            appliedFixes: Array.from(new Set([...d.appliedFixes, ...mine])),
            handedOff: Array.from(new Set([...(d.handedOff ?? []), ...theirs])),
          });
          if (artifactId) get().setArtifactStatus(artifactId, "applied");
          if (mine.length) log({ actor: "Admin", action: "Apply policy", detail: mine.join(", "), evidenceTier: 1 });
          theirs.forEach((x) => log({ actor: "Admin", action: `Sent fix to ${ownerOf(x)!.name}`, detail: x, evidenceTier: 1 }));
          const done = theirs.length ? (mine.length ? "Applied your changes and sent the rest to its owner." : "Sent to its owner.") : "Applied.";
          const ack = tickets.length ? `${done.replace(/\.$/, "")}, and sent the ticket to ${handoffTo(tickets[0])}.` : done;
          const rules = rulesFromApply(get().demo, mine, get().ruleNoThanks);
          // The rule offer sits with the change it is about; the updated forecast and next step stay at the bottom.
          if (!rules.length) return update(ack);
          // One question at a time: the new landing goes in this message, and the full forecast waits for the answer.
          const g = get().group;
          const f = forecast(get().demo, g);
          const lands = `${g === "all" ? "All teams now land" : `${GROUPS[g].name} now lands`} at ${usd100(f.p50)} against a ${usd(f.pool)} budget${f.p50 > f.pool ? `, ${usd100(f.p50 - f.pool)} over` : ""}.`;
          suggestRules(rules, `${ack} ${lands} ${rules.length > 1
            ? "You could apply changes like these yourself. Want a rule for next month?"
            : "You could apply this change yourself. Want a rule for next month?"}`, { decision: "applied" });
          const ruleMsg = get().messages.at(-1)!;
          get().patchMessage(ruleMsg.id, (x) => ({ ...x, held: { view: "forecast", text: headline(get().demo, g), snap: { demo: get().demo, group: g } } }));
        },
        sendHandoff: (driverId) => {
          const d = get().demo;
          if ((d.handedOff ?? []).includes(driverId)) return;
          mutate({ ...d, handedOff: [...(d.handedOff ?? []), driverId] });
          log({ actor: "Admin", action: `Sent hand-off to ${ownerOf(driverId)?.name ?? "Connector owner, Jira MCP"}`, detail: driverId, evidenceTier: 1 });
        },
        ownerShipped: (driverId) => {
          const d = get().demo;
          mutate({ ...d, appliedFixes: Array.from(new Set([...d.appliedFixes, driverId])) });
          log({ actor: ownerOf(driverId)?.name ?? "Owner", action: "Shipped fix", detail: driverId, evidenceTier: 1 });
          update(`${ownerOf(driverId)?.short ? ownerOf(driverId)!.short[0].toUpperCase() + ownerOf(driverId)!.short.slice(1) : "The owner"} shipped the fix.`);
        },
        declineRec: (driverId) => {
          const d = get().demo;
          if (isDeclined(d, driverId)) return;
          const label = driverById(driverId)?.label ?? driverId;
          // Drafts waiting for this recommendation are declined with it.
          const runs = new Set(get().messages.filter((m) => m.run?.driverId === driverId).map((m) => m.id));
          set({
            demo: { ...d, declined: [...(d.declined ?? []), driverId] },
            messages: get().messages.map((m) => (m.artifactStatus === "proposed" && m.runOf && runs.has(m.runOf) ? { ...m, artifactStatus: "declined" as const } : m)),
          });
          log({ actor: "Admin", action: "Declined recommendation", detail: driverId });
          update(`Declined: ${label}. It stays in the forecast and won't be suggested again this month.`);
          askWhy(driverId);
        },
        restoreRec: (driverId, quiet) => {
          const d = get().demo;
          // Undoing an in-place decline also drops the rule that decline saved, or the rule would keep it hidden.
          const label = driverById(driverId)?.label ?? driverId;
          const fromThis = quiet ? (d.rules ?? []).filter((r) => r.level === "skip" && r.basedOn?.includes(`"${label}"`)) : [];
          set({ demo: { ...d, declined: (d.declined ?? []).filter((x) => x !== driverId), rules: (d.rules ?? []).filter((r) => !fromThis.includes(r)) } });
          log({ actor: "Admin", action: "Restored recommendation", detail: driverId });
          fromThis.forEach((r) => log({ actor: "Admin", action: "Removed rule", detail: ruleSentence(r) }));
          if (quiet) { const { [driverId]: _gone, ...rest } = get().declineReasons; void _gone; set({ declineReasons: rest }); }
          if (!quiet) update(`Restored: ${label}.`);
        },
        declineInPlace: (driverId) => {
          const d = get().demo;
          if (isDeclined(d, driverId)) return;
          const runs = new Set(get().messages.filter((m) => m.run?.driverId === driverId).map((m) => m.id));
          set({
            demo: { ...d, declined: [...(d.declined ?? []), driverId] },
            messages: get().messages.map((m) => (m.artifactStatus === "proposed" && m.runOf && runs.has(m.runOf) ? { ...m, artifactStatus: "declined" as const } : m)),
          });
          log({ actor: "Admin", action: "Declined recommendation", detail: driverId });
        },
        giveDeclineReason: (driverId, reasonId) => {
          const reason = DECLINE_REASONS.find((r) => r.id === reasonId);
          if (!reason) return false;
          set({ declineReasons: { ...get().declineReasons, [driverId]: reasonId } });
          log({ actor: "Admin", action: "Gave a reason", detail: `${driverId}: ${reason.label}` });
          const t = topicOf(driverId);
          const g = driverById(driverId)?.groupId;
          if (!reason.lasting || !t || !g || ruleFor(get().demo, driverId) || get().ruleNoThanks.includes(`${t}:${g}`)) return false;
          const rule = ruleFromDecline(driverId, reason.label);
          if (!rule) return false;
          set({ demo: withRules(get().demo, [rule]) });
          log({ actor: "Admin", action: "Saved rule", detail: ruleSentence(rule) });
          return true;
        },
        settleDeclines: (driverIds, keep) => {
          const reasons = { ...get().declineReasons };
          const rules: PrefRule[] = [];
          for (const id of driverIds) {
            reasons[id] = keep ? "kept" : "later";
            const r = keep && !ruleFor(get().demo, id) ? ruleFromDecline(id, "") : null;
            if (r && !rules.some((x) => x.topic === r.topic && x.groupId === r.groupId)) rules.push(r);
          }
          set({ declineReasons: reasons, demo: rules.length ? withRules(get().demo, rules) : get().demo });
          rules.forEach((r) => log({ actor: "Admin", action: "Saved rule", detail: ruleSentence(r) }));
        },
        declineDraft: (artifactId) => {
          const m = get().messages.find((x) => x.artifact?.id === artifactId);
          if (!m?.artifact || m.artifactStatus !== "proposed") return;
          get().setArtifactStatus(artifactId, "declined");
          const name = DRAFT_NAME[m.artifact.kind] ?? "draft";
          const driverId = (m.runOf ? get().messages.find((x) => x.id === m.runOf)?.run?.driverId : undefined)
            ?? ("driverIds" in m.artifact ? (m.artifact.driverIds as string[])[0] : "driverId" in m.artifact ? (m.artifact.driverId as string) : undefined);
          log({ actor: "Admin", action: `Declined ${name}`, detail: driverId ?? name });
          get().say({ role: "assistant", text: `Declined the ${name}. Nothing changed.` });
          askWhy(driverId);
        },
        answerWhy: (messageId, reasonId) => {
          const m = get().messages.find((x) => x.id === messageId);
          const reason = DECLINE_REASONS.find((r) => r.id === reasonId);
          if (!m?.why || m.why.answer || !reason) return;
          get().patchMessage(messageId, (x) => ({ ...x, why: { ...x.why!, answer: reason.label } }));
          log({ actor: "Admin", action: "Gave a reason", detail: `${m.why.driverId}: ${reason.label}` });
          const rule = reason.lasting ? ruleFromDecline(m.why.driverId, reason.label) : null;
          const g = rule?.groupId;
          if (rule && !get().ruleNoThanks.includes(`${rule.topic}:${g}`))
            suggestRules([rule], "That sounds like it will hold next month too. Want me to keep it as a rule?", { decision: "declined", reason: reason.label });
          else if (!reason.lasting && "reply" in reason) get().say({ role: "assistant", text: reason.reply });
        },
        saveRules: (messageId, levels) => {
          const m = get().messages.find((x) => x.id === messageId);
          if (!m?.rules || m.rulesStatus !== "proposed") return;
          const rules = m.rules.map((r, i) => ({ ...r, level: levels[i] ?? r.level, createdAt: new Date().toISOString() }));
          // A rule that stops suggestions applies now; the others start with next month.
          set({ demo: withRules(get().demo, rules) });
          get().patchMessage(messageId, (x) => ({ ...x, rules, rulesStatus: "saved" }));
          rules.forEach((r) => log({ actor: "Admin", action: "Saved rule", detail: ruleSentence(r) }));
          releaseHeld();
          // The confirmation shows in the rule's own card (Rules.tsx), not as a new message at the bottom: the forecast
          // between the rule and the bottom hasn't been read yet, and a new message would scroll past it.
        },
        dismissRules: (messageId) => {
          const m = get().messages.find((x) => x.id === messageId);
          if (!m?.rules || m.rulesStatus !== "proposed") return;
          get().patchMessage(messageId, (x) => ({ ...x, rulesStatus: "dismissed" }));
          set({ ruleNoThanks: [...get().ruleNoThanks, ...m.rules.map((r) => `${r.topic}:${r.groupId}`)] });
          releaseHeld();
        },
        setRuleLevel: (ruleId, level) => {
          const r = (get().demo.rules ?? []).find((x) => x.id === ruleId);
          if (!r || r.level === level) return;
          set({ demo: withRules(get().demo, [{ ...r, level }]) });
          log({ actor: "Admin", action: "Changed rule", detail: ruleSentence({ ...r, level }) });
        },
        removeRule: (ruleId) => {
          const r = (get().demo.rules ?? []).find((x) => x.id === ruleId);
          if (!r) return;
          set({ demo: { ...get().demo, rules: (get().demo.rules ?? []).filter((x) => x.id !== ruleId) } });
          log({ actor: "Admin", action: "Removed rule", detail: ruleSentence(r) });
        },
        undoPolicy: (driverIds, artifactId) => {
          const d = get().demo;
          const mine = driverIds.filter((x) => !ownerOf(x));
          mutate({ ...d, appliedFixes: d.appliedFixes.filter((x) => !mine.includes(x)) });
          if (artifactId) get().setArtifactStatus(artifactId, "reverted");
          log({ actor: "Admin", action: "Revert policy", detail: driverIds.join(", "), evidenceTier: 1 });
          update("Undone.");
        },
        applyRebalance: (artifactId) => {
          mutate({ ...get().demo, rebalanceApplied: true });
          if (artifactId) get().setArtifactStatus(artifactId, "applied");
          log({ actor: "Admin", action: "Apply rebalance", detail: `Sharing level ${get().demo.sharingLevel}`, evidenceTier: 2 });
          update("Rebalanced.");
        },
        confirmOverride: (driverId, reasonCode, fundingPath, artifactId) => {
          const d = get().demo;
          mutate({ ...d, overrides: Array.from(new Set([...d.overrides, driverId])) });
          if (artifactId) get().setArtifactStatus(artifactId, "confirmed");
          log({ actor: "Admin", action: "Approved as planned spend", detail: driverId, evidenceTier: 4, reasonCode, fundingPath });
          update("Approved as planned spend.");
        },
        approveRevision: (g, newBudget, artifactId) => {
          const d = get().demo;
          mutate({ ...d, budgetRevisions: { ...d.budgetRevisions, [g]: newBudget } });
          if (artifactId) get().setArtifactStatus(artifactId, "approved");
          log({ actor: "Budget owner", action: "Approved budget increase", detail: `${g} budget to $${newBudget.toLocaleString("en-US")}`, fundingPath: "Budget owner brief" });
          // What the month came to follows as the recap (Chat posts it once nothing is left open).
          get().postView("forecast", `Budget raised to $${newBudget.toLocaleString("en-US")}.`);
        },
        setSharing: (level) => {
          set({ demo: { ...get().demo, sharingLevel: level } });
          log({ actor: "Admin", action: "Sharing level", detail: level });
        },
        setToggle: (key, value) => {
          set({ demo: { ...get().demo, [key]: value } });
          log({ actor: "System", action: key === "tier3Arrived" ? "30-day code survival data" : "Jira outcomes import", detail: value ? "arrived" : "removed" });
        },
        setHurdle: (g, value) => {
          set({ demo: { ...get().demo, hurdleOverrides: { ...get().demo.hurdleOverrides, [g]: value } } });
          log({ actor: "Budget owner", action: "Minimum return to fund", detail: `${g} to ${value.toFixed(2)}x` });
        },
        // Restart the current scenario from its starting numbers.
        newChat: () => {
          if (!get().messages.length) return;
          set({ pastChats: saveCurrent(), currentChatId: null, messages: [], review: null, chatStart: { demo: get().demo, group: get().group } });
        },
        openPastChat: (id) => {
          if (id === get().currentChatId) return;
          const list = saveCurrent();
          const target = list.find((c) => c.id === id);
          if (!target) return;
          set({ pastChats: list, currentChatId: id, messages: target.messages, chatStart: target.start ?? get().chatStart, review: null });
        },
        reset: () => {
          const id = get().demo.scenarioId;
          set({ ...fresh(id), ruleNoThanks: [], declineReasons: {}, chartHidden: null, group: focusGroup(id), audit: [], auditSeen: 0, epoch: get().epoch + 1, seq: 0, threads: [], review: null, ghost: null, chatStart: { demo: initialState(id), group: focusGroup(id) } });
        },
      };
    },
    {
      name: "csi-demo-v7",
      version: 7,
      // A run can't survive a reload (its stream is gone), so the saved copy says it was interrupted. Otherwise a
      // reload mid-run would leave it "running" forever and disable every button.
      partialize: (s) => ({
        ...s,
        review: null,
        // Which backend the last run used is only true for this visit: a saved one would show Offline after a key is added.
        lastBackend: null,
        messages: interrupted(s.messages),
      }),
      // Saves written before that rule (or mid-write) are fixed up on load too.
      onRehydrateStorage: () => (state) => {
        setAdvancedView(state?.advanced ?? false);
        if (state?.messages.some((m) => m.run?.status === "running")) useStore.setState({ messages: interrupted(state.messages) });
      },
    },
  ),
);

/** Helpers that build artifacts from the current state (used by Fix/Fund buttons now, by agents later). */
export const artifactFor = {
  policy: (driverIds?: string[]) => {
    const s = useStore.getState();
    return draftPolicyDiff(s.demo, "pe", driverIds);
  },
  rebalance: () => draftRebalance(useStore.getState().demo, "pe"),
  override: (driverId?: string) => draftOverride(useStore.getState().demo, "pe", driverId),
  brief: () => draftCfoBrief(useStore.getState().demo, "pe"),
};
