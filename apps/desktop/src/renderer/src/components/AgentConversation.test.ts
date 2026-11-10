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
import timelineBlocksSource from "./conversationTimelineBlocks.ts?raw";
import processingItemSource from "./ConversationProcessingItem.vue?raw";
import workGroupSource from "./ConversationWorkGroup.vue?raw";
import presentationSource from "./conversationToolPresentation.ts?raw";
import proposalCardViewSource from "./AgentEditProposalCard.vue?raw";
import proposalCardPresentationSource from "./agentEditProposalPresentation.ts?raw";
import fileChangeSummarySource from "./ConversationFileChangeSummary.vue?raw";
import fileChangeRowSource from "./ConversationFileChangeRow.vue?raw";
import discardButtonSource from "./ApprovalDiscardButton.vue?raw";
import writingWorkspaceSource from "./WritingWorkspaceModule.vue?raw";
import longWorkspaceSource from "./LongWorkspaceModule.vue?raw";
import subagentListSource from "./SubagentRunList.vue?raw";
import subagentCardSource from "./SubagentRunCard.vue?raw";
import subagentDetailSource from "./SubagentRunDetail.vue?raw";
import subagentPresentationSource from "./subagentRunPresentation.ts?raw";

const subagentSource = `${subagentListSource}\n${subagentCardSource}\n${subagentDetailSource}`;
// Card status and wording live beside the card so summary rows can share them.
const proposalCardSource = `${proposalCardViewSource}\n${proposalCardPresentationSource}`;
// Finished turns show their approvals inside the file-change summary rows.
const approvalHostSource = `${messageItemSource}\n${processingItemSource}\n${fileChangeSummarySource}\n${fileChangeRowSource}`;

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
    expect(teamModeSource).toContain("standardMode");
    expect(teamModeSource).toContain("teamMode");
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
    expect(userInputCardSource).toContain("writeYourOwnAnswer");
    expect(userInputCardSource).toContain("recommended");
    expect(userInputCardSource).toContain("skip");
    expect(userInputCardSource).toContain(
      'v-for="question in visibleQuestions"'
    );
    expect(userInputCardSource).toContain("activeQuestionIndex.value += 1");
    expect(userInputCardSource).toContain("nextQuestion");
    expect(userInputCardSource).not.toContain(
      'v-for="question in request.questions"'
    );
    expect(conversationSource).toContain("<ConversationComposer");
    expect(conversationSource).toContain("v-else");
    // With a follow-up queue the composer stays usable while the agent runs.
    expect(composerSource).toContain(
      '<div class="composer" :class="{ \'is-disabled\': lockedWhileRunning }">'
    );
    expect(writingWorkspaceSource).toContain(
      ':user-input-request="conversationController.pendingUserInput.value"'
    );
  });

  it("moves right-pane collapse controls with the selected layout", () => {
    expect(conversationSource).toContain("rightPane?: boolean");
    expect(conversationSource).toContain("collapseAgentPane");
    expect(conversationSource).toContain("rightCollapsed && !rightPane");
    expect(writingWorkspaceSource).toContain(
      ":right-pane=\"paneLayout === 'editor-agent'\""
    );
    expect(writingWorkspaceSource).toContain(
      ':right-pane-collapsed="rightPane.collapsed"'
    );
  });

  it("shows target navigation only for accepted approval cards and relays it", () => {
    // A proposal received from another device is located only on that device.
    expect(proposalCardSource).toContain(
      "v-if=\"proposal.status === 'accepted' && !remoteDevice\""
    );
    expect(proposalCardSource).toContain("approval-target-button");
    expect(proposalCardSource).toContain("goToTargetFile");
    expect(proposalCardSource).toContain("goToTargetFile");
    expect(proposalCardSource).toContain('emit("locate", {');
    expect(approvalHostSource).toContain(
      "@locate=\"emit('locateEditProposal', $event)\""
    );
    expect(
      approvalHostSource.match(
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
    expect(discardButtonSource).toContain("discardTheseChanges");
    expect(proposalCardSource).toContain("<ApprovalDiscardButton");
    expect(presentationSource).toContain(
      "canDiscard: agentProposalSupportsDiscard(proposal)"
    );
    expect(approvalHostSource).toContain(':discardable="latest.canDiscard"');
    expect(`${messageItemSource}\n${processingItemSource}`).toContain(
      ':discardable="item.canDiscard"'
    );
    expect(writingWorkspaceSource).toContain(
      "@discard-edit-proposal=\"emit('discardEditProposal', $event)\""
    );
    // Long cards undo through Core restore points, on the same relay.
    expect(longWorkspaceSource).toContain(
      "@discard-edit-proposal=\"emit('discardEditProposal', $event)\""
    );
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
      "message.status === 'streaming'"
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
    expect(processingTimelineSource).toContain("conversationTimelineBlocks(");
    expectSourceToContain(
      timelineBlocksSource,
      'processingDisplayItems(message, message.status === "streaming", longProposalItems)'
    );
  });

  it("allows every explicitly enabled agent proposal to save while streaming", () => {
    expect(conversationSource).toContain("allowLiveEditReview?: boolean");
    expect(conversationSource).toContain("allowLiveEditReview: false");
    expect(proposalCardSource).toContain(
      "function canReviewProposalWhileStreaming"
    );
    expect(proposalCardSource).not.toContain('proposal.stageId === "draft"');
    expect(proposalCardSource).not.toContain("!proposal.libraryTarget");
    expect(proposalCardSource).toContain("thisItemIsReadyForReviewTheAgentIs");
    expect(proposalCardSource).toContain(
      "thisItemIsReadyAndIsEnteringTheAutosave"
    );
    expect(proposalCardSource).toContain("proposal.longCharacterTarget");
    expect(proposalCardSource).toContain(
      "acceptToCreateTheCharacterAndBothProfilesAnd"
    );
    expect(proposalCardSource).toContain(
      "acceptToWriteTheCharacterProfileAndSaveIt"
    );
    expect(proposalCardSource).toContain("proposal.longPlotDesignTarget");
    expect(proposalCardSource).toContain(
      "acceptToValidateStructuralImpactAndSaveThePlot"
    );
    expect(proposalCardSource).toContain("thisItemIsReadyAndHasBeenAddedTo");
    expect(proposalCardSource).toContain(
      "autosaveFailedYouCanRetryOrRejectNowThe"
    );
    expect(proposalCardSource).toContain("showProposalReviewActions(props)");
    expect(proposalCardSource).toContain(
      ":disabled=\"proposalReviewDisabled(props, 'reject')\""
    );
    expect(proposalCardSource).toContain(
      ":disabled=\"proposalReviewDisabled(props, 'accept')\""
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
      'v-else-if="response"',
      messageBodyStart
    );
    const proposalsStart = messageItemSource.indexOf(
      "<ConversationFileChangeSummary",
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
      "writeAnythingTypeToUseSkillsOrToReference"
    );
    expect(composerLogicSource).toContain(
      "describeALibraryTaskTypeToLoadAMethod"
    );
    expect(composerLogicSource).toContain(
      "describeALibraryTaskTypeToLoadAMethod2"
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
    expect(composerLogicSource).toContain("createEditorReferenceAttachment(");
    expect(composerLogicSource).toContain(
      "options.textAttachmentMaxCharacters()"
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
      "writeToolText(item.tool).length.toLocaleString(locale)"
    );
    expect(processingItemSource).toContain(
      'import { writeToolText } from "../utils/agentWriteToolPreview"'
    );
    expect(proposalCardSource).toContain(
      "acceptToSaveTheCurrentChapterManuscriptToIts"
    );
    expect(workGroupSource).toContain("<ConversationProcessingItem");
    expect(subagentSource).toContain("<ConversationWorkGroup");
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

  it("renders subagent cards within both ordered timelines without a trailing list", () => {
    expect(processingTimelineSource).toContain('v-for="block in blocks"');
    const disclosureStart = processingTimelineSource.indexOf(
      "<ConversationDetails\n      v-else"
    );
    const disclosureEnd = processingTimelineSource.indexOf(
      "</ConversationDetails>",
      disclosureStart
    );
    expect(disclosureStart).toBeGreaterThan(-1);
    expect(disclosureEnd).toBeGreaterThan(disclosureStart);
    expect(processingTimelineSource).toContain('class="processing-block"');
    expect(processingTimelineSource).toContain(
      'class="processing-live-status"'
    );
    expect(processingTimelineSource).not.toContain("showProcessingStatus");
    const liveTimeline = processingTimelineSource.slice(0, disclosureStart);
    const historyTimeline = processingTimelineSource.slice(
      disclosureStart,
      disclosureEnd
    );
    for (const timeline of [liveTimeline, historyTimeline]) {
      const loopStart = timeline.indexOf('v-for="item in block.items"');
      const workGroupStart = timeline.indexOf(
        "<ConversationWorkGroup",
        loopStart
      );
      const cardStart = timeline.indexOf("<SubagentRunList", loopStart);
      const loopEnd = timeline.indexOf("</template>", loopStart);
      expect(loopStart).toBeGreaterThan(-1);
      expect(workGroupStart).toBeGreaterThan(loopStart);
      expect(cardStart).toBeGreaterThan(workGroupStart);
      expect(cardStart).toBeLessThan(loopEnd);
      expect(timeline).toContain("v-if=\"item.type === 'work-group'\"");
      expect(timeline).toContain("v-else-if=\"item.type === 'subagent'\"");
      expect(timeline).toContain(':runs="item.runs"');
    }
    expect(processingTimelineSource.slice(disclosureEnd)).not.toContain(
      "<SubagentRunList"
    );
  });

  it("shows retry countdowns in the existing processing areas", () => {
    expect(presentationSource).toContain("function retryStatusLabel");
    expect(presentationSource).toContain(
      "connectionInterruptedRetryingValueInValueS"
    );
    expect(presentationSource).toContain("retryingValue");
    expect(processingTimelineSource).toContain("processingLabel(message, now)");
    expectSourceToContain(
      timelineBlocksSource,
      "message.retry || message.processingStartedAt"
    );
    expect(processingTimelineSource).not.toContain("retry-error");

    expect(subagentPresentationSource).toContain(
      "export function subagentRetryStatus"
    );
    expect(subagentPresentationSource).toContain(
      "connectionInterruptedRetryInValueSValue"
    );
    expect(subagentPresentationSource).toContain("retrying");
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
    expect(presentationSource).toContain("modelQueuedWaitedValueS");
    expect(presentationSource).toContain("message.content || message.thinking");
    expect(presentationSource).toContain(
      "message.toolCalls?.length || message.subagentRuns?.length"
    );
  });

  it("keeps model selection and fixed run settings in one popup", () => {
    expect(composerSource).toContain("<ConversationModelConfigSelect");
    expect(composerSource).not.toContain("<ConversationRunSettings");
    expect(modelConfigSource).toContain("model");
    expect(modelConfigSource).toContain(
      'class="conversation-model-config-footer"'
    );
    expect(modelConfigSource).toContain("reasoningLevel");
    expect(modelConfigSource).toContain("webAccess");
    expect(modelConfigSource).toContain(':aria-pressed="webSearchEnabled"');
    expect(modelConfigSource).toContain(
      ':disabled="responding || !webSearchAvailable"'
    );
    expect(modelConfigSource).toContain("emit('toggleWebSearch'");
    expect(modelConfigSource).toContain("function revealCurrentSelection");
    expect(modelConfigSource).toContain(
      "scrollSelectedIntoView(scroller, selected)"
    );
    const openMenuStart = modelConfigSource.indexOf("async function openMenu");
    const openMenuEnd = modelConfigSource.indexOf(
      "function closeMenu",
      openMenuStart
    );
    expect(modelConfigSource.slice(openMenuStart, openMenuEnd)).toContain(
      "revealCurrentSelection()"
    );
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
