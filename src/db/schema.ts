import { sqliteTable, text, integer, real, primaryKey, unique, index } from "drizzle-orm/sqlite-core";
import type { Category, Priority, TestStep } from "@/lib/types";
import type { ProviderConfig } from "@/lib/aiContract";
import type { DesktopCapabilities, DesktopDisplay, DesktopPermissions, DesktopTarget } from "@/lib/desktopContract";

const pk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

/** External agent (machine) credentials. Only SHA-256 hashes of the random key body are stored; the plaintext is shown once at creation. */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: pk(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    /** First characters of the plaintext key (e.g. "rasq_7f3a…"); safe to display, never sufficient to authenticate. */
    keyPrefix: text("key_prefix").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [unique("api_keys_key_hash_unique").on(t.keyHash)],
);

/** Append-only audit trail. Rows are never updated or deleted by the application. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: pk(),
    actorType: text("actor_type").notNull(), // operator | agent
    actorId: text("actor_id"), // api_keys.id when actorType = agent
    actorName: text("actor_name").notNull().default(""),
    action: text("action").notNull(), // e.g. "POST /api/tests"
    status: text("status").notNull(), // ok | denied
    detail: text("detail").notNull().default(""),
    ip: text("ip").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_at_idx").on(t.createdAt)],
);

/** Operator-configured outbound webhooks for terminal run events. The HMAC signing secret is stored (like outbound provider credentials) so deliveries can be signed; it is shown once at creation and never listed back. */
export const webhooks = sqliteTable("webhooks", {
  id: pk(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events", { mode: "json" }).$type<string[]>().notNull().default([]),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastDeliveryAt: integer("last_delivery_at", { mode: "timestamp_ms" }),
  lastStatus: text("last_status").notNull().default(""),
  createdAt: createdAt(),
});

/** One row per delivery attempt result. Never updated after insert. */
export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: pk(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(), // ok | failed
    httpStatus: integer("http_status"),
    error: text("error").notNull().default(""),
    attempt: integer("attempt").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt)],
);

/** Idempotency-Key replay records for mutating agent/operator calls. Entries older than 24h are purged opportunistically. */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    actor: text("actor").notNull(), // "operator" or the agent key id
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    bodyHash: text("body_hash").notNull(),
    status: integer("status").notNull(),
    response: text("response").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.actor, t.key] })],
);

export const projects = sqliteTable("projects", {
  id: pk(),
  name: text("name").notNull(),
  surface: text("surface").notNull().default("web"),
  targetUrl: text("target_url").notNull().default(""),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
});

