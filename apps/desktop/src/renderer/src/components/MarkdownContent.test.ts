import { describe, expect, it } from "vitest";
import source from "./MarkdownContent.vue?raw";
import longEditorSource from "./LongWorkspaceEditor.vue?raw";
import messageSource from "./MessageMarkdown.vue?raw";

describe("MarkdownContent", () => {
  it("owns the shared safe Markdown rendering path", () => {
    expect(source).toContain(
      'import { renderMarkdown } from "../utils/renderMarkdown"'
    );
    expect(source).toContain('class="markdown-content"');
    expect(source).toContain('v-html="html"');
    expect(source).toContain("annotateHeadings?: boolean");
    expect(source).toContain("annotateHeadings: false");
  });

  it("is also reused by conversation messages", () => {
    expect(messageSource).toContain(
      'import MarkdownContent from "./MarkdownContent.vue"'
    );
    expect(messageSource).toContain('class="message-markdown"');
    expect(messageSource).not.toContain("annotate-headings");
  });

  it("renders both editable long-form preview surfaces through the shared component", () => {
    expect(longEditorSource).toContain(
      'import EditableMarkdownPreview from "./EditableMarkdownPreview.vue"'
    );
    expect(longEditorSource.match(/<EditableMarkdownPreview/g)).toHaveLength(2);
    expect(longEditorSource).not.toContain("previewParagraphs");
  });
});
