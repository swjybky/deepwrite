import {
  JEV_QUESTION_TOKEN_LIMIT,
  JEV_SYSTEMONE_MAX_ATTEMPTS,
  JEV_SYSTEMONE_TIMEOUT_MS,
  JevSystemOneRequestSchema,
  JevSystemOneResponseSchema,
  parseJevSystemOneScoreAnswer,
  resolveJevSystemOneUrl,
  type AgentProviderRuntimeConfig,
  type JevSystemOneRequest,
  type JevSystemOneResponse,
  type JevSystemOneScoreAnswer,
  type ModelConnectionTestResult
} from "@deepwrite/contracts";

interface JevSystemOneCallOptions {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface JevSystemOneRequestInput extends JevSystemOneCallOptions {
  request: JevSystemOneRequest;
}

export interface JevSystemOneScoreInput extends JevSystemOneRequestInput {
  questionId: string;
  criteriaLength: number;
}

/** A failed Jev call; `retryable` marks rate limits, 5xx and network errors. */
export class JevRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "JevRequestError";
  }
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
    controller.abort(new Error(`JEV 请求超时（${timeoutMs}ms）。`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancelTimer: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternal);
    }
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 529 || status >= 500;
}

/** Reads TypeSafe `{detail}`, OpenAI-style `{error:{message}}` or plain text. */
async function readErrorMessage(response: Response): Promise<string> {
  let text: string;
  try {
    text = (await response.text()).trim();
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
  try {
    const body = JSON.parse(text) as {
      detail?: unknown;
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const detail = Array.isArray(body.detail)
      ? body.detail
          .map((item: { msg?: unknown }) =>
            typeof item?.msg === "string" ? item.msg : ""
          )
          .filter(Boolean)
          .join("；")
      : body.detail;
    const candidate =
      (typeof detail === "string" && detail) ||
      (typeof body.error === "string" && body.error) ||
      (typeof body.error === "object" &&
        typeof body.error?.message === "string" &&
        body.error.message) ||
      (typeof body.message === "string" && body.message);
    if (candidate) return candidate.slice(0, 500);
  } catch {
    // Not JSON; fall back to the raw body.
  }
  return text.slice(0, 500) || response.statusText || `HTTP ${response.status}`;
}

function httpError(status: number, detail: string): JevRequestError {
  const hint =
    status === 401 || status === 403
      ? "（API Key 无效或没有 Jev 权限）"
      : status === 404
        ? "（地址或模型 ID 不存在，请确认服务商提供 Jev）"
        : status === 413 || status === 422 || status === 400
          ? `（请求被拒绝；单个问题上限约 ${JEV_QUESTION_TOKEN_LIMIT} token）`
          : "";
  return new JevRequestError(
    `JEV 请求失败（HTTP ${status}）${hint}：${detail}`,
    isRetryableStatus(status)
  );
}

async function attemptJevRequest(
  url: string,
  input: JevSystemOneRequestInput,
  request: JevSystemOneRequest,
  timeoutMs: number
): Promise<JevSystemOneResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const { signal, cancelTimer } = mergeAbortSignals(input.signal, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request),
        signal
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new JevRequestError(`JEV 网络请求失败：${message}`, true);
    }
    if (!response.ok) {
      throw httpError(response.status, await readErrorMessage(response));
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new JevRequestError("JEV 响应不是有效的 JSON。", false);
    }
    const parsed = JevSystemOneResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new JevRequestError(
        "JEV 响应格式无效（缺少 answers），请确认地址指向 Jev 判定接口。",
        false
      );
    }
    return parsed.data;
  } finally {
    cancelTimer();
  }
}

/**
 * POSTs one Jev request to `{baseUrl}/v1/systemone` (or a full `/systemone` /
 * `/decisions` URL). Retries once on 408/429/529/5xx or network errors and
 * never falls back to chat completions.
 */
export async function requestJevSystemOne(
  input: JevSystemOneRequestInput
): Promise<JevSystemOneResponse> {
  const request = JevSystemOneRequestSchema.parse(input.request);
  const url = resolveJevSystemOneUrl(input.baseUrl);
  const timeoutMs = input.timeoutMs ?? JEV_SYSTEMONE_TIMEOUT_MS;
  const maxAttempts = input.maxAttempts ?? JEV_SYSTEMONE_MAX_ATTEMPTS;
  let lastError: Error = new Error("JEV 请求失败。");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (input.signal?.aborted) throw new Error("JEV 请求已取消。");
    try {
      return await attemptJevRequest(url, input, request, timeoutMs);
    } catch (error: unknown) {
      if (input.signal?.aborted) throw new Error("JEV 请求已取消。");
      lastError = error instanceof Error ? error : new Error(String(error));
      const retryable = error instanceof JevRequestError && error.retryable;
      if (!retryable || attempt >= maxAttempts) throw lastError;
    }
  }
  throw lastError;
}

/** Sends one score question and returns its validated answer. */
export async function scoreWithJevSystemOne(
  input: JevSystemOneScoreInput
): Promise<JevSystemOneScoreAnswer> {
  const response = await requestJevSystemOne(input);
  return parseJevSystemOneScoreAnswer(
    response,
    input.questionId,
    input.criteriaLength
  );
}

const CONNECTION_TEST_QUESTION_ID = "connection_check";
const CONNECTION_TEST_CRITERIA = ["不是连接测试", "是连接测试"];

/**
 * Verifies a JEV model with a minimal score request, so URL, key and model ID
 * are all exercised on the real judgment endpoint.
 */
export async function testJevConnection(
  config: AgentProviderRuntimeConfig,
  options: Pick<JevSystemOneCallOptions, "fetchImpl" | "signal"> = {}
): Promise<ModelConnectionTestResult> {
  if (!config.baseUrl.trim()) throw new Error("JEV 模型未配置 API 地址。");
  if (!config.apiKey.trim()) throw new Error("JEV 模型未配置 API Key。");
  const response = await requestJevSystemOne({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: 15_000,
    maxAttempts: 1,
    ...options,
    request: {
      model: config.modelId,
      state: "DeepWrite 正在测试 JEV 连接。",
      questions: {
        [CONNECTION_TEST_QUESTION_ID]: {
          type: "score",
          instructions: "这段文字是否是一次连接测试？",
          criteria: CONNECTION_TEST_CRITERIA
        }
      }
    }
  });
  const answer = parseJevSystemOneScoreAnswer(
    response,
    CONNECTION_TEST_QUESTION_ID,
    CONNECTION_TEST_CRITERIA.length
  );
  const inputTokens = Math.max(
    0,
    Math.round(response.usage?.input_tokens ?? 0)
  );
  const outputTokens = Math.max(
    0,
    Math.round(response.usage?.output_tokens ?? 0)
  );
  const confidence =
    answer.confidence === undefined
      ? ""
      : `，置信度 ${Math.round(answer.confidence * 100)}%`;
  return {
    modelId: config.id,
    ok: true,
    message: `连接成功，${response.model ?? config.modelId} 已返回有效判定${confidence}。`,
    testedAt: new Date().toISOString(),
    contextWindow: JEV_QUESTION_TOKEN_LIMIT,
    maxTokens: 1,
    ...(response.usage
      ? {
          usage: {
            inputTokens,
            outputTokens,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: inputTokens + outputTokens
          }
        }
      : {})
  };
}
