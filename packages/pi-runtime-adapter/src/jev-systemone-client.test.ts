import { describe, expect, it, vi } from "vitest";
import {
  DRAW_JEV_SCORE_CRITERIA,
  DRAW_JEV_SCORE_QUESTION_ID
} from "@deepwrite/contracts";
import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import {
  scoreWithJevSystemOne,
  testJevConnection
} from "./jev-systemone-client";

const scoreRequest = {
  model: "jev-1.14.0",
  state: "text",
  questions: {
    [DRAW_JEV_SCORE_QUESTION_ID]: {
      type: "score" as const,
      instructions: "rate",
      criteria: ["低", "高"]
    }
  }
};

const jevConfig: AgentProviderRuntimeConfig = {
  id: "model_jev",
  label: "Jev",
  provider: "typesafe",
  modelId: "jev-1.14.0",
  modelKind: "jev",
  api: "openai-completions",
  baseUrl: "https://api.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["medium"],
  temperatureOptions: [0.1, 0.7, 1],
  apiKey: "sk-placeholder"
};

describe("scoreWithJevSystemOne", () => {
  it("POSTs to the normalized systemone endpoint with bearer auth", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example.test/v1/systemone");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer sk-test",
        "Content-Type": "application/json"
      });
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        questions: Record<string, { type: string }>;
      };
      expect(body.model).toBe("jev-latest");
      expect(body.questions[DRAW_JEV_SCORE_QUESTION_ID]?.type).toBe("score");
      return new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: {
            [DRAW_JEV_SCORE_QUESTION_ID]: {
              type: "score",
              score: 2.5,
              confidence: 0.7
            }
          }
        }),
        { status: 200 }
      );
    });

    const answer = await scoreWithJevSystemOne({
      baseUrl: "https://api.example.test",
      apiKey: "sk-test",
      questionId: DRAW_JEV_SCORE_QUESTION_ID,
      criteriaLength: DRAW_JEV_SCORE_CRITERIA.length,
      fetchImpl: fetchImpl as typeof fetch,
      request: {
        model: "jev-latest",
        state: "candidate text",
        questions: {
          [DRAW_JEV_SCORE_QUESTION_ID]: {
            type: "score",
            instructions: "rate it",
            criteria: [...DRAW_JEV_SCORE_CRITERIA]
          }
        }
      }
    });

    expect(answer.score).toBe(2.5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once on HTTP 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "rate" }), { status: 429 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            answers: {
              [DRAW_JEV_SCORE_QUESTION_ID]: {
                type: "score",
                score: 1,
                confidence: 0.5
              }
            }
          }),
          { status: 200 }
        )
      );

    const answer = await scoreWithJevSystemOne({
      baseUrl: "https://api.example.test/v1",
      apiKey: "sk-test",
      questionId: DRAW_JEV_SCORE_QUESTION_ID,
      criteriaLength: DRAW_JEV_SCORE_CRITERIA.length,
      fetchImpl: fetchImpl as typeof fetch,
      request: {
        model: "jev-latest",
        state: "text",
        questions: {
          [DRAW_JEV_SCORE_QUESTION_ID]: {
            type: "score",
            instructions: "rate",
            criteria: ["低", "高"]
          }
        }
      }
    });

    expect(answer.score).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry auth failures and surfaces the provider detail", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "Invalid API key" }), {
          status: 401
        })
    );
    await expect(
      scoreWithJevSystemOne({
        baseUrl: "https://api.example.test/v1",
        apiKey: "sk-placeholder",
        questionId: DRAW_JEV_SCORE_QUESTION_ID,
        criteriaLength: 2,
        fetchImpl: fetchImpl as typeof fetch,
        request: scoreRequest
      })
    ).rejects.toThrow(/HTTP 401.*API Key.*Invalid API key/u);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("posts to an AIMLAPI-style /decisions URL as entered", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://agg.example.test/v1/decisions");
      return new Response(
        JSON.stringify({
          answers: { [DRAW_JEV_SCORE_QUESTION_ID]: { type: "score", score: 0 } }
        }),
        { status: 200 }
      );
    });
    const answer = await scoreWithJevSystemOne({
      baseUrl: "https://agg.example.test/v1/decisions",
      apiKey: "sk-placeholder",
      questionId: DRAW_JEV_SCORE_QUESTION_ID,
      criteriaLength: 2,
      fetchImpl: fetchImpl as typeof fetch,
      request: scoreRequest
    });
    expect(answer.score).toBe(0);
  });

  it("rejects a chat-completions style reply instead of guessing a score", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: {} }] }), {
          status: 200
        })
    );
    await expect(
      scoreWithJevSystemOne({
        baseUrl: "https://api.example.test/v1",
        apiKey: "sk-placeholder",
        questionId: DRAW_JEV_SCORE_QUESTION_ID,
        criteriaLength: 2,
        fetchImpl: fetchImpl as typeof fetch,
        request: scoreRequest
      })
    ).rejects.toThrow(/缺少 answers/u);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("testJevConnection", () => {
  it("probes the judgment endpoint with a score question and reports usage", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example.test/v1/systemone");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        questions: Record<string, { type: string; criteria: string[] }>;
      };
      expect(body.model).toBe("jev-1.14.0");
      expect(Object.values(body.questions)[0]).toMatchObject({
        type: "score"
      });
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("max_tokens");
      return new Response(
        JSON.stringify({
          model: "jev-1.14.0",
          answers: {
            connection_check: { type: "score", score: 0.98, confidence: 0.9 }
          },
          usage: { input_tokens: 42, output_tokens: 0 }
        }),
        { status: 200 }
      );
    });
    const result = await testJevConnection(jevConfig, {
      fetchImpl: fetchImpl as typeof fetch
    });
    expect(result).toMatchObject({
      modelId: "model_jev",
      ok: true,
      usage: { inputTokens: 42, outputTokens: 0, totalTokens: 42 }
    });
    expect(result.message).toContain("jev-1.14.0");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails fast without an API key", async () => {
    await expect(
      testJevConnection({ ...jevConfig, apiKey: "" })
    ).rejects.toThrow(/API Key/u);
  });

  it.each(["typesafe/jev-1.14", "~typesafe/jev-latest"])(
    "accepts OpenRouter System One metadata and usage for %s",
    async (modelId) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        Response.json({
          id: "test-decision-id",
          provider: "TypeSafe",
          model: "typesafe/jev-1.14",
          answers: {
            connection_check: { type: "score", score: 0.98, confidence: 0.9 }
          },
          usage: { input_tokens: 42, output_tokens: 2, cost: 0.00003 }
        })
      );
      const result = await testJevConnection(
        {
          ...jevConfig,
          provider: "openrouter",
          modelId,
          baseUrl: "https://gateway.example.test/api/v1"
        },
        { fetchImpl: fetchImpl as typeof fetch }
      );

      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://gateway.example.test/api/v1/systemone",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer sk-placeholder",
            "Content-Type": "application/json"
          },
          body: expect.any(String)
        })
      );
      expect(
        JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)
      ).toMatchObject({
        model: modelId,
        questions: { connection_check: { type: "score" } }
      });
      expect(result).toMatchObject({
        ok: true,
        modelId: "model_jev",
        usage: { inputTokens: 42, outputTokens: 2, totalTokens: 44 }
      });
      expect(result.message).toContain("typesafe/jev-1.14");
    }
  );
});
