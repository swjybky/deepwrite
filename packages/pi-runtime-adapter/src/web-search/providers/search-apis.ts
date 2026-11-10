import { WEB_SEARCH_PROVIDERS } from "@deepwrite/contracts";
import {
  WebSearchProviderError,
  type WebSearchHit,
  type WebSearchProviderClient
} from "../types";
import { httpUrl, isRecord, requestJson } from "./http";

type ProviderId = "tavily" | "exa" | "brave";

function toHit(raw: unknown, id: ProviderId): WebSearchHit[] {
  if (
    !isRecord(raw) ||
    typeof raw.title !== "string" ||
    typeof raw.url !== "string"
  )
    return [];
  const url = httpUrl(raw.url);
  if (!url || !raw.title.trim()) return [];
  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights
        .filter((value): value is string => typeof value === "string")
        .join("\n")
    : "";
  const content =
    id === "tavily"
      ? raw.content
      : id === "brave"
        ? raw.description
        : highlights;
  const snippet = typeof content === "string" ? content : "";
  return [{ title: raw.title.trim(), url, snippet, summary: snippet }];
}

/** Provider-specific wire formats; sessions own retries, pacing and budgets. */
export function searchApiClient(id: ProviderId): WebSearchProviderClient {
  return {
    id,
    maxQps: 1,
    queryHint: "使用简明的公开关键词或自然语言问题搜索。",
    async search(request, context) {
      const descriptor = WEB_SEARCH_PROVIDERS[id];
      if (
        !request.query.trim() ||
        [...request.query].length > descriptor.queryMaxChars
      )
        throw new WebSearchProviderError("bad_request", false);
      const count = Math.min(
        Math.max(1, request.count),
        descriptor.maxResultsCap
      );
      const body = await requestJson(
        id === "brave" ? "/res/v1/web/search" : "/search",
        id === "tavily"
          ? {
              query: request.query,
              max_results: count,
              search_depth: "basic",
              include_answer: false
            }
          : {
              query: request.query,
              numResults: count,
              type: "auto",
              contents: { highlights: true }
            },
        context,
        {
          limitBytes: 2 * 1024 * 1024,
          ...(id === "exa" ? { headers: { "x-api-key": context.apiKey } } : {}),
          ...(id === "brave"
            ? {
                method: "GET",
                headers: { "X-Subscription-Token": context.apiKey },
                query: { q: request.query, count: String(count) }
              }
            : {})
        }
      );
      if (!isRecord(body))
        throw new WebSearchProviderError("invalid_response", false);
      const results =
        id === "brave"
          ? isRecord(body.web)
            ? body.web.results
            : body.web === undefined
              ? []
              : undefined
          : body.results;
      if (!Array.isArray(results))
        throw new WebSearchProviderError("invalid_response", false);
      return results.flatMap((raw) => toHit(raw, id)).slice(0, count);
    }
  };
}
