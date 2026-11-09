import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/db";
import { desktopAgents } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { enrollmentConfigured, hashDeviceToken } from "@/lib/desktopAuth";
import { DesktopCapabilitiesSchema, DesktopDisplaySchema, DesktopPermissionsSchema, DESKTOP_PROTOCOL_VERSION } from "@/lib/desktopContract";
import { publicDesktopAgent } from "@/lib/desktopService";

export const dynamic = "force-dynamic";
const EnrollmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  os: z.string().min(1).max(40),
  arch: z.string().min(1).max(40),
  agentVersion: z.string().min(1).max(40),
  capabilities: DesktopCapabilitiesSchema,
  displays: z.array(DesktopDisplaySchema).max(16),
  permissions: DesktopPermissionsSchema,
}).strict();

export async function POST(req: Request) {
  if (!process.env.RASQ_DESKTOP_ENROLLMENT_TOKEN) return fail("Desktop enrollment is disabled. Set RASQ_DESKTOP_ENROLLMENT_TOKEN on the control plane.", 503);
  if (!enrollmentConfigured(req)) return fail("Invalid desktop enrollment token", 401);
  try {
    const input = EnrollmentSchema.parse(await body(req));
    const deviceToken = randomBytes(32).toString("base64url");
    const [agent] = await getDb().then((db) => db.insert(desktopAgents).values({ ...input, protocolVersion: DESKTOP_PROTOCOL_VERSION, tokenHash: hashDeviceToken(deviceToken), lastHeartbeatAt: new Date() }).returning());
    return ok({ agent: publicDesktopAgent(agent), deviceToken, controlPlane: "Store the device token in the desktop agent's protected local configuration. It cannot be recovered from RASQ-Ai." }, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid desktop enrollment");
  }
}
