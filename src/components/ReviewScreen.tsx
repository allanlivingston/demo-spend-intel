"use client";
import { useEffect } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { forecast } from "@/engine";
import { AGENT_LABEL } from "@/state/agentClient";
import { useStore } from "@/state/store";
import { ArtifactCard } from "./Artifacts";
import { StatusPill, usd } from "./ui";

/** Plan, then apply: a focused page for the decisions Finance and auditors will ask about. */
export function ReviewScreen() {
  const { review, setReview, messages, demo, group } = useStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setReview(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setReview]);
  if (!review) return null;
  const art = messages.find((m) => m.artifact?.id === review);
  if (!art?.artifact) return null;
  const run = messages.find((m) => m.id === art.runOf)?.run;
  const text = messages.find((m) => m.id === art.runOf)?.text;
  const f = forecast(demo, group === "all" ? "pe" : group);
  const done = art.artifactStatus === "approved" || art.artifactStatus === "confirmed";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-card px-6 py-3">
        <button type="button" onClick={() => setReview(null)} className="flex items-center gap-1.5 text-[15px] text-muted hover:text-ink">
          <ArrowLeft size={15} /> Back to chat
        </button>
        <span className="text-[15px] font-semibold">Review before approving</span>
        {done && <span className="ml-auto flex items-center gap-1 text-[15px] text-ok"><CheckCircle2 size={15} /> Approved and recorded in Activity</span>}
      </header>
      <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-2 gap-8 overflow-y-auto px-6 py-6">
        <section className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Why: {run ? AGENT_LABEL[run.agent] : "Agent"}</h2>
          {text && <p className="font-serif text-[17px] leading-[26px]">{text.replace(/\s*Review the [^.]+ below\.?$/, "")}</p>}
          {run && (
            <ol className="space-y-2">
              {run.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-[15px]">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />
                  <span><span className="font-medium">{s.phase}</span><span className="block text-neutral-600">{s.summary}</span></span>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-black/10 bg-card px-4 py-3 text-[15px]">
            <span className="whitespace-nowrap text-muted">Platform Engineering now</span>
            <span className="font-semibold tabular-nums">{usd(f.p50)}</span>
            <span className="whitespace-nowrap text-muted">of {usd(f.pool)}</span>
            <StatusPill status={f.status} funded={f.fundedVariance} />
          </div>
        </section>
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">The change</h2>
          <ArtifactCard a={art.artifact} status={art.artifactStatus} />
          {done && (
            <button type="button" onClick={() => setReview(null)} className="w-full rounded-lg bg-accent px-4 py-2.5 text-[15px] font-medium text-white">
              Back to chat
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
