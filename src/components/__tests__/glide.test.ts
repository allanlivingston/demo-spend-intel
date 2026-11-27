import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { glide } from "../glide";

// A fake scroller and a frame clock, so the glide can be stepped frame by frame without a browser.
let now = 0;
let queue: ((t: number) => void)[] = [];
beforeEach(() => {
  now = 0;
  queue = [];
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => (queue.push(cb), queue.length));
  vi.stubGlobal("cancelAnimationFrame", () => { queue = []; });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
});
afterEach(() => vi.unstubAllGlobals());

function scroller(height: number, view = 600) {
  return { scrollTop: 0, scrollHeight: height, clientHeight: view, addEventListener() {}, removeEventListener() {} } as unknown as HTMLElement;
}
/** Runs frames of `ms` each; returns every scrollTop seen. */
function run(el: HTMLElement, frames: number, ms = 1000 / 60) {
  const seen: number[] = [];
  for (let i = 0; i < frames && queue.length; i++) {
    now += ms;
    const q = queue; queue = [];
    q.forEach((cb) => cb(now));
    seen.push(el.scrollTop);
  }
  return seen;
}
const maxStep = (xs: number[], from: number) => Math.max(...xs.map((x, i) => Math.abs(x - (i ? xs[i - 1] : from))));

test("a long scroll never moves more than about 30px a frame, and lands exactly", () => {
  const el = scroller(5000);
  glide(el, () => 3000);
  const seen = run(el, 600);
  expect(maxStep(seen, 0)).toBeLessThanOrEqual(30.5);
  expect(seen.at(-1)).toBe(3000);
});

test("slow frames pause the scroll instead of letting it leap", () => {
  const el = scroller(5000);
  glide(el, () => 3000);
  const seen = run(el, 60, 200);
  expect(maxStep(seen, 0)).toBeLessThanOrEqual(30.5);
});

test("when it runs out of time it stops where it is, never jumping to the target", () => {
  const el = scroller(50_000);
  glide(el, () => 40_000);
  const seen = run(el, 2000, 200);
  expect(maxStep(seen, 0)).toBeLessThanOrEqual(30.5);
  expect(el.scrollTop).toBeLessThan(40_000);
  expect(queue.length).toBe(0);
});
