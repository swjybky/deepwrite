import { describe, expect, it } from "vitest";
import { appendWritingContentCounts } from "./writing-content-counts";

describe("writing content counts", () => {
  it("uses the editor's UTF-16 count, excluding whitespace but retaining markup", () => {
    expect(
      appendWritingContentCounts("等待审阅。", [
        { title: "正文", id: "body", content: "# 甲 A，\n\t乙\u3000🙂" },
        { title: "状态", id: "state", content: " \r\n\t\u00a0\u3000\ufeff" }
      ])
    ).toBe(
      "等待审阅。\n正文（文档标识=body）目标内容字数（本次提案）：7 字\n状态（文档标识=state）目标内容字数（本次提案）：0 字"
    );
  });

  it("leaves results without content targets untouched", () => {
    expect(appendWritingContentCounts("未修改。", [])).toBe("未修改。");
  });
});
