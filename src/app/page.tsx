"use client";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatApp } from "@/components/Chat";
import { ReviewScreen } from "@/components/ReviewScreen";
import { Tour, tourSeen } from "@/components/Tour";
import { DemoGuide } from "@/components/DemoGuide";

export default function Home() {
  // State persists in the browser, so render after hydration to avoid server/client mismatch.
  const [ready, setReady] = useState(false);
  const [activity, setActivity] = useState(false);
  const [tour, setTour] = useState(false);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    setReady(true);
    if (!tourSeen()) setTour(true);
  }, []);
  // A quiet outline of the page while saved state loads, instead of a blank screen.
  if (!ready)
    return (
      <div className="flex h-screen bg-canvas" aria-busy="true">
        <div className="w-[60px] shrink-0 border-r-[0.5px] border-black/10 bg-sidebar px-4 pt-4 lg:w-[288px]">
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
    <div className="flex h-screen bg-canvas">
      <Sidebar onTour={() => setTour(true)} onActivity={() => setActivity(true)} onGuide={() => setGuide(true)} />
      <ChatApp activityOpen={activity} setActivityOpen={setActivity} />
      <ReviewScreen />
      {tour && <Tour onClose={() => setTour(false)} />}
      {guide && <DemoGuide onClose={() => setGuide(false)} />}
    </div>
  );
}
