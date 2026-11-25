// How far visitors get, for Vercel Web Analytics (custom events). No cookies, no personal data: only the step reached.
// The script is loaded in the layout; locally (and in tests) there is no script, so nothing is sent.
type Va = (event: "event", data: { name: string; data?: Record<string, string | number | boolean> }) => void;

export function track(name: string, data?: Record<string, string | number | boolean>) {
  if (typeof window === "undefined") return;
  try {
    const va = (window as unknown as { va?: Va }).va;
    if (va) va("event", { name, data });
    else if (process.env.NODE_ENV === "development") console.debug("[track]", name, data ?? "");
  } catch {}
}
