import { body, fail } from "@/lib/api";
import { captureScreenshot } from "@/lib/runner";

export async function POST(req: Request) {
  const b = await body<{ url?: string; width?: number; height?: number }>(req);
  if (!b.url) return fail("url required");
  try {
    const png = await captureScreenshot(b.url, Math.min(3840, b.width ?? 1280), Math.min(2160, b.height ?? 800));
    return Response.json({ dataUrl: `data:image/png;base64,${png.toString("base64")}`, width: Math.min(3840, b.width ?? 1280), height: Math.min(2160, b.height ?? 800) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Capture failed", 502);
  }
}
