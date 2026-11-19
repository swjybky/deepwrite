<script setup lang="ts">
import { createScopedTranslator, locale } from "../i18n";
import type { AgentEditProposal, AgentToolTrace } from "../types/conversation";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { ProcessingDisplayItem } from "./conversationToolPresentation";
import {
  formatToolPayload,
  hasWebSources,
  isWriteTool,
  toolDetail,
  toolGroupIsRunning,
  toolGroupLabel,
  toolIcon,
  toolLabel,
  visibleToolArguments,
  writeToolContentLabel,
  writeToolTarget
} from "./conversationToolPresentation";
import { writeToolText } from "../utils/agentWriteToolPreview";
import AppIcon from "./AppIcon.vue";
import ConversationDetails from "./ConversationDetails.vue";
import ConversationStatusIcon from "./ConversationStatusIcon.vue";
import AgentEditProposalCard from "./AgentEditProposalCard.vue";
import LongProposalReview from "./LongProposalReview.vue";
import StreamedContent from "./StreamedContent.vue";
import WebSearchSources from "./WebSearchSources.vue";

const t = createScopedTranslator("components.conversationProcessingItem");

const props = withDefaults(
  defineProps<{
    item: Exclude<
      ProcessingDisplayItem,
      { type: "subagent" | "work-group" | "compaction" | "user_note" }
    >;
    streaming: boolean;
    messageStatus?: "streaming" | "completed" | "stopped" | "error" | undefined;
    allowLiveEditReview?: boolean;
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
    detailIdPrefix?: string;
    peerProposals?: readonly AgentEditProposal[];
  }>(),
  {
    allowLiveEditReview: false,
    longWorkspaceIndex: null,
    detailIdPrefix: "",
    peerProposals: () => []
  }
);

const emit = defineEmits<{
  reviewEdit: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  locateEditProposal: [payload: { runId: string; proposalId: string }];
  discardEditProposal: [payload: { runId: string; proposalId: string }];
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [eventId: string];
}>();

function writeToolFallback(tool: AgentToolTrace): string {
  return tool.status === "preparing" || tool.status === "running"
    ? t("waitingForContentToWrite")
    : t("noContentToWrite");
}

function detailId(id: string): string {
  return props.detailIdPrefix ? `${props.detailIdPrefix}:${id}` : id;
}
</script>

