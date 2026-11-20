import { openApiDocument } from "@/lib/openapi";

export const dynamic = "force-dynamic";

/** Public discovery document for external AI agents. Contains no secrets. */
export async function GET() {
  return Response.json(openApiDocument, { headers: { "cache-control": "no-store" } });
}
