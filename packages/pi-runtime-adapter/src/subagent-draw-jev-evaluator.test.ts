import { describe, expect, it } from "vitest";
import {
  pickHighestDrawJevScore,
  type DrawJevCandidateScore
} from "./subagent-draw-jev-evaluator";
import type { DrawCandidate } from "./subagent-draw-evaluator";

function candidate(number: number): DrawCandidate {
  return {
    number,
    index: number - 1,
    subagentRunId: `run_${number}`,
    summary: `draft ${number}`
  };
}

describe("pickHighestDrawJevScore", () => {
  const candidates = [candidate(1), candidate(2), candidate(3)];

  it("picks the highest valid score and mentions every score in the reason", () => {
    const scores: DrawJevCandidateScore[] = [
      { number: 1, score: 2.1 },
      { number: 2, score: 3.4, confidence: 0.8 },
      { number: 3, error: "timeout" }
    ];
    const picked = pickHighestDrawJevScore(candidates, scores);
    expect(picked).toMatchObject({
      status: "selected",
      candidate: candidates[1],
      score: 3.4
    });
    if (picked.status === "selected") {
      expect(picked.reason).toContain("第 2 份");
      expect(picked.reason).toContain("3.40");
      expect(picked.reason).toContain("timeout");
    }
  });

  it("breaks ties by the smaller candidate number", () => {
    const picked = pickHighestDrawJevScore(candidates, [
      { number: 1, score: 2 },
      { number: 2, score: 3 },
      { number: 3, score: 3 }
    ]);
    expect(picked).toMatchObject({
      status: "selected",
      candidate: candidates[1],
      score: 3
    });
    if (picked.status === "selected") {
      expect(picked.reason).toContain("同分时取候选编号更小");
    }
  });

  it("fails when every score is invalid", () => {
    expect(
      pickHighestDrawJevScore(candidates, [
        { number: 1, error: "bad" },
        { number: 2, error: "bad" }
      ])
    ).toMatchObject({ status: "failed" });
  });
});
