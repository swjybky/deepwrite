import { describe, expect, it } from "vitest";
import conversationSource from "./AgentConversation.vue?raw";
import subagentSource from "./SubagentRunList.vue?raw";

describe("AgentConversation edit proposal placement", () => {
  it("keeps edit proposals above the completed response actions", () => {
    const messageBodyStart = conversationSource.indexOf('<div class="message-body">');
    const responseStart = conversationSource.indexOf(
      'v-else-if="visibleResponse(message)"',
      messageBodyStart
    );
    const proposalsStart = conversationSource.indexOf(
      'class="edit-proposal-list"',
      responseStart
    );
    const actionsStart = conversationSource.indexOf(
      'class="message-actions"',
      proposalsStart
    );

    expect(messageBodyStart).toBeGreaterThan(-1);
    expect(responseStart).toBeGreaterThan(messageBodyStart);
    expect(proposalsStart).toBeGreaterThan(responseStart);
    expect(actionsStart).toBeGreaterThan(proposalsStart);
  });

  it("uses distinct composer placeholders for creative space and library agents", () => {
    expect(conversationSource).toContain("composerPlaceholder");
    expect(conversationSource).toContain("随心输入，输入 / 调用技能，输入 @ 引用素材");
    expect(conversationSource).toContain(
      "输入 / 加载方法技能，输入 @ 引用当前库或同分组其它库的技能"
    );
    expect(conversationSource).toContain(
      "输入 / 加载方法技能，输入 @ 引用当前库或同分组其它库的素材"
    );
  });

  it("renders a hover copy action and timestamp below both user and assistant messages", () => {
    expect(conversationSource).toContain('<div class="message-content">');
    expect(conversationSource).toContain(
      'v-if="message.content && message.status !== \'streaming\'"'
    );
    expect(conversationSource).toContain(':aria-label="copyMessageLabel(message)"');
    expect(conversationSource).toContain(
      'return message.role === "assistant" ? "复制回复" : "复制消息";'
    );

    const actionsStart = conversationSource.indexOf('class="message-actions"');
    const userTimeStart = conversationSource.indexOf(
      '<span v-if="message.role === \'user\'">{{ formatTime(message.createdAt) }}</span>',
      actionsStart
    );
    const copyButtonStart = conversationSource.indexOf(
      ':aria-label="copyMessageLabel(message)"',
      actionsStart
    );
    const assistantTimeStart = conversationSource.indexOf(
      '<span v-if="message.role === \'assistant\'">{{ formatTime(message.createdAt) }}</span>',
      actionsStart
    );

    expect(actionsStart).toBeGreaterThan(-1);
    expect(userTimeStart).toBeGreaterThan(actionsStart);
    expect(copyButtonStart).toBeGreaterThan(userTimeStart);
    expect(assistantTimeStart).toBeGreaterThan(copyButtonStart);
  });

  it("shows multiple independently clickable editor references inside the composer", () => {
    expect(conversationSource).toContain('class="composer-editor-reference-list"');
    expect(conversationSource).toContain('v-for="editorReference in editorReferences"');
    expect(conversationSource).toContain('class="composer-editor-reference"');
    expect(conversationSource).toContain("{{ editorReference.label }}");
    expect(conversationSource).toContain(
      "emit('locateEditorReference', editorReference)"
    );
    expect(conversationSource).toContain(
      "props.editorReferences.map(createEditorReferenceAttachment)"
    );
    expect(conversationSource).toContain(
      "emit('removeEditorReference', editorReference.id)"
    );
    expect(conversationSource).toContain('emit("clearEditorReferences")');
  });

  it("only lists configured models in the composer model selector", () => {
    expect(conversationSource).toContain("props.models.map");
    expect(conversationSource).toContain('placeholder="选择模型"');
    expect(conversationSource).not.toContain('{ value: "", label: "DeepWrite Faux" }');
  });

  it("offers configured thinking levels even when non-thinking parameters were configured last", () => {
    const optionsStart = conversationSource.indexOf("const availableThinkingOptions");
    const optionsEnd = conversationSource.indexOf("const modelOptions", optionsStart);
    const optionsBlock = conversationSource.slice(optionsStart, optionsEnd);

    expect(optionsBlock).toContain("selectedModel.value.thinkingLevelOptions.map");
    expect(optionsBlock).not.toContain("selectedModel.value.reasoning");
  });

  it("labels and classifies the physical expert-draft tools", () => {
    const labelsStart = conversationSource.indexOf("function workspaceToolLabel");
    const labelsEnd = conversationSource.indexOf("function hasProcessing", labelsStart);
    const labels = conversationSource.slice(labelsStart, labelsEnd);
    expect(labels).toContain('create_expert_draft_sections: "创建章节文件"');
    expect(labels).toContain('read_all_expert_draft: "读取全部正文"');
    expect(labels).toContain('write_expert_draft_section: "写入正文小节"');
    expect(labels).toContain(
      'replace_expert_draft_section_text: "替换正文小节文本"'
    );
    expect(labels).toContain('read_expert_character_state: "读取人物状态"');
    expect(labels).toContain('edit_expert_draft_section: "编辑正文"');

    const writeStart = conversationSource.indexOf("const WRITE_TOOL_NAMES");
    const directStart = conversationSource.indexOf(
      "const DIRECT_WRITE_TOOL_NAMES",
      writeStart
    );
    const writeNames = conversationSource.slice(writeStart, directStart);
    const directEnd = conversationSource.indexOf("function isWriteTool", directStart);
    const directWriteNames = conversationSource.slice(directStart, directEnd);
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
    expect(directWriteNames).not.toContain('"replace_expert_draft_section_text"');
    expect(directWriteNames).not.toContain('"edit_expert_draft_section"');
    expect(conversationSource).not.toContain("initialize_expert_draft");
    expect(conversationSource).toContain(
      "writeToolText(item.tool).length.toLocaleString('zh-CN')"
    );
  });

  it("renders subagent runs via a shared collapsed card list", () => {
    expect(conversationSource).toContain("import SubagentRunList from");
    expect(conversationSource).toContain("<SubagentRunList");
    expect(subagentSource).toContain('class="subagent-run-list"');
    expect(subagentSource).toContain('class="subagent-run-card"');
    expect(subagentSource).toContain("v-for=\"run in runs\"");
    expect(subagentSource).not.toContain(
      '<details\n      v-for="run in runs"\n      open'
    );
    expect(subagentSource).toContain('aria-label="子智能体执行过程"');
    expect(subagentSource).toContain("subagentProcessingDisplayItems(run)");
    expect(subagentSource).toContain(
      'class="processing-live-item processing-live-thinking"'
    );
    expect(subagentSource).toContain(
      'class="processing-live-item processing-live-tool"'
    );
    expect(subagentSource).toContain(
      'class="processing-live-item processing-live-thinking processing-tool-group"'
    );
    expect(subagentSource).toContain(
      "run.status === 'running' ? '思考中' : '思考过程'"
    );
    expect(subagentSource).not.toContain('class="subagent-run-timeline"');
    expect(subagentSource).toContain("{{ run.task }}");
    expect(subagentSource).toContain("{{ subagentStatusLabel(run) }}");
    expect(subagentSource).toContain("{{ run.toolCalls.length }} 个工具");
    expect(subagentSource).toContain("subagentReviewHint(message, run)");
    expect(subagentSource).toContain("`${writeCount} 次写入调用`");
    expect(subagentSource).not.toContain("`${writeCount} 项文本变更`");
    expect(subagentSource).toContain(
      "formatToolPayload(visibleToolArguments(item.tool))"
    );
    expect(subagentSource).toContain("item.tool.resultSummary");
    expect(subagentSource).toContain("run.summary");
    expect(conversationSource).toContain('tool.name === "spawn_subagent"');
    expect(subagentSource).not.toContain("subagent-run-modal");
  });

  it("nests completed subagent runs inside the processed disclosure only", () => {
    expect(conversationSource).toContain("hasProcessingDisclosure(message)");
    expect(conversationSource).toContain(
      "hasProcessing(message) || Boolean(message.subagentRuns?.length)"
    );

    const disclosureStart = conversationSource.indexOf(
      'v-else-if="message.role === \'assistant\' && hasProcessingDisclosure(message)"'
    );
    const nestedSubagentStart = conversationSource.indexOf(
      "message.subagentRuns?.length && message.status !== 'streaming'",
      disclosureStart
    );
    const disclosureEnd = conversationSource.indexOf("</details>", nestedSubagentStart);
    const streamingSubagentStart = conversationSource.indexOf(
      "message.subagentRuns?.length && message.status === 'streaming'",
      disclosureEnd
    );

    expect(disclosureStart).toBeGreaterThan(-1);
    expect(nestedSubagentStart).toBeGreaterThan(disclosureStart);
    expect(nestedSubagentStart).toBeLessThan(disclosureEnd);
    expect(streamingSubagentStart).toBeGreaterThan(disclosureEnd);
  });
});
