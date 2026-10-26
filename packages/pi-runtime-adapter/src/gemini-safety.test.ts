import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { Type, type Context } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProviderRuntime,
  buildWorkspaceProviderRuntimes
} from "./provider-runtime";

const config: AgentProviderRuntimeConfig = {
  id: "gemini-safety-test",
  label: "Gemini writing gateway",
  provider: "custom",
  modelId: "gemini-3.8-flash",
  api: "google-generative-ai",
  baseUrl: "https://gateway.example.test/v1beta",
  apiKey: "invalid-gemini-safety-test-key",
  reasoning: true,
  defaultThinkingLevel: "high",
  thinkingLevelOptions: ["low", "high"],
  temperatureOptions: [0.1, 0.7, 1]
};

const context: Context = {
  systemPrompt: "Help write a fictional story.",
  messages: [{ role: "user", content: "Write a greeting.", timestamp: 1 }],
  tools: [
    {
      name: "read_document",
      description: "Read a writing document.",
      parameters: Type.Object({ id: Type.String() })
    }
  ]
};

const expectedSettings = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

async function capturePayload(runtimeConfig: AgentProviderRuntimeConfig) {
  const { model, streamFn } = buildProviderRuntime(runtimeConfig);
  let payload: Record<string, unknown> | undefined;
  await (
    await streamFn(model, context, {
      onPayload: (value) => {
        payload = value as Record<string, unknown>;
        throw new Error("Captured before transport");
      }
    })
  ).result();
  expect(payload).toBeDefined();
  return payload!;
}

function captureGoogleTransport() {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const body =
      init?.body ?? (input instanceof Request ? await input.text() : "");
    bodies.push(JSON.parse(String(body)) as Record<string, unknown>);
    return new Response(
      `data: ${JSON.stringify({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello." }] },
            finishReason: "STOP"
          }
        ]
      })}\n\n`,
      { headers: { "content-type": "text/event-stream" } }
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return { bodies, fetcher };
}

afterEach(() => vi.unstubAllGlobals());

describe("Gemini writing safety settings", () => {
  it.each([
    { modelId: "gemini-3.8-flash" },
    { modelId: "models/gemini-2.5-pro" },
    { modelId: "google/gemini-3.8-flash-high" },
    { modelId: "gemini-3.8-flash", requestModelId: "gateway-writing-route" },
    { modelId: "writing-alias", requestModelId: "gemini-3.8-flash" }
  ])("adds explicit native defaults for %j", async (identity) => {
    const payload = await capturePayload({ ...config, ...identity });
    expect(payload.config).toMatchObject({ safetySettings: expectedSettings });
    expect(payload).not.toHaveProperty("safetySettings");
  });

  it.each([
    { api: "openai-completions", modelId: "gemini-3.8-flash" },
    { api: "google-generative-ai", modelId: "claude-opus-4-6-thinking" },
    { api: "google-generative-ai", modelId: "custom-writer" }
  ] as const)("keeps other routes unchanged: %j", async (identity) => {
    const payload = await capturePayload({ ...config, ...identity });
    expect(JSON.stringify(payload)).not.toContain("safetySettings");
    expect(JSON.stringify(payload)).not.toContain("BLOCK_NONE");
  });

  it.each(["streamFn", "spawnStreamFn"] as const)(
    "serializes the settings in the HTTP body for %s and preserves other controls",
    async (streamName) => {
      const { bodies, fetcher } = captureGoogleTransport();
      const runtime = buildWorkspaceProviderRuntimes(config, 0.7, "high");
      let observations = 0;
      const result = await (
        await runtime[streamName](runtime.model, context, {
          maxTokens: 512,
          maxRetries: 0,
          reasoning: "high",
          onPayload: async (payload, model) => {
            observations++;
            expect(model.id).toBe(config.modelId);
            const request = payload as Record<string, unknown>;
            const requestConfig = request.config as Record<string, unknown>;
            expect(requestConfig.safetySettings).toEqual(expectedSettings);
            return {
              ...request,
              config: { ...requestConfig, responseMimeType: "text/plain" }
            };
          }
        })
      ).result();

      expect(result.stopReason).toBe("stop");
      expect(result.content).toMatchObject([{ type: "text", text: "Hello." }]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(observations).toBe(1);
      expect(bodies[0]).toMatchObject({
        safetySettings: expectedSettings,
        contents: [{ role: "user", parts: [{ text: "Write a greeting." }] }],
        systemInstruction: {
          parts: [{ text: "Help write a fictional story." }]
        },
        tools: [expect.any(Object)],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512,
          thinkingConfig: expect.any(Object),
          responseMimeType: "text/plain"
        }
      });
      expect(bodies[0]?.generationConfig).not.toHaveProperty("safetySettings");
    }
  );

  it("lets an existing payload hook override the defaults", async () => {
    const { bodies } = captureGoogleTransport();
    const { model, streamFn } = buildProviderRuntime(config);
    const explicitSettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" }
    ];
    const result = await (
      await streamFn(model, context, {
        maxRetries: 0,
        onPayload: (payload) => {
          const request = payload as { config: Record<string, unknown> };
          request.config.safetySettings = explicitSettings;
        }
      })
    ).result();
    expect(result.stopReason).toBe("stop");
    expect(bodies[0]?.safetySettings).toEqual(explicitSettings);
  });
});
