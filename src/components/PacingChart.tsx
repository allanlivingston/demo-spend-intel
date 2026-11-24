"use client";
import { Area, Bar, BarChart, Cell, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dayInfo, driverEffects, forecast, GROUP_IDS, monthStrip, TODAY, type GroupId } from "@/engine";
import { useStore } from "@/state/store";
import { usd, usdK } from "./ui";

const FORMULA =
  "Likely landing = spend to date + remaining days at each driver's daily rate, shaped by the team's weekly pattern, plus active drivers, minus applied fixes. The shaded band runs to a high case, which widens as more spend comes from autonomous agents.";

/** The month's spend curve. Clicking any day asks Claude what happened (or is forecast) that day. */
export function PacingChart({ onDay }: { onDay?: (question: string, context: string) => void }) {
  const { demo, group, ghost, advanced } = useStore();
  const f = forecast(demo, group);
  const groups: GroupId[] = group === "all" ? GROUP_IDS : [group];
  const yAt = (day: number) => {
    const p = f.series[day - 1];
    return p.actual ?? p.p50 ?? 0;
  };

  const markers = groups.flatMap((g) => driverEffects(demo, g).filter((e) => e.driver.marker && (advanced || e.driver.id !== "b-soc2")).map((e) => e.driver));
  // The whole month for everyone who hits a limit: bursty days included, under both policies.
  const ms = monthStrip(demo, group);
  const blockDays = ms.firstBlocks;
  const cum = (i: number) => { const p = f.series[i]; return p.actual ?? p.p50 ?? 0; };
  const stripDays: StripDay[] = ms.demand.map((dem, i) => {
    const step = { rerouted: Math.round(ms.rerouted[i]), paused: Math.round(ms.paused[i]), hard: Math.round(ms.hardThrottled[i]), stopped: Math.round(ms.stopped[i]) };
    const held = step.rerouted + step.paused + step.hard + step.stopped;
    return { day: i + 1, ran: Math.round(Math.max(0, dem - held)), ...step };
  });
  const thrArr = ms.throttled;
  const blkArr = ms.blocked;
  const anyHeld = ms.people > 0;
  // Spend with limits on, from day 1: the no-limits line minus what was held back up to each day.
  let heldSoFar = 0;
  const data = f.series.map((p, i) => {
    heldSoFar += thrArr[i] + blkArr[i];
    return { ...p, forecastLine: i + 1 >= TODAY ? Math.round(cum(i)) : undefined, noLimits: Math.round(cum(i)), limited: anyHeld ? Math.round(cum(i) - heldSoFar) : undefined, ghost: ghost && ghost[i]?.p50 !== undefined ? ghost[i].p50 : undefined };
  });
  // Event labels: one per dot (throttle days within 4 days share one), above the dot on a leader line,
  // left-aligned, stacked into rows so no two labels overlap.
  const throttleLabels = Object.entries(blockDays)
    .filter(([day], i, all) => !(i > 0 && +day - +all[i - 1][0] < 4))
    .map(([day]) => ({ key: `b${day}`, day: +day, text: `${Object.entries(blockDays).filter(([d]) => +d >= +day && +d - +day < 4).reduce((a, [, c]) => a + c, 0)} people: some runs held`, color: "#C4452F" }));
  const labels = [...markers.map((d) => ({ key: d.id, day: d.startDay, text: d.marker!.replace(/^Day \d+:\s*/, ""), color: "#555" })), ...throttleLabels].sort((a, b) => a.day - b.day);
  const rowOf = new Map<string, number>();
  const rowEnds: number[] = [];
  for (const l of labels) {
    const width = l.text.length * 0.27 + 0.8; // in days: ~6px a character at ~24px a day, plus a gap
    let row = rowEnds.findIndex((end) => end <= l.day);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = l.day + width;
    rowOf.set(l.key, row);
  }
  const labelFor = (key: string, text: string, color: string) =>
    function EventLabel({ viewBox }: { viewBox?: { x?: number; y?: number; width?: number; height?: number } }) {
      // The dot's viewBox is its bounding box; the leader line starts at its centre.
      const x = (viewBox?.x ?? 0) + (viewBox?.width ?? 0) / 2;
      const y = (viewBox?.y ?? 0) + (viewBox?.height ?? 0) / 2;
      const ty = y - 24 - (rowOf.get(key) ?? 0) * 18;
      return (
        <g pointerEvents="none">
          <line x1={x} x2={x} y1={y - 7} y2={ty + 3} stroke={color} strokeOpacity={0.35} />
          <text x={x - 3} y={ty} fontSize={11} fill={color} paintOrder="stroke" stroke="#fff" strokeWidth={3}>{text}</text>
        </g>
      );
    };
  const yMax = Math.max(f.pool, ...f.series.map((p) => p.p90 ?? 0), ...(ghost ?? []).map((p) => p.p90 ?? 0)) * 1.05;

  return (
    <div>
      <div className="h-[260px] px-1 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 24, bottom: 0, left: 8 }}
            className="cursor-pointer"
            onClick={(st) => {
              const day = Number(st?.activeLabel);
              if (!day || !onDay) return;
              const d = dayInfo(demo, group, day);
              const parts = [d.past ? `Day ${day}: ${usd(d.spend)} spent` : `Day ${day}: about ${usd(d.spend)} forecast`, ...d.events.map((e) => `started: ${e}`), d.blocked ? `${d.blocked} people go over their monthly limit` : ""].filter(Boolean);
              onDay(day > TODAY ? `What's expected on day ${day}?` : `What happened on day ${day}?`, parts.join("; "));
            }}
          >
            <CartesianGrid stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} interval={1} />
            <YAxis domain={[0, Math.ceil(yMax / 5000) * 5000]} tickFormatter={usdK} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              formatter={(v, name) => (Array.isArray(v) ? [`${usd(Number(v[0]))} to ${usd(Number(v[1]))}`, "Likely to high case"] : [usd(Number(v)), String(name)])}
              labelFormatter={(d) => `Day ${d}${Number(d) === TODAY ? " (today)" : ""}`}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Area dataKey="band" name="Likely to high case" fill="#D97757" fillOpacity={0.12} stroke="none" isAnimationActive />
            {advanced && <Line dataKey="plan" name="Pacing plan" stroke="#D97757" strokeWidth={1} dot={false} isAnimationActive={false} />}
            {ghost && <Line dataKey="ghost" name="Previous forecast" stroke="#94a3b8" strokeOpacity={0.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
            <Line dataKey="actual" name="Actual" stroke="#191919" strokeWidth={2} dot={false} isAnimationActive={false} />
            {advanced && anyHeld && <Line dataKey="limited" name="Spend with pacing and caps" stroke="#D97757" strokeWidth={2} strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
            <Line dataKey={advanced ? "noLimits" : "forecastLine"} name={advanced ? "No limits, from day 1" : "Forecast"} stroke="#191919" strokeWidth={2} strokeDasharray="6 4" dot={false} animationDuration={700} />
            <ReferenceLine y={f.pool} stroke="#191919" strokeDasharray="2 4" label={{ value: `Budget ${usd(f.pool)}`, position: "insideTopLeft", fontSize: 12, fill: "#555" }} />
            <ReferenceLine x={TODAY} stroke="#cbd5e1" label={{ value: "Today", position: "insideTop", fontSize: 11, fill: "#888" }} />
            {markers.map((d) => (
              <ReferenceDot
                key={d.id}
                x={d.startDay}
                y={yAt(d.startDay)}
                r={6}
                fill={d.kind === "waste" ? "#C98A1B" : "#3F8F5A"}
                stroke="#fff"
                strokeWidth={2}
                style={{ cursor: "pointer" }}
                label={labelFor(d.id, d.marker!.replace(/^Day \d+:\s*/, ""), "#555")}
              />
            ))}
            {Object.entries(blockDays).map(([day]) => (
              <ReferenceDot
                key={`b${day}`}
                x={+day}
                y={yAt(+day)}
                r={5}
                fill="#C4452F"
                stroke="#fff"
                strokeWidth={2}
                style={{ cursor: "pointer" }}
                label={(() => { const l = throttleLabels.find((x) => x.key === `b${day}`); return l ? labelFor(l.key, l.text, l.color) : undefined; })()}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {anyHeld && <DailyStrip data={stripDays} />}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 pt-1 text-[13px] text-muted">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-ink align-middle" />Actual</span>
        <span><span className="mr-1 inline-block w-4 border-t-2 border-dashed border-ink align-middle" />{advanced ? "No limits, from day 1" : "Forecast"}</span>
        {advanced && anyHeld && <span><span className="mr-1 inline-block w-4 border-t-2 border-dotted align-middle" style={{ borderColor: "#D97757" }} />Spend with pacing and caps</span>}
        <span><span className="mr-1 inline-block h-2.5 w-4 bg-accent/20 align-middle" />Likely to high case</span>
        {advanced && <span><span className="mr-1 inline-block h-px w-4 bg-accent align-middle" />Pacing plan</span>}
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-warn align-middle" />Waste starts</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-ok align-middle" />Growth starts</span>
        {Object.keys(blockDays).length > 0 && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-bad align-middle" />People with runs first held</span>}
        <span className="ml-auto cursor-help underline decoration-dotted" title={FORMULA}>How is this calculated?</span>
      </div>
    </div>
  );
}


type StripDay = { day: number; ran: number; rerouted: number; paused: number; hard: number; stopped: number };
type StepKey = Exclude<keyof StripDay, "day">;

const C_RAN_PAST = "#b8b8b8";
const C_RAN_FUTURE = "#e0e0e0";
/** One ladder, lightest response first. */
const STEPS: { key: Exclude<StepKey, "ran">; label: string; color: string; text: string }[] = [
  { key: "rerouted", label: "Cheaper model", color: "#F2CF8A", text: "#9A6A12" },
  { key: "paused", label: "Paused", color: "#E3A63B", text: "#9A6A12" },
  { key: "hard", label: "Held a few hours", color: "#D9693F", text: "#B04A26" },
  { key: "stopped", label: "Stopped for the month", color: "#9E2A1C", text: "#9E2A1C" },
];

function StripTip({ active, payload, label }: { active?: boolean; payload?: { payload: StripDay }[]; label?: number | string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] shadow-md">
      <div className="font-medium">Day {label}{Number(label) <= TODAY ? "" : " (forecast)"}</div>
      <div>Ran: {usd(d.ran)}</div>
      {STEPS.filter((st) => d[st.key] > 0).map((st) => <div key={st.key} style={{ color: st.text }}>{st.label}: {usd(d[st.key])}</div>)}
    </div>
  );
}

/** One stacked bar a day along the ladder: ran, then cheaper model, paused, hard throttled, stopped. */
function DailyStrip({ data }: { data: StripDay[] }) {
  const t = (k: StepKey) => data.reduce((a, d) => a + d[k], 0);
  const steps = STEPS.filter((st) => st.key !== "stopped" || t("stopped") > 0);
  return (
    <div className="px-4 pt-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="text-[13px] font-medium text-ink">Each day</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 align-middle" style={{ background: C_RAN_PAST }} />Ran {usd(Math.round(t("ran") / 100) * 100)}</span>
        {steps.map((st) => <span key={st.key}><span className="mr-1 inline-block h-2.5 w-2.5 align-middle" style={{ background: st.color }} />{st.label} {usd(Math.round(t(st.key) / 100) * 100)}</span>)}
      </div>
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 24, bottom: 0, left: 8 }} barCategoryGap="15%">
            <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} interval={1} height={16} />
            <YAxis tickFormatter={usdK} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} tickCount={3} />
            <Tooltip content={<StripTip />} position={{ y: -90 }} wrapperStyle={{ zIndex: 40, pointerEvents: "none" }} allowEscapeViewBox={{ x: false, y: true }} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <ReferenceLine x={TODAY} stroke="#94a3b8" strokeDasharray="3 3" />
            <Bar dataKey="ran" stackId="d" isAnimationActive={false}>{data.map((d) => <Cell key={d.day} fill={d.day <= TODAY ? C_RAN_PAST : C_RAN_FUTURE} />)}</Bar>
            {steps.map((st) => <Bar key={st.key} dataKey={st.key} stackId="d" fill={st.color} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
