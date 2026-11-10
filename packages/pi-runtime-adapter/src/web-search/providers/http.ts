import {
  WebSearchProviderError,
  type WebSearchProviderContext
} from "../types";

const MAX_RETRY_AFTER_MS = 10_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/** Seconds, or an HTTP date, as milliseconds; unusable values give undefined. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms >= 0
    ? Math.min(Math.round(ms), MAX_RETRY_AFTER_MS)
    : undefined;
}

/** The status codes search and fetch share; the service's error body is never read. */
export function failureFor(response: Response): WebSearchProviderError {
  const { status } = response;
  if (status === 401) return new WebSearchProviderError("auth", false);
  if (status === 402) return new WebSearchProviderError("balance", false);
  if (status === 400 || status === 413)
    return new WebSearchProviderError("bad_request", false);
  if (status === 429)
    return new WebSearchProviderError(
      "rate_limit",
      true,
      retryAfterMs(response.headers.get("retry-after"))
    );
  if (status === 408 || status === 504)
    return new WebSearchProviderError("timeout", true);
  return new WebSearchProviderError("unavailable", status >= 500);
}

async function readBoundedJson(
  response: Response,
  limitBytes: number
): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > limitBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new WebSearchProviderError("invalid_response", false);
  }
  if (!response.body)
    throw new WebSearchProviderError("invalid_response", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > limitBytes) {
      await reader.cancel().catch(() => undefined);
      throw new WebSearchProviderError("invalid_response", false);
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new WebSearchProviderError("invalid_response", false);
  }
}

export interface JsonRequestOptions {
  /** Largest response body read before the reply is given up on. */
  limitBytes: number;
  headers?: Record<string, string>;
  method?: "POST" | "GET";
  query?: Record<string, string>;
  /** Maps a status this endpoint treats specially; undefined falls back to `failureFor`. */
  statusFailure?: (response: Response) => WebSearchProviderError | undefined;
}

/**
 * One authenticated JSON request to the service. Transport failures become a
 * retryable `unavailable`; aborts and timeouts reach the session unchanged.
 */
export async function requestJson(
  path: string,
  body: unknown,
  context: WebSearchProviderContext,
  options: JsonRequestOptions
): Promise<unknown> {
  const url = new URL(`${context.baseUrl.replace(/\/+$/u, "")}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {}))
    url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await context.fetch(url.href, {
      method: options.method ?? "POST",
      redirect: "error",
      headers: {
        ...(options.headers ?? { authorization: `Bearer ${context.apiKey}` }),
        "content-type": "application/json"
      },
      ...(options.method === "GET" ? {} : { body: JSON.stringify(body) }),
      signal: context.signal
    });
  } catch (error) {
    if (isAbortLike(error)) throw error;
    throw new WebSearchProviderError("unavailable", true);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw options.statusFailure?.(response) ?? failureFor(response);
  }
  return readBoundedJson(response, options.limitBytes);
}
