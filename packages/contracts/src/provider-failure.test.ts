import { describe, expect, it } from "vitest";
import { isInsufficientQuotaErrorMessage } from "./provider-failure";

describe("provider failure classification", () => {
  it("recognises quota and billing exhaustion wording", () => {
    const exhausted = [
      "insufficient_quota: You exceeded your current quota",
      "Your account is out of budget",
      "quota exceeded for this billing period",
      "Monthly usage limit reached, please enable available balance",
      "GoUsageLimitError",
      "FreeUsageLimitError",
      "billing hard limit reached"
    ];
    for (const message of exhausted) {
      expect(
        isInsufficientQuotaErrorMessage(message),
        `应识别为欠费: ${message}`
      ).toBe(true);
    }
  });

  it("leaves transient and unrelated failures alone", () => {
    const transient = [
      "429 Too Many Requests",
      "socket hang up",
      "fetch failed: connection reset",
      "prompt is too long: 30000 tokens > 16000 maximum",
      "模型返回错误终态。",
      "",
      null,
      undefined
    ];
    for (const message of transient) {
      expect(
        isInsufficientQuotaErrorMessage(message),
        `不应识别为欠费: ${String(message)}`
      ).toBe(false);
    }
  });
});
