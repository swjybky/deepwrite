import { describe, expect, it } from "vitest";
import {
  DRAW_JEV_SCORE_CRITERIA,
  DRAW_JEV_SCORE_QUESTION_ID,
  buildDrawJevScoreInstructions,
  buildDrawJevScoreQuestion,
  normalizeJevModelIdentity,
  parseJevSystemOneScoreAnswer,
  resolveJevApiRoot,
  resolveJevSystemOneUrl
} from "./jev-systemone";

describe("JEV SystemOne helpers", () => {
  it("normalizes base URLs to the systemone endpoint", () => {
    expect(resolveJevSystemOneUrl("https://api.example.test")).toBe(
      "https://api.example.test/v1/systemone"
    );
    expect(resolveJevSystemOneUrl("https://api.example.test/v1/")).toBe(
      "https://api.example.test/v1/systemone"
    );
    expect(
      resolveJevSystemOneUrl("https://proxy.example.test/v1/systemone/")
    ).toBe("https://proxy.example.test/v1/systemone");
    expect(
      resolveJevSystemOneUrl("https://agg.example.test/v1/decisions")
    ).toBe("https://agg.example.test/v1/decisions");
  });

  it("derives the versioned API root used for model listing", () => {
    expect(resolveJevApiRoot("https://api.example.test")).toBe(
      "https://api.example.test/v1"
    );
    expect(resolveJevApiRoot("https://api.example.test/v1/systemone/")).toBe(
      "https://api.example.test/v1"
    );
    expect(resolveJevApiRoot("https://agg.example.test/v1/decisions")).toBe(
      "https://agg.example.test/v1"
    );
    expect(resolveJevApiRoot("  ")).toBe("");
  });

  it.each([
    "https://gateway.example.test/api",
    "https://gateway.example.test/api/v1/",
    "https://gateway.example.test/api/v1/systemone/"
  ])("preserves the OpenRouter-style API prefix for %s", (baseUrl) => {
    expect(resolveJevSystemOneUrl(baseUrl)).toBe(
      "https://gateway.example.test/api/v1/systemone"
    );
    expect(resolveJevApiRoot(baseUrl)).toBe(
      "https://gateway.example.test/api/v1"
    );
  });

  it("pins text-generation fields and drops LLM-only overrides", () => {
    const normalized = normalizeJevModelIdentity({
      id: "model_jev",
      api: "anthropic-messages",
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["high"],
      temperatureOptions: [0.2, 0.5, 0.9] as [number, number, number],
      toolSchemaProfile: "portable",
      requestModelId: "route-x",
      supportsDeveloperRole: true,
      contextWindow: 128_000,
      maxTokens: 8_000
    });
    expect(normalized).toMatchObject({
      id: "model_jev",
      modelKind: "jev",
      api: "openai-completions",
      reasoning: false,
      defaultThinkingLevel: "off",
      temperatureOptions: [0.1, 0.7, 1]
    });
    for (const key of [
      "toolSchemaProfile",
      "requestModelId",
      "supportsDeveloperRole",
      "contextWindow",
      "maxTokens"
    ]) {
      expect(normalized).not.toHaveProperty(key);
    }
  });

  it("parses a probability-weighted score within the criteria range", () => {
    const answer = parseJevSystemOneScoreAnswer(
      {
        model: "jev-latest",
        answers: {
          [DRAW_JEV_SCORE_QUESTION_ID]: {
            type: "score",
            score: 3.2,
            confidence: 0.81,
            legend: { "0": "a", "1": "b", "2": "c", "3": "d", "4": "e" },
            probabilities: {
              "0": 0.01,
              "1": 0.04,
              "2": 0.1,
              "3": 0.5,
              "4": 0.35
            }
          }
        },
        usage: { input_tokens: 10, output_tokens: 2 }
      },
      DRAW_JEV_SCORE_QUESTION_ID,
      DRAW_JEV_SCORE_CRITERIA.length
    );
    expect(answer.score).toBe(3.2);
    expect(answer.confidence).toBe(0.81);
  });

  it("rejects scores outside 0..criteria.length-1", () => {
    expect(() =>
      parseJevSystemOneScoreAnswer(
        {
          answers: {
            [DRAW_JEV_SCORE_QUESTION_ID]: {
              type: "score",
              score: 5,
              confidence: 0.5
            }
          }
        },
        DRAW_JEV_SCORE_QUESTION_ID,
        DRAW_JEV_SCORE_CRITERIA.length
      )
    ).toThrow(/0–4/);
  });

  it("appends evaluation rules to score instructions", () => {
    const question = buildDrawJevScoreQuestion(
      buildDrawJevScoreInstructions("优先看节奏")
    );
    expect(question.type).toBe("score");
    expect(question.criteria).toEqual([...DRAW_JEV_SCORE_CRITERIA]);
    expect(question.instructions).toContain("优先看节奏");
  });
});
