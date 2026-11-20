import { getDb } from "@/db";
import { buildSystem, callModel, errMsg, parseJson, provenanceOf, resolveRoute, untrusted } from "@/lib/ai";
import { body, fail, ok } from "@/lib/api";
import { AiScanSchema } from "@/lib/schemas";
import { CONTROL_TYPES } from "@/lib/types";
import { authorize } from "@/lib/agentAuth";

export const maxDuration = 300;

type Cand = { id: string; x: number; y: number; w: number; h: number; type: string; confidence: number };

/** Enriches client-side perception candidates with semantic labels from the operator-selected multimodal model. */
export async function POST(req: Request) {
  const auth = await authorize(req, "ai:scan");
  if ("response" in auth) return auth.response;
  const b = await body<{ name?: string; width: number; height: number; imageDataUrl: string; candidates: Cand[] }>(req);
  if (!b.imageDataUrl || !b.width || !b.height || !Array.isArray(b.candidates)) return fail("imageDataUrl, width, height and candidates are required");
  try {
    const db = await getDb();
    const route = await resolveRoute(db, "visual_scan");
    if (route.local) return fail(`No AI model selected for visual scanning. ${route.reason}`, 409);
    const system = await buildSystem(
      db,
      `TASK: visual scan. Output schema: {"controls":[{"candidateId":string,"type":"${CONTROL_TYPES.join("|")}"|null,"label":string,"confidence":0..1,"evidence":string}],"missed":[{"x":number,"y":number,"w":number,"h":number,"type":string,"label":string,"confidence":0..1,"evidence":string}]}.
Use type null for candidates that are not supported visual test objects. Do not change candidate coordinates. Only report "missed" objects that are clearly visible and absent from the candidates; coordinates are in the ${b.width}x${b.height} source pixel system.
Taxonomy: text is ordinary read-only copy; w_button is only a standard OS main-window minimize/maximize/restore/close button; w_text is only the OS main-window title; s_input is one composite search field including its adjacent search icon/button; p_input is a masked or explicitly identified password input; p_button requires push-and-hold; h_button requires hover; timer is a visible clock; gesture_arena is a bounded signature/gesture capture area. Static pixels do not prove hold, hover, realtime, masking, or gesture behavior, so use those types only with explicit visible evidence and state the uncertainty in evidence. Otherwise use a more general type. Do not infer font values or OCR wording that is not legible.
For a search composite, preserve candidate coordinates only when they already cover the whole group. Otherwise mark the partial candidate null and return one missed s_input with union bounds covering the field and adjacent search icon/button; do not also return its inner pieces as separate objects.`,
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
