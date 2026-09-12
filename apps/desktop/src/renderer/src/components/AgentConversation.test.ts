import { describe, expect, it } from "vitest";
import {
  expectSourceToContain,
  sourceTextIndexOf
} from "../../../test-utils/sourceText";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import rendererStyles from "virtual:deepwrite-renderer-styles";
import conversationSource from "./AgentConversation.vue?raw";
import composerSource from "./ConversationComposer.vue?raw";
import teamModeSource from "./AgentTeamModeSelect.vue?raw";
import modelConfigSource from "./ConversationModelConfigSelect.vue?raw";
import composerLogicSource from "../composables/useConversationComposer.ts?raw";
import attachmentLogicSource from "../composables/useConversationAttachments.ts?raw";
import userInputCardSource from "./AgentUserInputCard.vue?raw";
import messageListSource from "./ConversationMessageList.vue?raw";
import messageItemSource from "./ConversationMessageItem.vue?raw";
import processingTimelineSource from "./ConversationProcessingTimeline.vue?raw";
import processingItemSource from "./ConversationProcessingItem.vue?raw";
import presentationSource from "./conversationToolPresentation.ts?raw";
import proposalCardSource from "./AgentEditProposalCard.vue?raw";
import discardButtonSource from "./ApprovalDiscardButton.vue?raw";
import writingWorkspaceSource from "./WritingWorkspaceModule.vue?raw";
import longWorkspaceSource from "./LongWorkspaceModule.vue?raw";
import subagentSource from "./SubagentRunList.vue?raw";
import subagentPresentationSource from "./subagentRunPresentation.ts?raw";

