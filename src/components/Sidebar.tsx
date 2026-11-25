"use client";
// Left navigation, Claude-style: app name and menu, New chat, Reset demo, past chats, and the admin at the bottom.
import { useEffect, useRef, useState } from "react";
import { CircleHelp, Compass, History, MoreHorizontal, PanelLeft, Plus, RotateCcw } from "lucide-react";
import type { ScenarioId } from "@/engine";
import { chatTitle, useStore } from "@/state/store";
import { cx } from "./ui";

const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: "C", label: "Waste and new work", hint: "Fix the waste, then fund the new engineers" },
  { id: "baseline", label: "Normal month", hint: "Every team on budget" },
  { id: "A", label: "Agents wasting spend", hint: "Waste a per-person limit would miss: fix it" },
  { id: "B", label: "New engineers ramping", hint: "New work producing results: fund it" },
];

/** The ··· menu: scenario, offline replay and what the agents have cost this session. */
function DemoMenu() {
  const { demo, setScenario, offline, setOffline, advanced, setAdvanced, lastBackend, usage } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const live = !offline && lastBackend?.backend !== "replay";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="Demo options" className="rounded-md p-1.5 text-muted hover:bg-black/5 hover:text-ink">
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
          <div className="px-2 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Scenario</div>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setScenario(s.id); setOpen(false); }}
              className={cx("flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-neutral-50", s.id === demo.scenarioId && "bg-orange-50")}
            >
              <span className="text-[15px] font-medium">{s.label}</span>
              <span className="text-[13px] text-muted">{s.hint}</span>
            </button>
          ))}
          <div className="my-2 border-t border-neutral-100" />
          <label className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[15px] hover:bg-neutral-50">
            <span>
              Advanced view
              <span className="block text-[13px] text-muted">{advanced ? "Workstreams, Health and activity. Includes planned workstream work, like a SOC 2 sprint, so forecasts can be higher." : "Default view: forecast, users and agents"}</span>
            </span>
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} className="accent-[#D97757]" />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[15px] hover:bg-neutral-50">
            <span>
              Offline replay
              <span className="block text-[13px] text-muted">{live ? "Agents run live on Claude" : "Agents replay recorded runs"}</span>
            </span>
            <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} className="accent-[#D97757]" />
          </label>
          <div className="px-2 py-1 text-[13px] text-muted">
            {usage.calls} agent {usage.calls === 1 ? "run" : "runs"} this session, ${usage.costUsd.toFixed(2)} · v{process.env.NEXT_PUBLIC_APP_VERSION}
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({ icon, label, onClick, collapsed, title }: { icon: React.ReactNode; label: string; onClick: () => void; collapsed: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : title}
      className={cx("flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[15px] font-[450] text-ink hover:bg-black/5", collapsed && "justify-center px-0")}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

export function Sidebar({ onTour, onActivity, onGuide }: { onTour: () => void; onActivity: () => void; onGuide: () => void }) {
  const { newChat, reset, pastChats, openPastChat, audit, messages, currentChatId } = useStore();
  // The open conversation is always listed (with a live title), highlighted, even before it is first saved.
  const chats = currentChatId ? pastChats : [{ id: "current", title: "New chat", messages }, ...pastChats];
  const openId = currentChatId ?? "current";
  // Like claude.ai: open by default; the panel icon collapses it to a rail; hovering the rail opens it over the page
  // for a moment; clicking the logo (or the panel icon while collapsed) keeps it open.
  const [pinned, setPinnedState] = useState(true);
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(PIN_KEY) === "0") setPinnedState(false); } catch {}
  }, []);
  const setPinned = (v: boolean) => {
    setPinnedState(v);
    setPeek(false);
    try { localStorage.setItem(PIN_KEY, v ? "1" : "0"); } catch {}
  };
  const collapsed = !pinned && !peek;
  return (
    <aside id="sidebar" className={cx("relative h-full shrink-0 transition-[width] duration-200", pinned ? "w-[288px]" : "w-[60px]")}>
     <div
      onMouseEnter={() => !pinned && setPeek(true)}
      onMouseLeave={() => setPeek(false)}
      className={cx("absolute inset-y-0 left-0 z-30 flex flex-col border-r-[0.5px] border-black/10 bg-sidebar transition-[width,box-shadow] duration-200",
        collapsed ? "w-[60px]" : "w-[288px]", peek && !pinned && "shadow-xl")}
    >
      <div className={cx("flex items-center gap-2 px-3 pb-4 pt-3", collapsed && "flex-col")}>
        {collapsed ? (
          <button type="button" onClick={() => setPinned(true)} aria-label="Expand sidebar" title="Expand sidebar" className="rounded-md p-1.5 hover:bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="h-[18px] w-[18px]" />
          </button>
        ) : (
          <>
            <button type="button" onClick={() => setPinned(!pinned)} aria-label={pinned ? "Collapse sidebar" : "Keep sidebar open"} title={pinned ? "Collapse sidebar" : "Keep sidebar open"} className="rounded-md p-1.5 text-muted hover:bg-black/5 hover:text-ink">
              <PanelLeft size={18} />
            </button>
            <button type="button" onClick={() => setPinned(true)} title={pinned ? undefined : "Keep sidebar open"} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span className="truncate font-serif text-[19px]">Spend Intelligence</span>
            </button>
            <DemoMenu />
          </>
        )}
      </div>

      <nav className="space-y-0.5 px-2">
        <NavItem icon={<Plus size={16} className="text-ink" />} label="New chat" onClick={newChat} collapsed={collapsed} title="Start a new conversation. Approved changes stay." />
        <NavItem icon={<RotateCcw size={16} className="text-ink" />} label="Reset demo" onClick={reset} collapsed={collapsed} title="Restart this scenario from its starting numbers" />
        <NavItem icon={<Compass size={16} className="text-ink" />} label="Run the welcome wizard" onClick={onTour} collapsed={collapsed} title="A short walkthrough of the screen" />
        <NavItem icon={<CircleHelp size={16} className="text-ink" />} label="Ask about this demo" onClick={onGuide} collapsed={collapsed} title="Why it's built this way: the problem, workflows, layout and nav choices" />
      </nav>

      {!collapsed && (chats.length > 1 || messages.length > 0 || pastChats.length > 0) && (
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-2">
          <div className="px-2.5 pb-1 text-[14px] font-[520] leading-5 text-muted">Chats</div>
          {chats.map((c) => {
            const open = c.id === openId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openPastChat(c.id)}
                aria-current={open ? "page" : undefined}
                className={cx("flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[15px] text-ink hover:bg-black/5", open && "bg-black/[0.06]")}
              >
                <span className="truncate">{open && messages.length ? chatTitle(messages) : c.title}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className={cx("mt-auto flex items-center gap-2 px-3 py-3", collapsed && "flex-col")}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-300 text-[13px] font-semibold">A</span>
        {!collapsed && (
          <span className="flex-1 truncate text-[15px]">
            <span className="font-[450]">Admin</span> <span className="text-muted">· Enterprise</span>
          </span>
        )}
        <ConnectionDot collapsed={collapsed} />
        <button type="button" onClick={onActivity} title="Activity: everything approved or sent" className="relative rounded-md p-1.5 text-muted hover:bg-black/5 hover:text-ink">
          <History size={17} />
          {audit.length > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 text-[9px] font-semibold text-white">{audit.length}</span>}
        </button>
      </div>
     </div>
    </aside>
  );
}

const PIN_KEY = "si-sidebar-pinned";

/** Why the last answer was replayed, in plain words. */
const why = (reason?: string) => {
  if (!reason) return "";
  const fig = reason.match(/Grounding check failed \((.*)\)/);
  if (fig) return `: it stated a figure the app couldn't check (${fig[1]})`;
  if (/Timed out/i.test(reason)) return ": Claude took too long";
  return ": Claude couldn't be reached";
};

/** Subtle live/offline marker: live only when Offline replay is off, the server can reach Claude, and the last run didn't fall back
 *  (then "Replayed": still live, only that answer was replayed). */
function ConnectionDot({ collapsed }: { collapsed: boolean }) {
  const { offline, lastBackend } = useStore();
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/usage").then((r) => r.json()).then((d) => setServer(d.backend ?? null)).catch(() => setServer("replay"));
  }, []);
  if (server === null) return null;
  const fellBack = lastBackend?.backend === "replay" && !offline && server !== "replay";
  const live = !offline && server !== "replay" && !fellBack;
  const title = live ? "Live: agents run on Claude"
    : offline ? "Offline: Offline replay is on in the ··· menu. Recorded runs replay; every number is still computed live."
    : fellBack ? `Live, but the last answer was replayed${why(lastBackend?.replayReason)}. The next question runs live again; every number is still computed live.`
    : "Offline: no Claude connection on this server. Recorded runs replay; every number is still computed live.";
  return (
    <span title={title} className="flex shrink-0 items-center gap-1 text-[12px] text-muted">
      <span className={cx("h-1.5 w-1.5 rounded-full", live ? "bg-emerald-500" : fellBack ? "bg-amber-400" : "bg-neutral-400")} />
      {!collapsed && (live ? "Live" : fellBack ? "Replayed" : "Offline")}
    </span>
  );
}
