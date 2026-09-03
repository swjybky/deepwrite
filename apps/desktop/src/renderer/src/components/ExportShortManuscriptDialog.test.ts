import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import source from "./ExportShortManuscriptDialog.vue?raw";

describe("ExportShortManuscriptDialog", () => {
  it("shows type-specific export-scope reminders above the format choices", () => {
    const reminder = source.indexOf("导出范围提醒");
    const choices = source.indexOf("选择导出格式");
    expect(reminder).toBeGreaterThan(-1);
    expect(choices).toBeGreaterThan(reminder);
    expect(source).toContain("导语和全部小节正文");
    expect(source).toContain("全部剧集正文");
    expect(source).toContain("workspaceType === 'script'");
    expect(source).toContain("不包含人物状态、剧情设计和大纲等内容");
    expect(source).toContain("尚未保存的编辑内容也会一并导出");
  });

  it("offers file exports and direct manuscript copying as selectable cards", () => {
    expectSourceToContain(source, '{ id: "docx", label: "DOCX 文档"');
    expectSourceToContain(source, '{ id: "txt", label: "TXT 纯文本"');
    expectSourceToContain(source, '{ id: "epub", label: "EPUB 电子书"');
    expect(source).toContain('id: "clipboard"');
    expect(source).toContain('label: "复制正文"');
    expect(source).toContain("复制全部正文，可自由选择粘贴位置");
    expect(source).toContain('type="radio"');
    expect(source).toContain('emit("export", selectedTarget.value)');
    expect(source).toContain("selectedTarget === 'clipboard'");
    expect(source).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))"
    );
  });

  it("uses only the selected card border without an outer focus ring", () => {
    expect(source).toContain(".export-manuscript-format-card.is-selected");
    expect(source).not.toContain(".export-manuscript-format-card:focus-within");
  });
});
