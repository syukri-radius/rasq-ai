import { randomUUID } from "node:crypto";
import type { ProviderConfig, StandardAiRequest, StandardContent, StandardImage } from "./aiContract";

// RASQ-Ai has no conversation ID. Keep one opaque Go routing session per server
// process, rather than putting a credential or operator data in the header.
let goSessionId: string | undefined;

function isOpenCodeGo(url: string): boolean {
  const endpoint = new URL(url);
  return endpoint.protocol === "https:" && endpoint.hostname === "opencode.ai" && endpoint.pathname.startsWith("/inference/go/");
}

export type ProtocolProvider = {
  name: string;
  kind: string;
  baseUrl: string;
  apiKeyEnv: string;
  config?: ProviderConfig | null;
};

export type ProtocolCallArgs = { system: string; user: string; images?: string[] };

function splitDataUrl(value: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(value);
  if (!match) throw new Error("Image must be a base64 data URL");
  return { mimeType: match[1], data: match[2] };
}

/** Canonical provider-neutral request used by generic JSON integrations and templates. */
export function buildStandardAiRequest(model: string, args: ProtocolCallArgs): StandardAiRequest {
  const content: StandardContent[] = [
    { type: "text", text: args.user },
    ...(args.images ?? []).map((image): StandardImage => ({ type: "image", ...splitDataUrl(image) })),
  ];
  return {
    rasqAiVersion: "1.0",
    model,
    system: args.system,
    messages: [{ role: "user", content }],
    responseFormat: { type: "json_object" },
  };
}

type TemplateContext = Record<string, unknown>;

function templateValue(name: string, context: TemplateContext): unknown {
  if (!(name in context)) throw new Error(`Unknown AI JSON template placeholder "{{${name}}}".`);
  return context[name];
}

/** Exact placeholders preserve JSON types; embedded placeholders are stringified. */
function renderTemplate(value: unknown, context: TemplateContext, depth = 0): unknown {
  if (depth > 30) throw new Error("AI JSON request template exceeds 30 nesting levels.");
  if (typeof value === "string") {
    const exact = /^\{\{([A-Za-z][A-Za-z0-9]*)\}\}$/.exec(value);
    if (exact) return templateValue(exact[1], context);
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, name: string) => {
      const resolved = templateValue(name, context);
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, context, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplate(item, context, depth + 1)]));
  }
  throw new Error("AI JSON request templates may contain only JSON values.");
}

function renderEndpoint(endpoint: string, model: string): string {
  const rendered = endpoint.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, name: string) => {
    if (name !== "model") throw new Error(`Provider endpoint allows only the {{model}} placeholder, not {{${name}}}.`);
    return encodeURIComponent(model);
  });
  const url = new URL(rendered);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("AI provider endpoints must use HTTP(S).");
  return url.toString();
}

function renderHeaders(config: ProviderConfig, key: string, model: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, template] of Object.entries(config.headers ?? {})) {
    // Do not emit an empty credential header for keyless local/generic providers.
    if (!key && template.includes("{{apiKey}}")) continue;
    out[name] = String(renderTemplate(template, { apiKey: key, model }));
  }
  return out;
}

function readResponsePath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    const match = /^([A-Za-z0-9_$-]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) throw new Error(`Invalid AI responsePath segment "${part}".`);
    const keys = [match[1], ...[...match[2].matchAll(/\[(\d+)\]/g)].map((index) => Number(index[1]))];
    for (const key of keys) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string | number, unknown>)[key as string];
    }
  }
  return current;
}

function textFrom(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(textFrom).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join("") : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if ("content" in record) return textFrom(record.content);
  }
  return null;
}

function extractText(json: unknown, path?: string): string {
  if (path) {
    const text = textFrom(readResponsePath(json, path));
    if (text !== null) return text;
    throw new Error(`AI responsePath "${path}" did not contain text.`);
  }
  const candidates = [
    "output.text",
    "outputText",
    "text",
    "response",
    "choices[0].message.content",
    "content",
    "candidates[0].content.parts",
  ];
  for (const candidate of candidates) {
    const text = textFrom(readResponsePath(json, candidate));
    if (text !== null) return text;
  }
  throw new Error("AI provider returned no recognizable text. Configure responsePath for this JSON protocol.");
}

function scrubSecret(text: string, key: string): string {
  return key ? text.split(key).join("[key]") : text;
}

