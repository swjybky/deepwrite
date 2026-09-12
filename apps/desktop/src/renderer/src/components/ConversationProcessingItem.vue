<script setup lang="ts">
import type { AgentToolTrace } from "../types/conversation";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { ProcessingDisplayItem } from "./conversationToolPresentation";
import {
  formatToolPayload,
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
import AgentEditProposalCard from "./AgentEditProposalCard.vue";
import LongProposalReview from "./LongProposalReview.vue";
import StreamedContent from "./StreamedContent.vue";

withDefaults(
  defineProps<{
    item: ProcessingDisplayItem;
    streaming: boolean;
    messageStatus?: "streaming" | "completed" | "stopped" | "error" | undefined;
    allowLiveEditReview?: boolean;
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
  }>(),
  {
    allowLiveEditReview: false,
    longWorkspaceIndex: null
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
    ? "正在等待写入内容……"
    : "没有写入内容";
}
</script>

<template>
  <ConversationDetails
    v-if="item.type === 'thinking'"
    :detail-id="item.id"
    class="processing-live-item processing-live-thinking"
  >
    <template #summary>
      <span>{{ streaming ? "思考中" : "思考过程" }}</span>
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
    :detail-id="item.id"
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
          <small
            >{{
              writeToolText(item.tool).length.toLocaleString("zh-CN")
            }}
            字符</small
          >
        </div>
        <pre
          class="write-tool-output"
          :class="{
            'is-streaming': streaming && item.tool.status === 'preparing'
          }"
          >{{ writeToolText(item.tool) || writeToolFallback(item.tool) }}</pre>
      </div>
      <div v-else-if="formatToolPayload(visibleToolArguments(item.tool))">
        <span>调用参数</span>
        <pre>{{ formatToolPayload(visibleToolArguments(item.tool)) }}</pre>
      </div>
      <div v-if="item.tool.resultSummary">
        <span>执行结果</span>
        <p>{{ item.tool.resultSummary }}</p>
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
    :detail-id="item.id"
    class="processing-live-item processing-live-thinking processing-tool-group"
    :aria-busy="toolGroupIsRunning(item.tools)"
  >
    <template #summary>
      <span>{{ toolGroupLabel(item.tools) }}</span>
      <AppIcon name="chevron" :size="13" />
    </template>
    <div class="processing-live-body tool-call-list" aria-label="工具调用列表">
      <ConversationDetails
        v-for="tool in item.tools"
        :key="tool.id"
        :detail-id="tool.id"
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
            <span>调用参数</span>
            <pre>{{ formatToolPayload(visibleToolArguments(tool)) }}</pre>
          </div>
          <div v-if="tool.resultSummary">
            <span>执行结果</span>
            <p>{{ tool.resultSummary }}</p>
          </div>
        </div>
      </ConversationDetails>
    </div>
  </ConversationDetails>
</template>
