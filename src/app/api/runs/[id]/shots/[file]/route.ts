import fs from "node:fs";
import path from "node:path";
import type { Params } from "@/lib/api";
import { DATA_DIR } from "@/lib/runner";

export async function GET(_req: Request, { params }: Params<"id" | "file">) {
  const { id, file } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^\d+\.jpg$/.test(file)) return new Response("Bad request", { status: 400 });
  const p = path.join(DATA_DIR, "runs", id, file);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(p)), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=600" } });
}
