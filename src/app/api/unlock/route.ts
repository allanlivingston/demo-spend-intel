import { NextResponse } from "next/server";
import { GATE_COOKIE, gateToken, passcode } from "@/gate";

export async function POST(req: Request) {
  const code = passcode();
  const form = await req.formData();
  const given = String(form.get("passcode") ?? "").trim();
  // A relative Location keeps the visitor on the host they used, so the cookie is sent back.
  const res = new NextResponse(null, { status: 303, headers: { Location: code && given !== code ? "/unlock?wrong=1" : "/" } });
  if (code && given === code) {
    res.cookies.set(GATE_COOKIE, await gateToken(code), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return res;
}
