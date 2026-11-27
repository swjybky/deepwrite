import { WEB_SEARCH_PROVIDERS } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  resolveFetchBaseUrl,
  tinyFishWebSearchClient
} from "./providers/tinyfish";
import { TEST_KEY } from "./test-support";
import {
  WebSearchProviderError,
  type WebFetchRequest,
  type WebSearchFailureKind
} from "./types";

const PAGE = "https://example.test/article";

const RAW = {
  position: 1,
  site_name: "docs.example.test",
  title: " TinyFish Web Guide ",
  snippet: " 公开网页摘要内容 ",
  url: "https://example.test/tinyfish-guide",
  date: "2026-06-01T00:00:00Z",
  extra: true
};

function search(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  request = { query: "web automation tools", count: 5 } as {
    query: string;
    count: number;
    question?: string;
  },
  baseUrl = "https://search.example.test"
) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) =>
    respond(String(url), init!)
  );
  const result = tinyFishWebSearchClient.search(request, {
    apiKey: TEST_KEY,
    baseUrl,
    fetch: fetchMock as unknown as typeof fetch,
    signal: new AbortController().signal
  });
  return { result, fetchMock };
}

function read(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  request: WebFetchRequest = { url: PAGE },
  baseUrl: string = WEB_SEARCH_PROVIDERS.tinyfish.defaultBaseUrl
) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) =>
    respond(String(url), init!)
  );
  const result = tinyFishWebSearchClient.fetch!.page(request, {
    apiKey: TEST_KEY,
    baseUrl,
    fetch: fetchMock as unknown as typeof fetch,
    signal: new AbortController().signal
  });
  return { result, fetchMock };
}

async function searchFailureOf(
  response: Response
): Promise<WebSearchProviderError> {
  const error = await search(() => response).result.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(WebSearchProviderError);
  return error as WebSearchProviderError;
}

async function fetchFailureOf(
  response: Response
): Promise<WebSearchProviderError> {
  const error = await read(() => response).result.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(WebSearchProviderError);
  return error as WebSearchProviderError;
}

