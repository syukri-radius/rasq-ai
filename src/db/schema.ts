import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import type { Category, Priority, TestStep } from "@/lib/types";
import type { ProviderConfig } from "@/lib/aiContract";

const pk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

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
