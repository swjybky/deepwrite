import { webSearchProvider } from "@deepwrite/contracts";
import {
  WebSearchProviderError,
  type WebSearchHit,
  type WebSearchProviderClient
} from "../types";
import {
  failureFor,
  httpUrl,
  isRecord,
  requestJson,
  type JsonRequestOptions
} from "./http";

export type AdditionalSearchProviderId =
  | "serper"
  | "serpapi"
  | "searchapi"
  | "bocha"
  | "zhipu"
  | "search1api"
  | "searxng";

interface WireRequest {
  path: string;
  body?: unknown;
  options?: Omit<JsonRequestOptions, "limitBytes">;
}

function wireRequest(
  id: AdditionalSearchProviderId,
  query: string,
  count: number,
  apiKey: string
): WireRequest {
  switch (id) {
    case "serper":
      return {
        path: "/search",
        body: { q: query, num: count },
        options: { headers: { "X-API-KEY": apiKey } }
      };
    case "serpapi":
      // Google's organic page size is now fixed; cap results locally, without extra paid requests.
      return {
        path: "/search.json",
        options: {
          method: "GET",
          headers: {},
          query: { engine: "google", q: query, api_key: apiKey }
        }
      };
    case "searchapi":
      return {
        path: "/api/v1/search",
        options: { method: "GET", query: { engine: "google", q: query } }
      };
    case "bocha":
      return {
        path: "/v1/web-search",
        body: { query, count, summary: true, freshness: "noLimit" }
      };
    case "zhipu":
      return {
        path: "/api/paas/v4/web_search",
        body: {
          search_query: query,
          search_engine: "search_pro",
          search_intent: false,
          count
        }
      };
    case "search1api":
      return {
        path: "/search",
        body: { query, max_results: count, crawl_results: 0 }
      };
    case "searxng":
      return {
        path: "/search",
        options: {
          method: "GET",
          headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
          query: { q: query, format: "json", categories: "general" }
        }
      };
  }
}

function resultList(body: unknown, id: AdditionalSearchProviderId): unknown[] {
  if (!isRecord(body))
    throw new WebSearchProviderError("invalid_response", false);
  if (id === "bocha" && typeof body.code === "number" && body.code !== 200)
    throw failureFor(
      new Response(null, {
        status: body.code >= 400 && body.code <= 599 ? body.code : 502
      })
    );
  if (body.error !== undefined)
    throw new WebSearchProviderError("unavailable", false);
  let results: unknown;
  switch (id) {
    case "serper":
      results = body.organic;
      break;
    case "serpapi":
    case "searchapi":
      results = body.organic_results;
      // A successful SERP can contain only answer boxes or other non-organic results.
      if (
        results === undefined &&
        isRecord(body.search_metadata) &&
        body.search_metadata.status === "Success"
      )
        results = [];
      break;
    case "bocha": {
      const data = isRecord(body.data) ? body.data : undefined;
      results =
        data && isRecord(data.webPages) ? data.webPages.value : undefined;
      break;
    }
    case "zhipu":
      results = body.search_result;
      break;
    default:
      results = body.results;
  }
  if (!Array.isArray(results))
    throw new WebSearchProviderError("invalid_response", false);
  return results;
}

function toHit(raw: unknown, id: AdditionalSearchProviderId): WebSearchHit[] {
  if (!isRecord(raw)) return [];
  const title = id === "bocha" ? raw.name : raw.title;
  const link = ["bocha", "searxng"].includes(id) ? raw.url : raw.link;
  if (typeof title !== "string" || !title.trim() || typeof link !== "string")
    return [];
  const url = httpUrl(link);
  if (!url) return [];
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const snippet = text(raw.snippet) || text(raw.content);
  const summary = text(raw.summary) || text(raw.content) || snippet;
  const siteName = text(raw.siteName) || text(raw.media) || text(raw.source);
  const date = raw.datePublished ?? raw.publish_date ?? raw.published_date;
  return [
    {
      title: title.trim(),
      url,
      snippet,
      summary,
      ...(siteName ? { siteName } : {}),
      ...(typeof date === "string" && !Number.isNaN(Date.parse(date))
        ? { publishedAt: new Date(date).toISOString() }
        : {})
    }
  ];
}

/** Wire protocols share the same bounded transport, session budgets and error handling. */
export function additionalSearchApiClient(
  id: AdditionalSearchProviderId
): WebSearchProviderClient {
  return {
    id,
    maxQps: 1,
    queryHint: "使用简明的公开关键词或自然语言问题搜索。",
    async search(request, context) {
      const descriptor = webSearchProvider(id);
      if (
        !request.query.trim() ||
        [...request.query].length > descriptor.queryMaxChars
      )
        throw new WebSearchProviderError("bad_request", false);
      const count = Math.min(
        Math.max(1, request.count),
        descriptor.maxResultsCap
      );
      const wire = wireRequest(id, request.query, count, context.apiKey);
      const body = await requestJson(wire.path, wire.body, context, {
        limitBytes: 2 * 1024 * 1024,
        ...wire.options
      });
      return resultList(body, id)
        .flatMap((raw) => toHit(raw, id))
        .slice(0, count);
    }
  };
}
