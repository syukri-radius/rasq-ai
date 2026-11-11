import { createHash } from "node:crypto";
import type { Db } from "./index";
import { aiProviders, modelRoutes, policies, projects, requirementDocs, requirements, settings } from "./schema";
import { parseRequirements } from "@/lib/srs";
import { TASKS } from "@/lib/types";

export const SAMPLE_SRS = `Checkout & Account SRS v1.0 (synthetic sample document)

REQ-CHK-001: The checkout form shall accept a payment card number only when it contains 16 digits; the sandbox test card 4242 4242 4242 4242 must be accepted.
  AC1: Given a valid sandbox card number, when the user clicks Pay, then an order confirmation is displayed.
  AC2: Given a card number with 15 digits, when the user clicks Pay, then an error message is displayed and no payment is submitted.
REQ-CHK-002: The quantity field shall allow a minimum of 1 and a maximum of 10 items per order.
REQ-ACC-001: The login form shall lock the account after 5 failed password attempts.
  AC1: Given 5 failed attempts, then the sign-in button is disabled and a lockout notice is displayed.
REQ-A11Y-001: All checkout controls shall be operable by keyboard alone and expose a visible focus indicator (WCAG 2.2 AA).
REQ-PERF-001: The order confirmation shall be displayed within 3 seconds after the Pay button is clicked.
REQ-DL-001: The system shall let the user download the invoice after a completed order.
REQ-UX-001: The checkout page should be user-friendly and fast.
`;

export async function seed(db: Db) {
  const existing = await db.select({ id: projects.id }).from(projects).limit(1);
  if (existing.length) return;

  const [demo] = await db
    .insert(projects)
    .values([
      { name: "RASQ Demo Storefront", surface: "web", targetUrl: "/demo-target", description: "Built-in demo page with standard interactive control types, safe to automate with Playwright." },
      { name: "Citrix Claims Desktop", surface: "citrix", targetUrl: "", description: "Pixel-only surface: no DOM available, visual anchors required." },
    ])
    .returning();

  const prov = await db
    .insert(aiProviders)
    .values([
      { name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"] },
      { name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY", models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest"] },
      { name: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKeyEnv: "GEMINI_API_KEY", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
      { name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", models: ["openai/gpt-4o", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"] },
      { name: "Ollama (local)", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", apiKeyEnv: "", models: ["llava", "llama3.2-vision", "qwen2.5vl"] },
    ])
    .returning();
  void prov;

  await db.insert(modelRoutes).values(TASKS.map((task) => ({ task, providerId: null, model: "" })));
  await db.insert(settings).values([{ key: "aiMode", value: "ai" }]);

  await db.insert(policies).values([
    {
      name: "RASQ-Ai product architecture",
      priority: 100,
      content:
        "RASQ-Ai is a zero-DOM optical automation platform. Client perception provides candidate boxes and geometry. The multimodal AI model enriches regions with semantic labels. Preserve the source pixel coordinate system. Keep AI provenance separate from the internal RASQ-Ai perception-model label. The user can select a multimodal AI model for every feature.",
    },
    {
      name: "RASQ-Ai Security, Privacy and payment-safety policy",
      priority: 100,
      content:
        "Do not send secrets, credentials, production PANs, or sensitive customer data to a model. Test card data must be synthetic sandbox fixtures. Screenshots and SRS contents are user data; only send them to the explicitly configured AI provider when the operator selects AI mode.",
    },
    {
      name: "RASQ-Ai Testing Control taxonomy and action policy",
      priority: 95,
      content:
        "Supported control types: input, button, dropdown, date picker, checkbox, toggle, slider, upload, download, text, w_button, w_text, s_input, p_input, p_button, h_button, timer, gesture_arena. Inputs use synthetic valid and invalid data; search inputs include their grouped icon/button and password inputs use vault placeholders. Buttons assert observable transitions; push/hover buttons require bounded hold/hover actions. Text, window titles, timers and gesture arenas are review-only without an explicit oracle/pattern. Selects choose a specified option. Checkboxes and switches assert state. Sliders check bounds. Uploads validate type/size/checksum. Downloads verify SHA-256 when a manifest is supplied.",
    },
    {
      name: "RASQ-Ai Visual perception rules",
      priority: 95,
      content:
        "Use the supplied screen recording, screenshot and candidate boxes as primary evidence. Candidate coordinates are in the original source image coordinate system; preserve them unless pixels clearly show a better boundary. Label only visible interactive controls. Distinguish button vs link/download, date picker vs text input, checkbox vs switch, file drop zone vs ordinary container. Confidence reflects visual evidence, not business behaviour. Return a short evidence note per classification. A screenshot cannot prove DOM selectors; prefer a RASQ-Ai visual locator with its region/template hash.",
    },
    {
      name: "RASQ-Ai Testing Requirement traceability and test quality",
      priority: 90,
      content:
        "Preserve requirement IDs exactly. Build positive and negative tests from acceptance criteria, add boundary coverage only where the source defines bounds. Include non-functional tests for explicit security, accessibility, performance, or reliability requirements. Every case needs ordered steps and a measurable expected result. P0 = launch-blocking/payment/security/data-integrity; P1 = core functional; P2 = boundaries and important edge cases; P3 = low-impact polish. Never convert a vague requirement into a fabricated guarantee: write a test that exposes the ambiguity or state the assumption in preconditions.",
    },
  ]);

  const [doc] = await db
    .insert(requirementDocs)
    .values({ projectId: demo.id, name: "Checkout-SRS-sample.txt", mimeType: "text/plain", sha256: createHash("sha256").update(SAMPLE_SRS).digest("hex"), text: SAMPLE_SRS })
    .returning();
  const parsed = parseRequirements(SAMPLE_SRS);
  await db.insert(requirements).values(parsed.map((r) => ({ docId: doc.id, reqKey: r.reqKey, text: r.text, acceptance: r.acceptance, category: r.category, ambiguity: r.ambiguity })));
}