describe("TinyFish search client", () => {
  it("limits rate to 0.5 QPS and sends GET with X-API-Key without Authorization", async () => {
    expect(tinyFishWebSearchClient.maxQps).toBe(0.5);
    const { result, fetchMock } = search(() => Response.json({ results: [] }), {
      query: "web automation tools",
      count: 5,
      question: "  What tools exist? "
    });
    await result;
    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(rawUrl);
    expect(parsed.origin).toBe("https://search.example.test");
    expect(parsed.pathname).toBe("/");
    expect(parsed.searchParams.get("query")).toBe("web automation tools");
    expect(parsed.searchParams.get("purpose")).toBe("What tools exist?");
    expect(parsed.searchParams.has("language")).toBe(false);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toMatchObject({ "X-API-Key": TEST_KEY });
    expect(init?.headers).not.toHaveProperty("authorization");
  });

  it("adds language=zh only when query contains Han characters and caps purpose", async () => {
    const zh = search(() => Response.json({ results: [] }), {
      query: "中国古代驿站制度",
      count: 5,
      question: "a".repeat(2_050)
    });
    await zh.result;
    const zhUrl = new URL(zh.fetchMock.mock.calls[0]![0]);
    expect(zhUrl.searchParams.get("language")).toBe("zh");
    expect([...zhUrl.searchParams.get("purpose")!]).toHaveLength(2_000);

    const en = search(() => Response.json({ results: [] }), {
      query: "postal relay system",
      count: 5
    });
    await en.result;
    const enUrl = new URL(en.fetchMock.mock.calls[0]![0]);
    expect(enUrl.searchParams.has("language")).toBe(false);
    expect(enUrl.searchParams.has("purpose")).toBe(false);
  });

  it("maps hits, drops unusable entries, and slices results to count", async () => {
    const hits = await search(
      () =>
        Response.json({
          results: [
            RAW,
            { ...RAW, url: "javascript:alert(1)" },
            { title: "   ", url: "https://example.test/empty-title" },
            {
              title: "Second hit",
              url: "http://example.test/two",
              snippet: "Second snippet",
              date: "not-a-date"
            },
            {
              title: "Third hit",
              url: "https://example.test/three"
            }
          ]
        }),
      { query: "web automation", count: 2 }
    ).result;
    expect(hits).toEqual([
      {
        title: "TinyFish Web Guide",
        url: "https://example.test/tinyfish-guide",
        snippet: "公开网页摘要内容",
        summary: "公开网页摘要内容",
        siteName: "docs.example.test",
        publishedAt: "2026-06-01T00:00:00.000Z"
      },
      {
        title: "Second hit",
        url: "http://example.test/two",
        snippet: "Second snippet",
        summary: "Second snippet"
      }
    ]);
  });

  it("refuses empty or over-long queries without sending a request", async () => {
    for (const query of [" ", "字".repeat(401)]) {
      const { result, fetchMock } = search(
        () => Response.json({ results: [] }),
        {
          query,
          count: 5
        }
      );
      await expect(result).rejects.toMatchObject({ kind: "bad_request" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it.each([
    [400, "bad_request", false],
    [401, "auth", false],
    [402, "balance", false],
    [429, "rate_limit", true],
    [408, "timeout", true],
    [504, "timeout", true],
    [500, "unavailable", true],
    [502, "unavailable", true]
  ] as [number, WebSearchFailureKind, boolean][])(
    "maps search HTTP %i to %s",
    async (status, kind, retryable) => {
      const error = await searchFailureOf(
        new Response(
          JSON.stringify({ error: { message: `secret ${TEST_KEY}` } }),
          { status }
        )
      );
      expect(error).toMatchObject({ kind, retryable });
      expect(JSON.stringify(error)).not.toContain(TEST_KEY);
    }
  );
});

describe("TinyFish fetch client", () => {
  it("declares 2 QPS and resolves official or custom fetch endpoints safely", () => {
    expect(tinyFishWebSearchClient.fetch).toMatchObject({ maxQps: 2 });
    const officialSearch = WEB_SEARCH_PROVIDERS.tinyfish.defaultBaseUrl;
    const officialFetch = WEB_SEARCH_PROVIDERS.tinyfish.defaultFetchBaseUrl;
    expect(resolveFetchBaseUrl(officialSearch)).toBe(officialFetch);
    expect(resolveFetchBaseUrl(`${officialSearch}/`)).toBe(officialFetch);
    expect(resolveFetchBaseUrl("https://api.search.relay.example.test")).toBe(
      "https://api.fetch.relay.example.test"
    );
    expect(resolveFetchBaseUrl("https://gateway.example.test/tinyfish/")).toBe(
      "https://gateway.example.test/tinyfish/fetch"
    );
  });

  it("posts urls, markdown format and per_url_timeout_ms with X-API-Key", async () => {
    const { result, fetchMock } = read(() =>
      Response.json({
        results: [
          {
            url: PAGE,
            title: "  页面标题  ",
            text: "\n# 正文\n\n内容\n"
          }
        ],
        errors: []
      })
    );
    await expect(result).resolves.toEqual({
      title: "页面标题",
      url: PAGE,
      content: "# 正文\n\n内容"
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${WEB_SEARCH_PROVIDERS.tinyfish.defaultFetchBaseUrl}/`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "X-API-Key": TEST_KEY,
      "content-type": "application/json"
    });
    expect(init?.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(init!.body as string)).toEqual({
      urls: [PAGE],
      format: "markdown",
      per_url_timeout_ms: 25_000
    });
  });

  it("treats blank text or missing results without errors as no_content", async () => {
    expect(
      await fetchFailureOf(
        Response.json({ results: [{ url: PAGE, title: "t", text: "   " }] })
      )
    ).toMatchObject({ kind: "no_content", retryable: false });
    expect(
      await fetchFailureOf(Response.json({ results: [], errors: [] }))
    ).toMatchObject({ kind: "no_content", retryable: false });
  });

  it.each([
    ["timeout", "timeout", true],
    ["proxy_error", "unavailable", true],
    ["invalid_url", "bad_request", false],
    ["invalid_redirect_url", "bad_request", false],
    ["bot_blocked", "no_content", false],
    ["login_required", "no_content", false],
    ["page_not_found", "no_content", false],
    ["target_http_error", "no_content", false],
    ["target_unreachable", "no_content", false],
    ["empty_content", "no_content", false],
    ["content_too_large", "no_content", false]
  ] as const)(
    "maps HTTP 200 errors[].error=%s to %s without leaking details",
    async (entryError, kind, retryable) => {
      const error = await fetchFailureOf(
        Response.json({
          results: [],
          errors: [
            {
              url: PAGE,
              error: entryError,
              message: `sensitive ${TEST_KEY} detail`
            }
          ]
        })
      );
      expect(error).toMatchObject({ kind, retryable });
      expect(JSON.stringify(error)).not.toContain(TEST_KEY);
      expect(error.message).toBe(kind);
    }
  );

  it.each([
    [403, "blocked", false],
    [422, "bad_request", false],
    [401, "auth", false],
    [402, "balance", false],
    [429, "rate_limit", true]
  ] as const)("maps fetch HTTP %i to %s", async (status, kind, retryable) => {
    expect(await fetchFailureOf(new Response("{}", { status }))).toMatchObject({
      kind,
      retryable
    });
  });

  it("rejects oversized fetch bodies and over-long URLs", async () => {
    const tooLongUrl = `https://example.test/${"a".repeat(8192)}`;
    const { result, fetchMock } = read(() => Response.json({}), {
      url: tooLongUrl
    });
    await expect(result).rejects.toMatchObject({ kind: "bad_request" });
    expect(fetchMock).not.toHaveBeenCalled();

    const declared = new Response("{}", {
      headers: { "content-length": String(9 * 1024 * 1024) }
    });
    expect(await fetchFailureOf(declared)).toMatchObject({
      kind: "invalid_response"
    });
  });
});