<template>
  <ConversationDetails
    v-if="item.type === 'thinking'"
    :detail-id="detailId(item.id)"
    class="processing-live-item processing-live-thinking"
  >
    <template #summary>
      <span class="processing-status-label">
        <ConversationStatusIcon kind="thinking" />
        <span>{{ streaming ? t("thinking") : t("reasoning") }}</span>
      </span>
      <AppIcon name="chevron" :size="13" />
    </template>
    <div class="processing-live-body processing-thinking">
      <StreamedContent
        :content="item.content"
        format="plain"
        :streaming="streaming"
      />
    </div>
  </ConversationDetails>

  <div
    v-else-if="item.type === 'response'"
    class="processing-step processing-response"
  >
    <StreamedContent
      :content="item.content"
      format="markdown"
      :streaming="streaming"
    />
  </div>

  <ConversationDetails
    v-else-if="item.type === 'tool'"
    :detail-id="detailId(item.id)"
    class="processing-live-item processing-live-tool"
  >
    <template #summary>
      <div
        class="tool-trace"
        :class="[
          `is-${item.tool.status}`,
          { 'is-write': isWriteTool(item.tool) }
        ]"
      >
        <AppIcon
          v-if="!isWriteTool(item.tool)"
          :name="toolIcon(item.tool)"
          :size="17"
        />
        <div>
          <div v-if="isWriteTool(item.tool)" class="write-tool-label">
            <strong>{{ toolLabel(item.tool) }}</strong>
            <AppIcon name="chevron" :size="13" />
          </div>
          <strong v-else>{{ toolLabel(item.tool) }}</strong>
          <span v-if="toolDetail(item.tool)">{{ toolDetail(item.tool) }}</span>
        </div>
      </div>
      <AppIcon v-if="!isWriteTool(item.tool)" name="chevron" :size="13" />
    </template>
    <div class="processing-live-body tool-detail">
      <div v-if="isWriteTool(item.tool)" class="write-tool-detail">
        <div class="write-tool-output-heading">
          <span>{{ writeToolContentLabel(item.tool) }}</span>
          <small v-if="writeToolTarget(item.tool)">{{
            writeToolTarget(item.tool)
          }}</small>
          <small>{{
            t("charactersMessage", {
              arg0: writeToolText(item.tool).length.toLocaleString(locale) ?? ""
            })
          }}</small>
        </div>
        <pre
          class="write-tool-output"
          :class="{
            'is-streaming': streaming && item.tool.status === 'preparing'
          }"
          >{{ writeToolText(item.tool) || writeToolFallback(item.tool) }}</pre>
      </div>
      <div v-else-if="formatToolPayload(visibleToolArguments(item.tool))">
        <span>{{ t("arguments") }}</span>
        <pre>{{ formatToolPayload(visibleToolArguments(item.tool)) }}</pre>
      </div>
      <div v-if="item.tool.resultSummary">
        <span>{{ t("result") }}</span>
        <WebSearchSources
          v-if="hasWebSources(item.tool) && item.tool.status === 'completed'"
          :summary="item.tool.resultSummary"
        />
        <p v-else>{{ item.tool.resultSummary }}</p>
      </div>
    </div>
  </ConversationDetails>

  <AgentEditProposalCard
    v-else-if="item.type === 'edit-proposal'"
    class="approval-timeline-card"
    :proposal="item.proposal"
    :message-status="messageStatus"
    :allow-live-edit-review="allowLiveEditReview"
    :discardable="item.canDiscard"
    :remote-device="item.remoteDevice"
    :peer-proposals="peerProposals"
    @review="emit('reviewEdit', $event)"
    @locate="emit('locateEditProposal', $event)"
    @discard="emit('discardEditProposal', $event)"
  />

  <LongProposalReview
    v-else-if="item.type === 'long-proposal'"
    class="approval-timeline-card"
    embedded
    conversation-card
    :items="[item.item]"
    :workspace-index="longWorkspaceIndex"
    @approve="emit('approveLongProposal', $event)"
    @reject="emit('rejectLongProposal', $event)"
    @retry-preview="emit('retryLongProposalPreview', $event)"
    @locate="emit('locateLongProposal', $event)"
  />

  <ConversationDetails
    v-else
    :detail-id="detailId(item.id)"
    class="processing-live-item processing-live-thinking processing-tool-group"
    :aria-busy="toolGroupIsRunning(item.tools)"
  >
    <template #summary>
      <span class="processing-status-label">
        <ConversationStatusIcon kind="execution" />
        <span>{{ toolGroupLabel(item.tools) }}</span>
      </span>
      <AppIcon name="chevron" :size="13" />
    </template>
    <div
      class="processing-live-body tool-call-list"
      :aria-label="t('toolCalls')"
    >
      <ConversationDetails
        v-for="tool in item.tools"
        :key="tool.id"
        :detail-id="detailId(tool.id)"
        class="processing-live-item processing-live-tool tool-call-list-item"
      >
        <template #summary>
          <div class="tool-trace" :class="`is-${tool.status}`">
            <AppIcon :name="toolIcon(tool)" :size="17" />
            <div>
              <strong>{{ toolLabel(tool) }}</strong>
              <span v-if="toolDetail(tool)">{{ toolDetail(tool) }}</span>
            </div>
          </div>
          <AppIcon name="chevron" :size="13" />
        </template>
        <div class="processing-live-body tool-detail">
          <div v-if="formatToolPayload(visibleToolArguments(tool))">
            <span>{{ t("arguments") }}</span>
            <pre>{{ formatToolPayload(visibleToolArguments(tool)) }}</pre>
          </div>
          <div v-if="tool.resultSummary">
            <span>{{ t("result") }}</span>
            <WebSearchSources
              v-if="hasWebSources(tool) && tool.status === 'completed'"
              :summary="tool.resultSummary"
            />
            <p v-else>{{ tool.resultSummary }}</p>
          </div>
        </div>
      </ConversationDetails>
    </div>
  </ConversationDetails>
</template>

<style scoped>
.processing-status-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
</style>
