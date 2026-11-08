import { getDb } from "@/db";
import { buildSystem, callModel, errMsg, parseJson, provenanceOf, resolveRoute, untrusted } from "@/lib/ai";
import { body, fail, ok } from "@/lib/api";
import { AiScanSchema } from "@/lib/schemas";

export const maxDuration = 300;

type Cand = { id: string; x: number; y: number; w: number; h: number; type: string; confidence: number };

/** Enriches client-side perception candidates with semantic labels from the operator-selected multimodal model. */
export async function POST(req: Request) {
  const b = await body<{ name?: string; width: number; height: number; imageDataUrl: string; candidates: Cand[] }>(req);
  if (!b.imageDataUrl || !b.width || !b.height || !Array.isArray(b.candidates)) return fail("imageDataUrl, width, height and candidates are required");
  try {
    const db = await getDb();
    const route = await resolveRoute(db, "visual_scan");
    if (route.local) return fail(`No AI model selected for visual scanning. ${route.reason}`, 409);
    const system = await buildSystem(
      db,
      `TASK: visual scan. Output schema: {"controls":[{"candidateId":string,"type":"input|button|dropdown|date_picker|checkbox|toggle|slider|upload|download"|null,"label":string,"confidence":0..1,"evidence":string}],"missed":[{"x":number,"y":number,"w":number,"h":number,"type":string,"label":string,"confidence":0..1,"evidence":string}]}.
Use type null for candidates that are not interactive controls. Do not change candidate coordinates. Only report "missed" controls that are clearly visible and absent from the candidates; coordinates are in the ${b.width}x${b.height} source pixel system.`,
    );
    const cands = b.candidates.slice(0, 120).map((c) => ({ candidateId: c.id, x: c.x, y: c.y, w: c.w, h: c.h, perceptionGuess: c.type, perceptionConfidence: c.confidence }));
    const user = `Screen "${(b.name ?? "").slice(0, 80)}" source size ${b.width}x${b.height}. The image is attached. Candidate boxes from RASQ-Ai perception (geometry only):\n${untrusted("candidates", JSON.stringify(cands))}`;
    const raw = await callModel(route, { system, user, images: [b.imageDataUrl] });
    const parsed = AiScanSchema.parse(parseJson(raw));
    const valid = new Set(b.candidates.map((c) => c.id));
    const inBounds = (m: { x: number; y: number; w: number; h: number }) => m.x >= 0 && m.y >= 0 && m.x + m.w <= b.width * 1.01 && m.y + m.h <= b.height * 1.01;
    return ok({
      model: provenanceOf(route),
      controls: parsed.controls.filter((c) => valid.has(c.candidateId)),
      missed: parsed.missed.filter(inBounds).slice(0, 30),
    });
  } catch (e) {
    return fail(errMsg(e), 502);
  }
}
