import { describe, expect, it } from "vitest";
import {
  listRemoteModels,
  parseRemoteModelList,
  resolveRemoteModelsUrl
} from "./list-remote-models";

describe("listRemoteModels", () => {
  it("builds OpenAI-compatible, Anthropic, and Google list endpoints", () => {
    expect(
      resolveRemoteModelsUrl({
        api: "openai-completions",
        baseUrl: "https://api.example.test/v1/",
        apiKey: "sk-test",
        provider: "custom"
      })
    ).toBe("https://api.example.test/v1/models");
    expect(
      resolveRemoteModelsUrl({
        api: "anthropic-messages",
        baseUrl: "https://api.example.test",
        apiKey: "sk-test",
        provider: "anthropic"
      })
    ).toBe("https://api.example.test/v1/models");
    expect(
      resolveRemoteModelsUrl({
        api: "google-generative-ai",
        baseUrl: "https://generativelanguage.example.test/v1beta",
        apiKey: "sk-test",
        provider: "google"
      })
    ).toBe("https://generativelanguage.example.test/v1beta/models?key=sk-test");
  });

  it("parses OpenAI, Anthropic, and Google list payloads", () => {
    expect(
      parseRemoteModelList({
        data: [{ id: "writer-b" }, { id: "writer-a" }, { id: "writer-a" }]
      })
    ).toEqual([{ id: "writer-a" }, { id: "writer-b" }]);
    expect(
      parseRemoteModelList({
        data: [{ id: "claude-test", display_name: "Claude Test" }]
      })
    ).toEqual([{ id: "claude-test", label: "Claude Test" }]);
    expect(
      parseRemoteModelList({
        models: [{ name: "models/gemini-flash", displayName: "Gemini Flash" }]
      })
    ).toEqual([{ id: "gemini-flash", label: "Gemini Flash" }]);
  });

  it("keeps validated remote runtime metadata and understands common aliases", () => {
    expect(
      parseRemoteModelList({
        data: [
          {
            id: "writer-pro",
            label: "Writer Pro",
            provider: "deepseek",
            request_model_id: "writer-pro-20260901",
            supports_developer_role: false,
            tool_schema_profile: "portable",
            reasoning: true,
            default_thinking_level: "medium",
            thinking_level_options: ["low", "medium", "high"],
            temperature_options: [0.1, 0.6, 1],
            context_window: 1_000_000,
            max_output_tokens: 128_000,
            discount: 0.8,
            input: 2,
            output: 5,
            cache: 0.2
          }
        ]
      })
    ).toEqual([
      {
        id: "writer-pro",
        label: "Writer Pro",
        provider: "deepseek",
        requestModelId: "writer-pro-20260901",
        supportsDeveloperRole: false,
        toolSchemaProfile: "portable",
        reasoning: true,
        defaultThinkingLevel: "medium",
        thinkingLevelOptions: ["low", "medium", "high"],
        temperatureOptions: [0.1, 0.6, 1],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        discount: 0.8,
        input: 2,
        output: 5,
        cache: 0.2
      }
    ]);
  });

  it("ignores one invalid metadata field without dropping valid capacity", () => {
    expect(
      parseRemoteModelList({
        data: [
          {
            id: "writer-pro",
            context_window: 500_000,
            max_tokens: 64_000,
            discount: 8
          }
        ]
      })
    ).toEqual([
      { id: "writer-pro", contextWindow: 500_000, maxTokens: 64_000 }
    ]);
  });

  it("fetches and returns available model ids", async () => {
    const requested: Array<{ url: string; authorization: string | null }> = [];
    const models = await listRemoteModels(
      {
        api: "openai-completions",
        baseUrl: "https://api.example.test/v1",
        apiKey: "sk-test-only",
        provider: "custom"
      },
      async (url, init) => {
        requested.push({
          url,
          authorization: new Headers(init?.headers).get("Authorization")
        });
        return Response.json({
          data: [{ id: "model-b" }, { id: "model-a" }]
        });
      }
    );

    expect(requested).toEqual([
      {
        url: "https://api.example.test/v1/models",
        authorization: "Bearer sk-test-only"
      }
    ]);
    expect(models).toEqual([{ id: "model-a" }, { id: "model-b" }]);
  });

  it("sends Google credentials in the header accepted by the DeepWriteApi gateway", async () => {
    await listRemoteModels(
      {
        api: "google-generative-ai",
        baseUrl: "https://gateway.example.test/v1beta",
        apiKey: "dw_sk_test_only_invalid",
        provider: "google"
      },
      async (_url, init) => {
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(
          "dw_sk_test_only_invalid"
        );
        return Response.json({
          models: [{ name: "models/gemini-3.7-flash" }]
        });
      }
    );
  });

  it("allows Ollama without an API key", async () => {
    const models = await listRemoteModels(
      {
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "",
        provider: "ollama"
      },
      async (url, init) => {
        expect(url).toBe("http://127.0.0.1:11434/v1/models");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer ollama"
        );
        return Response.json({ data: [{ id: "llama3" }] });
      }
    );

    expect(models).toEqual([{ id: "llama3" }]);
  });

  it("rejects missing credentials before making a request", async () => {
    await expect(
      listRemoteModels({
        api: "openai-completions",
        baseUrl: "",
        apiKey: "sk-test",
        provider: "custom"
      })
    ).rejects.toThrow("请先填写 API 地址");
    await expect(
      listRemoteModels({
        api: "openai-completions",
        baseUrl: "https://api.example.test/v1",
        apiKey: "",
        provider: "custom"
      })
    ).rejects.toThrow("请先填写 API Key");
  });

  it("maps unauthorized responses to a key error", async () => {
    await expect(
      listRemoteModels(
        {
          api: "openai-completions",
          baseUrl: "https://api.example.test/v1",
          apiKey: "sk-test-only",
          provider: "custom"
        },
        async () => new Response("denied", { status: 401 })
      )
    ).rejects.toThrow("密钥无效或没有权限拉取模型列表。");
  });

  it("explains a dead local HTTP proxy instead of blaming the API address", async () => {
    const proxyError = new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED 127.0.0.1:17891")
    });
    await expect(
      listRemoteModels(
        {
          api: "openai-completions",
          baseUrl: "https://gateway.example.test/v1",
          apiKey: "dw_sk_test_only_invalid",
          provider: "deepwrite-site"
        },
        async () => {
          throw proxyError;
        }
      )
    ).rejects.toThrow("无法连接本地网络代理");
  });
});
