import { body, fail } from "@/lib/api";
import { captureScreenshot } from "@/lib/runner";
import { authorize } from "@/lib/agentAuth";

const SIZE = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

export async function POST(req: Request) {
  const auth = await authorize(req, "capture:run");
  if ("response" in auth) return auth.response;
  const b = await body<{ url?: string; width?: number; height?: number }>(req);
  if (!b.url) return fail("url required");
  const width = SIZE(b.width, 1280, 100, 3840);
  const height = SIZE(b.height, 800, 100, 2160);
  try {
    const png = await captureScreenshot(b.url, width, height);
    return Response.json({ dataUrl: `data:image/png;base64,${png.toString("base64")}`, width, height });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Capture failed", 502);
  }
}
