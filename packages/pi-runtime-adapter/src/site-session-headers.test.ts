import { Agent } from "@earendil-works/pi-agent-core";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
  DEEPWRITE_SITE_OFFICIAL_MODEL_ID_PREFIX,
  type AgentProviderRuntimeConfig,
  type ModelApi
} from "@deepwrite/contracts";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiAgentRuntimeAdapter } from "./adapter";
import { buildProviderRuntime } from "./provider-runtime";

const apis = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai"
] as const;

function siteConfig(
  api: ModelApi,
  overrides: Partial<AgentProviderRuntimeConfig> = {}
): AgentProviderRuntimeConfig {
  return {
    id: `${DEEPWRITE_SITE_OFFICIAL_MODEL_ID_PREFIX}session-test`,
    label: "Official site test",
    provider: "deepwrite-site",
    modelId: "session-test",
    api,
    baseUrl: "https://gateway.example.test/v1",
    apiKey: "invalid-site-test-key",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low"],
    temperatureOptions: [0.1, 0.7, 1],
    ...overrides
  };
}

function captureRequests() {
  const headers: Headers[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    headers.push(new Headers(init?.headers));
    return Response.json(
      { error: { message: "expected test stop" } },
      { status: 400 }
    );
  };
  vi.stubGlobal("fetch", fetcher);
  return { headers, fetcher };
}

async function request(
  runtime: ReturnType<typeof buildProviderRuntime>,
  options: SimpleStreamOptions
) {
  const stream = runtime.streamFn(
    runtime.model,
    { messages: [{ role: "user", content: "OK", timestamp: 0 }] },
    { maxRetries: 0, ...options }
  );
  await (await stream).result();
}

afterEach(() => vi.unstubAllGlobals());

describe("official-site routing session headers", () => {
  it.each(apis)(
    "%s keeps a conversation ID across requests and rebuilt runtimes",
    async (api) => {
      const { headers, fetcher } = captureRequests();
      const runtime = buildProviderRuntime(siteConfig(api));
      runtime.model.headers = { "x-test-model": "preserved" };
      const options: SimpleStreamOptions = {
        fetch: fetcher,
        sessionId: "conversation-one",
        cacheRetention: "none",
        headers: { "x-test-option": "preserved" }
      };
      await request(runtime, options);
      await request(runtime, options);
      await request(buildProviderRuntime(siteConfig(api)), options);
      await request(runtime, { ...options, sessionId: "conversation-two" });
      expect(
        headers.map((value) => value.get("X-DeepWrite-Session-ID"))
      ).toEqual([
        "conversation-one",
        "conversation-one",
        "conversation-one",
        "conversation-two"
      ]);
      expect(headers[0]?.get("x-test-model")).toBe("preserved");
      expect(
        headers.every((value) => value.get("x-test-option") === "preserved")
      ).toBe(true);
    }
  );

  it.each(apis)(
    "%s excludes free models and custom configurations at the same endpoint",
    async (api) => {
      const { headers, fetcher } = captureRequests();
      for (const overrides of [
        { id: "free-test", managedBy: "deepwrite-free" as const },
        { id: "custom-test", provider: "custom" },
        { id: "custom-site-label", provider: "deepwrite-site" }
      ]) {
        await request(buildProviderRuntime(siteConfig(api, overrides)), {
          fetch: fetcher,
          sessionId: "other-conversation"
        });
      }
      expect(headers).toHaveLength(3);
      expect(
        headers.every((value) => !value.has("X-DeepWrite-Session-ID"))
      ).toBe(true);
    }
  );

  it.each(apis)(
    "%s gives each standalone connection test its own ID",
    async (api) => {
      const { headers } = captureRequests();
      const adapter = new PiAgentRuntimeAdapter();
      await expect(adapter.testConnection(siteConfig(api))).rejects.toThrow();
      await expect(adapter.testConnection(siteConfig(api))).rejects.toThrow();
      const ids = headers.map((value) => value.get("X-DeepWrite-Session-ID"));
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBeTruthy();
      expect(ids[1]).toBeTruthy();
      expect(ids[0]).not.toBe(ids[1]);
    }
  );

  it("keeps a fallback ID across retries of one standalone operation", async () => {
    const { headers, fetcher } = captureRequests();
    const runtime = buildProviderRuntime(siteConfig("openai-completions"));
    await request(runtime, { fetch: fetcher });
    await request(runtime, { fetch: fetcher });
    expect(headers[0]?.get("X-DeepWrite-Session-ID")).toBeTruthy();
    expect(headers[0]?.get("X-DeepWrite-Session-ID")).toBe(
      headers[1]?.get("X-DeepWrite-Session-ID")
    );
  });

  it("passes the desktop conversation ID through successive agent runs", async () => {
    const { headers } = captureRequests();
    const adapter = new PiAgentRuntimeAdapter();
    for (const runId of ["run-one", "run-two"]) {
      for await (const _event of adapter.start({
        runId,
        sessionId: "desktop-conversation",
        prompt: "OK",
        runtimeConfig: siteConfig("openai-completions")
      })) {
        // Consume the deterministic provider error without a live service.
      }
    }
    expect(headers.length).toBeGreaterThanOrEqual(2);
    expect(
      headers.every(
        (value) =>
          value.get("X-DeepWrite-Session-ID") === "desktop-conversation"
      )
    ).toBe(true);
  });

  it("keeps the routing ID during an actual tool continuation", async () => {
    const headers: Headers[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      headers.push(new Headers(init?.headers));
      const first = headers.length === 1;
      const data = first
        ? {
            tool_calls: [
              {
                index: 0,
                id: "call_read",
                type: "function",
                function: { name: "read", arguments: "{}" }
              }
            ]
          }
        : { content: "Done" };
      return new Response(
        [
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: data }] })}`,
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}`,
          "data: [DONE]"
        ].join("\n\n") + "\n\n",
        { headers: { "Content-Type": "text/event-stream" } }
      );
    };
    vi.stubGlobal("fetch", fetcher);
    const runtime = buildProviderRuntime(siteConfig("openai-completions"));
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "Read result" }],
      details: {}
    }));
    const agent = new Agent({
      initialState: {
        model: runtime.model,
        tools: [
          {
            name: "read",
            label: "Read",
            description: "Read draft",
            parameters: Type.Object({}),
            execute
          }
        ]
      },
      sessionId: "tool-conversation",
      streamFn: (model, context, options) =>
        runtime.streamFn(model, context, {
          ...options,
          fetch: fetcher,
          maxRetries: 0
        })
    });
    await agent.prompt("Read draft");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(headers).toHaveLength(2);
    expect(headers.map((value) => value.get("X-DeepWrite-Session-ID"))).toEqual(
      ["tool-conversation", "tool-conversation"]
    );
  });
});
