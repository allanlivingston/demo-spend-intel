"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Area, Bar, BarChart, Cell, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, usePlotArea, useXAxisScale, useYAxisScale, XAxis, YAxis } from "recharts";
import { dayInfo, driverEffects, forecast, GROUP_IDS, monthStrip, pacing, TODAY, type GroupId } from "@/engine";
import { useStore, type Snapshot } from "@/state/store";
import { PHONE, Term, TERMS, usd, usdK, useMedia } from "./ui";
import { markUsed, NewDot, useNew } from "./NewDot";
import { useJustNow, useRoll } from "./motion";

/** The live chart's last axis top, so a team switch can glide the scale from it (the chart may remount). */
let lastTop: number | null = null;
/** The live chart's last team and what it drew, so a team switch can blend the lines from it. */
let lastTeam: { group: string; line: number[]; band: ([number, number] | undefined)[]; pool: number } | null = null;
const TEAM_MS = 360;

/** Chart readouts round to $100, like the rest of the app. */
const r100 = (v: number) => Math.round(v / 100) * 100;

const FORMULA =
  "Likely landing = spend to date + remaining days at each driver's daily rate, shaped by the team's weekly pattern, plus active drivers, minus applied fixes. The shaded band runs to a high case, which widens as more spend comes from autonomous agents.";

/**
 * The month's spend curve. Clicking any day asks Claude what happened (or is forecast) that day.
 * With snap, it draws an earlier copy as it was at that point in the conversation.
 */
/** Every other day on a wide chart; every five days on a phone, where they would run together. */
const dayTicks = (phone: boolean) => (phone ? { ticks: [1, 5, 10, 15, 20, 25, 30], interval: 0 as const } : { interval: 1 as const });

/** Axis labels at an even step (5k, 10k, 20k, 25k, 50k or 100k), at most six steps, never above the top. */
function evenTicks(top: number) {
  const step = [5_000, 10_000, 20_000, 25_000, 50_000, 100_000].find((x) => top / x <= 6) ?? Math.ceil(top / 6 / 100_000) * 100_000;
  return Array.from({ length: Math.floor(top / step) + 1 }, (_, k) => k * step);
}

