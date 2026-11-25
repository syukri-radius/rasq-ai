/**
 * RASQ-Ai MCP server — a thin stdio adapter over the RASQ-Ai HTTP API.
 *
 * Design (ADR, see CONTEXT_MEMORY.md):
 * - This process holds NO database or business logic. Every tool maps 1:1 to an HTTP route,
 *   sending the operator-issued API key in `Authorization: Bearer rasq_…`. Scope enforcement,
 *   audit logging, rate limiting and idempotency all happen server-side exactly as for any
 *   other external agent — there is no second, divergent authorization path to audit.
 * - Exposes only reads and explicitly non-destructive generation/dry-run operations.
 *   There are intentionally no destructive, attending (desktop control), or load-generating
 *   tools: use the HTTP API with a key holding those scopes if the operator grants them.
 *
 * Configuration (environment):
 *   RASQ_AI_URL   Base URL of the RASQ-Ai server. Default: http://127.0.0.1:3000
 *   RASQ_API_KEY  A rasq_… API key issued by the operator (required).
 *
 * Run: `npm run mcp` (stdio). Configure in an MCP client, e.g.:
 *   { "mcpServers": { "rasq-ai": { "command": "npm", "args": ["run", "mcp"], "env": { "RASQ_AI_URL": "http://127.0.0.1:3000", "RASQ_API_KEY": "rasq_…" } } } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { APP_VERSION } from "../lib/version";

const BASE_URL = (process.env.RASQ_AI_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const API_KEY = process.env.RASQ_API_KEY ?? "";
const MAX_BODY = 16_000;

if (!/^rasq_[A-Za-z0-9_-]{20,300}$/.test(API_KEY)) {
  console.error("rasq-ai mcp: RASQ_API_KEY is missing or malformed. Ask the operator to issue a key (scripts/create-agent-key.ts) and set RASQ_API_KEY.");
  process.exit(1);
}

type Json = Record<string, unknown>;

async function callApi(method: "GET" | "POST", path: string, json?: Json, idempotencyKey?: string): Promise<{ ok: boolean; status: number; body: string }> {
  const headers: Record<string, string> = { authorization: `Bearer ${API_KEY}`, accept: "application/json" };
  if (json !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "\n…[truncated]" : text };
}

function toolResult(result: { ok: boolean; status: number; body: string }) {
  return { content: [{ type: "text" as const, text: result.ok ? result.body : `HTTP ${result.status}: ${result.body}` }], isError: !result.ok };
}

const idemField = { idempotency_key: z.string().min(8).max(200).optional().describe("Optional Idempotency-Key (8–200 chars) to make retries of this mutating call safe; a 409 means the payload drifted for that key.") };

const server = new McpServer({ name: "rasq-ai", version: APP_VERSION }, { instructions: "Read and limited safe-generation access to a RASQ-Ai QA automation server via its HTTP API. All calls are authenticated with the operator-issued key in RASQ_API_KEY; the server enforces scopes and audits mutations. No destructive, attending, or load-generating operations are exposed." });

server.registerTool("rasqai_health", {
  title: "Health check",
  description: "Check that the RASQ-Ai server is reachable. No scope required.",
  annotations: { readOnlyHint: true },
}, async () => toolResult(await callApi("GET", "/api/health")));

server.registerTool("rasqai_list_projects", {
  title: "List projects",
  description: "List automation projects. Requires scope: projects:read.",
  annotations: { readOnlyHint: true },
}, async () => toolResult(await callApi("GET", "/api/projects")));

server.registerTool("rasqai_list_requirements", {
  title: "List requirements",
  description: "List requirement documents and extracted requirements for a project. Requires scope: requirements:read.",
  inputSchema: { projectId: z.string().min(1).describe("Project id") },
  annotations: { readOnlyHint: true },
}, async ({ projectId }) => toolResult(await callApi("GET", `/api/requirements?projectId=${encodeURIComponent(projectId)}`)));

server.registerTool("rasqai_list_screens", {
  title: "List screens",
  description: "List captured screens (with detected controls) for a project. Requires scope: screens:read.",
  inputSchema: { projectId: z.string().min(1).describe("Project id") },
  annotations: { readOnlyHint: true },
}, async ({ projectId }) => toolResult(await callApi("GET", `/api/screens?projectId=${encodeURIComponent(projectId)}`)));

server.registerTool("rasqai_list_test_cases", {
  title: "List test cases",
  description: "List generated test cases for a project. Requires scope: tests:read.",
  inputSchema: { projectId: z.string().min(1).describe("Project id") },
  annotations: { readOnlyHint: true },
}, async ({ projectId }) => toolResult(await callApi("GET", `/api/tests?projectId=${encodeURIComponent(projectId)}`)));

server.registerTool("rasqai_list_workflows", {
  title: "List workflows",
  description: "List workflows (n8n-style) for a project, or all workflows when omitted. Requires scope: workflows:read.",
  inputSchema: { projectId: z.string().optional().describe("Project id (optional; omit to list all)") },
  annotations: { readOnlyHint: true },
}, async ({ projectId }) => toolResult(await callApi("GET", `/api/workflows${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`)));

server.registerTool("rasqai_list_runs", {
  title: "List runs",
  description: "List recent test runs (optionally filtered by workflow). Requires scope: runs:read.",
  inputSchema: { workflowId: z.string().optional().describe("Workflow id (optional)") },
  annotations: { readOnlyHint: true },
}, async ({ workflowId }) => toolResult(await callApi("GET", `/api/runs${workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ""}`)));

server.registerTool("rasqai_get_run", {
  title: "Get run",
  description: "Get one run with per-step results and evidence. Requires scope: runs:read.",
  inputSchema: { runId: z.string().min(1).describe("Run id") },
  annotations: { readOnlyHint: true },
}, async ({ runId }) => toolResult(await callApi("GET", `/api/runs/${encodeURIComponent(runId)}`)));

server.registerTool("rasqai_list_reports", {
  title: "List reports",
  description: "List generated QA reports for a project, or all reports when omitted. Requires scope: reports:read.",
  inputSchema: { projectId: z.string().optional().describe("Project id (optional)") },
  annotations: { readOnlyHint: true },
}, async ({ projectId }) => toolResult(await callApi("GET", `/api/reports${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`)));

server.registerTool("rasqai_generate_test_cases", {
  title: "Generate test cases",
  description: "Generate test cases from uploaded requirement documents for a project. AI-backed and audited; pass idempotency_key to make retries safe. Requires scope: tests:generate.",
  inputSchema: {
    projectId: z.string().min(1).describe("Project id"),
    docId: z.string().min(1).optional().describe("Requirement document id (required unless source=visual)"),
    source: z.enum(["requirements", "visual"]).optional().describe("Generation source; defaults to requirements"),
    replace: z.boolean().optional().describe("Replace existing generated cases for the document"),
    ...idemField,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
}, async ({ projectId, docId, source, replace, idempotency_key }) => toolResult(await callApi("POST", "/api/tests", { projectId, docId, source, replace }, idempotency_key)));

server.registerTool("rasqai_start_dry_run", {
  title: "Start dry run",
  description: "Start a dry-run (static validation, no browser) of a workflow. Safe default execution. Requires scope: runs:start:dry-run.",
  inputSchema: {
    workflowId: z.string().min(1).describe("Workflow id"),
    ...idemField,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
}, async ({ workflowId, idempotency_key }) => toolResult(await callApi("POST", "/api/runs", { workflowId, mode: "dry-run" }, idempotency_key)));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`rasq-ai mcp: connected via stdio (base ${BASE_URL})`);
}

main().catch((e) => {
  console.error(`rasq-ai mcp: fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
