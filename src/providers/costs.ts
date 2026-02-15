export { calculateCost, getProvider, MODEL_PRICING } from "../config/models.js";

/**
 * Pick the cheapest model from a provider that fits within a budget.
 * Useful for the orchestrator to auto-select models for subtasks.
 */
export function suggestModel(
  provider: "anthropic" | "openai",
  estimatedTokens: number,
  maxCost: number
): string | null {
  const { MODEL_PRICING } = require("../config/models.js");

  const candidates = Object.entries(MODEL_PRICING)
    .filter(([_, p]: [string, any]) => p.provider === provider)
    .map(([model, p]: [string, any]) => ({
      model,
      estimatedCost:
        (estimatedTokens * p.inputPer1M) / 1_000_000 +
        (estimatedTokens * p.outputPer1M) / 1_000_000,
    }))
    .filter((c) => c.estimatedCost <= maxCost)
    .sort((a, b) => a.estimatedCost - b.estimatedCost);

  return candidates[0]?.model ?? null;
}
