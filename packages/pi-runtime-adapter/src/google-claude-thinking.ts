import type { Api, SimpleStreamOptions } from "@earendil-works/pi-ai";

const GOOGLE_CLAUDE_46_MODEL_PATTERN =
  /(?:^|[/_.:-])claude-(?:opus|sonnet)-4-6(?:-thinking)?(?:$|[/_.:-])/iu;

const GOOGLE_CLAUDE_46_THINKING_BUDGETS = {
  minimal: 1_024,
  low: 2_048,
  medium: 8_192,
  high: 16_384
} as const;

const GOOGLE_CLAUDE_46_MAX_THINKING_BUDGET = 32_768;

/**
 * Google-compatible gateways can expose Claude 4.6 through generateContent.
 * Pi does not recognize those IDs as Gemini models and otherwise emits the
 * provider's automatic budget (-1), which some gateways accept without
 * returning thought parts. Give Claude an explicit positive budget instead.
 */
export function applyGoogleClaudeThinkingCompatibility(
  api: Api,
  modelId: string,
  options: SimpleStreamOptions
): SimpleStreamOptions {
  if (
    api !== "google-generative-ai" ||
    !options.reasoning ||
    !GOOGLE_CLAUDE_46_MODEL_PATTERN.test(modelId)
  ) {
    return options;
  }

  const maximumThinking =
    options.reasoning === "xhigh" || options.reasoning === "max";
  const reasoning =
    options.reasoning === "xhigh" || options.reasoning === "max"
      ? "high"
      : options.reasoning;
  const thinkingBudgets = {
    ...GOOGLE_CLAUDE_46_THINKING_BUDGETS,
    ...(maximumThinking ? { high: GOOGLE_CLAUDE_46_MAX_THINKING_BUDGET } : {}),
    ...options.thinkingBudgets
  };
  const budget = thinkingBudgets[reasoning];
  const maxTokens =
    typeof options.maxTokens === "number" &&
    typeof budget === "number" &&
    options.maxTokens <= budget
      ? budget + 1
      : options.maxTokens;
  return {
    ...options,
    // Pi's Google budget map only has minimal/low/medium/high slots. Carry
    // DeepWrite's max/xhigh selection through the high slot with a larger cap.
    reasoning,
    thinkingBudgets,
    ...(maxTokens === undefined ? {} : { maxTokens })
  };
}
