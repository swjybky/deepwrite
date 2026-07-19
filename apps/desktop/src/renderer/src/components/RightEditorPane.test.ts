import { describe, expect, it } from "vitest";
import source from "./RightEditorPane.vue?raw";

describe("RightEditorPane expert draft navigation", () => {
  it("renders independently managed section tabs before the active section editor", () => {
    const tabsStart = source.indexOf('class="section-tabs-bar"');
    const editorStart = source.indexOf('class="editor-document"', tabsStart);

    expect(tabsStart).toBeGreaterThan(-1);
    expect(source).toContain('aria-label="正文小节"');
    expect(source).toContain("emit('selectSection', section.id)");
    expect(source).not.toContain("emit('addSection')");
    expect(editorStart).toBeGreaterThan(tabsStart);
  });
});
