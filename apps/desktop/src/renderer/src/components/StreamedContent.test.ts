import { describe, expect, it } from "vitest";
import messageItemSource from "./ConversationMessageItem.vue?raw";
import processingItemSource from "./ConversationProcessingItem.vue?raw";
import streamedContentSource from "./StreamedContent.vue?raw";
import streamingMarkdownSource from "./StreamingMarkdown.vue?raw";
import streamingTextSource from "./StreamingText.vue?raw";
import subagentSource from "./SubagentRunDetail.vue?raw";
import workGroupSource from "./ConversationWorkGroup.vue?raw";

describe("streaming conversation content", () => {
  it("keeps thinking as incremental plain text in every state", () => {
    expect(streamedContentSource).toContain('props.format === "plain"');
    expect(processingItemSource).toContain('format="plain"');
    expect(workGroupSource).toContain("<ConversationProcessingItem");
    expect(streamingTextSource).toContain("textNode.appendData");
    expect(streamingTextSource).toContain("globalThis.requestAnimationFrame");
    expect(streamingTextSource).toContain("BACKGROUND_RENDER_FALLBACK_MS");
    expect(streamingTextSource).not.toContain("renderMarkdown");
    expect(streamingTextSource).not.toContain("v-html");
  });

  it("renders formal responses as throttled Markdown while streaming", () => {
    expect(streamedContentSource).toContain(
      'import StreamingMarkdown from "./StreamingMarkdown.vue"'
    );
    expect(streamedContentSource).toContain(
      '<StreamingMarkdown\n    v-else-if="streaming"'
    );
    expect(streamingMarkdownSource).toContain(
      'import { renderMarkdown } from "../utils/renderMarkdown"'
    );
    expect(streamingMarkdownSource).toContain("scheduler.schedule()");
    expect(streamingMarkdownSource).toContain("scheduler.flush()");
    expect(streamingMarkdownSource).toContain('v-html="html"');
    expect(messageItemSource).toContain('format="markdown"');
    expect(processingItemSource).toContain('format="markdown"');
  });

  it("uses one final Markdown pass and protects extremely large output", () => {
    expect(streamedContentSource).toContain(
      "MAX_SAFE_MARKDOWN_LENGTH = 100_000"
    );
    expect(streamedContentSource).toContain(
      '<MessageMarkdown v-else :content="content" />'
    );
    expect(
      processingItemSource.match(/:content="item\.content"/g)
    ).toHaveLength(2);
    expect(processingItemSource).toContain(':streaming="streaming"');
    expect(messageItemSource).toContain(':content="response"');
    expect(messageItemSource).not.toContain("<MessageMarkdown");
    expect(processingItemSource).not.toContain("<MessageMarkdown");
  });

  it("applies the same response and thinking split to subagent output", () => {
    expect(subagentSource).toContain(
      'import StreamedContent from "./StreamedContent.vue"'
    );
    expect(subagentSource).toContain("<ConversationWorkGroup");
    expect(workGroupSource).toContain("<ConversationProcessingItem");
    expect(processingItemSource).toContain('format="plain"');
    expect(
      subagentSource.match(/:streaming="run\.status === 'running'"/g)
    ).toHaveLength(2);
    expect(subagentSource.match(/format="markdown"/g)).toHaveLength(1);
    expect(subagentSource).not.toContain('format="plain"');
    expect(subagentSource).not.toContain("<MessageMarkdown");
  });
});
