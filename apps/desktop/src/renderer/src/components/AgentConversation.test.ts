import { describe, expect, it } from "vitest";
import {
  expectSourceToContain,
  sourceTextIndexOf
} from "../../../test-utils/sourceText";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import rendererStyles from "virtual:deepwrite-renderer-styles";
import messageItemSource from "./ConversationMessageItem.vue?raw";
import processingTimelineSource from "./ConversationProcessingTimeline.vue?raw";
import processingItemSource from "./ConversationProcessingItem.vue?raw";
import workGroupSource from "./ConversationWorkGroup.vue?raw";
import subagentListSource from "./SubagentRunList.vue?raw";
import subagentCardSource from "./SubagentRunCard.vue?raw";
import subagentDetailSource from "./SubagentRunDetail.vue?raw";
import subagentPresentationSource from "./subagentRunPresentation.ts?raw";

const subagentSource = `${subagentListSource}\n${subagentCardSource}\n${subagentDetailSource}`;

describe("AgentConversation edit proposal placement", () => {
  it("keeps the composer focus treatment steady when the app regains focus", () => {
    const surfaceStart = rendererStyles.indexOf(".composer-input-surface");
    const surfaceEnd = rendererStyles.indexOf("}", surfaceStart);
    const surfaceStyles = rendererStyles.slice(surfaceStart, surfaceEnd);

    expect(surfaceStart).toBeGreaterThan(-1);
    expect(surfaceStyles).toContain("transition: none;");
    expect(rendererStyles).toContain(
      ".composer:focus-within .composer-input-surface"
    );
  });

  it("renders a hover copy action and timestamp below both user and assistant messages", () => {
    expect(messageItemSource).toContain('<div class="message-content">');
    expect(messageItemSource).toContain("message.status !== 'streaming' &&");
    expect(messageItemSource).toContain("!editing");
    expect(messageItemSource).toContain("copyReply");
    expect(messageItemSource).toContain("copyMessage");

    const actionsStart = sourceTextIndexOf(
      messageItemSource,
      'class="message-actions"'
    );
    const userTimeStart = sourceTextIndexOf(
      messageItemSource,
      "message.role === 'user'",
      actionsStart
    );
    const copyButtonStart = sourceTextIndexOf(
      messageItemSource,
      '@click="copyMessage"',
      actionsStart
    );
    const assistantTimeStart = sourceTextIndexOf(
      messageItemSource,
      "message.role === 'assistant'",
      copyButtonStart + 1
    );

    expect(actionsStart).toBeGreaterThan(-1);
    expect(userTimeStart).toBeGreaterThan(actionsStart);
    expect(copyButtonStart).toBeGreaterThan(userTimeStart);
    expect(assistantTimeStart).toBeGreaterThan(copyButtonStart);
  });

  it("renders subagent runs via a shared collapsed card list", () => {
    expect(processingTimelineSource).toContain("import SubagentRunList from");
    expect(processingTimelineSource).toContain("<SubagentRunList");
    expect(subagentSource).toContain('class="subagent-run-list"');
    expect(subagentSource).toContain('class="subagent-run-card"');
    expect(subagentListSource).toContain('v-for="entry in entries"');
    expect(subagentListSource).toContain("<SubagentDrawGroup");
    expect(subagentSource).not.toContain(
      '<details\n      v-for="run in runs"\n      open'
    );
    expect(subagentSource).toContain("subagentExecution");
    expect(subagentCardSource).toContain('<SubagentRunDetail :run="run" />');
    expect(subagentDetailSource).toContain(
      "subagentProcessingDisplayItems(props.run, previous)"
    );
    expect(subagentSource).toContain("<ConversationWorkGroup");
    expect(workGroupSource).toContain("workGroupActivityLabel(item)");
    expect(workGroupSource).toContain(
      'class="processing-live-item processing-live-thinking processing-work-group"'
    );
    expect(workGroupSource).toContain('class="processing-work-group-body"');
    const workGroupBodyStart = rendererStyles.indexOf(
      ".processing-work-group-body"
    );
    const workGroupBodyStyles = rendererStyles.slice(
      workGroupBodyStart,
      rendererStyles.indexOf("}", workGroupBodyStart)
    );
    expect(workGroupBodyStart).toBeGreaterThan(-1);
    expect(workGroupBodyStyles).toContain("padding-left: 16px;");
    expect(processingItemSource).toContain(
      'class="processing-live-item processing-live-thinking"'
    );
    expect(processingItemSource).toContain(
      'class="processing-live-item processing-live-tool"'
    );
    expect(processingItemSource).toContain(
      'class="processing-live-item processing-live-thinking processing-tool-group"'
    );
    expectSourceToContain(processingItemSource, "reasoning");
    expect(subagentSource).not.toContain('class="subagent-run-timeline"');
    expect(subagentSource).toContain("{{ run.task }}");
    expect(subagentSource).toContain("{{ subagentStatusLabel(run, now) }}");
    expect(subagentSource).toContain("toolsMessage");
    expect(subagentSource).toContain("subagentReviewHint(message, run)");
    expect(subagentPresentationSource).toContain("valueWriteCalls");
    expect(subagentSource).not.toContain("`${writeCount} 项文本变更`");
    expect(processingItemSource).toContain(
      "formatToolPayload(visibleToolArguments(item.tool))"
    );
    expect(processingItemSource).toContain("item.tool.resultSummary");
    expect(subagentSource).toContain("run.summary");
    expect(subagentSource).not.toContain("subagent-run-modal");
  });

  it("shimmers running work-group labels and hides disclosure chevrons until hover", () => {
    expect(workGroupSource).toContain(
      ":class=\"{ 'is-processing-shimmer': item.running }\""
    );
    expect(rendererStyles).toContain(
      ".processing-live-thinking > summary > .is-processing-shimmer"
    );
    expect(rendererStyles).toContain(
      "animation: thinking-shimmer 1.8s linear infinite"
    );
    const liveChevronStart = rendererStyles.indexOf(
      ".processing-live-item > summary > svg"
    );
    const liveChevronStyles = rendererStyles.slice(
      liveChevronStart,
      rendererStyles.indexOf("}", liveChevronStart)
    );
    expect(liveChevronStart).toBeGreaterThan(-1);
    expect(liveChevronStyles).toContain("opacity: 0");
    expect(rendererStyles).toContain(
      ".processing-live-item > summary:is(:hover, :focus-visible) > svg"
    );
    expect(rendererStyles).toContain(
      ".processing-block > summary:is(:hover, :focus-visible) > svg"
    );
  });
});
