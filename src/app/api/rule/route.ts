// POST: Claude words a suggested rule. Returns { wording } (or none, and the app keeps its template).
import { z } from "zod";
import { checkCaps, record } from "@/agents/ledger";
import { wordRule } from "@/agents/ruleWording";
import { defaultBackend } from "@/agents/runAgent";
import type { PrefRule } from "@/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  rule: z.object({
    id: z.string().max(60), topic: z.enum(["loop", "model", "cache", "fund-new", "planned"]), groupId: z.enum(["pe", "fpa", "mkt"]),
    level: z.enum(["allow", "ask", "skip"]), basedOn: z.string().max(300), createdAt: z.string().max(40),
  }),
  decision: z.enum(["declined", "applied"]),
  reason: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const session = request.headers.get("x-demo-session") ?? "anon";
  let backend = defaultBackend();
  if (backend === "api" && checkCaps(session)) backend = "replay";
  try {
    const r = await wordRule({ ...parsed.data, rule: parsed.data.rule as PrefRule }, backend, AbortSignal.timeout(30_000));
    if (backend === "api") record(session, r.costUsd);
    console.log(JSON.stringify({ evt: "rule_wording", backend, model: r.model, costUsd: r.costUsd, worded: !!r.wording }));
    return Response.json({ wording: r.wording ?? null, model: r.model, backend });
  } catch (err) {
    console.log(JSON.stringify({ evt: "rule_wording_error", backend, message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ wording: null, backend });
  }
}
