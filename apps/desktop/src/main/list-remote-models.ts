import type { ModelApi, RemoteModelListItem } from "@deepwrite/contracts";
export { parseRemoteModelList } from "./remote-model-list-parser";
import { parseRemoteModelList } from "./remote-model-list-parser";

export const REMOTE_MODEL_LIST_TIMEOUT_MS = 15_000;
export const REMOTE_MODEL_LIST_MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;
export const REMOTE_MODEL_LIST_MAX_ITEMS = 2_000;

export interface ListRemoteModelsInput {
  api: ModelApi;
  baseUrl: string;
  apiKey: string;
  provider: string;
}

type RemoteModelsFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export class RemoteModelListError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RemoteModelListError";
    this.code = code;
  }
}

function isOllamaProvider(provider: string): boolean {
  return provider.trim().toLowerCase() === "ollama";
}

export function resolveRemoteModelsUrl(input: ListRemoteModelsInput): string {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) {
    throw new RemoteModelListError(
      "models.list_remote_missing_url",
      "请先填写 API 地址，再拉取可用模型。"
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new RemoteModelListError(
      "models.list_remote_invalid_url",
      "API 地址格式无效。"
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RemoteModelListError(
      "models.list_remote_invalid_url",
      "API 地址只支持 http 或 https。"
    );
  }

  const normalized = baseUrl.replace(/\/+$/u, "");
  if (input.api === "google-generative-ai") {
    const url = new URL(`${normalized}/models`);
    if (input.apiKey) {
      url.searchParams.set("key", input.apiKey);
    }
    return url.toString();
  }
  if (input.api === "anthropic-messages") {
    return /\/v\d+$/iu.test(normalized)
      ? `${normalized}/models`
      : `${normalized}/v1/models`;
  }
  return `${normalized}/models`;
}

function buildHeaders(input: ListRemoteModelsInput): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const apiKey = input.apiKey.trim();
  if (input.api === "google-generative-ai") {
    if (apiKey) {
      headers.set("x-goog-api-key", apiKey);
    }
    return headers;
  }
  if (input.api === "anthropic-messages") {
    if (apiKey) {
      headers.set("x-api-key", apiKey);
      headers.set("Authorization", `Bearer ${apiKey}`);
    }
    headers.set("anthropic-version", "2023-06-01");
    return headers;
  }
  const token = apiKey || (isOllamaProvider(input.provider) ? "ollama" : "");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > REMOTE_MODEL_LIST_MAX_RESPONSE_BYTES
  ) {
    throw new RemoteModelListError(
      "models.list_remote_too_large",
      "模型列表响应超过大小限制。"
    );
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > REMOTE_MODEL_LIST_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RemoteModelListError(
          "models.list_remote_too_large",
          "模型列表响应超过大小限制。"
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8"
  );
}

function httpErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "密钥无效或没有权限拉取模型列表。";
  }
  if (status === 404) {
    return "当前 API 地址没有提供模型列表接口。";
  }
  return `拉取模型失败（HTTP ${status}）。`;
}

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join(" ");
}

function networkErrorMessage(error: unknown): string {
  if (
    /ECONNREFUSED\s+(?:127\.0\.0\.1|::1|localhost):\d+/iu.test(
      errorChainText(error)
    )
  ) {
    return "无法连接本地网络代理。这个接口不需要 VPN，请先关闭失效的 HTTP 代理后再刷新。";
  }
  return "无法连接模型服务，请检查 API 地址后重试。";
}

export async function listRemoteModels(
  input: ListRemoteModelsInput,
  fetcher: RemoteModelsFetcher = fetch
): Promise<RemoteModelListItem[]> {
  if (!input.baseUrl.trim()) {
    throw new RemoteModelListError(
      "models.list_remote_missing_url",
      "请先填写 API 地址，再拉取可用模型。"
    );
  }
  if (!input.apiKey.trim() && !isOllamaProvider(input.provider)) {
    throw new RemoteModelListError(
      "models.list_remote_missing_key",
      "请先填写 API Key，再拉取可用模型。"
    );
  }

  const url = resolveRemoteModelsUrl(input);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(REMOTE_MODEL_LIST_TIMEOUT_MS),
      headers: buildHeaders(input)
    });
  } catch (error: unknown) {
    if (error instanceof RemoteModelListError) {
      throw error;
    }
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new RemoteModelListError(
      timedOut ? "models.list_remote_timeout" : "models.list_remote_network",
      timedOut ? "拉取模型超时，请稍后重试。" : networkErrorMessage(error)
    );
  }

  const text = await readLimitedResponse(response);
  if (!response.ok) {
    throw new RemoteModelListError(
      "models.list_remote_http",
      httpErrorMessage(response.status)
    );
  }

  let payload: unknown = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new RemoteModelListError(
        "models.list_remote_invalid_response",
        "模型列表响应格式无效。"
      );
    }
  }

  return parseRemoteModelList(payload);
}
