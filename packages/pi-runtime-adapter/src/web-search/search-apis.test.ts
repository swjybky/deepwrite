import { describe, expect, it, vi } from "vitest";
import { searchApiClient } from "./providers/search-apis";
import { TEST_KEY } from "./test-support";

const ids = ["tavily", "exa", "brave"] as const;
function run(id: (typeof ids)[number], response: Response) {
  const fetch = vi.fn(async () => response);
  const result = searchApiClient(id).search(
    { query: "写作 资料", count: 3 },
    {
      apiKey: TEST_KEY,
      baseUrl: "https://relay.example.test/gateway/",
      fetch,
      signal: new AbortController().signal
    }
  );
  return { fetch, result };
}

describe("additional search APIs", () => {
  it.each(ids)(
    "%s sends its protocol to the configured endpoint and normalizes results",
    async (id) => {
      const hit = {
        title: "资料",
        url: "https://example.test/source",
        content: "摘要",
        description: "摘要",
        highlights: ["摘要"]
      };
      const results = [
        hit,
        { ...hit, url: "javascript:invalid" },
        { title: "没有网址" }
      ];
      const { fetch, result } = run(
        id,
        Response.json(id === "brave" ? { web: { results } } : { results })
      );
      await expect(result).resolves.toEqual([
        { title: "资料", url: hit.url, snippet: "摘要", summary: "摘要" }
      ]);
      const [url, init] = fetch.mock.calls[0] as unknown as [
        string,
        RequestInit
      ];
      expect(url).toContain("https://relay.example.test/gateway/");
      expect(init.redirect).toBe("error");
      expect(init.headers).toMatchObject(
        id === "tavily"
          ? { authorization: `Bearer ${TEST_KEY}` }
          : id === "exa"
            ? { "x-api-key": TEST_KEY }
            : { "X-Subscription-Token": TEST_KEY }
      );
      if (id === "brave") {
        expect(new URL(url).pathname).toBe("/gateway/res/v1/web/search");
        expect(new URL(url).searchParams.get("q")).toBe("写作 资料");
        expect(new URL(url).searchParams.get("count")).toBe("3");
        expect(init.method).toBe("GET");
        expect(init.body).toBeUndefined();
      } else {
        expect(JSON.parse(init.body as string)).toMatchObject(
          id === "tavily"
            ? { query: "写作 资料", max_results: 3 }
            : {
                query: "写作 资料",
                numResults: 3,
                contents: { highlights: true }
              }
        );
      }
    }
  );
  it.each(ids)(
    "%s reports authentication and malformed response failures without response text",
    async (id) => {
      await expect(
        run(id, new Response("secret server error", { status: 401 })).result
      ).rejects.toMatchObject({ kind: "auth", retryable: false });
      await expect(
        run(
          id,
          Response.json({ results: "invalid", web: { results: "invalid" } })
        ).result
      ).rejects.toMatchObject({ kind: "invalid_response" });
    }
  );
  it.each(ids)("%s rejects oversized results", async (id) => {
    await expect(
      run(
        id,
        new Response("{}", {
          headers: { "content-length": String(3 * 1024 * 1024) }
        })
      ).result
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
});