describe("AgentConversation edit proposal placement", () => {
  it("places the creative agent mode selector immediately before approval", () => {
    const modeSelectIndex = composerSource.indexOf("<AgentTeamModeSelect");
    const approvalSelectIndex = composerSource.indexOf(
      ':model-value="approvalMode"',
      modeSelectIndex
    );

    expect(modeSelectIndex).toBeGreaterThan(-1);
    expect(approvalSelectIndex).toBeGreaterThan(modeSelectIndex);
    expect(composerSource).toContain('v-if="agentWorkspaceType && agentId"');
    expect(teamModeSource).toContain('label: "普通模式"');
    expect(teamModeSource).toContain('label: "团队模式"');
    expect(teamModeSource).toContain("disabled: !availability.value.available");
    expect(teamModeSource).toContain('emit("update:modelValue", "normal")');
    expect(writingWorkspaceSource).toContain(
      ':agent-team-mode="conversationController.agentTeamMode.value"'
    );
    expect(longWorkspaceSource).toContain(
      ':agent-team-mode="conversationController.agentTeamMode.value"'
    );
  });

  it("uses one composer card for agent questions and cross-stage confirmation", () => {
    expect(conversationSource).toContain("<AgentUserInputCard");
    expect(conversationSource).toContain('v-if="userInputRequest"');
    expect(userInputCardSource).toContain(
      "request.source === 'cross_stage_write'"
    );
    expect(userInputCardSource).toContain("输入自己的回答");
    expect(userInputCardSource).toContain("推荐");
    expect(userInputCardSource).toContain("跳过");
    expect(userInputCardSource).toContain(
      'v-for="question in visibleQuestions"'
    );
    expect(userInputCardSource).toContain("activeQuestionIndex.value += 1");
    expect(userInputCardSource).toContain('isLastQuestion ? "确认" : "下一题"');
    expect(userInputCardSource).not.toContain(
      'v-for="question in request.questions"'
    );
    expect(conversationSource).toContain("<ConversationComposer");
    expect(conversationSource).toContain("v-else");
    expect(composerSource).toContain(
      '<div class="composer" :class="{ \'is-disabled\': responding }">'
    );
    expect(writingWorkspaceSource).toContain(
      ':user-input-request="conversationController.pendingUserInput.value"'
    );
  });

  it("moves right-pane collapse controls with the selected layout", () => {
    expect(conversationSource).toContain("rightPane?: boolean");
    expect(conversationSource).toContain('aria-label="收起智能体栏"');
    expect(conversationSource).toContain("rightCollapsed && !rightPane");
    expect(writingWorkspaceSource).toContain(
      ":right-pane=\"paneLayout === 'editor-agent'\""
    );
    expect(writingWorkspaceSource).toContain(
      ':right-pane-collapsed="rightPane.collapsed"'
    );
  });

  it("shows target navigation only for accepted approval cards and relays it", () => {
    expect(proposalCardSource).toContain(
      "v-if=\"proposal.status === 'accepted'\""
    );
    expect(proposalCardSource).toContain("approval-target-button");
    expect(proposalCardSource).toContain('aria-label="跳转到目标文件"');
    expect(proposalCardSource).toContain(">\n            跳转到目标文件\n");
    expect(proposalCardSource).toContain("emit('locate', {");
    expect(`${messageItemSource}\n${processingItemSource}`).toContain(
      "@locate=\"emit('locateEditProposal', $event)\""
    );
    expect(
      `${messageItemSource}\n${processingItemSource}`.match(
        /@locate="emit\('locateEditProposal', \$event\)"/g
      )
    ).toHaveLength(2);
    expect(writingWorkspaceSource).toContain(
      "@locate-edit-proposal=\"emit('locateEditProposal', $event)\""
    );
  });

  it("places discard beside target navigation only when the card is eligible", () => {
    expect(proposalCardSource).toContain("discardable?: boolean");
    expect(proposalCardSource).toContain("function showDiscardButton");
    expect(discardButtonSource).toContain("舍弃本次修改");
    expect(proposalCardSource).toContain("<ApprovalDiscardButton");
    expect(presentationSource).toContain(
      "canDiscard: agentApprovalCanDiscard(message, proposal)"
    );
    expect(`${messageItemSource}\n${processingItemSource}`).toContain(
      ':discardable="approval.canDiscard"'
    );
    expect(`${messageItemSource}\n${processingItemSource}`).toContain(
      ':discardable="item.canDiscard"'
    );
    expect(writingWorkspaceSource).toContain(
      "@discard-edit-proposal=\"emit('discardEditProposal', $event)\""
    );
    expect(longWorkspaceSource).not.toContain("discardEditProposal");
    expect(longWorkspaceSource).not.toContain("discardLongProposal");
    expect(presentationSource).not.toContain("longApprovalCanDiscard");
  });

  it("places structured long proposals in the matching assistant turn", () => {
    expect(presentationSource).toContain("longProposalItemsForMessage");
    expect(`${messageItemSource}\n${processingItemSource}`).toContain(
      "<LongProposalReview"
    );
    expect(messageListSource).toContain("approveLongProposal");
    expect(messageListSource).toContain("rejectLongProposal");
    expect(messageListSource).toContain("retryLongProposalPreview");
  });

  it("renders approvals in the live timeline before later streaming responses", () => {
    const messageBodyStart = messageItemSource.indexOf(
      '<div class="message-body">'
    );
    const liveTimelineStart = processingTimelineSource.indexOf(
      "processingDisplayItems(message, true, longProposalItems)"
    );
    const liveProposalStart = processingItemSource.indexOf(
      "<AgentEditProposalCard"
    );
    const liveLongProposalStart = processingItemSource.indexOf(
      "<LongProposalReview"
    );

    expect(messageBodyStart).toBeGreaterThan(-1);
    expect(liveTimelineStart).toBeGreaterThan(-1);
    expect(liveProposalStart).toBeGreaterThan(-1);
    expect(liveLongProposalStart).toBeGreaterThan(liveProposalStart);
    expect(presentationSource).toContain("function liveTimelineItems");
    expect(presentationSource).toContain(
      "approval.toolCallIds.includes(item.tool.id)"
    );
    expect(presentationSource).toContain("position: anchorIndex * 2 + 1");
  });

  it("allows every explicitly enabled agent proposal to save while streaming", () => {
    expect(conversationSource).toContain("allowLiveEditReview?: boolean");
    expect(conversationSource).toContain("allowLiveEditReview: false");
    expect(proposalCardSource).toContain(
      "function canReviewProposalWhileStreaming"
    );
    expect(proposalCardSource).not.toContain('proposal.stageId === "draft"');
    expect(proposalCardSource).not.toContain("!proposal.libraryTarget");
    expect(proposalCardSource).toContain(
      "本项已生成，可立即审阅；智能体仍在继续。"
    );
    expect(proposalCardSource).toContain(
      "本项已生成，正在进入实时自动保存队列；智能体仍在继续。"
    );
    expect(proposalCardSource).toContain("proposal.longCharacterTarget");
    expect(proposalCardSource).toContain(
      "接受后将创建人物及其两份档案并保存到本机。"
    );
    expect(proposalCardSource).toContain("接受后将写入人物档案并保存到本机。");
    expect(proposalCardSource).toContain("proposal.longPlotDesignTarget");
    expect(proposalCardSource).toContain(
      "接受后将校验结构影响并保存剧情设计。"
    );
    expect(proposalCardSource).toContain(
      "本项已生成，已加入实时自动保存队列。"
    );
    expect(proposalCardSource).toContain(
      "实时保存失败，可立即重试或拒绝；智能体仍在继续。"
    );
    expect(proposalCardSource).toContain("showProposalReviewActions()");
    expect(proposalCardSource).toContain(
      ":disabled=\"proposalReviewDisabled('reject')\""
    );
    expect(proposalCardSource).toContain(
      ":disabled=\"proposalReviewDisabled('accept')\""
    );
    expect(proposalCardSource).not.toContain(
      ":disabled=\"message.status === 'streaming' || proposal.status === 'accepting'\""
    );
  });

  it("keeps edit proposals above the completed response actions", () => {
    const messageBodyStart = messageItemSource.indexOf(
      '<div class="message-body">'
    );
    const responseStart = messageItemSource.indexOf(
      'v-else-if="visibleResponse(message)"',
      messageBodyStart
    );
    const proposalsStart = messageItemSource.indexOf(
      'class="approval-card-stack"',
      responseStart
    );
    const actionsStart = messageItemSource.indexOf(
      'class="message-actions"',
      proposalsStart
    );

    expect(messageBodyStart).toBeGreaterThan(-1);
    expect(responseStart).toBeGreaterThan(messageBodyStart);
    expect(proposalsStart).toBeGreaterThan(responseStart);
    expect(actionsStart).toBeGreaterThan(proposalsStart);
    expect(messageItemSource).toContain("message.status !== 'streaming'");
    expect(messageItemSource).toContain("approvalItemsForMessage(");
  });

  it("uses distinct composer placeholders for creative space and library agents", () => {
    expect(composerSource).toContain("composerPlaceholder");
    expect(composerLogicSource).toContain(
      "随心输入，输入 / 调用技能，输入 @ 引用素材"
    );
    expect(composerLogicSource).toContain(
      "输入 / 加载方法技能，输入 @ 引用当前库或同分组其它库的技能"
    );
    expect(composerLogicSource).toContain(
      "输入 / 加载方法技能，输入 @ 引用当前库或同分组其它库的素材"
    );
  });

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

  it("scrolls the active slash or mention option into view when using arrow keys", () => {
    expect(composerLogicSource).toContain(
      "function scrollActiveReferenceOptionIntoView"
    );
    expect(composerLogicSource).toContain(
      "composer-reference-option-${activeReferenceIndex.value}"
    );
    expect(composerLogicSource).toContain(
      'scrollIntoView({ block: "nearest" })'
    );

    const keydownStart = composerLogicSource.indexOf("function handleKeydown");
    const keydownEnd = composerLogicSource.indexOf("return {", keydownStart);
    const keydownBlock = composerLogicSource.slice(keydownStart, keydownEnd);
    expect(keydownBlock).toContain(
      'event.key === "ArrowDown" || event.key === "ArrowUp"'
    );
    expect(keydownBlock).toContain("scrollActiveReferenceOptionIntoView()");
  });

  it("renders a hover copy action and timestamp below both user and assistant messages", () => {
    expect(messageItemSource).toContain('<div class="message-content">');
    expect(messageItemSource).toContain("message.status !== 'streaming' &&");
    expect(messageItemSource).toContain("!editing");
    expect(messageItemSource).toContain("'复制回复'");
    expect(messageItemSource).toContain("'复制消息'");

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

  it("delegates turn navigation to the left-side marker component", () => {
    expect(conversationSource).toContain(
      'import ConversationTurnNavigator from "./ConversationTurnNavigator.vue"'
    );
    expect(conversationSource).toContain("useConversationTurnNavigator({");
    expect(conversationSource).toContain("<ConversationTurnNavigator");
    expect(conversationSource).toContain(':turns="conversationTurns"');
    expect(conversationSource).toContain(
      ':active-turn-id="activeConversationTurnId"'
    );
    expect(conversationSource).toContain('@select="scrollToConversationTurn"');
    expect(messageItemSource).toContain(
      ':data-conversation-message-id="message.id"'
    );
    expect(conversationSource).not.toContain(
      'class="conversation-turn-navigator-toggle"'
    );
  });

  it("shows multiple independently clickable editor references inside the composer", () => {
    expect(composerSource).toContain('class="composer-editor-reference-list"');
    expect(composerSource).toContain(
      'v-for="editorReference in editorReferences"'
    );
    expect(composerSource).toContain('class="composer-editor-reference"');
    expect(composerSource).toContain("{{ editorReference.label }}");
    expect(composerSource).toContain(
      "emit('locateEditorReference', editorReference)"
    );
    expect(composerLogicSource).toContain(
      "options.editorReferences().map(createEditorReferenceAttachment)"
    );
    expect(composerSource).toContain(
      "emit('removeEditorReference', editorReference.id)"
    );
    expect(composerSource).toContain('emit("clearEditorReferences")');
  });

  it("adds pasted clipboard files through the existing attachment flow", () => {
    expect(attachmentLogicSource).toContain("function handleComposerPaste");
    expect(attachmentLogicSource).toContain(
      "promptAttachmentFilesFromClipboard(event.clipboardData)"
    );
    expect(attachmentLogicSource).toContain("void addAttachmentFiles(files)");
    expect(composerSource).toContain('@paste="handleComposerPaste"');
  });

  it("shares write previews between tool items and subagents", () => {
    expectSourceToContain(
      processingItemSource,
      "writeToolText(item.tool).length.toLocaleString('zh-CN')"
    );
    expect(processingItemSource).toContain(
      'import { writeToolText } from "../utils/agentWriteToolPreview"'
    );
    expect(proposalCardSource).toContain(
      "接受后将把当前章正文保存到该章节独立的 Markdown 文件。"
    );
    expect(subagentSource).toContain(
      'import { writeToolText } from "../utils/agentWriteToolPreview"'
    );
    expect(subagentSource).toContain("toolLabel(item.tool)");
  });

  it("renders subagent runs via a shared collapsed card list", () => {
    expect(processingTimelineSource).toContain("import SubagentRunList from");
    expect(processingTimelineSource).toContain("<SubagentRunList");
    expect(subagentSource).toContain('class="subagent-run-list"');
    expect(subagentSource).toContain('class="subagent-run-card"');
    expect(subagentSource).toContain('v-for="run in runs"');
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
    expectSourceToContain(
      subagentSource,
      "run.status === 'running' ? '思考中' : '思考过程'"
    );
    expect(subagentSource).not.toContain('class="subagent-run-timeline"');
    expect(subagentSource).toContain("{{ run.task }}");
    expect(subagentSource).toContain("{{ subagentStatusLabel(run, now) }}");
    expect(subagentSource).toContain("{{ run.toolCalls.length }} 个工具");
    expect(subagentSource).toContain("subagentReviewHint(message, run)");
    expect(subagentPresentationSource).toContain("`${writeCount} 次写入调用`");
    expect(subagentSource).not.toContain("`${writeCount} 项文本变更`");
    expect(subagentSource).toContain(
      "formatToolPayload(visibleToolArguments(item.tool))"
    );
    expect(subagentSource).toContain("item.tool.resultSummary");
    expect(subagentSource).toContain("run.summary");
    expect(presentationSource).toContain('tool.name === "spawn_subagent"');
    expect(subagentSource).not.toContain("subagent-run-modal");
  });

  it("nests completed subagent runs inside the processed disclosure only", () => {
    expect(processingTimelineSource).toContain(
      "hasProcessingDisclosure(message)"
    );
    expect(presentationSource).toContain(
      "hasProcessing(message) || Boolean(message.subagentRuns?.length)"
    );

    const disclosureStart = sourceTextIndexOf(
      processingTimelineSource,
      'v-else-if="hasProcessingDisclosure(message)"'
    );
    const nestedSubagentStart = sourceTextIndexOf(
      processingTimelineSource,
      'v-if="message.subagentRuns?.length"',
      disclosureStart
    );
    const disclosureEnd = sourceTextIndexOf(
      processingTimelineSource,
      "</ConversationDetails>",
      nestedSubagentStart
    );
    const streamingSubagentStart = sourceTextIndexOf(
      processingTimelineSource,
      "message.subagentRuns?.length && message.status === 'streaming'",
      disclosureEnd
    );

    expect(disclosureStart).toBeGreaterThan(-1);
    expect(nestedSubagentStart).toBeGreaterThan(disclosureStart);
    expect(nestedSubagentStart).toBeLessThan(disclosureEnd);
    expect(streamingSubagentStart).toBeGreaterThan(disclosureEnd);
  });

  it("shows retry countdowns in the existing processing areas", () => {
    expect(presentationSource).toContain("function retryStatusLabel");
    expect(presentationSource).toContain(
      "网络波动，${remainingSeconds}s 后重试${suffix}"
    );
    expect(presentationSource).toContain("正在重试${suffix}");
    expectSourceToContain(
      processingTimelineSource,
      "hasProcessing(message) || message.retry || message.processingStartedAt"
    );
    expect(processingTimelineSource).not.toContain("retry-error");

    expect(subagentPresentationSource).toContain(
      "export function subagentRetryStatus"
    );
    expect(subagentPresentationSource).toContain(
      "网络波动，${retryCountdownSeconds(run, now)}s 后重试（${progress}）"
    );
    expect(subagentPresentationSource).toContain("正在重试（${progress}）");
    expect(subagentSource).toContain('v-if="subagentRetryStatus(run, now)"');
  });

  it("labels a run as model queueing after ten seconds without model output", () => {
    expect(presentationSource).toContain(
      "const MODEL_QUEUE_LABEL_DELAY_MS = 10_000"
    );
    expect(presentationSource).toContain("function hasFirstModelOutput");
    expect(presentationSource).toContain(
      "end - start >= MODEL_QUEUE_LABEL_DELAY_MS"
    );
    expect(presentationSource).toContain("!hasFirstModelOutput(message)");
    expect(presentationSource).toContain("模型排队中 · 已等待 ${seconds}s");
    expect(presentationSource).toContain("message.content || message.thinking");
    expect(presentationSource).toContain(
      "message.toolCalls?.length || message.subagentRuns?.length"
    );
  });

  it("combines model, thinking, temperature and web search in one popup", () => {
    expect(composerSource).toContain("<ConversationModelConfigSelect");
    expect(composerSource).not.toContain("<ConversationThinkingSelect");
    expect(composerSource).not.toContain('accessible-label="选择温度"');
    expect(modelConfigSource).toContain("<span>模型</span>");
    expect(modelConfigSource).toContain("<span>思考等级</span>");
    expect(modelConfigSource).toContain("<span>温度</span>");
    expect(modelConfigSource).toContain("activeParameterLabel");
    expect(modelConfigSource).toContain("props.showsTemperature");
    expect(modelConfigSource).toContain("`温度 ${temperatureLabel.value}`");
    expect(modelConfigSource).toContain(": thinkingLabel.value");
    expect(modelConfigSource).not.toContain("高级");
    expect(modelConfigSource).toContain('aria-label="联网"');
    expect(modelConfigSource).toContain(':aria-pressed="webSearchEnabled"');
    expect(modelConfigSource).toContain(
      ':disabled="responding || !webSearchAvailable"'
    );
    expect(modelConfigSource).toContain("emit('toggleWebSearch'");
    expect(conversationSource).toContain(
      "@toggle-web-search=\"emit('toggleWebSearch', $event)\""
    );
    expect(writingWorkspaceSource).toContain(
      '@toggle-web-search="conversationController.selectWebSearchEnabled($event)"'
    );
    expect(longWorkspaceSource).toContain(
      "conversationController.selectWebSearchEnabled($event)"
    );
  });
});
