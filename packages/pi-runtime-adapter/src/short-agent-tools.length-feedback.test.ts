import { describe, expect, it } from "vitest";
import { draftBodyFeedback } from "./short-agent-tools/draft-feedback";

const input = { promptLocale: "zh-CN", workspaceType: "short" } as never;
const body = "字".repeat(514);

describe("draft length feedback", () => {
  it.each([
    ["500字以内", "高于要求，超出 14 字"],
    ["不超过500字", "高于要求，超出 14 字"],
    ["≤ 500", "高于要求，超出 14 字"],
    ["600字以内", "符合要求"],
    ["至少600字", "低于要求，少 86 字"],
    ["500字以上", "符合要求"],
    ["400-500字", "高于要求，超出 14 字"],
    ["514", "符合要求"]
  ])("judges %s", (requirement, verdict) => {
    expect(draftBodyFeedback(input, body, requirement)).toContain(verdict);
  });

  it("leaves free-form targets unjudged", () => {
    expect(draftBodyFeedback(input, body, "两分钟")).not.toMatch(
      /低于要求|高于要求|符合要求/u
    );
  });
});
