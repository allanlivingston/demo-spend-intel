import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, passcode } from "./gate";

export async function middleware(req: NextRequest) {
  const code = passcode();
  if (!code) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/unlock" || pathname === "/api/unlock") return NextResponse.next();
  if (req.cookies.get(GATE_COOKIE)?.value === (await gateToken(code))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Locked" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  // Keep a shared ?passcode= so the unlock page can prefill it.
  const shared = req.nextUrl.searchParams.get("passcode");
  url.search = shared ? `?passcode=${encodeURIComponent(shared)}` : "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/|icon.svg|favicon.ico).*)"] };
