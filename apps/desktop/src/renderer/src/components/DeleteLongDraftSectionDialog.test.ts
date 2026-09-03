import { describe, expect, it } from "vitest";
import source from "./DeleteLongDraftSectionDialog.vue?raw";

describe("DeleteLongDraftSectionDialog", () => {
  it("confirms a destructive section delete with the chapter-card impact copy", () => {
    expect(source).toContain('itemLabel: "小节"');
    expect(source).toContain("删除{{ itemLabel }}");
    expect(source).toContain("确认删除“{{ sectionTitle }}”？");
    expect(source).toContain(
      "将永久删除该小节及对应章卡、章节正文、章末人物状态、下一章接续包，以及相关剧情落点和伏笔触点。"
    );
    expect(source).toContain("确认删除");
    expect(source).toContain("danger-button");
    expect(source).toContain('role="alertdialog"');
    expect(source).toContain('<Teleport to="body">');
    expect(source).not.toContain("<select");
  });

  it("uses themed surfaces and keeps the warning out of the layout flow", () => {
    expect(source).toContain(
      'class="dialog-backdrop delete-long-draft-section-overlay"'
    );
    expect(source).not.toContain("backdrop-filter:");
    expect(source).toContain("var(--surface-raised)");
    expect(source).toContain("var(--theme-line)");
    expect(source).toContain("var(--text-primary)");
    expect(source).toContain("var(--danger)");
  });

  it("bounds long deletion impact details without moving the actions", () => {
    expect(source).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(source).toContain("height: min(420px, calc(100vh - 2rem))");
    expect(source).toContain("overflow-y: auto");
    expect(source).toContain("overflow-wrap: anywhere");
    expect(source).toContain("scrollbar-gutter: stable");
    expect(source).toContain('tabindex="0"');
  });
});
