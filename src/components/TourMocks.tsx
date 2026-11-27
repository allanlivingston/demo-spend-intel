"use client";
// Still example screens for the tour steps whose subject may not be on screen yet. Labels come from the engine.
import type { ReactNode } from "react";
import { ArrowRight, BookmarkCheck } from "lucide-react";
import { LEVELS, ruleSentence, SCENARIOS } from "@/engine";
import { cx } from "./ui";

export type MockKind = "rules" | "slowed" | "composer";

/** A button in an example screen; "on" marks the one to press. */
const Btn = ({ children, on, dark }: { children: ReactNode; on?: boolean; dark?: boolean }) => (
  <span className={cx("inline-flex items-center rounded-md px-2 py-1 text-[12px] font-medium", dark ? "bg-ink text-white" : "text-muted", on && "ring-2 ring-accent ring-offset-1")}>{children}</span>
);

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
    const rule = { topic: "model" as const, groupId: "pe" as const, level: "skip" as const };
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span>Declined <b className="font-medium text-ink">{m.sub.label}</b></span>
          <ArrowRight size={12} />
          <span>Why?</span>
          <Pick on>The team needs it</Pick>
        </div>
        <Card>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-accent-ink">Suggested rule</div>
          <div className="mt-0.5 text-[13px] font-medium leading-snug">{ruleSentence(rule)}</div>
          <div className="mt-1.5 flex items-center gap-1 text-[11px]">
            <span className="text-muted">{LEVELS.ask.label}</span><span className="rounded bg-white px-1.5 py-0.5 font-medium shadow-sm ring-1 ring-neutral-200">{LEVELS.skip.label}</span>
            <span className="ml-auto"><Btn dark on>Save rule</Btn></span>
          </div>
        </Card>
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
      <Claude>The Jira MCP connector started retrying a broken call: {m.loop.evidence[0]}, {m.loop.evidence[1]}.</Claude>
      <div className="flex gap-1.5"><Pick on>Fix the connector loop</Pick><Pick>What else is driving it?</Pick></div>
    </div>
  ),
};
