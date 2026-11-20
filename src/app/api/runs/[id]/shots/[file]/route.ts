import fs from "node:fs";
import path from "node:path";
import type { Params } from "@/lib/api";
import { DATA_DIR } from "@/lib/runner";
import { authorize } from "@/lib/agentAuth";

export async function GET(req: Request, { params }: Params<"id" | "file">) {
  const auth = await authorize(req, "runs:read");
  if ("response" in auth) return auth.response;
  const { id, file } = await params;
  const legacy = /^\d+\.jpg$/.test(file);
  const desktop = /^desktop-\d+-(before|after|preview)\.png$/.test(file);
  if (!/^[0-9a-f-]{36}$/.test(id) || (!legacy && !desktop)) return new Response("Bad request", { status: 400 });
  const p = path.join(DATA_DIR, "runs", id, file);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(p)), { headers: { "content-type": legacy ? "image/jpeg" : "image/png", "cache-control": "private, max-age=600" } });
}
