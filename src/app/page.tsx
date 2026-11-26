"use client";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatApp } from "@/components/Chat";
import { Tour, tourSeen } from "@/components/Tour";
import { DemoGuide } from "@/components/DemoGuide";
import { useNew } from "@/components/NewDot";
import { useStore } from "@/state/store";
import { Situations } from "@/components/Sidebar";
import { useUi } from "@/state/ui";

export default function Home() {
  // State persists in the browser, so render after hydration to avoid server/client mismatch.
  const [ready, setReady] = useState(false);
  const [activity, setActivity] = useState(false);
  const { tour, situations, set } = useUi();
  const setTour = (v: boolean) => set({ tour: v });
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    // Debug: ?first replays the first visit (the tour, new-feature dots, a fresh month), then drops itself from the URL so a
    // reload keeps your progress. Offline replay is left as it is.
    const url = new URL(location.href);
    if (url.searchParams.has("first")) {
      useNew.getState().reset();
      try { localStorage.removeItem("csi-tour-done"); } catch {}
      const st = useStore.getState();
      if (st.demo.scenarioId !== "C") st.setScenario("C");
      st.reset();
      useStore.setState({ pastChats: [], currentChatId: null, messages: [] });
      url.searchParams.delete("first");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    setReady(true);
    if (!tourSeen()) set({ tour: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A quiet outline of the page while saved state loads, instead of a blank screen.
  if (!ready)
    return (
      <div className="flex h-screen bg-canvas" aria-busy="true">
        <div className="hidden w-[60px] shrink-0 border-r-[0.5px] border-black/10 bg-sidebar px-4 pt-4 sm:block lg:w-[288px]">
          <div className="hidden font-serif text-[19px] text-ink lg:block">Spend Intelligence</div>
        </div>
        <div className="mx-auto w-full max-w-[816px] animate-pulse space-y-4 px-6 pt-8">
          <div className="h-4 w-48 rounded bg-black/5" />
          <div className="h-10 w-3/4 rounded bg-black/5" />
          <div className="h-72 rounded-xl bg-black/[0.04]" />
        </div>
      </div>
    );
  return (
    <div className="flex h-screen flex-col bg-canvas sm:flex-row">
      <Sidebar onTour={() => setTour(true)} onActivity={() => setActivity(true)} onGuide={() => setGuide(true)} />
      <ChatApp activityOpen={activity} setActivityOpen={setActivity} />
      {tour && <Tour onClose={() => setTour(false)} />}
      {guide && <DemoGuide onClose={() => setGuide(false)} />}
      {situations && <Situations />}
    </div>
  );
}
