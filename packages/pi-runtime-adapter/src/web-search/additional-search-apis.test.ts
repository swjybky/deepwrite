import { describe, expect, it, vi } from "vitest";
import {
  additionalSearchApiClient,
  type AdditionalSearchProviderId
} from "./providers/additional-search-apis";
import { createWebSearchSession } from "./session";
import { runtimeConfig, instantLimiter, TEST_KEY } from "./test-support";

const source = {
  title: "资料",
  link: "https://example.test/source",
  snippet: "摘要"
};
const cases = [
  {
    id: "serper",
    path: "/search",
    response: { organic: [source] },
    body: { q: "写作 资料", num: 3 },
    header: { "X-API-KEY": TEST_KEY }
  },
  {
    id: "serpapi",
    path: "/search.json",
    response: { organic_results: [source] },
    query: { q: "写作 资料", engine: "google", api_key: TEST_KEY },
    header: {}
  },
  {
    id: "searchapi",
    path: "/api/v1/search",
    response: { organic_results: [source] },
    query: { q: "写作 资料", engine: "google" },
    header: { authorization: `Bearer ${TEST_KEY}` }
  },
  {
    id: "bocha",
    path: "/v1/web-search",
    response: {
      code: 200,
      data: {
        webPages: {
          value: [
            { name: source.title, url: source.link, snippet: source.snippet }
          ]
        }
      }
    },
    body: { query: "写作 资料", count: 3, summary: true, freshness: "noLimit" },
    header: { authorization: `Bearer ${TEST_KEY}` }
  },
  {
    id: "zhipu",
    path: "/api/paas/v4/web_search",
    response: {
      search_result: [
        { title: source.title, link: source.link, content: source.snippet }
      ]
    },
    body: {
      search_query: "写作 资料",
      search_engine: "search_pro",
      search_intent: false,
      count: 3
    },
    header: { authorization: `Bearer ${TEST_KEY}` }
  },
  {
    id: "search1api",
    path: "/search",
    response: { results: [source] },
    body: { query: "写作 资料", max_results: 3, crawl_results: 0 },
    header: { authorization: `Bearer ${TEST_KEY}` }
  },
  {
    id: "searxng",
    path: "/search",
    response: {
      results: [
        { title: source.title, url: source.link, content: source.snippet }
      ]
    },
    query: { q: "写作 资料", format: "json", categories: "general" },
    header: { authorization: `Bearer ${TEST_KEY}` }
  }
] satisfies {
  id: AdditionalSearchProviderId;
  path: string;
  response: unknown;
  body?: unknown;
  query?: Record<string, string>;
  header: Record<string, string>;
}[];

function run(
  id: AdditionalSearchProviderId,
  response: Response,
  apiKey = TEST_KEY,
  count = 3
) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
  const signal = new AbortController().signal;
  const result = additionalSearchApiClient(id).search(
    { query: "写作 资料", count },
    {
      apiKey,
      baseUrl: "https://relay.example.test/gateway/",
      fetch,
      signal
    }
  );
  return { fetch, result, signal };
}

describe("additional provider protocols", () => {
  it.each(cases)(
    "$id maps the wire request and response and uses the configured endpoint",
    async (entry) => {
      const { fetch, result, signal } = run(
        entry.id,
        Response.json(entry.response)
      );
      await expect(result).resolves.toEqual([
        {
          title: source.title,
          url: source.link,
          snippet: source.snippet,
          summary: source.snippet
        }
      ]);
      const [address, init] = fetch.mock.calls[0]!;
      const url = new URL(String(address));
      expect(url.origin + url.pathname).toBe(
        `https://relay.example.test/gateway${entry.path}`
      );
      expect(init).toMatchObject({
        redirect: "error",
        signal,
        headers: entry.header
      });
      if (entry.query) {
        expect(init?.method).toBe("GET");
        expect(Object.fromEntries(url.searchParams)).toEqual(entry.query);
        expect(init?.body).toBeUndefined();
      } else {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init?.body as string)).toEqual(entry.body);
      }
    }
  );

  it.each(cases)(
    "$id reports failures and invalid payloads without exposing server text",
    async ({ id }) => {
      for (const [status, kind] of [
        [401, "auth"],
        [402, "balance"],
        [429, "rate_limit"]
      ] as const) {
        await expect(
          run(id, new Response("invalid-secret-server-message", { status }))
            .result
        ).rejects.toMatchObject({ kind });
      }
      await expect(run(id, Response.json({})).result).rejects.toMatchObject({
        kind: "invalid_response"
      });
      await expect(
        run(
          id,
          new Response("{}", { headers: { "content-length": "3000000" } })
        ).result
      ).rejects.toMatchObject({ kind: "invalid_response" });
    }
  );

  it("filters unsafe result URLs and caps the returned sources", async () => {
    const response = {
      organic: [
        { ...source, link: "javascript:invalid" },
        source,
        { ...source, title: "第二条" }
      ]
    };
    await expect(
      run("serper", Response.json(response), TEST_KEY, 1).result
    ).resolves.toEqual([
      {
        title: source.title,
        url: source.link,
        snippet: source.snippet,
        summary: source.snippet
      }
    ]);
  });

  it("allows a keyless SearXNG instance and never sends an empty bearer token", async () => {
    const { result, fetch } = run(
      "searxng",
      Response.json({ results: [] }),
      ""
    );
    await expect(result).resolves.toEqual([]);
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "authorization"
    );
  });

  it("retains budgets, caching and optional tools for a keyless search session", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        results: [
          { title: source.title, url: source.link, content: source.snippet }
        ]
      })
    );
    const session = createWebSearchSession(
      runtimeConfig({ providerId: "searxng", apiKey: "", perRunCallLimit: 1 }),
      { fetch, limiter: instantLimiter() }
    );
    await expect(
      session.search({ query: "资料", count: 3 })
    ).resolves.toMatchObject({
      cached: false,
      callIndex: 1
    });
    await expect(
      session.search({ query: "资料", count: 3 })
    ).resolves.toMatchObject({
      cached: true,
      callIndex: 1
    });
    await expect(session.search({ query: "其他", count: 3 })).rejects.toThrow(
      "limit"
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.canFetch).toBe(false);
  });

  it("handles errors in successful HTTP envelopes", async () => {
    await expect(
      run(
        "bocha",
        Response.json({ code: 401, message: "invalid-secret-server-message" })
      ).result
    ).rejects.toMatchObject({ kind: "auth" });
    await expect(
      run("serpapi", Response.json({ error: "invalid-secret-server-message" }))
        .result
    ).rejects.toMatchObject({ kind: "unavailable" });
    await expect(
      run("serpapi", Response.json({ search_metadata: { status: "Success" } }))
        .result
    ).resolves.toEqual([]);
  });

  it("rejects Zhipu queries over its documented 70-character limit before making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      additionalSearchApiClient("zhipu").search(
        { query: "字".repeat(71), count: 3 },
        {
          apiKey: TEST_KEY,
          baseUrl: "https://example.test",
          fetch,
          signal: new AbortController().signal
        }
      )
    ).rejects.toMatchObject({ kind: "bad_request" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
