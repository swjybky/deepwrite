import { describe, expect, it } from "vitest";
import entrySearchSource from "./EditorEntrySearchRow.vue?raw";
import highlightSource from "./EditorSearchHighlight.vue?raw";
import longEditorSource from "./LongEditorFindReplaceBar.vue?raw";
import longManuscriptSource from "./LongManuscriptEditor.vue?raw";
import longWorkspaceSource from "./LongWorkspaceEditor.vue?raw";
import rightEditorSource from "./RightEditorPane.vue?raw";

describe("editor find panel layout", () => {
  it("anchors long-editor panels to their complete toolbar instead of the button group", () => {
    expect(longEditorSource).toMatch(
      /\.long-editor-text-tools\s*\{\s*position:\s*static;/u
    );
    expect(longEditorSource).toMatch(
      /\.long-editor-find-panel\s*\{[\s\S]*?right:\s*13px;[\s\S]*?width:\s*min\(350px, calc\(100% - 26px\)\);/u
    );
    expect(longEditorSource).toMatch(
      /\.long-story-plot-text-toolbar\s*\{\s*position:\s*relative;/u
    );
    expect(longEditorSource).toMatch(
      /\.long-story-plot-text-toolbar \.long-editor-find-panel\s*\{\s*right:\s*0;\s*left:\s*auto;/u
    );
  });

  it("adds a stage-wide entry search row to both writing editors", () => {
    expect(longEditorSource).toContain("<EditorEntrySearchRow");
    expect(rightEditorSource).toContain("<EditorEntrySearchRow");
    expect(entrySearchSource).toContain('placeholder="搜索全部条目"');
    expect(entrySearchSource).toContain('aria-label="条目搜索结果"');
    expect(entrySearchSource).toContain("@click=\"emit('select', index)\"");
  });

  it("highlights all visible text matches and distinguishes the active one", () => {
    expect(rightEditorSource).toContain("<EditorSearchHighlight");
    expect(longWorkspaceSource).toContain("<EditorSearchHighlight");
    expect(longManuscriptSource).toContain("<EditorSearchHighlight");
    expect(highlightSource).toContain("editor-search-highlight-mark");
    expect(highlightSource).toContain("'is-active': segment.active");
    expect(highlightSource).toContain("var(--accent)");
  });
});
