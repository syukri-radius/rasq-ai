import { getDb } from "@/db";
import { body, fail, ok, type Params } from "@/lib/api";
import { DesktopTargetSchema, type DesktopTarget } from "@/lib/desktopContract";
import { compileStoredWorkflow } from "@/lib/desktopService";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: Params<"id">) {
  try {
    const { id } = await params;
    const input = await body<{ target?: Partial<DesktopTarget> }>(req);
    const target = DesktopTargetSchema.partial().parse(input.target ?? {});
    const { compilation, bundle } = await compileStoredWorkflow(await getDb(), id, target);
    return ok({
      manifest: compilation.manifest,
      diagnostics: compilation.diagnostics,
      executable: Boolean(bundle),
      bundleSha256: bundle?.sha256 ?? null,
      stepCount: compilation.manifest.steps.length,
      anchorCount: Object.keys(compilation.anchors).length,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Desktop compilation failed", 422);
  }
}

export async function GET(req: Request, { params }: Params<"id">) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const target = DesktopTargetSchema.parse({
      applicationName: url.searchParams.get("applicationName") ?? "",
      windowTitle: url.searchParams.get("windowTitle") ?? "",
      displayId: url.searchParams.get("displayId") ?? "",
      requireFocus: url.searchParams.get("requireFocus") !== "false",
    });
    const { bundle } = await compileStoredWorkflow(await getDb(), id, target);
    if (!bundle) return fail("Desktop workflow has blocking compiler diagnostics.", 422);
    return new Response(new Uint8Array(bundle.bytes), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="rasq-desktop-${id}.zip"`,
        "x-rasq-bundle-sha256": bundle.sha256,
      },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Desktop bundle export failed", 422);
  }
}
