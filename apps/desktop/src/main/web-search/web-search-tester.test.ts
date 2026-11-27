import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type WebSearchProviderId
} from "@deepwrite/contracts";
import type { WebSearchFailureKind } from "@deepwrite/pi-runtime-adapter";

const { netFetch } = vi.hoisted(() => ({ netFetch: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch: netFetch } }));

const { handleWebSearchCommands } = await import("./web-search-commands");
const { createWebSearchTester, testWebSearch, webSearchTestFailure } =
  await import("./web-search-tester");
const { SafeWebSearchError } = await import("./web-search-errors");
const { SEARCH_KEY, setup } = await import("./web-search.test-support");

const request = {
  providerId: "deepseek" as WebSearchProviderId,
  baseUrl: "https://search.example.test",
  apiKey: SEARCH_KEY,
  query: "DeepWrite",
  signal: new AbortController().signal
};

const found = (count: number) => ({
  results: Array.from({ length: count }, (_, index) => ({
    title: `结果 ${index + 1}`,
    url: `https://example.test/${index + 1}`,
    summary: "摘要",
    snippet: "摘要",
    site_name: "示例站"
  }))
});

beforeEach(() => netFetch.mockReset());

describe("testWebSearch", () => {
  it("searches through Electron's network stack with the key as a bearer token", async () => {
    netFetch.mockResolvedValue(Response.json(found(3)));
    const result = await testWebSearch(request);
    const [url, init] = netFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://search.example.test/v1/tools/search");
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${SEARCH_KEY}`
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      query: "DeepWrite",
      count: 3
    });
    expect(result.resultCount).toBe(3);
    expect(result.samples[0]).toEqual({
      title: "结果 1",
      url: "https://example.test/1",
      siteName: "示例站"
    });
  });

  it.each([
    [401, "API Key 无效"],
    [402, "余额不足"],
    [429, "过于频繁"],
    [504, "超时"],
    [500, "暂时不可用"]
  ])(
    "explains HTTP %i to the person in plain words",
    async (status, expected) => {
      const tester = createWebSearchTester(
        (async () =>
          new Response(JSON.stringify({ error: { message: SEARCH_KEY } }), {
            status
          })) as typeof fetch
      );
      const error = await tester(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SafeWebSearchError);
      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).not.toContain(SEARCH_KEY);
    }
  );

  const failing = (error: unknown) =>
    createWebSearchTester((async () => {
      throw error;
    }) as typeof fetch);
  const messageOf = async (error: unknown): Promise<string> =>
    ((await failing(error)(request).catch((e: unknown) => e)) as Error).message;

  it("reads a dropped connection as the service being unavailable", async () => {
    const message = await messageOf(
      new TypeError(`network down ${SEARCH_KEY}`)
    );
    expect(message).toContain("暂时不可用");
    expect(message).not.toContain(SEARCH_KEY);
  });

  it("reads a timeout as a timeout", async () => {
    expect(await messageOf(new DOMException("slow", "TimeoutError"))).toContain(
      "超时"
    );
  });
});

describe("webSearchTestFailure", () => {
  it("covers every failure kind and leaves other errors for the generic message", async () => {
    const { WebSearchProviderError } =
      await import("@deepwrite/pi-runtime-adapter");
    const kinds: WebSearchFailureKind[] = [
      "auth",
      "balance",
      "rate_limit",
      "timeout",
      "bad_request",
      "unavailable",
      "invalid_response"
    ];
    for (const kind of kinds)
      expect(
        webSearchTestFailure(new WebSearchProviderError(kind, false))
      ).toBeInstanceOf(SafeWebSearchError);
    const other = new Error("unexpected");
    expect(webSearchTestFailure(other)).toBe(other);
  });
});

describe("the settings test button end to end", () => {
  it("returns the result count and samples through the command", async () => {
    netFetch.mockResolvedValue(Response.json(found(2)));
    const { service } = await setup({ tester: testWebSearch });
    const result = await handleWebSearchCommands(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "webSearch.test",
          { providerId: "deepseek", apiKey: SEARCH_KEY },
          { id: "cmd_test" }
        )
      ),
      service
    );
    expect(result).toMatchObject({
      status: "accepted",
      payload: {
        resultCount: 2,
        samples: [{ title: "结果 1" }, { title: "结果 2" }]
      }
    });
  });

  it("shows the wording for a rejected key, never the service's own text", async () => {
    const { service } = await setup({
      tester: createWebSearchTester(
        (async () => new Response("{}", { status: 401 })) as typeof fetch
      )
    });
    const result = await handleWebSearchCommands(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "webSearch.test",
          { providerId: "deepseek", apiKey: SEARCH_KEY },
          { id: "cmd_test" }
        )
      ),
      service
    );
    expect(result).toMatchObject({
      status: "rejected",
      error: {
        code: "web_search.operation_failed",
        message: "联网搜索 API Key 无效或已失效，请检查后重试。"
      }
    });
  });
});
