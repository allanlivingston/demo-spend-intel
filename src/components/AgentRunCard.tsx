"use client";
import { useState } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, Loader2, RotateCcw } from "lucide-react";
import { AGENT_LABEL, retryRun, startAgentRun } from "@/state/agentClient";
import type { ChatMessage } from "@/state/store";
import { cx, mergeSteps } from "./ui";

const MODEL_NAME: Record<string, string> = {
  "claude-haiku-5-5": "Haiku",
  "claude-sonnet-5-5": "Sonnet",
  "claude-opus-5-5": "Opus",
};

/** An assistant turn: which agent, a quiet step disclosure, the answer, then model and cost. */
export function AgentRunCard({ m }: { m: ChatMessage }) {
  const run = m.run!;
  const running = run.status === "running";
  const [showSteps, setShowSteps] = useState(false);
  const stepsVisible = running || showSteps;
  const canEscalate = run.status === "done" && run.backend !== "replay" && run.model !== "claude-opus-5-5";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span className="font-medium text-neutral-600">{AGENT_LABEL[run.agent]}</span>
        {running && <><Loader2 size={12} className="animate-spin" /> {run.steps.at(-1)?.phase ?? "Thinking"}…</>}
        {!running && run.steps.length > 0 && (
          <button type="button" onClick={() => setShowSteps(!showSteps)} className="flex items-center gap-0.5 hover:text-ink">
            · {run.steps.length} {run.steps.length === 1 ? "step" : "steps"} <ChevronRight size={12} className={cx("transition", showSteps && "rotate-90")} />
          </button>
        )}
      </div>
      {stepsVisible && run.steps.length > 0 && (
        <ol className="space-y-1 border-l-2 border-neutral-200 pl-3">
          {mergeSteps(run.steps).map((s, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-neutral-600">
              <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-ok-ink" />
              <span><span className="font-medium text-ink">{s.phase}.</span> {s.summary}</span>
            </li>
          ))}
        </ol>
      )}
      {run.status === "error" && (
        <div className="flex items-center gap-2 text-[15px] text-bad">
          <CircleAlert size={14} /> {run.error}
          <button type="button" onClick={() => retryRun(m.id)} className="flex items-center gap-1 font-medium text-accent-ink hover:underline">
            <RotateCcw size={12} /> Try again
          </button>
        </div>
      )}
      {m.text && <p className="font-serif text-[17px] leading-[26px] text-ink">{m.text}</p>}
      {run.status === "done" && (
        <div className="flex items-center gap-3 text-[12px] text-muted">
          {run.model && <span title={run.backend === "replay" ? "A recorded run, re-checked against today's numbers" : undefined}>{MODEL_NAME[run.model] ?? run.model}{run.backend === "replay" ? " · replayed" : ""}</span>}
          {run.costUsd ? <span>${run.costUsd.toFixed(2)}</span> : null}
          {run.latencyMs ? <span>{(run.latencyMs / 1000).toFixed(1)}s</span> : null}
          {canEscalate && (
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-accent-ink"
              onClick={() => startAgentRun({ agent: run.agent, prompt: run.prompt, driverId: run.driverId, escalate: true, context: run.context, revision: run.revision })}
              title="Re-run this answer on Opus"
            >
              Ask Opus
            </button>
          )}
        </div>
      )}
    </div>
  );
}
