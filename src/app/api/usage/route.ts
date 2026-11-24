import { usage } from "@/agents/ledger";
import { defaultBackend } from "@/agents/runAgent";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ backend: defaultBackend(), ...usage() });
}
