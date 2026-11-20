import { getDb } from "@/db";
import { body, fail, ok, type Params } from "@/lib/api";
import { DesktopTargetSchema, type DesktopTarget } from "@/lib/desktopContract";
import { compileStoredWorkflow } from "@/lib/desktopService";
import { authorize } from "@/lib/agentAuth";
import { projectAllowed, projectDeny, workflowProjectId } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "desktop:attend");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const input = await body<{ target?: Partial<DesktopTarget> }>(req);
    const target = DesktopTargetSchema.partial().parse(input.target ?? {});
    const db = await getDb();
    const pid = await workflowProjectId(db, id);
    if (pid && !projectAllowed(auth.actor, pid)) return projectDeny();
    const { compilation, bundle } = await compileStoredWorkflow(db, id, target);
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
  const auth = await authorize(req, "desktop:read");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const db = await getDb();
    const pid = await workflowProjectId(db, id);
    if (pid && !projectAllowed(auth.actor, pid)) return projectDeny();
    const url = new URL(req.url);
    const target = DesktopTargetSchema.parse({
      applicationName: url.searchParams.get("applicationName") ?? "",
      windowTitle: url.searchParams.get("windowTitle") ?? "",
      displayId: url.searchParams.get("displayId") ?? "",
      requireFocus: url.searchParams.get("requireFocus") !== "false",
    });
    const { bundle } = await compileStoredWorkflow(db, id, target);
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
