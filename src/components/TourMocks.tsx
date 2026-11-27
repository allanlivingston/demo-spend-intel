"use client";
// Still example screens for the tour steps whose subject may not be on screen yet. Labels come from the engine.
import type { ReactNode } from "react";
import { ArrowRight, BookmarkCheck } from "lucide-react";
import { SCENARIOS } from "@/engine";
import { cx } from "./ui";

export type MockKind = "rules" | "slowed" | "composer";

const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx("rounded-lg border border-neutral-200 bg-white p-2.5", className)}>{children}</div>
);

const Pick = ({ children, on }: { children: ReactNode; on?: boolean }) => (
  <span className={cx("rounded-full border px-2 py-0.5 text-[12px]", on ? "border-accent bg-accent/10 text-accent-ink" : "border-neutral-300 text-neutral-600")}>{children}</span>
);

const Claude = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-1.5"><div className="font-serif text-[14px] leading-[19px]">{children}</div></div>
);

/** The starting month of the default situation, as the engine computes it. */
function month() {
  const drivers = SCENARIOS.C.drivers;
  return { loop: drivers[0], sub: drivers[1] };
}
type Month = ReturnType<typeof month>;

export function TourMock({ kind }: { kind: MockKind }) {
  return (
    <div className="relative mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 pt-5">
      <span className="absolute right-2 top-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">Example</span>
      {BODY[kind](month())}
    </div>
  );
}

const BODY: Record<MockKind, (m: Month) => ReactNode> = {
  rules: (m) => {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span>Declined <b className="font-medium text-ink">{m.sub.plain ?? m.sub.label}</b> · Why?</span>
          <Pick on>Team needs it</Pick><Pick>Planned</Pick><Pick>Not now</Pick>
          <span className="ml-auto font-medium text-ink">Undo</span>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-muted"><ArrowRight size={12} />Won&apos;t suggest this for Platform Engineering again.</div>
        <div className="flex items-center gap-1.5 text-[12px] text-muted"><BookmarkCheck size={13} className="text-ok-ink" />Saved rules are listed in Activity, where you can change them.</div>
      </div>
    );
  },
  slowed: () => (
    <div className="space-y-1.5 text-[12px]">
      {[
        ["Heavy Opus use", "Some work moves to Sonnet", "text-warn-ink"],
        ["Overnight batch jobs", "Wait a few hours", "text-warn-ink"],
        ["Everyone else", "Not affected", "text-ok-ink"],
      ].map(([who, what, tone]) => (
        <Card key={who} className="flex py-1.5"><span>{who}</span><span className={cx("ml-auto font-medium", tone)}>{what}</span></Card>
      ))}
      <div className="text-center text-[12px] font-medium text-ok-ink">Nobody is locked out</div>
    </div>
  ),
  composer: (m) => (
    <div className="flex flex-col gap-2">
      <div className="ml-auto w-fit rounded-lg bg-black/5 px-2.5 py-1 text-[13px]">Why did spend jump on day {m.loop.startDay}?</div>
      <Claude>The Jira link started retrying a broken call: {(m.loop.plainEvidence ?? m.loop.evidence).slice(0, 2).join(", ")}.</Claude>
      <div className="flex gap-1.5"><Pick on>Fix all the waste</Pick><Pick>Why are we over budget?</Pick></div>
    </div>
  ),
};
