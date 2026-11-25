"use client";
// Client store. Engine inputs (DemoState) plus UI state. Persisted per browser; Reset demo clears it.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ownerOf, headline,
  setAdvancedView, storySummary, draftCfoBrief, draftOverride, draftPolicyDiff, draftRebalance, forecast, initialState,
  type Artifact, type DayPoint, type DemoState, type GroupId, type GroupSelection, type ScenarioId, type SharingLevel, isDeclined, driverById,
  handoffTo, type Handoff,
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
  /** The state when this message was posted. Older copies render from it, so they match the text around them. */
  snap?: Snapshot;
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
  restoreRec: (driverId: string) => void;
  /** Decline a draft: nothing changes, and it is logged. */
  declineDraft: (artifactId: string) => void;
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
  return messages.find((m) => m.role === "user")?.text ?? "Conversation";
}

const fresh = (scenario: ScenarioId = "C") => ({
  demo: initialState(scenario),
  pinned: [] as PinnedContext[],
  messages: [] as ChatMessage[],
  ghost: null as DayPoint[] | null,
  dailyOpen: false,
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
      /** After any approved change: say what it did and show the updated forecast, at the bottom. */
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

        setDailyOpen: (dailyOpen) => set({ dailyOpen }),
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
          const msgSeq = get().msgSeq + 1;
          const id = `m${msgSeq}`;
          set({ msgSeq, messages: [...get().messages, { ...m, id }], unseen: get().unseen || (!m.anchor && !get().drawerOpen) });
          return id;
        },
        patchMessage: (id, fn) => set({ messages: get().messages.map((m) => (m.id === id ? fn(m) : m)) }),
        noteRun: (e) => set({ lastBackend: e }),
        addUsage: (costUsd) => set({ usage: { calls: get().usage.calls + 1, costUsd: get().usage.costUsd + costUsd } }),

        setScenario: (id) => {
          set({ ...fresh(id), group: focusGroup(id), review: null, audit: [], auditSeen: 0, epoch: get().epoch + 1, seq: 0, threads: [], chatStart: { demo: initialState(id), group: focusGroup(id) } });
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
          update(tickets.length ? `${done.replace(/\.$/, "")}, and sent the ticket to ${handoffTo(tickets[0])}.` : done);
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
          update(`Declined: ${label}. It stays in the forecast and won't be suggested again.`);
        },
        restoreRec: (driverId) => {
          const d = get().demo;
          set({ demo: { ...d, declined: (d.declined ?? []).filter((x) => x !== driverId) } });
          log({ actor: "Admin", action: "Restored recommendation", detail: driverId });
          update(`Restored: ${driverById(driverId)?.label ?? driverId}.`);
        },
        declineDraft: (artifactId) => {
          const m = get().messages.find((x) => x.artifact?.id === artifactId);
          if (!m?.artifact || m.artifactStatus !== "proposed") return;
          get().setArtifactStatus(artifactId, "declined");
          const name = DRAFT_NAME[m.artifact.kind] ?? "draft";
          log({ actor: "Admin", action: `Declined ${name}`, detail: m.runOf ? get().messages.find((x) => x.id === m.runOf)?.run?.driverId ?? name : name });
          get().say({ role: "assistant", text: `Declined the ${name}. Nothing changed.` });
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
          get().postView("forecast", storySummary(get().demo, g));
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
          set({ ...fresh(id), group: focusGroup(id), audit: [], auditSeen: 0, epoch: get().epoch + 1, seq: 0, threads: [], review: null, ghost: null, chatStart: { demo: initialState(id), group: focusGroup(id) } });
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
