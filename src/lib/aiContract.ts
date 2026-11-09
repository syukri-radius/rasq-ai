import { z } from "zod";

/** Provider protocols understood by the server-side AI gateway. */
export const AI_PROTOCOLS = ["openai", "anthropic", "gemini", "json"] as const;
export type AiProtocol = (typeof AI_PROTOCOLS)[number];

export const AI_PROTOCOL_LABELS: Record<AiProtocol, string> = {
  openai: "OpenAI-compatible",
  anthropic: "Anthropic Messages",
  gemini: "Gemini generateContent",
  json: "Generic REST / JSON",
};

/**
 * Declarative provider configuration. Request templates contain data only:
 * no JavaScript, expressions, arbitrary environment lookups, or dynamic imports.
 */
export const ProviderConfigSchema = z
  .object({
    method: z.enum(["POST", "PUT", "PATCH"]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    requestTemplate: z.unknown().optional(),
    responsePath: z.string().min(1).max(300).optional(),
    timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  })
  .strict()
  .default({})
  .superRefine((config, ctx) => {
    if (JSON.stringify(config).length > 65_536) {
      ctx.addIssue({ code: "custom", message: "Provider JSON configuration is limited to 64 KiB." });
    }
    const headers = Object.entries(config.headers ?? {});
    if (headers.length > 30) ctx.addIssue({ code: "custom", message: "At most 30 custom headers are allowed." });
    for (const [name, value] of headers) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) ctx.addIssue({ code: "custom", message: `Invalid HTTP header name "${name}".` });
      if (value.length > 4096) ctx.addIssue({ code: "custom", message: `Header "${name}" exceeds 4096 characters.` });
    }
  });

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export type StandardImage = { type: "image"; mimeType: string; data: string };
export type StandardContent = { type: "text"; text: string } | StandardImage;
export type StandardAiRequest = {
  rasqAiVersion: "1.0";
  model: string;
  system: string;
  messages: [{ role: "user"; content: StandardContent[] }];
  responseFormat: { type: "json_object" };
};

/** Safe UI default: a canonical request and { "output": { "text": "..." } } response. */
export const DEFAULT_JSON_PROVIDER_CONFIG: ProviderConfig = {
  headers: { "content-type": "application/json", authorization: "Bearer {{apiKey}}" },
  responsePath: "output.text",
  timeoutMs: 180_000,
};
