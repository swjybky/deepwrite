import { describe, expect, it, vi } from "vitest";
import {
  DRAW_JEV_SCORE_CRITERIA,
  DRAW_JEV_SCORE_QUESTION_ID
} from "@deepwrite/contracts";
import { scoreWithJevSystemOne } from "./jev-systemone-client";

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
});
