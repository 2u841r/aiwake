/** Z.AI GLM Coding Plan base URLs (Endpoint Guide). */
export const ZAI_ENDPOINTS = {
  anthropic: "https://api.z.ai/api/anthropic",
  openaiChat: "https://api.z.ai/api/coding/paas/v4",
  openaiResponses: "https://api.z.ai/api/v1",
} as const;

export type ZaiProtocol = keyof typeof ZAI_ENDPOINTS;

export const PROTOCOL_PATHS: Record<ZaiProtocol, string> = {
  anthropic: "/anthropic",
  openaiChat: "/openai/v1",
  openaiResponses: "/v1",
};
