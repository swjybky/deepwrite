import { describe, expect, it } from "vitest";
import source from "./AgentConversation.vue?raw";

describe("AgentConversation edit proposal placement", () => {
  it("keeps edit proposals above the completed response actions", () => {
    const messageBodyStart = source.indexOf('<div class="message-body">');
    const responseStart = source.indexOf('v-else-if="visibleResponse(message)"', messageBodyStart);
    const proposalsStart = source.indexOf('class="edit-proposal-list"', responseStart);
    const actionsStart = source.indexOf('class="message-actions"', proposalsStart);

    expect(messageBodyStart).toBeGreaterThan(-1);
    expect(responseStart).toBeGreaterThan(messageBodyStart);
    expect(proposalsStart).toBeGreaterThan(responseStart);
    expect(actionsStart).toBeGreaterThan(proposalsStart);
  });

  it("uses distinct composer placeholders for creative space and library agents", () => {
    expect(source).toContain("composerPlaceholder");
    expect(source).toContain("随心输入，输入 / 调用技能，输入 @ 引用素材");
    expect(source).toContain("输入 / 加载方法技能，输入 @ 引用当前库或同分组其它库的技能");
    expect(source).toContain("输入 / 加载方法技能，输入 @ 引用当前库或同分组其它库的素材");
  });

  it("renders a hover copy action and timestamp below both user and assistant messages", () => {
    expect(source).toContain('<div class="message-content">');
    expect(source).toContain('v-if="message.content && message.status !== \'streaming\'"');
    expect(source).toContain(':aria-label="copyMessageLabel(message)"');
    expect(source).toContain('return message.role === "assistant" ? "复制回复" : "复制消息";');

    const actionsStart = source.indexOf('class="message-actions"');
    const userTimeStart = source.indexOf(
      '<span v-if="message.role === \'user\'">{{ formatTime(message.createdAt) }}</span>',
      actionsStart
    );
    const copyButtonStart = source.indexOf(':aria-label="copyMessageLabel(message)"', actionsStart);
    const assistantTimeStart = source.indexOf(
      '<span v-if="message.role === \'assistant\'">{{ formatTime(message.createdAt) }}</span>',
      actionsStart
    );

    expect(actionsStart).toBeGreaterThan(-1);
    expect(userTimeStart).toBeGreaterThan(actionsStart);
    expect(copyButtonStart).toBeGreaterThan(userTimeStart);
    expect(assistantTimeStart).toBeGreaterThan(copyButtonStart);
  });

  it("shows multiple independently clickable editor references inside the composer", () => {
    expect(source).toContain('class="composer-editor-reference-list"');
    expect(source).toContain('v-for="editorReference in editorReferences"');
    expect(source).toContain('class="composer-editor-reference"');
    expect(source).toContain("{{ editorReference.label }}");
    expect(source).toContain("emit('locateEditorReference', editorReference)");
    expect(source).toContain("props.editorReferences.map(createEditorReferenceAttachment)");
    expect(source).toContain("emit('removeEditorReference', editorReference.id)");
    expect(source).toContain("emit(\"clearEditorReferences\")");
  });

  it("only lists configured models in the composer model selector", () => {
    expect(source).toContain("props.models.map");
    expect(source).toContain('placeholder="选择模型"');
    expect(source).not.toContain('{ value: "", label: "DeepWrite Faux" }');
  });

  it("offers configured thinking levels even when non-thinking parameters were configured last", () => {
    const optionsStart = source.indexOf("const availableThinkingOptions");
    const optionsEnd = source.indexOf("const modelOptions", optionsStart);
    const optionsBlock = source.slice(optionsStart, optionsEnd);

    expect(optionsBlock).toContain("selectedModel.value.thinkingLevelOptions.map");
    expect(optionsBlock).not.toContain("selectedModel.value.reasoning");
  });

  it("labels and classifies the physical expert-draft tools", () => {
    const labelsStart = source.indexOf("function workspaceToolLabel");
    const labelsEnd = source.indexOf("function hasProcessing", labelsStart);
    const labels = source.slice(labelsStart, labelsEnd);
    expect(labels).toContain(
      'create_expert_draft_sections: "创建章节文件"'
    );
    expect(labels).toContain('read_all_expert_draft: "读取全部正文"');
    expect(labels).toContain(
      'write_expert_draft_section: "写入正文小节"'
    );
    expect(labels).toContain(
      'replace_expert_draft_section_text: "替换正文小节文本"'
    );
    expect(labels).toContain(
      'read_expert_character_state: "读取人物状态"'
    );
    expect(labels).toContain('edit_expert_draft_section: "编辑正文"');

    const writeStart = source.indexOf("const WRITE_TOOL_NAMES");
    const directStart = source.indexOf("const DIRECT_WRITE_TOOL_NAMES", writeStart);
    const writeNames = source.slice(writeStart, directStart);
    const directEnd = source.indexOf("function isWriteTool", directStart);
    const directWriteNames = source.slice(directStart, directEnd);
    expect(writeNames).toContain('"write_expert_draft_section"');
    expect(writeNames).toContain('"create_expert_draft_sections"');
    expect(writeNames).toContain('"write_section_body"');
    expect(writeNames).toContain('"replace_expert_draft_section_text"');
    expect(writeNames).toContain('"edit_expert_draft_section"');
    expect(writeNames).not.toContain('"read_all_expert_draft"');
    expect(writeNames).not.toContain('"read_expert_character_state"');
    expect(directWriteNames).toContain('"write_expert_draft_section"');
    expect(directWriteNames).toContain('"create_expert_draft_sections"');
    expect(directWriteNames).toContain('"write_section_body"');
    expect(directWriteNames).not.toContain(
      '"replace_expert_draft_section_text"'
    );
    expect(directWriteNames).not.toContain('"edit_expert_draft_section"');
    expect(source).not.toContain("initialize_expert_draft");
    expect(source).toContain("writeToolText(item.tool).length.toLocaleString('zh-CN')");
  });

  it("renders subagent runs as collapsed inline cards with inspectable details", () => {
    expect(source).toContain('class="subagent-run-list"');
    expect(source).toContain('class="subagent-run-card"');
    expect(source).toContain('v-for="run in message.subagentRuns"');
    expect(source).not.toContain('<details\n                v-for="run in message.subagentRuns"\n                open');
    expect(source).toContain('aria-label="子智能体执行过程"');
    expect(source).toContain("subagentProcessingDisplayItems(run)");
    expect(source).toContain(
      'class="processing-live-item processing-live-thinking"'
    );
    expect(source).toContain(
      'class="processing-live-item processing-live-tool"'
    );
    expect(source).toContain(
      'class="processing-live-item processing-live-thinking processing-tool-group"'
    );
    expect(source).toContain("run.status === 'running' ? '思考中' : '思考过程'");
    expect(source).not.toContain('class="subagent-run-timeline"');
    expect(source).toContain("{{ run.task }}");
    expect(source).toContain("{{ subagentStatusLabel(run) }}");
    expect(source).toContain("{{ run.toolCalls.length }} 个工具");
    expect(source).toContain("subagentReviewHint(message, run)");
    expect(source).toContain("`${writeCount} 次写入调用`");
    expect(source).not.toContain("`${writeCount} 项文本变更`");
    expect(source).toContain("formatToolPayload(visibleToolArguments(item.tool))");
    expect(source).toContain("item.tool.resultSummary");
    expect(source).toContain("run.summary");
    expect(source).toContain('tool.name === "spawn_subagent"');
    expect(source).not.toContain("subagent-run-modal");
  });
});
