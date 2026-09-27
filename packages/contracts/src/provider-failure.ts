/**
 * Provider failures that mean "this account cannot run right now", as opposed
 * to a transient problem worth retrying.
 *
 * The keyword list mirrors pi-ai's own non-retryable provider-limit pattern
 * (`@earendil-works/pi-ai/dist/utils/retry.js`, the
 * `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` constant). That pattern is not
 * exported — only `isRetryableAssistantError` is — so the wording is duplicated
 * here to let callers tell "out of credit" apart from other terminal errors.
 * Keep it in sync when upgrading pi-ai.
 */
const INSUFFICIENT_QUOTA_PATTERN = new RegExp(
  [
    // Subscription limits returned as typed 429 JSON by OpenCode's Zen API.
    "GoUsageLimitError",
    "FreeUsageLimitError",
    "Monthly usage limit reached",
    "available balance",
    // Generic quota/budget/billing exhaustion; `insufficient_quota` is OpenAI's
    // quota/billing error code, the rest cover common gateway wording.
    "insufficient_quota",
    "out of budget",
    "quota exceeded",
    "billing"
  ].join("|"),
  "iu"
);

/**
 * Whether a provider error message means the account has run out of credit or
 * hit a subscription cap. Long-running automation should stop on these rather
 * than burn through retries.
 */
export function isInsufficientQuotaErrorMessage(
  message: string | null | undefined
): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  return INSUFFICIENT_QUOTA_PATTERN.test(message);
}
