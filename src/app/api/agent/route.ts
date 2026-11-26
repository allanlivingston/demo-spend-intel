// POST: runs an agent or chat turn and streams steps, text, artifacts over SSE.
import { setAdvancedView } from "@/engine";
import { z } from "zod";
import { checkCaps, record } from "@/agents/ledger";
import { defaultBackend, runAgent } from "@/agents/runAgent";
import type { AgentEvent, AgentRequest } from "@/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  agent: z.enum(["connector", "cache", "routing", "funding", "chat", "guide"]),
  prompt: z.string().min(1).max(2_000),
  demo: z.any(),
  group: z.enum(["all", "pe", "fpa", "mkt"]),
  pinned: z.array(z.string().max(1_500)).max(12).default([]),
  driverId: z.string().optional(),
  escalate: z.boolean().optional(),
  model: z.enum(["auto", "haiku", "sonnet", "opus"]).optional(),
  offline: z.boolean().optional(),
  advanced: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const req = parsed.data as AgentRequest;
  // Tools see the same view as the admin: the default view leaves out workstream-only items.
  setAdvancedView(req.advanced ?? true);
  const session = request.headers.get("x-demo-session") ?? "anon";
  // An early run starts the likely next step before the click (see agentClient). It only runs live, within the caps;
  // otherwise there is nothing to gain, and the click runs as usual.
  const early = request.headers.get("x-early-run") === "1";

  let backend = defaultBackend();
  let capReason: string | null = null;
  if (early && (req.offline || backend === "replay" || (backend === "api" && checkCaps(session, true)))) return new Response(null, { status: 204 });
  if (backend === "api") {
    capReason = checkCaps(session);
    if (capReason) backend = "replay";
  }
  // Stop the run when the browser lets go of it (an early run nobody clicked), so it stops spending.
  const stop = new AbortController();
  request.signal?.addEventListener("abort", () => stop.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => {
        if (!stop.signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      try {
        for await (const e of runAgent(capReason ? { ...req, offline: false } : req, {
          backend,
          signal: stop.signal,
          onDone: (o, d) => {
            if (o.backend === "api") record(session, d.costUsd);
            console.log(JSON.stringify({ evt: "agent_run", agent: req.agent, backend: o.backend, model: o.model, early, ...d }));
          },
        })) {
          if (stop.signal.aborted) break;
          send(e.type === "start" && capReason ? { ...e, replayReason: capReason } : e);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (stop.signal.aborted) console.log(JSON.stringify({ evt: "agent_run_stopped", agent: req.agent, early }));
        try { controller.close(); } catch { /* the browser already let go */ }
      }
    },
    cancel() {
      stop.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
