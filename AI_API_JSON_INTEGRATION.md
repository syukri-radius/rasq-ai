# RASQ-Ai AI API JSON Integration

RASQ-Ai routes model calls through a server-side protocol gateway. It supports OpenAI-compatible, Anthropic, Gemini, and declarative generic REST/JSON providers without changing feature code.

The integration is internal provider configuration, not an unauthenticated public model proxy. Existing task routing, the global Local kill switch, per-task model selection, policies, redaction, provenance, and task-specific Zod validation still apply.

## Protocols

| `kind` | Endpoint behavior | Response extraction |
|---|---|---|
| `openai` | `<baseUrl>/chat/completions`; defaults to OpenAI `/v1` | `choices[0].message.content` |
| `anthropic` | `<baseUrl>/v1/messages`; defaults to Anthropic | `content` text blocks |
| `gemini` | `<baseUrl>/models/<model>:generateContent`; defaults to Gemini `v1beta` | `candidates[0].content.parts` |
| `json` | Full configured URL; optional `{{model}}` in path/query | Configured `responsePath`, or common response shapes |

All protocols accept optional custom `headers` and `timeoutMs`. Generic JSON additionally supports `method`, `requestTemplate`, and `responsePath`.

## Canonical `rasq-ai.v1` request

A generic provider with no `requestTemplate` receives this JSON shape:

```json
{
  "rasqAiVersion": "1.0",
  "model": "your-model",
  "system": "RASQ-Ai mission, enabled policies, and task-specific instructions",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Task input and untrusted data" },
        {
          "type": "image",
          "mimeType": "image/png",
          "data": "BASE64_WITHOUT_DATA_URL_PREFIX"
        }
      ]
    }
  ],
  "responseFormat": { "type": "json_object" }
}
```

Text-only calls omit image content items. Images use raw base64 plus a MIME type, not a data URL.

The recommended generic response is:

```json
{
  "output": {
    "text": "{\"testCases\":[],\"otherTaskSpecificProperties\":{}}"
  }
}
```

`output.text` is a string. For generation tasks, that string normally contains the JSON object requested by the task instructions. RASQ-Ai then performs its existing JSON parsing, Zod validation, source-ID checks, redaction, and provenance handling.

## Add a canonical provider

Configure through **AI Models & Policy → Providers** or `POST /api/providers`:

```json
{
  "name": "Enterprise canonical AI",
  "kind": "json",
  "baseUrl": "https://ai-gateway.example.test/v1/generate",
  "apiKeyEnv": "ENTERPRISE_AI_KEY",
  "models": ["enterprise-multimodal-1"],
  "config": {
    "headers": {
      "content-type": "application/json",
      "authorization": "Bearer {{apiKey}}",
      "x-tenant": "quality-engineering"
    },
    "responsePath": "output.text",
    "timeoutMs": 180000
  }
}
```

Only the environment-variable name is persisted. Set its value on the server:

```bash
ENTERPRISE_AI_KEY=... npm run start
```

The placeholder `{{apiKey}}` is resolved only in memory while constructing headers. The value is not returned by `/api/settings` or stored in provider JSON.

## Map a different JSON protocol

`requestTemplate` is JSON data, not JavaScript. Exact placeholders preserve their JSON types; embedded placeholders become strings.

| Placeholder | Value | Typical use |
|---|---|---|
| `{{model}}` | Selected model string | Body, endpoint, headers |
| `{{system}}` | Full RASQ-Ai system instructions | Body |
| `{{user}}` | Task user input | Body |
| `{{messages}}` | Canonical user-message array | Body |
| `{{images}}` | Canonical image-content array | Body |
| `{{responseFormat}}` | `{ "type": "json_object" }` | Body |
| `{{standardRequest}}` | Complete canonical request | Nested body |
| `{{apiKey}}` | Server environment secret | **Headers only** |

Example custom integration:

```json
{
  "name": "Custom enterprise model",
  "kind": "json",
  "baseUrl": "https://models.example.test/v2/invoke?deployment={{model}}",
  "apiKeyEnv": "CUSTOM_MODEL_KEY",
  "models": ["qa-vision-prod"],
  "config": {
    "method": "PUT",
    "headers": {
      "content-type": "application/json",
      "x-api-key": "{{apiKey}}",
      "x-workload": "rasq-test-generation"
    },
    "requestTemplate": {
      "deployment": "{{model}}",
      "instructions": "{{system}}",
      "input": "{{user}}",
      "attachments": "{{images}}",
      "options": {
        "format": "{{responseFormat}}"
      },
      "diagnostics": {
        "originalRequest": "{{standardRequest}}"
      }
    },
    "responsePath": "result.items[0].text",
    "timeoutMs": 240000
  }
}
```

This example expects a response such as:

```json
{
  "result": {
    "items": [
      { "text": "{\"testCases\":[]}" }
    ]
  }
}
```

### Response paths

Use dot-separated object properties and numeric array indexes:

```text
output.text
result.items[0].text
data.choices[0].message.content
```

Arrays of text blocks and objects with `text` or `content` are normalized to a string. If `responsePath` is omitted, the gateway tries common shapes including `output.text`, `outputText`, `text`, `response`, OpenAI choices, Anthropic content, and Gemini parts. An explicit path is recommended for enterprise gateways.

## Routing behavior

For each feature task, RASQ-Ai still performs the following sequence:

1. Resolve `aiMode`; `local` bypasses all provider HTTP calls.
2. Resolve the task's provider/model route, or use the deterministic Local engine.
3. Verify that the provider is enabled and its named environment variable exists.
4. Build the immutable mission, enabled policies, and task instructions.
5. Apply task-specific textual redaction and untrusted-data wrapping.
6. Adapt the canonical request to the selected protocol.
7. Parse provider JSON and extract text.
8. Validate the generated artifact with the task's existing schema and domain rules.
9. Persist provider/model provenance.

Supported task routes remain `visual_scan`, `document_analysis`, `test_scenarios`, `workflow_creation`, and `report_generation`.

## Validation and security limits

- Provider `kind` must be one of `openai`, `anthropic`, `gemini`, or `json`.
- Endpoints must use HTTP(S), must not contain URL credentials, and are required for generic JSON.
- Configuration is limited to 64 KiB, 30 headers, and 30 template nesting levels.
- Methods are limited to `POST`, `PUT`, and `PATCH`; timeouts range from 1 to 300 seconds.
- Unknown template placeholders fail closed rather than being sent literally.
- `{{apiKey}}` is forbidden in request bodies and endpoints. Common authentication headers must use the placeholder instead of a raw stored credential.
- Provider errors are truncated and the configured key is scrubbed before being returned.
- Generic providers return JSON; non-JSON responses fail explicitly.
- Existing SSRF/egress concerns still apply. Production deployments should restrict provider endpoints with an egress allowlist, DNS/IP validation, and network policy.
- Existing image-redaction limits still apply: canonical images contain the supplied pixels. Select Local or an approved provider for sensitive evidence.

## Current scope and recommended next gateway features

This release provides synchronous request/response JSON routing. It does not yet implement streaming, provider fallback/load balancing, retries with idempotency, OAuth token exchange, AWS SigV4, mTLS, prompt caching, usage/cost metering, or per-tenant secret vaults. Those belong in the enterprise gateway roadmap rather than being embedded in request templates.

See [`ENTERPRISE_ROADMAP.md`](./ENTERPRISE_ROADMAP.md) for the recommended evolution of routing, resilience, governance, and model evaluation.
