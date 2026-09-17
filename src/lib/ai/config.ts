export type AiProvider = "openai" | "openrouter";

export type AiProviderSettings = {
  token: string;
  model: string;
  judgeModel?: string;
};

export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  openrouter: "z-ai/glm-5.3-flash",
};
