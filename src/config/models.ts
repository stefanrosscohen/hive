export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  contextWindow: number;
  provider: "anthropic" | "openai";
}

// Pricing in USD per 1M tokens (as of Feb 2026)
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-6": {
    inputPer1M: 15.0,
    outputPer1M: 75.0,
    contextWindow: 200_000,
    provider: "anthropic",
  },
  "claude-sonnet-4-5-20250929": {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    contextWindow: 200_000,
    provider: "anthropic",
  },
  "claude-haiku-4-5-20251001": {
    inputPer1M: 0.8,
    outputPer1M: 4.0,
    contextWindow: 200_000,
    provider: "anthropic",
  },

  // OpenAI
  "gpt-4o": {
    inputPer1M: 2.5,
    outputPer1M: 10.0,
    contextWindow: 128_000,
    provider: "openai",
  },
  "gpt-4o-mini": {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    contextWindow: 128_000,
    provider: "openai",
  },
  "o1": {
    inputPer1M: 15.0,
    outputPer1M: 60.0,
    contextWindow: 200_000,
    provider: "openai",
  },
  "o3-mini": {
    inputPer1M: 1.1,
    outputPer1M: 4.4,
    contextWindow: 200_000,
    provider: "openai",
  },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Fallback: estimate high to be safe
    return ((inputTokens * 10) / 1_000_000) + ((outputTokens * 30) / 1_000_000);
  }
  return (
    (inputTokens * pricing.inputPer1M) / 1_000_000 +
    (outputTokens * pricing.outputPer1M) / 1_000_000
  );
}

export function getProvider(model: string): "anthropic" | "openai" {
  return MODEL_PRICING[model]?.provider ?? "anthropic";
}
