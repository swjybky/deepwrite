import { WEB_SEARCH_PROVIDERS } from "@deepwrite/contracts";
import { isRecord } from "@deepwrite/shared";
import { cutCharacters } from "../format";
import {
  WebSearchProviderError,
  type WebFetchCapability,
  type WebSearchHit,
  type WebSearchProviderClient
} from "../types";
import { failureFor, httpUrl, requestJson } from "./http";

const SEARCH_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const FETCH_RESPONSE_LIMIT_BYTES = 8 * 1024 * 1024;
const FETCH_PER_URL_TIMEOUT_MS = 25_000;
const PURPOSE_MAX_CHARS = 2_000;
const HAN_SCRIPT_PATTERN = /\p{Script=Han}/u;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * TinyFish serves search and fetch on separate hosts by default. When a user
 * configures a custom gateway, route fetch alongside it instead of sending
 * the user's key to the official fetch host.
 */
export function resolveFetchBaseUrl(searchBaseUrl: string): string {
  const trimmed = searchBaseUrl.trim().replace(/\/+$/u, "");
  const parsed = new URL(trimmed);
  const official = new URL(WEB_SEARCH_PROVIDERS.tinyfish.defaultBaseUrl);
  if (
    parsed.origin.toLowerCase() === official.origin.toLowerCase() &&
    (parsed.pathname === "/" || parsed.pathname === "")
  ) {
    return WEB_SEARCH_PROVIDERS.tinyfish.defaultFetchBaseUrl;
  }
  if (parsed.hostname.toLowerCase().startsWith("api.search.")) {
    parsed.hostname = `api.fetch.${parsed.hostname.slice("api.search.".length)}`;
    return parsed.href.replace(/\/+$/u, "");
  }
  return `${trimmed}/fetch`;
}

function fetchStatusFailure(response: Response): WebSearchProviderError {
  if (response.status === 403)
    return new WebSearchProviderError("blocked", false);
  if (response.status === 422)
    return new WebSearchProviderError("bad_request", false);
  return failureFor(response);
}

function fetchEntryFailure(code: unknown): WebSearchProviderError {
  if (code === "timeout") return new WebSearchProviderError("timeout", true);
  if (code === "proxy_error")
    return new WebSearchProviderError("unavailable", true);
  if (code === "invalid_url" || code === "invalid_redirect_url")
    return new WebSearchProviderError("bad_request", false);
  return new WebSearchProviderError("no_content", false);
}

function toTinyFishHit(raw: unknown): WebSearchHit | undefined {
  if (!isRecord(raw)) return undefined;
  const title = text(raw.title);
  const url = typeof raw.url === "string" ? httpUrl(raw.url) : undefined;
  if (!title || !url) return undefined;
  const snippet = text(raw.snippet) ?? "";
  const siteName = text(raw.site_name);
  const date = text(raw.date);
  return {
    title,
    url,
    snippet,
    summary: snippet,
    ...(siteName ? { siteName } : {}),
    ...(date && !Number.isNaN(Date.parse(date))
      ? { publishedAt: new Date(date).toISOString() }
      : {})
  };
}

export const tinyFishWebFetch: WebFetchCapability = {
  maxQps: 2,
  async page(request, context) {
    if (request.url.length > WEB_SEARCH_PROVIDERS.tinyfish.fetchUrlMaxChars)
      throw new WebSearchProviderError("bad_request", false);
    const fetchContext = {
      ...context,
      baseUrl: resolveFetchBaseUrl(context.baseUrl)
    };
    const body = await requestJson(
      "",
      {
        urls: [request.url],
        format: "markdown",
        per_url_timeout_ms: FETCH_PER_URL_TIMEOUT_MS
      },
      fetchContext,
      {
        limitBytes: FETCH_RESPONSE_LIMIT_BYTES,
        headers: { "X-API-Key": context.apiKey },
        statusFailure: fetchStatusFailure
      }
    );
    if (!isRecord(body) || !Array.isArray(body.results))
      throw new WebSearchProviderError("invalid_response", false);
    const entry: unknown = body.results[0];
    if (entry !== undefined) {
      if (!isRecord(entry) || typeof entry.text !== "string")
        throw new WebSearchProviderError("invalid_response", false);
      const content = entry.text.trim();
      if (!content) throw new WebSearchProviderError("no_content", false);
      return {
        title: typeof entry.title === "string" ? entry.title.trim() : "",
        url: request.url,
        content
      };
    }
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      const first: unknown = body.errors[0];
      throw fetchEntryFailure(isRecord(first) ? first.error : undefined);
    }
    throw new WebSearchProviderError("no_content", false);
  }
};

export const tinyFishWebSearchClient: WebSearchProviderClient = {
  id: "tinyfish",
  maxQps: 0.5,
  fetch: tinyFishWebFetch,
  queryHint: "使用简明的公开关键词或自然语言问题搜索。",
  async search(request, context) {
    const limit = WEB_SEARCH_PROVIDERS.tinyfish.queryMaxChars;
    if (!request.query.trim() || [...request.query].length > limit)
      throw new WebSearchProviderError("bad_request", false);
    const count = Math.min(
      Math.max(1, request.count),
      WEB_SEARCH_PROVIDERS.tinyfish.maxResultsCap
    );
    const trimmedQuestion = request.question?.trim();
    const purpose = trimmedQuestion
      ? cutCharacters(trimmedQuestion, PURPOSE_MAX_CHARS).head
      : "";
    const query: Record<string, string> = {
      query: request.query,
      ...(purpose ? { purpose } : {}),
      ...(HAN_SCRIPT_PATTERN.test(request.query) ? { language: "zh" } : {})
    };
    const body = await requestJson("", undefined, context, {
      method: "GET",
      limitBytes: SEARCH_RESPONSE_LIMIT_BYTES,
      headers: { "X-API-Key": context.apiKey },
      query
    });
    if (!isRecord(body) || !Array.isArray(body.results))
      throw new WebSearchProviderError("invalid_response", false);
    return body.results
      .flatMap((raw: unknown) => toTinyFishHit(raw) ?? [])
      .slice(0, count);
  }
};
