import { describe, expect, it } from "vitest";
import {
  DRAW_JEV_SCORE_CRITERIA,
  DRAW_JEV_SCORE_QUESTION_ID,
  buildDrawJevScoreInstructions,
  buildDrawJevScoreQuestion,
  parseJevSystemOneScoreAnswer,
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
