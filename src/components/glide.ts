// Calm scrolling for the chat. The browser's smooth scroll speeds up with distance and can't follow a layout that is
// still settling (a chart getting its height), so long moves zip past and can land short. This is a motion with a hard
// speed limit: it speeds up gently, never goes faster than MAX_SPEED, slows down to land, re-aims every frame, and stops
// the moment the reader scrolls themselves. A slow frame (a chart drawing) just pauses it; it never leaps to catch up.

/** Top speed in pixels per millisecond: 1,800px a second, about 30px per frame at 60 frames a second. */
const MAX_SPEED = 1.8;
/** How fast it speeds up and slows down, in pixels per millisecond squared: full speed after about 0.2 seconds. */
const ACCEL = 0.009;
/** The longest frame step it will take, so a stalled frame never turns into a jump. */
const MAX_DT = 1000 / 60;

type Motion = { stop: () => void; velocity: () => number };
const active = new WeakMap<HTMLElement, Motion>();

/** Scroll `el` to the position `target()` returns, re-read every frame. Returns a function that cancels it. */
export function glide(el: HTMLElement, target: () => number): () => void {
  const clamp = (v: number) => Math.max(0, Math.min(v, el.scrollHeight - el.clientHeight));
  // A new aim while already moving keeps the current speed, so the page never stops and restarts.
  let vel = active.get(el)?.velocity() ?? 0;
  active.get(el)?.stop();
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.scrollTop = clamp(target());
    return () => {};
  }
  let pos = el.scrollTop;
  let set = pos;
  let last = performance.now();
  const began = last;
  let frame = 0;
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  const stop = () => {
    cancelAnimationFrame(frame);
    events.forEach((e) => el.removeEventListener(e, stop));
    if (active.get(el)?.stop === stop) active.delete(el);
  };
  const step = (now: number) => {
    const dt = Math.min(MAX_DT, Math.max(0, now - last));
    last = now;
    // Content folding above shifts scrollTop under us (the browser keeps what's on screen in place): follow it.
    if (Math.abs(el.scrollTop - set) > 1.5) pos = el.scrollTop;
    const rem = clamp(target()) - pos;
    // The fastest speed from which it can still stop in time, capped at MAX_SPEED.
    const want = Math.sign(rem) * Math.min(MAX_SPEED, Math.sqrt(2 * ACCEL * Math.abs(rem)));
    const slowing = Math.sign(want) === Math.sign(vel) && Math.abs(want) < Math.abs(vel);
    vel = slowing ? want : vel + Math.max(-ACCEL * dt, Math.min(ACCEL * dt, want - vel));
    // Land exactly rather than step past the target and wobble back.
    if (Math.abs(vel * dt) >= Math.abs(rem) || Math.abs(rem) < 0.5) {
      el.scrollTop = clamp(target());
      return stop();
    }
    // A safety stop for a page that keeps stalling: stop where it is. Never jump to the target, which reads as the page
    // vanishing (the first Fund it, while the app is still loading code, used to leap here).
    if (now - began > 8_000) return stop();
    pos += vel * dt;
    el.scrollTop = pos;
    set = el.scrollTop;
    frame = requestAnimationFrame(step);
  };
  events.forEach((e) => el.addEventListener(e, stop, { passive: true }));
  active.set(el, { stop, velocity: () => vel });
  frame = requestAnimationFrame(step);
  return stop;
}

/** Glide the nearest scrolling container so `target` sits `gap` pixels below its top. */
export function glideTo(target: HTMLElement | null, gap = 24) {
  let el = target?.parentElement ?? null;
  while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  if (!el || !target) return;
  const box = el;
  glide(box, () => box.scrollTop + target.getBoundingClientRect().top - box.getBoundingClientRect().top - gap);
}