export function PacingChart({ onDay, snap }: { onDay?: (question: string, context: string) => void; snap?: Snapshot }) {
  const store = useStore();
  const phone = useMedia(PHONE);
  const daySeen = useNew((s) => s.seen.includes("chart-day"));
  const { advanced, dailyOpen, setDailyOpen } = store;
  const demo = snap?.demo ?? store.demo;
  const group = snap?.group ?? store.group;
  const ghost = snap ? null : store.ghost;
  const f = forecast(demo, group);
  // A change the user just made: the forecast line first draws where it was heading, then moves to where it lands now.
  const justNow = useJustNow();
  // The chart library doesn't blend a line between two data sets reliably, so the blend is done here: 0 is the old line,
  // 1 the new one, over 600ms, easing out.
  const [morphing] = useState(() => !snap && justNow && !!ghost);
  const [mix, setMix] = useState(morphing ? 0 : 1);
  useEffect(() => {
    if (!morphing) return;
    let raf = 0;
    let t0 = 0;
    const step = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / 600);
      setMix(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    // A short pause first, so the eye finds the old line before it moves.
    const wait = setTimeout(() => (raf = requestAnimationFrame(step)), 250);
    return () => { clearTimeout(wait); cancelAnimationFrame(raf); };
  }, [morphing]);
  // Switching team: every line, the range and the budget blend from the last team's over 360ms, in step with the scale,
  // so nothing snaps. Kept in a module variable because the chart may remount.
  const [teamFrom, setTeamFrom] = useState(() => (!snap && justNow && lastTeam && lastTeam.group !== group ? lastTeam : null));
  const [tmix, setTmix] = useState(teamFrom ? 0 : 1);
  const prevGroup = useRef(group);
  useEffect(() => {
    if (snap || prevGroup.current === group) return;
    prevGroup.current = group;
    if (lastTeam && lastTeam.group !== group && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setTeamFrom(lastTeam); setTmix(0); }
  }, [snap, group]);
  useEffect(() => {
    if (!teamFrom) return;
    let raf = 0, t0 = 0;
    const step = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / TEAM_MS);
      setTmix(p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
      if (p < 1) raf = requestAnimationFrame(step); else setTeamFrom(null);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [teamFrom]);
  const tb = (was: number | undefined, now: number) => (teamFrom && was !== undefined && tmix < 1 ? was + (now - was) * tmix : now);
  const groups: GroupId[] = group === "all" ? GROUP_IDS : [group];
  const yAt = (day: number) => {
    const p = f.series[day - 1];
    return tb(teamFrom?.line[day - 1], p.actual ?? p.p50 ?? 0);
  };

  const markers = groups.flatMap((g) => driverEffects(demo, g).filter((e) => e.driver.marker && (advanced || e.driver.id !== "b-soc2")).map((e) => e.driver));
  // The whole month for everyone who hits a limit: bursty days included, under both policies.
  const ms = monthStrip(demo, group);
  // The day-1 "runs held" dot only explains the advanced comparison lines; the daily bars already show it in the default view.
  const blockDays = advanced ? ms.firstBlocks : {};
  const fixedState = (id: string) => (demo.appliedFixes.includes(id) ? "fixed" : (demo.handedOff ?? []).includes(id) ? "with owner" : null);
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
    const was = ghost?.[i] ? (ghost[i].actual ?? ghost[i].p50 ?? cum(i)) : cum(i);
    const line = tb(teamFrom?.line[i], mix < 1 ? was + (cum(i) - was) * mix : cum(i));
    const fb = teamFrom?.band[i];
    const band = p.band && fb ? [tb(fb[0], p.band[0]), tb(fb[1], p.band[1])] as [number, number] : teamFrom ? undefined : p.band;
    return { ...p, band, actual: p.actual !== undefined ? Math.round(line) : undefined, forecastLine: i + 1 >= TODAY ? Math.round(line) : undefined, noLimits: Math.round(line), limited: anyHeld ? Math.round(cum(i) - heldSoFar) : undefined, ghost: ghost && ghost[i]?.p50 !== undefined ? ghost[i].p50 : undefined };
  });
  // Event labels: one per dot (throttle days within 4 days share one). EventLabels places them in pixels so none overlap.
  const throttleLabels = Object.entries(blockDays)
    .filter(([day], i, all) => !(i > 0 && +day - +all[i - 1][0] < 4))
    .map(([day]) => ({ key: `b${day}`, day: +day, value: yAt(+day), text: `${Object.entries(blockDays).filter(([d]) => +d >= +day && +d - +day < 4).reduce((a, [, c]) => a + c, 0)} people: some runs held`, color: "#C4452F" }));
  const labels: EventLabel[] = [
    ...markers.map((d) => ({ key: d.id, day: d.startDay, value: yAt(d.startDay), text: d.marker!.replace(/^Day \d+:\s*/, ""), color: fixedState(d.id) ? "#999" : "#555" })),
    ...throttleLabels,
  ].sort((a, b) => a.day - b.day);
  const dots = [...markers.map((d) => ({ day: d.startDay, value: yAt(d.startDay) })), ...Object.keys(blockDays).map((d) => ({ day: +d, value: yAt(+d) }))];
  const yMax = Math.max(f.pool, ...f.series.map((p) => p.p90 ?? 0), ...(ghost ?? []).map((p) => p.p90 ?? 0)) * 1.05;
  const top = Math.ceil(yMax / 5000) * 5000;
  // Switching team changes the scale: it glides there instead of snapping (not on page load).
  const shownTop = Math.round(useRoll(top, !snap && justNow ? lastTop : null, 360));
  useEffect(() => { if (!snap) lastTop = top; }, [snap, top]);
  useEffect(() => {
    if (snap) return;
    lastTeam = { group, line: f.series.map((_, i) => cum(i)), band: f.series.map((p) => p.band as [number, number] | undefined), pool: f.pool };
  });

  return (
    <div>
      <div id={onDay ? "forecast-chart" : undefined} className="h-[260px] px-1 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 24, bottom: 0, left: 8 }}
            className="cursor-pointer"
            onClick={(st) => {
              const day = Number(st?.activeLabel);
              if (!day || !onDay) return;
              markUsed("chart-day");
              const d = dayInfo(demo, group, day);
              const parts = [d.past ? `Day ${day}: ${usd(d.spend)} spent` : `Day ${day}: about ${usd(d.spend)} forecast`, ...d.events.map((e) => `started: ${e}`), d.blocked ? `${d.blocked} people go over their monthly limit` : ""].filter(Boolean);
              onDay(day > TODAY ? `What's expected on day ${day}?` : `What happened on day ${day}?`, parts.join("; "));
            }}
          >
            <CartesianGrid stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} {...dayTicks(phone)} />
            <YAxis domain={[0, shownTop]} allowDataOverflow ticks={evenTicks(top).filter((t) => t <= shownTop + 1)} tickFormatter={usdK} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              formatter={(v, name) => (Array.isArray(v) ? [`${usd(r100(Number(v[0])))} to ${usd(r100(Number(v[1])))}`, "Likely range"] : [usd(r100(Number(v))), String(name)])}
              labelFormatter={(d) => `Day ${d}${Number(d) === TODAY ? " (today)" : ""}`}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Area dataKey="band" name="Likely range" fill="#D97757" fillOpacity={0.12} stroke="none" isAnimationActive />
            {advanced && <Line dataKey="plan" name="Pacing plan" stroke="#D97757" strokeWidth={1} dot={false} isAnimationActive={false} />}
            {ghost && <Line dataKey="ghost" name="Previous forecast" stroke="#94a3b8" strokeOpacity={0.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
            <Line dataKey="actual" name="Actual" stroke="#191919" strokeWidth={2} dot={false} isAnimationActive={false} />
            {advanced && anyHeld && <Line dataKey="limited" name="Spend with pacing and caps" stroke="#D97757" strokeWidth={2} strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
            <Line dataKey={advanced ? "noLimits" : "forecastLine"} name={advanced ? "No limits, from day 1" : "Forecast"} stroke="#191919" strokeWidth={2} strokeDasharray="6 4" dot={false} animationDuration={700} isAnimationActive={!morphing} />
            <ReferenceLine y={tb(teamFrom?.pool, f.pool)} stroke="#191919" strokeDasharray="2 4" label={{ value: `Budget ${usd(f.pool)}`, position: "insideTopLeft", fontSize: 12, fill: "#555" }} />
            <ReferenceLine x={TODAY} stroke="#cbd5e1" label={{ value: "Today", position: "insideTop", fontSize: 11, fill: "#888" }} />
            {markers.map((d) => (
              <ReferenceDot
                key={d.id}
                x={d.startDay}
                y={yAt(d.startDay)}
                r={6}
                fill={fixedState(d.id) ? "#B8B8B8" : d.kind === "waste" ? "#C98A1B" : "#3F8F5A"}
                stroke="#fff"
                strokeWidth={2}
                style={{ cursor: "pointer" }}
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
              />
            ))}
            <EventLabels
              labels={labels}
              dots={dots}
              lines={[data.map((p) => p.noLimits), ...(advanced && anyHeld ? [data.map((p) => p.limited)] : []), ...(advanced ? [data.map((p) => p.plan as number | undefined)] : [])]}
              fixed={[{ text: `Budget ${usd(f.pool)}`, value: f.pool, at: "budget" }, { text: "Today", day: TODAY, at: "top" }]}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 pt-1 text-[13px] text-muted">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-ink align-middle" />Actual</span>
        <span><span className="mr-1 inline-block w-4 border-t-2 border-dashed border-ink align-middle" />{advanced ? "No limits, from day 1" : "Forecast"}</span>
        {advanced && anyHeld && <span><span className="mr-1 inline-block w-4 border-t-2 border-dotted align-middle" style={{ borderColor: "#D97757" }} />Spend with pacing and caps</span>}
        <span><span className="mr-1 inline-block h-2.5 w-4 bg-accent/20 align-middle" /><Term def={TERMS.likely}>Likely range</Term></span>
        {advanced && <span><span className="mr-1 inline-block h-px w-4 bg-accent align-middle" />Pacing plan</span>}
        {/* Only the markers this chart shows. */}
        {markers.some((d) => d.kind === "waste" && !fixedState(d.id)) && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-warn align-middle" />Waste starts</span>}
        {markers.some((d) => d.kind !== "waste" && !fixedState(d.id)) && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-ok align-middle" />Growth starts</span>}
        {markers.some((d) => fixedState(d.id)) && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: "#B8B8B8" }} />Fixed or sent to owner</span>}
        {Object.keys(blockDays).length > 0 && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-bad align-middle" />People with runs first held</span>}
        {/* The note and the ? stay together on the right, so neither wraps onto a line of its own. */}
        <span className="ml-auto inline-flex items-center gap-3 whitespace-nowrap">
          {onDay && (
            <span className="inline-flex items-center gap-1.5 text-ink">
              <span className={daySeen ? "text-muted" : undefined}>Click any day to ask about it</span>
            </span>
          )}
          <button type="button" className="inline-flex cursor-help items-center text-muted hover:text-ink" title={FORMULA} aria-label={`How is this calculated? ${FORMULA}`}>
            <CircleHelp size={15} />
          </button>
        </span>
      </div>
      {anyHeld && <DailySummary data={stripDays} pace={pacing(demo, group)} open={!!dailyOpen} onToggle={() => setDailyOpen(!dailyOpen)} />}
      {anyHeld && dailyOpen && <DailyStrip data={stripDays} />}
    </div>
  );
}

type EventLabel = { key: string; day: number; value: number; text: string; color: string };
type Box = { l: number; t: number; r: number; b: number };

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width of an 11px chart label in the page's font. */
function labelWidth(text: string) {
  if (measureCtx === undefined) measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 6;
  measureCtx.font = `11px ${getComputedStyle(document.body).fontFamily}`;
  return measureCtx.measureText(text).width;
}

const hit = (a: Box, b: Box, gap = 2) => a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap;

/**
 * The chart's event labels, laid out in pixels from the chart's own scales. Each sits on a leader line above its dot,
 * left-aligned; if that spot overlaps another label, a dot, a spend line or the chart's Budget and Today labels, it
 * tries right-aligned, then a row higher, then below the dot, until it finds a free spot.
 */
function EventLabels({ labels, dots, lines, fixed }: {
  labels: EventLabel[];
  dots: { day: number; value: number }[];
  lines: (number | undefined)[][];
  fixed: { text: string; value?: number; day?: number; at: "budget" | "top" }[];
}) {
  const xs = useXAxisScale();
  const ys = useYAxisScale();
  const plot = usePlotArea();
  if (!xs || !ys || !plot) return null;
  const X = (day: number) => xs(day, { position: "middle" });
  const Y = (v: number) => ys(v);
  const H = 13; // one 11px line of text
  const obstacles: Box[] = [];
  for (const d of dots) {
    const x = X(d.day), y = Y(d.value);
    if (x !== undefined && y !== undefined) obstacles.push({ l: x - 7, t: y - 7, r: x + 7, b: y + 7 });
  }
  // Spend lines, sampled between days so a label never sits on one.
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      const x0 = X(i + 1), x1 = X(i + 2);
      if (a === undefined || b === undefined || x0 === undefined || x1 === undefined) continue;
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const x = x0 + (x1 - x0) * t, y = Y(a + (b - a) * t);
        if (y !== undefined) obstacles.push({ l: x - 2, t: y - 2, r: x + 2, b: y + 2 });
      }
    }
  }
  for (const f of fixed) {
    const w = labelWidth(f.text) + 8;
    if (f.at === "budget" && f.value !== undefined) {
      const y = Y(f.value);
      if (y !== undefined) obstacles.push({ l: plot.x, t: y, r: plot.x + w + 6, b: y + 18 });
    } else if (f.day !== undefined) {
      const x = X(f.day);
      if (x !== undefined) obstacles.push({ l: x - w / 2, t: plot.y, r: x + w / 2, b: plot.y + 16 });
    }
  }
  const right = plot.x + plot.width;
  const placed: { l: EventLabel; box: Box; x: number; y: number; above: boolean }[] = [];
  // Closest spot first: above the dot (left-aligned, then right-aligned), a row higher each time; below only when above is full.
  const spots = [
    ...Array.from({ length: 8 }, (_, k) => [{ above: true, k, end: false, cost: k }, { above: true, k, end: true, cost: k + 0.5 }]).flat(),
    ...Array.from({ length: 5 }, (_, k) => [{ above: false, k, end: false, cost: k + 2.2 }, { above: false, k, end: true, cost: k + 2.7 }]).flat(),
  ].sort((a, b) => a.cost - b.cost);
  for (const l of labels) {
    const x = X(l.day), y = Y(l.value);
    if (x === undefined || y === undefined) continue;
    const w = labelWidth(l.text) + 4;
    const taken = [...obstacles, ...placed.map((p) => p.box)];
    let chosen: { box: Box; above: boolean } | null = null;
    for (const s of spots) {
      const t = s.above ? y - 20 - s.k * 16 - H : y + 12 + s.k * 16;
      const left = Math.max(plot.x, Math.min(s.end ? x + 3 - w : x - 3, right - w));
      const box = { l: left, t, r: left + w, b: t + H };
      if (box.t < plot.y - 8 || box.b > plot.y + plot.height - 2) continue;
      if (taken.some((o) => hit(box, o))) continue;
      chosen = { box, above: s.above };
      break;
    }
    if (!chosen) {
      const left = Math.max(plot.x, Math.min(x - 3, right - w));
      chosen = { box: { l: left, t: y - 20 - H, r: left + w, b: y - 20 }, above: true };
    }
    placed.push({ l, x, y, ...chosen });
  }
  return (
    <g pointerEvents="none">
      {/* Every leader line first, then every label on top, so a label's white halo covers a line passing behind it. */}
      {placed.map(({ l, box, x, y, above }) => (
        <line key={`${l.key}-line`} x1={x} x2={x} y1={above ? y - 7 : y + 7} y2={above ? box.b - 1 : box.t + 1} stroke={l.color} strokeOpacity={0.35} />
      ))}
      {placed.map(({ l, box }) => (
        <text key={`${l.key}-text`} x={box.l + 2} y={box.t + 10} fontSize={11} fill={l.color} paintOrder="stroke" stroke="#fff" strokeWidth={4}>{l.text}</text>
      ))}
    </g>
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

/** How each step reads in a sentence. */
const STEP_PHRASE: Record<Exclude<StepKey, "ran">, string> = { rerouted: "moved to a cheaper model", paused: "paused", hard: "held a few hours", stopped: "stopped" };

/**
 * The daily bars in one line: from today, the share of runs pacing slows (the same figure the brief and Claude give),
 * and the step most of it takes. Once nobody is over their own limit, all of it is on people's busiest days, and the
 * line says so (otherwise "On track" next to "7% slowed" reads as a contradiction). Opens the bars on click.
 */
function DailySummary({ data, pace, open, onToggle }: { data: StripDay[]; pace: { teamShare: number; capsBlocked: number }; open: boolean; onToggle: () => void }) {
  const share = pace.teamShare;
  const when = pace.capsBlocked === 0 ? " on people's busiest days" : "";
  const t = (k: StepKey, from = 1) => data.filter((d) => d.day >= from).reduce((a, d) => a + d[k], 0);
  const steps = STEPS.filter((st) => Math.round(t(st.key) / 100) > 0);
  const pct = Math.round(share * 100);
  const top = [...STEPS].sort((a, b) => t(b.key, TODAY + 1) - t(a.key, TODAY + 1)).find((st) => t(st.key, TODAY + 1) > 0);
  const sentence = <>{pct ? `If nothing changes, about ${pct}% of runs will be ` : "If nothing changes, under 1% of runs will be "}<Term def={TERMS.slowed}>slowed</Term>{" from today"}{when}{pct && top ? `, mostly ${STEP_PHRASE[top.key]}` : ""}</>;
  return (
    <div id="slowed" className={`border-t border-neutral-100 px-4 py-2.5 text-[13px]${open ? " pb-1" : ""}`}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-ink">{sentence}</span>
      <button type="button" onClick={() => { onToggle(); markUsed("daily-bars"); }} aria-expanded={open} className="ml-auto flex shrink-0 items-center text-left text-muted hover:text-ink">
        <span className="inline-flex shrink-0 items-center gap-1 text-accent-ink">
          <NewDot f="daily-bars" label="The month day by day: what ran, what was slowed" className="mr-1" />
          {open ? "Hide daily bars" : "Show daily bars"}
          <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </span>
      </button>
      </div>
      {open && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <span className="font-medium text-ink">This month</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 align-middle" style={{ background: C_RAN_PAST }} />Ran {usd(Math.round(t("ran") / 100) * 100)}</span>
          {steps.map((st) => <span key={st.key}><span className="mr-1 inline-block h-2.5 w-2.5 align-middle" style={{ background: st.color }} />{st.label} {usd(Math.round(t(st.key) / 100) * 100)}</span>)}
        </div>
      )}
    </div>
  );
}

/** One stacked bar a day along the ladder: ran, then cheaper model, paused, hard throttled, stopped. The summary above is its legend. */
function DailyStrip({ data }: { data: StripDay[] }) {
  const phone = useMedia(PHONE);
  const t = (k: StepKey) => data.reduce((a, d) => a + d[k], 0);
  // Hide steps that round to $0 for the month (for example, no cheaper-model runs left once the waste is fixed).
  const steps = STEPS.filter((st) => Math.round(t(st.key) / 100) > 0);
  return (
    <div className="px-4 pb-3">
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 24, bottom: 0, left: 8 }} barCategoryGap="15%">
            <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} {...dayTicks(phone)} height={16} />
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
