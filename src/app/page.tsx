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
  if (!ready) return <div className="min-h-screen bg-canvas" />;
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
