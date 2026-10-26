const QUOTA_CODES =
  /insufficient[_ -]quota|billing[_ -]hard[_ -]limit[_ -]reached|credit[_ -]balance[_ -]too[_ -]low|subscription_sharing_usage_limit_exceeded|(?:Go|Free)UsageLimitError/iu;
const QUOTA_MESSAGES =
  /(?:quota|credits?|(?:account|credit) balance).{0,40}(?:exhausted|depleted|insufficient|too low|run out)|(?:insufficient|not enough|out of).{0,20}(?:quota|credits?|balance|budget)|(?:monthly|weekly|daily) usage limit (?:reached|exceeded)|(?:额度|配额|余额|点数|用量).{0,12}(?:不足|耗尽|用完|用尽|已达上限|已超|超限)/iu;
const QUOTA_EXCEEDED =
  /quota (?:has been )?exceeded|exceeded your current quota/iu;
const RATE_LIMIT =
  /rate.?limit|per (?:minute|second)|requests? per|tokens? per/iu;

const CONTENT_BLOCK_CODE =
  /^(PROHIBITED_CONTENT|SAFETY|BLOCKLIST|SPII|RECITATION|content_filter)$/iu;
const CONTENT_BLOCK_MESSAGE =
  /(?:Provider (?:stopped with|finish_reason):\s*|["'](?:finishReason|finish_reason|blockReason)["']\s*:\s*["'])(PROHIBITED_CONTENT|SAFETY|BLOCKLIST|SPII|RECITATION|content_filter)\b/iu;
const CONTENT_BLOCK_MARKER = /\b(PROHIBITED_CONTENT|content_filter)\b/iu;

/** Content restrictions remain terminal even inside a transient gateway error. */
export function getModelContentBlockReason(
  cause: unknown,
  depth = 0
): string | undefined {
  if (typeof cause === "string") {
    const match =
      CONTENT_BLOCK_CODE.exec(cause.trim()) ??
      CONTENT_BLOCK_MESSAGE.exec(cause) ??
      CONTENT_BLOCK_MARKER.exec(cause);
    return match?.[1]?.toUpperCase();
  }
  if (!cause || typeof cause !== "object" || depth >= 4) return undefined;
  const value = cause as Record<string, unknown>;
  for (const part of [
    value.rawStopReason,
    value.finishReason,
    value.blockReason,
    value.code,
    value.type,
    value.errorMessage,
    value.message,
    value.error,
    value.cause
  ]) {
    const reason = getModelContentBlockReason(part, depth + 1);
    if (reason) return reason;
  }
  return undefined;
}

/** Account exhaustion needs user action; a transient request throttle does not. */
export function isModelQuotaExhausted(cause: unknown, depth = 0): boolean {
  if (typeof cause === "string")
    return (
      QUOTA_CODES.test(cause) ||
      QUOTA_MESSAGES.test(cause) ||
      (QUOTA_EXCEEDED.test(cause) && !RATE_LIMIT.test(cause))
    );
  if (!cause || typeof cause !== "object" || depth >= 4) return false;
  const value = cause as {
    code?: unknown;
    type?: unknown;
    message?: unknown;
    error?: unknown;
    cause?: unknown;
  };
  return [value.code, value.type, value.message, value.error, value.cause].some(
    (part) => isModelQuotaExhausted(part, depth + 1)
  );
}
