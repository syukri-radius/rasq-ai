import type { AiProtocol } from "./aiContract";

// OpenCode Go's chat-completions models use the existing OpenAI-compatible gateway.
// Other Go models use Responses, Anthropic, or Gemini endpoints and are not included here.
// https://opencode.ai/docs/console/go/#endpoints
export const OPENCODE_GO = {
  name: "OpenCode Go",
  kind: "openai" as AiProtocol,
  baseUrl: "https://opencode.ai/inference/go/openai/v1",
  apiKeyEnv: "OPENCODE_API_KEY",
  models: ["glm-5.3-flash", "kimi-k3", "kimi-k2.7-code", "minimax-m3.1-flash"],
};
