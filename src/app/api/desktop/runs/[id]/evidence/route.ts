import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runs, runSteps } from "@/db/schema";
import { body, fail, ok, type Params } from "@/lib/api";
import { authenticateDesktopAgent } from "@/lib/desktopAuth";
import { DesktopEvidenceSchema, DESKTOP_LIMITS } from "@/lib/desktopContract";
import { DATA_DIR } from "@/lib/runner";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const agent = await authenticateDesktopAgent(req, db);
  if (!agent) return fail("Invalid or revoked desktop device credential", 401);
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, id));
    if (!run || run.desktopAgentId !== agent.id || run.executor !== "robotjs-desktop") return fail("Desktop run is not assigned to this agent", 404);
    if (!["pending", "running"].includes(run.status) || run.desktopCancelRequested) return fail("Run is terminal or cancelled; preview/evidence upload is closed.", 409);
    const input = DesktopEvidenceSchema.parse(await body(req));
    const png = Buffer.from(input.dataBase64, "base64");
    if (png.length > DESKTOP_LIMITS.evidenceBytes || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return fail("Evidence must be a PNG within the 6 MiB limit.");
    if (createHash("sha256").update(png).digest("hex") !== input.sha256) return fail("Evidence SHA-256 mismatch.");
    let step: typeof runSteps.$inferSelect | undefined;
    if (input.nodeId) {
      [step] = await db.select().from(runSteps).where(and(eq(runSteps.runId, id), eq(runSteps.nodeId, input.nodeId)));
      if (!step) return fail("Evidence references an unknown run step.");
    }
    const file = `desktop-${input.sequence}-${input.kind}.png`;
    const dir = path.join(DATA_DIR, "runs", id);
    await fs.promises.mkdir(dir, { recursive: true });
    const destination = path.join(dir, file);
    try {
      await fs.promises.writeFile(destination, png, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const existing = await fs.promises.readFile(destination);
      if (!existing.equals(png)) return fail("Evidence sequence was replayed with different content.", 409);
    }
    const evidence = { shot: file, sha256: input.sha256, capturedAt: input.capturedAt, display: input.display, kind: input.kind };
    if (input.kind === "preview") {
      await db.update(runs).set({ desktopPreview: { ...evidence, sequence: input.sequence } }).where(eq(runs.id, id));
    } else if (step) {
      const key = input.kind === "before" ? "beforeShot" : "afterShot";
      await db.update(runSteps).set({ evidence: { ...step.evidence, [key]: evidence, ...(input.kind === "after" ? { shot: file } : {}) } }).where(eq(runSteps.id, step.id));
    }
    return ok(evidence, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Desktop evidence was rejected");
  }
}
