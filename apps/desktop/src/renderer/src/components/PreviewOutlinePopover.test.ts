import editorMetadataSource from "./EditorDocumentMetadata.vue?raw";
import { describe, expect, it } from "vitest";
import longManuscriptSource from "./LongManuscriptEditor.vue?raw";
import longWorkspaceSource from "./LongWorkspaceEditor.vue?raw";
import markdownContentSource from "./MarkdownContent.vue?raw";
import metaRowSource from "./DocumentMetaRow.vue?raw";
import outlineSource from "./PreviewOutlinePopover.vue?raw";
import rightEditorSource from "./RightEditorPane.vue?raw";

describe("preview document outline", () => {
  it("uses a themed, teleported, keyboard-accessible outline card", () => {
    expect(outlineSource).toContain('<Teleport to="body">');
    expect(outlineSource).toContain('aria-label="打开文档目录"');
    expect(outlineSource).toContain('aria-label="文档目录"');
    expect(outlineSource).toContain('event.key === "Escape"');
    expect(outlineSource).toContain('event.key === "ArrowDown"');
    expect(outlineSource).toContain("handleDocumentPointerdown");
    expect(outlineSource).toContain(
      '<style scoped src="./preview-outline-popover.css"></style>'
    );
  });

  it("jumps only inside the active preview and focuses the target heading", () => {
    expect(outlineSource).toContain("props.previewElement");
    expect(outlineSource).toContain("data-markdown-heading-index");
    expect(outlineSource).toContain('behavior: "smooth"');
    expect(outlineSource).toContain("target.focus({ preventScroll: true })");
    expect(outlineSource).toContain("正文中暂无 Markdown 标题");
  });

  it("keeps the outline control exclusive to preview mode", () => {
    expect(metaRowSource).toContain(`v-if="viewMode === 'preview'"`);
    expect(metaRowSource).toContain("<PreviewOutlinePopover");
    expect(markdownContentSource).toContain("annotateHeadings: false");
  });

  it("covers short, library, long-form, and story-plot text previews", () => {
    expect(rightEditorSource).toContain("<EditorDocumentMetadata");
    expect(editorMetadataSource).toContain("<DocumentMetaRow");
    expect(rightEditorSource).toContain("annotate-headings");
    expect(longManuscriptSource).toContain("<DocumentMetaRow");
    expect(longManuscriptSource).toContain("annotate-headings");
    expect(longWorkspaceSource.match(/<DocumentMetaRow/g)).toHaveLength(2);
    expect(longWorkspaceSource.match(/annotate-headings/g)).toHaveLength(2);
    expect(longWorkspaceSource).toContain("故事情节正文");
  });
});
