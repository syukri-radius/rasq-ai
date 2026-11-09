import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { desktopAgents } from "@/db/schema";

export const hashDeviceToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function bearer(req: Request): string {
  const match = /^Bearer ([A-Za-z0-9_-]{20,300})$/.exec(req.headers.get("authorization") ?? "");
  return match?.[1] ?? "";
}

export function enrollmentConfigured(req: Request): boolean {
  const configured = process.env.RASQ_DESKTOP_ENROLLMENT_TOKEN ?? "";
  const supplied = bearer(req);
  if (configured.length < 16 || supplied.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

export async function authenticateDesktopAgent(req: Request, existingDb?: Db) {
  const token = bearer(req);
  if (!token) return null;
  const db = existingDb ?? await getDb();
  const [agent] = await db.select().from(desktopAgents).where(eq(desktopAgents.tokenHash, hashDeviceToken(token))).limit(1);
  return agent && !agent.revokedAt ? agent : null;
}
