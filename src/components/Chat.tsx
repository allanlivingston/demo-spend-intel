"use client";
// Chat-first: one conversation that only moves forward. Claude opens with a briefing (forecast + recommendations).
// Everything after appends below. Views (forecast, recommendations) can be posted again at the bottom; only the
// newest copy of each is live, older copies render from the state they were posted with, so they match their text.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { headline } from "@/engine";
import { dropEarlyRun, keepEarlyRun, runKey, startEarlyRun, startAgentRun } from "@/state/agentClient";
import { chipsFor, stepOpen, type ChipSpec } from "@/state/chipRules";
import { nextAction } from "@/state/nextAction";
import { useStore, type ChatMessage, type Snapshot, type ViewKind } from "@/state/store";
import { useUi } from "@/state/ui";
import { anythingDone, recapOf, shouldRecap } from "@/state/recap";
import { AgentRunCard } from "./AgentRunCard";
import { Activity } from "./Details";
import { RuleSuggestion, WhyAsk } from "./Rules";
import { glide, glideTo } from "./glide";
import { SmoothHeight, useJustNow } from "./motion";
import { ask, busyOf, typed } from "./chatShared";
import { ForecastView } from "./ForecastView";
import { Headline, Draft, RecapCard } from "./Drafts";
import { Composer } from "./Composer";

/** Money decisions an auditor or budget owner will ask about open in a full-page review. */

/** How long the page has to sit still before the likely next step starts early. */
const EARLY_RUN_DELAY_MS = 2_000;


function View({ snap, live, id }: { kind?: ViewKind; snap: Snapshot; live: boolean; id?: string }) {
  return <ForecastView snap={snap} live={live} id={id} />;
}

// ---------- Conversation ----------

/** A draft grows open when it arrives now (not on reload) and folds smoothly when approved. */
function DraftBox({ x, all }: { x: ChatMessage; all: ChatMessage[] }) {
  const justNow = useJustNow();
  return <SmoothHeight enter={justNow}><Draft x={x} all={all} /></SmoothHeight>;
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
  const shown = messages.filter((m) => !m.runOf && !m.dismissed); // A retried run's failed card goes away.
  const scroller = useRef<HTMLDivElement>(null);

  // The newest copy of each view is the live one; the briefing's copies are live until a newer one is posted.
  // Only the newest forecast copy is live; the briefing's copy is live until another is posted.
  const lastView = [...messages].reverse().find((m) => m.view)?.id;
  const liveIds = new Set(lastView ? [lastView] : []);
  const briefingLive = !lastView;

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
  const justDeclined = useStore((s) => s.justDeclined);
  const hasStep = stepOpen(demo, group, messages, justDeclined);
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
  const follow = useRef<string | null>(null);
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
    // A typed question moves to the top, like claude.ai. A question from a click (a card's Ask, a chip) scrolls only
    // as far as needed to show it and the start of its answer, so the cards it came from stay in view when they fit.
    const wasTyped = target === user && Date.now() - typed.at < 2_000;
    follow.current = target === user && !wasTyped ? user.id : null;
    const ANSWER_ROOM = 220;
    const aim = () => {
      const firstLine = el.scrollTop + msg.getBoundingClientRect().top - el.getBoundingClientRect().top - 24;
      if (target !== user) return Math.min(firstLine, el.scrollHeight - el.clientHeight);
      if (wasTyped) return firstLine;
      const needed = el.scrollTop + msg.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + ANSWER_ROOM;
      return Math.min(firstLine, Math.max(el.scrollTop, needed));
    };
    // Wait for folds above (an approved draft shrinking) to finish first: gliding while they run chases a target that
    // keeps moving up, so the page glides down and then back up (a bounce). Up to about 0.7 seconds.
    let h = -1, frames = 0;
    const whenStill = () => {
      if (el.scrollHeight === h || frames++ > 40) { glide(el, aim); return; }
      h = el.scrollHeight;
      requestAnimationFrame(whenStill);
    };
    requestAnimationFrame(whenStill);
    // A card folding on screen (an approved draft) can finish after the scroll has landed and leave the reply's first
    // line above the screen. Once folds have settled, bring it back into view.
    const settle = setTimeout(() => {
      if (msg.isConnected && msg.getBoundingClientRect().top < el.getBoundingClientRect().top) glide(el, aim);
    }, 900);
    return () => clearTimeout(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);
  // After a clicked question, follow its answer as it streams in: scroll only when new text would be cut off at the
  // bottom, and never so far that the question leaves the top. A typed question is already at the top.
  useEffect(() => {
    const sc = scroller.current, list = floorRef.current;
    if (!sc || !list) return;
    let stop: (() => void) | null = null;
    const ro = new ResizeObserver(() => {
      const qid = follow.current;
      const lastId = shown.at(-1)?.id;
      const q = qid ? document.getElementById(`msg-${qid}`) : null;
      const last = lastId ? document.getElementById(`msg-${lastId}`) : null;
      if (!q || !last) return;
      const box = sc.getBoundingClientRect();
      const cut = last.getBoundingClientRect().bottom + 16 - box.bottom + 120; // 120: clear of the message box
      if (cut <= 0) return;
      const ceiling = sc.scrollTop + q.getBoundingClientRect().top - box.top - 24;
      stop?.();
      stop = glide(sc, () => Math.min(ceiling, sc.scrollTop + Math.max(0, last.getBoundingClientRect().bottom + 16 - box.bottom + 120)));
    });
    [...list.children].forEach((c) => ro.observe(c));
    return () => { ro.disconnect(); stop?.(); };
  }, [shown]);
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
            {/* Once the chat starts, this is how things stood then; the newest forecast below is the live one. */}
            {/* Always live: it updates after a fix and follows the team picked. Earlier figures stay in the chat history. */}
            <Headline key={group} text={headline(demo, group)} />
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