async function execute(provider: ProtocolProvider, url: string, method: string, headers: Record<string, string>, body: unknown, config: ProviderConfig): Promise<unknown> {
  const key = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] ?? "" : "";
  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs ?? 180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${provider.name} returned HTTP ${response.status}: ${scrubSecret(raw.slice(0, 300), key)}`);
  if (!raw.trim()) throw new Error(`${provider.name} returned an empty response.`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${provider.name} returned invalid JSON: ${scrubSecret(raw.slice(0, 160), key)}`);
  }
}

/** Executes all supported protocols through one normalized server-side gateway. */
export async function callProtocolProvider(provider: ProtocolProvider, model: string, args: ProtocolCallArgs): Promise<string> {
  const config = provider.config ?? {};
  const key = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] ?? "" : "";
  const base = provider.baseUrl.replace(/\/+$/, "");
  const standard = buildStandardAiRequest(model, args);
  const customHeaders = renderHeaders(config, key, model);
  let url = "";
  let method = "POST";
  let headers: Record<string, string> = { "content-type": "application/json", ...customHeaders };
  let body: unknown;

  if (provider.kind === "anthropic") {
    url = `${base || "https://api.anthropic.com"}/v1/messages`;
    headers = { "x-api-key": key, "anthropic-version": "2023-06-01", ...headers };
    body = {
      model,
      max_tokens: 8192,
      system: args.system,
      messages: [{ role: "user", content: standard.messages[0].content.map((item) => item.type === "text" ? item : { type: "image", source: { type: "base64", media_type: item.mimeType, data: item.data } }) }],
    };
  } else if (provider.kind === "gemini") {
    url = `${base || "https://generativelanguage.googleapis.com/v1beta"}/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "x-goog-api-key": key, ...headers };
    body = {
      systemInstruction: { parts: [{ text: args.system }] },
      contents: [{ role: "user", parts: [{ text: args.user }, ...standard.messages[0].content.filter((item) => item.type === "image").map((item) => ({ inlineData: { mimeType: item.mimeType, data: item.data } }))] }],
      generationConfig: { responseMimeType: "application/json" },
    };
  } else if (provider.kind === "openai") {
    url = `${base || "https://api.openai.com/v1"}/chat/completions`;
    if (key && !Object.keys(headers).some((name) => name.toLowerCase() === "authorization")) headers.authorization = `Bearer ${key}`;
    body = {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: standard.messages[0].content.map((item) => item.type === "text" ? item : { type: "image_url", image_url: { url: `data:${item.mimeType};base64,${item.data}` } }) },
      ],
    };
  } else if (provider.kind === "json") {
    if (!base) throw new Error("Generic JSON providers require a full endpoint URL.");
    url = base;
    method = config.method ?? "POST";
    body = config.requestTemplate === undefined
      ? standard
      : renderTemplate(config.requestTemplate, {
          model,
          system: args.system,
          user: args.user,
          messages: standard.messages,
          images: standard.messages[0].content.filter((item) => item.type === "image"),
          responseFormat: standard.responseFormat,
          standardRequest: standard,
        });
    const customUsesKey = Object.values(config.headers ?? {}).some((value) => value.includes("{{apiKey}}"));
    if (key && !customUsesKey && !Object.keys(headers).some((name) => name.toLowerCase() === "authorization")) headers.authorization = `Bearer ${key}`;
  } else {
    throw new Error(`Unsupported AI protocol "${provider.kind}".`);
  }

  const endpoint = renderEndpoint(url, model);
  if (isOpenCodeGo(endpoint)) {
    // Override any differently cased custom copies; HTTP header names are case-insensitive.
    for (const name of Object.keys(headers)) {
      if (["user-agent", "x-opencode-session"].includes(name.toLowerCase())) delete headers[name];
    }
    headers["user-agent"] = "rasq-ai/1.0";
    headers["x-opencode-session"] = goSessionId ?? (goSessionId = `ses_${randomUUID()}`);
  }
  const json = await execute(provider, endpoint, method, headers, body, config);
  if (provider.kind === "json") return extractText(json, config.responsePath);
  if (provider.kind === "anthropic") return extractText(json, "content");
  if (provider.kind === "gemini") return extractText(json, "candidates[0].content.parts");
  return extractText(json, "choices[0].message.content");
}
