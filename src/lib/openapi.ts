/**
 * Hand-maintained OpenAPI 3.1 description of the RASQ-Ai agent-relevant API surface.
 * Served at GET /api/openapi.json (public, like a discovery document).
 *
 * Contract policy: additive-only within 1.x. Breaking changes would ship under a new major
 * `openapi.info.version` and path prefix review. `x-rasq-scope` on each operation names the
 * API-key scope an external agent needs (see AGENT_GUIDE.md). `/api/health` and
 * `/api/openapi.json` are public; everything else requires either the single-operator browser
 * session or a scoped `rasq_…` bearer key.
 */

const errorRef = { $ref: "#/components/schemas/Error" } as const;
const bearer = [{ bearerAuth: [] as string[] }];
const idemHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  schema: { type: "string", pattern: "^[A-Za-z0-9_\\-:.]{8,255}$" },
  description: "Replay-safe key for mutating calls. Same key + same body returns the stored response with `idempotent-replay: true`; same key + different body returns 409.",
} as const;
const scope = (s: string) => ({ "x-rasq-scope": s });
const errRes = (description: string) => ({
  description,
  content: { "application/json": { schema: errorRef } },
});
const json = (schema: unknown) => ({ "application/json": { schema } });

const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } } as const;
const projectIdQuery = { name: "projectId", in: "query", required: false, schema: { type: "string" } } as const;

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "RASQ-Ai API",
    version: "1.3.0",
    description:
      "Trustworthy visual test automation: optical capture, requirements traceability, test design, workflow execution and evidence-based reporting. External agents authenticate with scoped API keys (see /AGENT_GUIDE.md or the repository's AGENT_GUIDE.md). The browser UI is a single-operator surface; agents must never rely on unauthenticated access.",
    contact: { name: "RASQ-Ai operator" },
    license: { name: "Commercial (PT Radius Data Solusi)" },
  },
  servers: [{ url: "/", description: "Same-origin host serving this document" }],
  tags: [
    { name: "meta", description: "Discovery and health" },
    { name: "projects", description: "Projects and settings" },
    { name: "screens", description: "Recordings, screens and visual controls" },
    { name: "requirements", description: "SRS documents and requirements" },
    { name: "tests", description: "Test cases and traceability" },
    { name: "workflows", description: "n8n-shaped workflows" },
    { name: "runs", description: "Playwright/dry-run execution and evidence" },
    { name: "reports", description: "Evidence-based Markdown reports" },
    { name: "performance", description: "Restricted JSON REST load plans (JMeter)" },
    { name: "desktop", description: "Attended desktop agent control plane" },
    { name: "agent-keys", description: "API key management (operator only)" },
    { name: "webhooks", description: "Outbound webhook endpoints for terminal run events (operator only)" },
    { name: "audit", description: "Audit log query and export (operator only)" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "rasq_<random>", description: "Scoped external-agent API key, e.g. `rasq_…`. Create with POST /api/agent-keys or `npm run agent:key` (operator only)." },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", description: "Human-readable message" },
          code: { type: "string", description: "Machine-readable code: invalid_api_key | insufficient_scope | operator_only | rate_limited | validation_failed | not_found | idempotency_conflict | invalid_idempotency_key | …" },
        },
      },
      Health: { type: "object", properties: { ok: { type: "boolean" }, engine: { type: "string" }, app: { type: "string" }, version: { type: "string" } } },
      Project: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, surface: { type: "string", enum: ["web", "desktop", "citrix", "vmware", "mobile", "design"] }, targetUrl: { type: "string" }, description: { type: "string" }, createdAt: { type: "string", format: "date-time" } } },
      TestCase: { type: "object", properties: { id: { type: "string" }, caseKey: { type: "string" }, title: { type: "string" }, category: { type: "string" }, priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] }, requirementIds: { type: "array", items: { type: "string" } }, provenance: { type: "string" } } },
      WebhookEvent: {
        type: "object",
        required: ["id", "type", "createdAt", "data"],
        properties: {
          id: { type: "string", description: "evt_<uuid>" },
          type: { type: "string", enum: ["run.completed", "desktop.run.completed", "performance.run.completed", "webhook.test"] },
          createdAt: { type: "string", format: "date-time" },
          data: { type: "object", description: "Terminal run summary (runId, workflowId/planId, status, summary, error, timestamps). See AGENT_GUIDE.md#webhooks." },
        },
        description: "Delivered as POST application/json with x-rasq-signature: v1=<hex HMAC-SHA256(secret, `<timestamp>.<rawBody>`)> and x-rasq-webhook-timestamp header.",
      },
      Run: { type: "object", properties: { id: { type: "string" }, workflowId: { type: "string" }, mode: { type: "string", enum: ["playwright", "dry-run"] }, status: { type: "string", enum: ["pending", "running", "passed", "failed", "warning", "skipped", "needs-review", "error"] }, summary: { type: "object", additionalProperties: { type: "number" } }, error: { type: ["string", "null"] } } },
    },
  },
  paths: {
    "/api/health": {
      get: { tags: ["meta"], summary: "Liveness probe (public)", security: [], responses: { "200": { description: "Service and database are up", content: json({ $ref: "#/components/schemas/Health" }) }, "500": errRes("Database unavailable") } },
    },
    "/api/openapi.json": {
      get: { tags: ["meta"], summary: "This document (public)", security: [], responses: { "200": { description: "OpenAPI 3.1 document", content: json({ type: "object" }) } } },
    },
    "/api/projects": {
      get: { tags: ["projects"], summary: "List projects", ...scope("projects:read"), security: bearer, responses: { "200": { description: "All projects", content: json({ type: "array", items: { $ref: "#/components/schemas/Project" } }) }, "401": errRes("Invalid key"), "403": errRes("Missing scope") } },
      post: { tags: ["projects"], summary: "Create project", ...scope("projects:write"), security: bearer, parameters: [idemHeader], requestBody: { required: true, content: json({ type: "object", required: ["name"], properties: { name: { type: "string" }, surface: { type: "string" }, targetUrl: { type: "string" }, description: { type: "string" } } }) }, responses: { "200": { description: "Created" }, "401": errRes("Invalid key"), "403": errRes("Missing scope") } },
    },
    "/api/settings": {
      get: { tags: ["projects"], summary: "Read AI mode, routes, policies and provider catalog", ...scope("settings:read"), security: bearer, responses: { "200": { description: "Settings bundle" }, "401": errRes("Invalid key"), "403": errRes("Missing scope") } },
      put: { tags: ["projects"], summary: "Update AI mode / routes / policies", ...scope("settings:write"), security: bearer, requestBody: { required: true, content: json({ type: "object" }) }, responses: { "200": { description: "Saved" }, "401": errRes("Invalid key"), "403": errRes("Missing scope") } },
    },
    "/api/providers": {
      post: { tags: ["projects"], summary: "Add provider (operator-configured env var names only; never key values)", ...scope("providers:write"), security: bearer, requestBody: { required: true, content: json({ type: "object" }) }, responses: { "200": { description: "Created" }, "400": errRes("Validation failed"), "403": errRes("Missing scope") } },
      patch: { tags: ["projects"], summary: "Update provider", ...scope("providers:write"), security: bearer, requestBody: { required: true, content: json({ type: "object" }) }, responses: { "200": { description: "Updated" }, "403": errRes("Missing scope") } },
      delete: { tags: ["projects"], summary: "Remove provider by id (query ?id=)", ...scope("providers:write"), security: bearer, responses: { "200": { description: "Removed" }, "403": errRes("Missing scope") } },
    },
    "/api/capture": {
      post: { tags: ["screens"], summary: "Server-side Playwright screenshot of a URL (PNG data URL)", ...scope("capture:run"), security: bearer, requestBody: { required: true, content: json({ type: "object", properties: { url: { type: "string" }, width: { type: "number" }, height: { type: "number" } } }) }, responses: { "200": { description: "PNG data URL" }, "403": errRes("Missing scope") } },
    },
    "/api/ai/scan": {
      post: { tags: ["screens"], summary: "AI semantic enrichment of perception candidates (requires non-Local provider)", ...scope("ai:scan"), security: bearer, requestBody: { required: true, content: json({ type: "object" }) }, responses: { "200": { description: "Enriched candidates" }, "409": errRes("Local engine selected"), "403": errRes("Missing scope") } },
    },
    "/api/recordings": {
      get: { tags: ["screens"], summary: "List recordings (query ?projectId=)", ...scope("screens:read"), security: bearer, responses: { "200": { description: "Recordings" }, "403": errRes("Missing scope") } },
      post: { tags: ["screens"], summary: "Upload a screen recording (multipart)", ...scope("screens:write"), security: bearer, requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object" } } } }, responses: { "200": { description: "Saved" }, "403": errRes("Missing scope") } },
    },
    "/api/recordings/{id}": {
      get: { tags: ["screens"], summary: "Download recording binary", ...scope("screens:read"), security: bearer, parameters: [idParam], responses: { "200": { description: "Binary recording" }, "404": errRes("Not found") } },
      delete: { tags: ["screens"], summary: "Delete recording row and file", ...scope("delete:artifacts"), security: bearer, parameters: [idParam], responses: { "200": { description: "Deleted" }, "403": errRes("Missing scope") } },
    },
    "/api/screens": {
      get: { tags: ["screens"], summary: "List saved screens with visual controls (query ?projectId=&recordingId=)", ...scope("screens:read"), security: bearer, responses: { "200": { description: "Screens with controls" }, "403": errRes("Missing scope") } },
      post: { tags: ["screens"], summary: "Save a screen (image + controls)", ...scope("screens:write"), security: bearer, requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object" } } } }, responses: { "201": { description: "Persisted, returns server control IDs" }, "403": errRes("Missing scope") } },
    },
    "/api/screens/{id}": {
      get: { tags: ["screens"], summary: "Screen image binary", ...scope("screens:read"), security: bearer, parameters: [idParam], responses: { "200": { description: "Image" }, "404": errRes("Not found") } },
      put: { tags: ["screens"], summary: "Update screen metadata/controls (stable control IDs)", ...scope("screens:write"), security: bearer, parameters: [idParam], requestBody: { required: true, content: json({ type: "object" }) }, responses: { "200": { description: "Updated" }, "403": errRes("Missing scope") } },
      delete: { tags: ["screens"], summary: "Delete screen and image", ...scope("delete:artifacts"), security: bearer, parameters: [idParam], responses: { "200": { description: "Deleted" }, "403": errRes("Missing scope") } },
    },
    "/api/requirements": {
      get: { tags: ["requirements"], summary: "List requirement docs and requirements (query ?projectId=)", ...scope("requirements:read"), security: bearer, parameters: [projectIdQuery], responses: { "200": { description: "Documents and requirements" }, "403": errRes("Missing scope") } },
      post: { tags: ["requirements"], summary: "Upload/paste an SRS (multipart); parsed locally, optional AI analysis", ...scope("requirements:write"), security: bearer, requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object" } } } }, responses: { "200": { description: "Parsed and persisted" }, "403": errRes("Missing scope") } },
      delete: { tags: ["requirements"], summary: "Delete a requirement doc (query ?docId=)", ...scope("delete:artifacts"), security: bearer, responses: { "200": { description: "Deleted" }, "403": errRes("Missing scope") } },
    },
    "/api/tests": {
      get: { tags: ["tests"], summary: "List test cases (query ?projectId=, required)", ...scope("tests:read"), security: bearer, parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Cases with requirement keys" }, "403": errRes("Missing scope") } },
      post: {
        tags: ["tests"], summary: "Generate test cases (source: requirements|visual). SRS generation REPLACE-ALL by default; pass replace:false to append", ...scope("tests:generate"), security: bearer, parameters: [idemHeader],
        requestBody: { required: true, content: json({ type: "object", required: ["projectId"], properties: { projectId: { type: "string" }, docId: { type: "string" }, source: { type: "string", enum: ["requirements", "visual"] }, screenIds: { type: "array", items: { type: "string" } }, replace: { type: "boolean" } } }) },
        responses: { "201": { description: "Generated count, provenance, warnings" }, "400": errRes("Validation failed"), "403": errRes("Missing scope"), "409": errRes("Idempotency conflict") },
      },
      delete: { tags: ["tests"], summary: "Delete one case (?id=) or all project cases (?projectId=)", ...scope("delete:artifacts"), security: bearer, responses: { "200": { description: "Deleted" }, "403": errRes("Missing scope") } },
    },
    "/api/tests/export": {
      get: { tags: ["tests"], summary: "Export cases as CSV or JSON (query ?projectId=&format=)", ...scope("tests:read"), security: bearer, responses: { "200": { description: "File download" }, "403": errRes("Missing scope") } },
    },
    "/api/workflows": {
      get: { tags: ["workflows"], summary: "List workflows (query ?projectId=)", ...scope("workflows:read"), security: bearer, responses: { "200": { description: "Workflow summaries" }, "403": errRes("Missing scope") } },
      post: {
        tags: ["workflows"], summary: "Create workflow (mode: generate|import|blank)", ...scope("workflows:write"), security: bearer, parameters: [idemHeader],
        requestBody: { required: true, content: json({ type: "object", required: ["projectId", "mode"], properties: { projectId: { type: "string" }, mode: { type: "string", enum: ["generate", "import", "blank"] }, name: { type: "string" }, caseIds: { type: "array", items: { type: "string" } }, n8n: { type: "object" } } }) },
        responses: { "201": { description: "Created workflow id" }, "400": errRes("Validation failed"), "403": errRes("Missing scope"), "409": errRes("Idempotency conflict") },
      },
    },
    "/api/workflows/{id}": {
      get: { tags: ["workflows"], summary: "Get saved n8n workflow JSON", ...scope("workflows:read"), security: bearer, parameters: [idParam], responses: { "200": { description: "Workflow" }, "404": errRes("Not found") } },
      put: { tags: ["workflows"], summary: "Validate and save workflow (version increments)", ...scope("workflows:write"), security: bearer, parameters: [idParam], requestBody: { required: true, content: json({ type: "object", required: ["n8n"], properties: { name: { type: "string" }, n8n: { type: "object" } } }) }, responses: { "200": { description: "Saved, new version" }, "403": errRes("Missing scope"), "404": errRes("Not found") } },
      delete: { tags: ["workflows"], summary: "Delete workflow (cascades runs)", ...scope("delete:artifacts"), security: bearer, parameters: [idParam], responses: { "200": { description: "Deleted" }, "403": errRes("Missing scope") } },
    },
    "/api/workflows/{id}/export": {
      get: { tags: ["workflows"], summary: "Download n8n-compatible JSON", ...scope("workflows:read"), security: bearer, parameters: [idParam], responses: { "200": { description: "JSON file" }, "404": errRes("Not found") } },
    },
    "/api/runs": {
      get: { tags: ["runs"], summary: "List runs (query ?workflowId=; latest 50)", ...scope("runs:read"), security: bearer, responses: { "200": { description: "Runs" }, "403": errRes("Missing scope") } },
      post: {
        tags: ["runs"], summary: "Start a run. Scope is mode-aware: runs:start:dry-run (validates only) or runs:start:playwright (executes in a browser)", security: bearer, parameters: [idemHeader],
        "x-rasq-scope": "runs:start:dry-run | runs:start:playwright (selected by body mode)",
        requestBody: { required: true, content: json({ type: "object", required: ["workflowId"], properties: { workflowId: { type: "string" }, mode: { type: "string", enum: ["playwright", "dry-run"], default: "playwright" }, targetUrl: { type: "string" } } }) },
        responses: { "202": { description: "Run accepted; poll /api/runs/{id}" }, "403": errRes("Missing scope for the requested mode"), "409": errRes("Idempotency conflict") },
      },
    },
    "/api/runs/{id}": {
      get: { tags: ["runs"], summary: "Run status and ordered steps", ...scope("runs:read"), security: bearer, parameters: [idParam], responses: { "200": { description: "Run with steps", content: json({ $ref: "#/components/schemas/Run" }) }, "404": errRes("Not found") } },
    },
    "/api/runs/{id}/shots/{file}": {
      get: { tags: ["runs"], summary: "Step evidence image", ...scope("runs:read"), security: bearer, parameters: [idParam, { name: "file", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Image" }, "404": errRes("Not found") } },
    },
    "/api/reports": {
      get: { tags: ["reports"], summary: "List reports (query ?projectId=)", ...scope("reports:read"), security: bearer, responses: { "200": { description: "Reports" }, "403": errRes("Missing scope") } },
      post: { tags: ["reports"], summary: "Generate and persist an evidence-based Markdown report", ...scope("reports:generate"), security: bearer, requestBody: { required: true, content: json({ type: "object", required: ["projectId"], properties: { projectId: { type: "string" } } }) }, responses: { "201": { description: "Report created" }, "403": errRes("Missing scope") } },
      delete: { tags: ["reports"], summary: "Delete report (query ?id=)", ...scope("delete:artifacts"), security: bearer, responses: { "200": { description: "Deleted" }, "403": errRes("Missing scope") } },
    },
    "/api/reports/{id}": {
      get: { tags: ["reports"], summary: "Download report Markdown", ...scope("reports:read"), security: bearer, parameters: [idParam], responses: { "200": { description: "Markdown file" }, "404": errRes("Not found") } },
    },
    "/api/performance": {
      get: { tags: ["performance"], summary: "Plans, scenarios, requirements and run history (query ?projectId=)", ...scope("performance:read"), security: bearer, parameters: [{ ...projectIdQuery, required: true }], responses: { "200": { description: "Performance workspace" }, "403": errRes("Missing scope") } },
      post: { tags: ["performance"], summary: "Create a restricted JSON REST plan", ...scope("performance:plan"), security: bearer, requestBody: { required: true, content: json({ type: "object" }) }, responses: { "201": { description: "Plan created" }, "400": errRes("Invalid plan"), "403": errRes("Missing scope") } },
      put: { tags: ["performance"], summary: "Update a plan", ...scope("performance:plan"), security: bearer, requestBody: { required: true, content: json({ type: "object" }) }, responses: { "200": { description: "Plan updated" }, "403": errRes("Missing scope"), "404": errRes("Not found") } },
      delete: { tags: ["performance"], summary: "Delete plan (query ?id=); blocked while a run is active", ...scope("performance:plan"), security: bearer, responses: { "200": { description: "Deleted" }, "403": errRes("Missing scope"), "409": errRes("Run still active") } },
    },
    "/api/performance/runs": {
      get: { tags: ["performance"], summary: "Poll a load run (query ?id=)", ...scope("performance:read"), security: bearer, responses: { "200": { description: "Run status and analysis" }, "403": errRes("Missing scope") } },
      post: { tags: ["performance"], summary: "Start a confirmed JMeter run. Origin must be on RASQ_JMETER_ALLOWED_ORIGINS", ...scope("performance:load"), security: bearer, requestBody: { required: true, content: json({ type: "object", required: ["planId", "confirm"], properties: { planId: { type: "string" }, confirm: { type: "boolean", const: true } } }) }, responses: { "202": { description: "Run started" }, "403": errRes("Missing scope") } },
      delete: { tags: ["performance"], summary: "Cancel an active load run (query ?id=)", ...scope("performance:load"), security: bearer, responses: { "200": { description: "Cancellation requested" }, "403": errRes("Missing scope") } },
    },
    "/api/desktop/agents": {
      get: { tags: ["desktop"], summary: "List enrolled desktop agents (sanitized)", ...scope("desktop:read"), security: bearer, responses: { "200": { description: "Agents" }, "403": errRes("Missing scope") } },
      delete: { tags: ["desktop"], summary: "Revoke agent and terminate its active runs (query ?id=)", ...scope("desktop:revoke"), security: bearer, responses: { "200": { description: "Revoked" }, "403": errRes("Missing scope") } },
    },
    "/api/desktop/workflows/{id}": {
      post: { tags: ["desktop"], summary: "Compile workflow to rasq-desktop.v1 manifest (diagnostics)", ...scope("desktop:attend"), security: bearer, parameters: [idParam], requestBody: { required: true, content: json({ type: "object" }) }, responses: { "200": { description: "Compilation result" }, "403": errRes("Missing scope") } },
      get: { tags: ["desktop"], summary: "Download deterministic RobotJS bundle (query ?target=)", ...scope("desktop:read"), security: bearer, parameters: [idParam], responses: { "200": { description: "ZIP bundle" }, "403": errRes("Missing scope") } },
    },
    "/api/desktop/runs": {
      post: { tags: ["desktop"], summary: "Compile and reserve an attended or dry-run desktop session", ...scope("desktop:attend"), security: bearer, requestBody: { required: true, content: json({ type: "object" }) }, responses: { "202": { description: "Run queued; requires operator confirmation before input" }, "403": errRes("Missing scope"), "409": errRes("Agent unavailable") } },
    },
    "/api/desktop/runs/{id}/confirm": {
      post: { tags: ["desktop"], summary: "Authorize attended input after preflight. Operators grant this scope deliberately; attended confirmation is the safety boundary for real OS input", ...scope("desktop:confirm"), security: bearer, parameters: [idParam], responses: { "200": { description: "Input authorized" }, "403": errRes("Missing scope") } },
    },
    "/api/desktop/runs/{id}/cancel": {
      post: { tags: ["desktop"], summary: "Request cancellation of a desktop run", ...scope("desktop:attend"), security: bearer, parameters: [idParam], responses: { "200": { description: "Cancellation requested" }, "403": errRes("Missing scope") } },
    },
    "/api/webhooks": {
      get: { tags: ["webhooks"], summary: "List webhook endpoints (secrets never returned; operator only)", security: bearer, responses: { "200": { description: "Webhook list" }, "403": errRes("Operator only") } },
      post: { tags: ["webhooks"], summary: "Register an endpoint for terminal events (operator only). Signing secret is returned once", security: bearer, requestBody: { required: true, content: json({ type: "object", required: ["name", "url", "events"], properties: { name: { type: "string" }, url: { type: "string", format: "uri" }, events: { type: "array", items: { type: "string", enum: ["run.completed", "desktop.run.completed", "performance.run.completed", "webhook.test"] } }, enabled: { type: "boolean" } } }) }, responses: { "201": { description: "Created; store the whsec_ secret now" }, "400": errRes("Validation failed"), "403": errRes("Operator only"), "409": errRes("Limit reached") } },
      patch: { tags: ["webhooks"], summary: "Enable/disable an endpoint (operator only)", security: bearer, requestBody: { required: true, content: json({ type: "object", required: ["id", "enabled"], properties: { id: { type: "string", format: "uuid" }, enabled: { type: "boolean" } } }) }, responses: { "200": { description: "Updated" }, "403": errRes("Operator only"), "404": errRes("Not found") } },
      delete: { tags: ["webhooks"], summary: "Delete endpoint and its delivery history (query ?id=, operator only)", security: bearer, responses: { "200": { description: "Deleted" }, "403": errRes("Operator only"), "404": errRes("Not found") } },
    },
    "/api/webhooks/{id}/test": {
      post: { tags: ["webhooks"], summary: "Send a synthetic webhook.test event to this endpoint (operator only)", security: bearer, parameters: [idParam], responses: { "200": { description: "Delivered; check `delivered` for the receiver result" }, "403": errRes("Operator only"), "404": errRes("Not found"), "502": errRes("Receiver rejected or unreachable") } },
    },
    "/api/webhooks/deliveries": {
      get: { tags: ["webhooks"], summary: "Delivery attempts, newest 100 (query ?webhookId= to scope; operator only)", security: bearer, responses: { "200": { description: "Delivery history" }, "403": errRes("Operator only") } },
    },
    "/api/audit": {
      get: {
        tags: ["audit"],
        summary: "Query or export the audit log (operator only). Filters: actorType, actorId, status, action (substring), from/to (ISO 8601), limit (1–1000, default 100), offset, format=json|csv (CSV capped at 10,000 rows; formula-injection-safe)",
        security: bearer,
        parameters: [
          { name: "actorType", in: "query", required: false, schema: { type: "string", enum: ["operator", "agent", "unauthenticated"] } },
          { name: "actorId", in: "query", required: false, schema: { type: "string" } },
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["ok", "denied"] } },
          { name: "action", in: "query", required: false, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", default: 100, maximum: 1000 } },
          { name: "offset", in: "query", required: false, schema: { type: "integer", default: 0 } },
          { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "csv"], default: "json" } },
        ],
        responses: { "200": { description: "Matching audit rows plus total" }, "400": errRes("Invalid filter"), "403": errRes("Operator only") },
      },
    },
    "/api/agent-keys": {
      get: { tags: ["agent-keys"], summary: "List key metadata (operator only; never plaintext)", security: bearer, responses: { "200": { description: "Key list" }, "403": errRes("Operator only") } },
      post: { tags: ["agent-keys"], summary: "Mint a key; plaintext returned once (operator only)", security: bearer, requestBody: { required: true, content: json({ type: "object", required: ["name", "scopes"], properties: { name: { type: "string" }, scopes: { type: "array", items: { type: "string" } }, ttlDays: { type: "integer" }, projectIds: { type: "array", items: { type: "string" }, description: "Restrict the key to these projects; empty/omitted = all projects (no isolation)" }, dailyMutationLimit: { type: "integer", minimum: 1, nullable: true, description: "Max mutating calls per UTC day; null = RASQ_AGENT_DAILY_MUTATIONS default (0 = unlimited)" } } }) }, responses: { "201": { description: "Created; store the key now" }, "403": errRes("Operator only") } },
      delete: { tags: ["agent-keys"], summary: "Revoke a key by id (query ?id=, operator only)", security: bearer, responses: { "200": { description: "Revoked" }, "403": errRes("Operator only"), "404": errRes("Not found") } },
    },
  },
} as const;
