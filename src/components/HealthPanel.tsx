"use client";
// Health: how forecasting and pacing did over the last six full months. One number per row (the six-month average)
// and a small trend line by month.
import { formatMetric, pacingHealth } from "@/engine";
import { usd } from "./ui";

function Spark({ values }: { values: number[] }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const w = 96;
  const h = 26;
  const y = (v: number) => (hi === lo ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6));
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i / (values.length - 1)) * (w - 4) + 2},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label="Trend by month">
      <path d={d} fill="none" stroke="#D97757" strokeWidth={2} />
    </svg>
  );
}

export function HealthPanel({ onAsk, busy }: { onAsk: (q: string, context: string) => void; busy: boolean }) {
  const h = pacingHealth();
  const range = `${h.months[0]} to ${h.months[h.months.length - 1]}`;
  return (
    <div className="pb-3">
      <p className="px-4 pb-2 pt-3 text-[14px] leading-[21px] text-neutral-700">Forecast and pacing results for the last six full months ({range}).</p>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="grid grid-cols-[1fr_120px_96px_104px] gap-2 px-4 py-1.5 text-[12px] uppercase tracking-wide text-muted">
            <span>Measure</span>
            <span className="text-right">6-month average</span>
            <span className="text-right">Target</span>
            <span className="text-right">By month</span>
          </div>
          {h.rows.map(({ metric, values, average }) => (
            <div key={metric.id} className="grid grid-cols-[1fr_120px_96px_104px] items-center gap-2 border-t border-neutral-50 px-4 py-1.5 text-[15px]">
              <span className="min-w-0 truncate">{metric.label}</span>
              <span className="text-right font-medium tabular-nums">{formatMetric(average.pacing, metric.format)}</span>
              <span className="text-right text-[13px] text-muted">{metric.good}</span>
              <span className="flex justify-end"><Spark values={values.pacing} /></span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-100 px-4 pt-2.5 text-[13px] text-muted">
        <span>
          A connector retry loop in {h.months[1]} cost {usd(h.wasteSpend.pacing)} before it was paused. New work that started in {h.months[2]} was
          forecast from the team average at first; by {h.months[5]}, {Math.round(h.newOwnWeight[5] * 100)}% of its forecast came from its own history.
        </span>
        <button type="button" disabled={busy} onClick={() => onAsk("How do we know this pacing is any good?", `The Health tab: forecast and pacing results, ${range}.`)}
          className="ml-auto rounded-md px-2 py-1 text-[13px] text-neutral-600 hover:bg-neutral-100 hover:text-ink disabled:opacity-40">
          Ask about this
        </button>
      </div>
    </div>
  );
}
