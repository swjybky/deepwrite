import { describe, expect, it } from "vitest";
import source from "./RightEditorPane.vue?raw";

describe("RightEditorPane expert draft navigation", () => {
  it("shows automatic save status while preserving an immediate save action", () => {
    expect(source).toContain('autoSaveEnabled ? "等待自动保存"');
    expect(source).toContain('autoSaveEnabled ? "本机文稿 · 更改后自动保存"');
    expect(source).toContain('autoSaveEnabled ? "立即保存" : "应用"');
  });

  it("renders independently managed section tabs before the active section editor", () => {
    const tabsStart = source.indexOf('class="section-tabs-bar"');
    const editorStart = source.indexOf('class="editor-document"', tabsStart);

    expect(tabsStart).toBeGreaterThan(-1);
    expect(source).toContain('aria-label="正文小节"');
    expect(source).toContain("emit('selectSection', section.id)");
    expect(source).not.toContain("emit('addSection')");
    expect(editorStart).toBeGreaterThan(tabsStart);
  });

  it("offers one insert action only after right-clicking a selected editor range", () => {
    expect(source).toContain('aria-label="正文选区操作"');
    expect(source).toContain("插入输入框");
    expect(source.match(/role="menuitem"/g)).toHaveLength(1);
    expect(source).toContain('@contextmenu="handleEditorContextMenu"');
    expect(source).toContain("event.preventDefault()");
    expect(source).not.toContain('@mouseup="handleEditorMouseup"');
    expect(source).not.toContain('@keyup="handleEditorKeyup"');
    expect(source).toContain("emit(\"insertSelection\", reference)");
    expect(source).toContain("input.setSelectionRange(range.start, range.end, \"forward\")");
  });
});