/** Provider catalog. Credentials are NEVER stored: only the name of the env var that holds the key. */
export const aiProviders = sqliteTable("ai_providers", {
  id: pk(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("openai"), // openai (compatible) | anthropic | gemini | json
  baseUrl: text("base_url").notNull().default(""),
  apiKeyEnv: text("api_key_env").notNull().default(""),
  models: text("models", { mode: "json" }).$type<string[]>().notNull().default([]),
  config: text("config", { mode: "json" }).$type<ProviderConfig>().notNull().default({}),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

export const modelRoutes = sqliteTable("model_routes", {
  task: text("task").primaryKey(),
  providerId: text("provider_id"), // null => local deterministic engine (no data leaves the server)
  model: text("model").notNull().default(""),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const desktopAgents = sqliteTable("desktop_agents", {
  id: pk(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  os: text("os").notNull(),
  arch: text("arch").notNull(),
  agentVersion: text("agent_version").notNull(),
  protocolVersion: text("protocol_version").notNull(),
  capabilities: text("capabilities", { mode: "json" }).$type<DesktopCapabilities>().notNull(),
  displays: text("displays", { mode: "json" }).$type<DesktopDisplay[]>().notNull().default([]),
  permissions: text("permissions", { mode: "json" }).$type<DesktopPermissions>().notNull(),
  availability: text("availability").notNull().default("idle"),
  currentRunId: text("current_run_id"),
  lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const policies = sqliteTable("policies", {
  id: pk(),
  name: text("name").notNull(),
  scope: text("scope").notNull().default("system"),
  priority: integer("priority").notNull().default(50),
  content: text("content").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

export const recordings = sqliteTable("recordings", {
  id: pk(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull().default("video/webm"),
  durationMs: integer("duration_ms").notNull().default(0),
  sizeBytes: integer("size_bytes").notNull().default(0),
  sha256: text("sha256").notNull().default(""),
  filePath: text("file_path").notNull(),
  createdAt: createdAt(),
});

/** One row per distinct page/window group found in a screenshot or recording. */
export const screens = sqliteTable("screens", {
  id: pk(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  recordingId: text("recording_id").references(() => recordings.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  groupKey: text("group_key").notNull().default("grp-1"),
  source: text("source").notNull().default("screenshot"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  imagePath: text("image_path").notNull(),
  frameCount: integer("frame_count").notNull().default(1),
  timestampMs: integer("timestamp_ms").notNull().default(0),
  perceptionModel: text("perception_model").notNull(),
  aiModel: text("ai_model"),
  createdAt: createdAt(),
});

export const controls = sqliteTable("controls", {
  id: pk(),
  screenId: text("screen_id")
    .notNull()
    .references(() => screens.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  label: text("label").notNull().default(""),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  w: integer("w").notNull(),
  h: integer("h").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  evidence: text("evidence").notNull().default(""),
  locatorHash: text("locator_hash").notNull().default(""),
  perceptionLabel: text("perception_label").notNull().default(""),
  aiModel: text("ai_model"),
  source: text("source").notNull().default("perception"),
  createdAt: createdAt(),
});

export const requirementDocs = sqliteTable("requirement_docs", {
  id: pk(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull().default("text/plain"),
  sha256: text("sha256").notNull().default(""),
  text: text("text").notNull(),
  analysisModel: text("analysis_model"),
  createdAt: createdAt(),
});

export const requirements = sqliteTable("requirements", {
  id: pk(),
  docId: text("doc_id")
    .notNull()
    .references(() => requirementDocs.id, { onDelete: "cascade" }),
  reqKey: text("req_key").notNull(), // exact requirement ID as written in the SRS
  text: text("text").notNull(),
  acceptance: text("acceptance", { mode: "json" }).$type<string[]>().notNull().default([]),
  category: text("category").notNull().default("functional"),
  ambiguity: text("ambiguity"),
  createdAt: createdAt(),
});

export const testCases = sqliteTable("test_cases", {
  id: pk(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  caseKey: text("case_key").notNull(),
  title: text("title").notNull(),
  category: text("category").$type<Category>().notNull(),
  priority: text("priority").$type<Priority>().notNull(),
  preconditions: text("preconditions", { mode: "json" }).$type<string[]>().notNull().default([]),
  testData: text("test_data", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  steps: text("steps", { mode: "json" }).$type<TestStep[]>().notNull().default([]),
  expected: text("expected").notNull(),
  assumptions: text("assumptions", { mode: "json" }).$type<string[]>().notNull().default([]),
  provenance: text("provenance").notNull(),
  createdAt: createdAt(),
});

/** Many-to-many requirement <-> test case traceability. */
export const testTraceability = sqliteTable(
  "test_traceability",
  {
    testCaseId: text("test_case_id")
      .notNull()
      .references(() => testCases.id, { onDelete: "cascade" }),
    requirementId: text("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.testCaseId, t.requirementId] })],
);

/** Restricted JSON REST load plans; no uploaded JMX or credentials are stored. */
export const performancePlans = sqliteTable("performance_plans", {
  id: pk(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  caseId: text("case_id").references(() => testCases.id, { onDelete: "set null" }),
  config: text("config", { mode: "json" }).$type<import("@/lib/performance").PerformancePlan>().notNull(),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const performanceRuns = sqliteTable("performance_runs", {
  id: pk(),
  planId: text("plan_id").notNull().references(() => performancePlans.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  summary: text("summary", { mode: "json" }).$type<import("@/lib/performance").PerformanceSummary | null>(),
  error: text("error").notNull().default(""),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

export const workflows = sqliteTable("workflows", {
  id: pk(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  n8n: text("n8n", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  provenance: text("provenance").notNull().default("manual"),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const runs = sqliteTable("runs", {
  id: pk(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("playwright"), // playwright | dry-run
  status: text("status").notNull().default("pending"),
  targetUrl: text("target_url").notNull().default(""),
  error: text("error"),
  summary: text("summary", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
  executor: text("executor").notNull().default("playwright"), // playwright | robotjs-desktop
  desktopAgentId: text("desktop_agent_id"),
  desktopDriver: text("desktop_driver").notNull().default(""), // robotjs | mock; mock is simulation, never real execution evidence
  desktopSessionState: text("desktop_session_state").notNull().default(""),
  desktopBundleSha256: text("desktop_bundle_sha256").notNull().default(""),
  desktopTarget: text("desktop_target", { mode: "json" }).$type<DesktopTarget | Record<string, never>>().notNull().default({}),
  desktopPreview: text("desktop_preview", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  desktopConfirmedAt: integer("desktop_confirmed_at", { mode: "timestamp_ms" }),
  desktopCancelRequested: integer("desktop_cancel_requested", { mode: "boolean" }).notNull().default(false),
  desktopLastEventSeq: integer("desktop_last_event_seq").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export const runSteps = sqliteTable("run_steps", {
  id: pk(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  nodeId: text("node_id").notNull(),
  nodeName: text("node_name").notNull(),
  nodeType: text("node_type").notNull(),
  status: text("status").notNull().default("pending"),
  message: text("message").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
});

export const desktopEvents = sqliteTable(
  "desktop_events",
  {
    id: pk(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("desktop_events_run_seq_unique").on(t.runId, t.seq)],
);

export const reports = sqliteTable("reports", {
  id: pk(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  markdown: text("markdown").notNull(),
  provenance: text("provenance").notNull(),
  createdAt: createdAt(),
});
