import {
  JEV_SYSTEMONE_MAX_ATTEMPTS,
  JEV_SYSTEMONE_TIMEOUT_MS,
  JevSystemOneRequestSchema,
  parseJevSystemOneScoreAnswer,
  resolveJevSystemOneUrl,
  type JevSystemOneRequest,
  type JevSystemOneScoreAnswer
} from "@deepwrite/contracts";

export interface JevSystemOneScoreInput {
  baseUrl: string;
  apiKey: string;
  request: JevSystemOneRequest;
  questionId: string;
  criteriaLength: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
}

function mergeAbortSignals(
  external: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cancelTimer: () => void } {
  const controller = new AbortController();
  const onExternal = (): void => {
    controller.abort(external?.reason);
  };
  if (external) {
    if (external.aborted) onExternal();
    else external.addEventListener("abort", onExternal, { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`JEV 评分超时（${timeoutMs}ms）。`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancelTimer: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternal);
    }
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 500) || response.statusText;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

/**
 * POST `{baseUrl}/v1/systemone` (normalized) and parse one score answer.
 * Retries once on 429/529/5xx or transient network errors; does not fall back
 * to chat completions.
 */
export async function scoreWithJevSystemOne(
  input: JevSystemOneScoreInput
): Promise<JevSystemOneScoreAnswer> {
  const request = JevSystemOneRequestSchema.parse(input.request);
  const url = resolveJevSystemOneUrl(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? JEV_SYSTEMONE_TIMEOUT_MS;
  const maxAttempts = input.maxAttempts ?? JEV_SYSTEMONE_MAX_ATTEMPTS;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (input.signal?.aborted) {
      throw new Error("JEV 评分已取消。");
    }
    const { signal, cancelTimer } = mergeAbortSignals(input.signal, timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request),
        signal
      });
      if (!response.ok) {
        const detail = await readErrorMessage(response);
        const error = new Error(
          `JEV 评分失败（HTTP ${response.status}）：${detail}`
        );
        if (attempt < maxAttempts && shouldRetryStatus(response.status)) {
          lastError = error;
          continue;
        }
        throw error;
      }
      const payload: unknown = await response.json();
      return parseJevSystemOneScoreAnswer(
        payload,
        input.questionId,
        input.criteriaLength
      );
    } catch (error: unknown) {
      if (input.signal?.aborted) {
        throw new Error("JEV 评分已取消。");
      }
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      const retryable =
        attempt < maxAttempts &&
        !(
          normalized.message.includes("HTTP 4") &&
          !normalized.message.includes("HTTP 429")
        );
      if (retryable && !normalized.message.includes("分数")) {
        lastError = normalized;
        continue;
      }
      throw normalized;
    } finally {
      cancelTimer();
    }
  }

  throw lastError ?? new Error("JEV 评分失败。");
}
