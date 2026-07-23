import { describe, expect, it } from "vitest";
import source from "./ExportShortManuscriptDialog.vue?raw";

describe("ExportShortManuscriptDialog", () => {
  it("shows a fixed export-scope reminder above the format choices", () => {
    const reminder = source.indexOf("导出范围提醒");
    const choices = source.indexOf("选择导出格式");
    expect(reminder).toBeGreaterThan(-1);
    expect(choices).toBeGreaterThan(reminder);
    expect(source).toContain("导语和全部小节正文");
    expect(source).toContain("不包含人物状态、剧情设计和大纲等内容");
    expect(source).toContain("尚未保存的编辑内容也会一并导出");
  });

  it("offers DOCX, TXT, and EPUB as selectable format cards", () => {
    expect(source).toContain('{ id: "docx", label: "DOCX 文档"');
    expect(source).toContain('{ id: "txt", label: "TXT 纯文本"');
    expect(source).toContain('{ id: "epub", label: "EPUB 电子书"');
    expect(source).toContain('type="radio"');
    expect(source).toContain('emit("export", selectedFormat.value)');
  });

  it("uses only the selected card border without an outer focus ring", () => {
    expect(source).toContain(".export-manuscript-format-card.is-selected");
    expect(source).not.toContain(".export-manuscript-format-card:focus-within");
  });
});
