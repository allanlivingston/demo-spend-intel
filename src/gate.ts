// Optional passcode gate. Set APP_PASSCODE in .env.local (or the host's env) to require it; leave it blank to skip.
export const GATE_COOKIE = "csi-gate";

/** The cookie holds a hash of the passcode, never the passcode itself. */
export async function gateToken(passcode: string): Promise<string> {
  const data = new TextEncoder().encode(`csi:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const passcode = () => (process.env.APP_PASSCODE ?? "").trim();
