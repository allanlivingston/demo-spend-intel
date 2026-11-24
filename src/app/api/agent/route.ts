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

  let backend = defaultBackend();
  let capReason: string | null = null;
  if (backend === "api") {
    capReason = checkCaps(session);
    if (capReason) backend = "replay";
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        for await (const e of runAgent(capReason ? { ...req, offline: false } : req, {
          backend,
          onDone: (o, d) => {
            if (o.backend === "api") record(session, d.costUsd);
            console.log(JSON.stringify({ evt: "agent_run", agent: req.agent, backend: o.backend, model: o.model, ...d }));
          },
        })) {
          send(e.type === "start" && capReason ? { ...e, replayReason: capReason } : e);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
