import { WEB_SEARCH_PROVIDERS } from "@deepwrite/contracts";
import {
  WebSearchProviderError,
  type WebSearchHit,
  type WebSearchProviderClient
} from "../types";
import { deepSeekWebFetch } from "./deepseek-fetch";
import { httpUrl, isRecord, requestJson } from "./http";

/** https://api-docs.deepseek.com/zh-cn/api/search */
const SEARCH_PATH = "/v1/tools/search";
const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_COUNT = 50;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Unknown fields are ignored; a result without a title or http(s) link is dropped. */
function toHit(raw: unknown): WebSearchHit | undefined {
  if (!isRecord(raw)) return undefined;
  const title = text(raw.title);
  const url = typeof raw.url === "string" ? httpUrl(raw.url) : undefined;
  if (title === undefined || !url) return undefined;
  const snippet = text(raw.snippet) ?? "";
  const siteName = text(raw.site_name);
  const date = text(raw.date);
  const score = number(raw.rerank_score);
  const authority = number(raw.authority);
  return {
    title,
    url,
    snippet,
    summary: text(raw.summary) || snippet,
    ...(siteName ? { siteName } : {}),
    ...(date && !Number.isNaN(Date.parse(date)) ? { publishedAt: date } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(authority !== undefined ? { authority } : {})
  };
}

export const deepSeekWebSearchClient: WebSearchProviderClient = {
  id: "deepseek",
  maxQps: 5,
  fetch: deepSeekWebFetch,
  queryHint:
    '支持 site:域名、-site:域名、"精确短语"、-排除词、lang:zh、after:2025、before:2026-01-01，可组合使用。',
  async search(request, context) {
    const limit = WEB_SEARCH_PROVIDERS.deepseek.queryMaxChars;
    if (!request.query.trim() || [...request.query].length > limit)
      throw new WebSearchProviderError("bad_request", false);
    const question = request.question?.trim().slice(0, limit);
    const body = await requestJson(
      SEARCH_PATH,
      {
        query: request.query,
        count: Math.min(Math.max(1, request.count), MAX_COUNT),
        ...(question ? { ori_question: question } : {}),
        need_content: false
      },
      context,
      { limitBytes: RESPONSE_LIMIT_BYTES }
    );
    if (!isRecord(body) || !Array.isArray(body.results))
      throw new WebSearchProviderError("invalid_response", false);
    return body.results.flatMap((raw: unknown) => toHit(raw) ?? []);
  }
};
