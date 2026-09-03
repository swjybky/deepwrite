<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  type AgentTeamRunMode,
  type AgentUserInputAnswer,
  type AgentUserInputRequestedPayload,
  type BuiltInReasoningLevel,
  type LibraryAgentDomain,
  type LibraryAgentSkill,
  type LongAgentId,
  type LongWorkspaceIndexSnapshot,
  type ModelConfig,
  type WorkspaceAgentId,
  type ThinkingLevel,
  type UserPromptAttachment
} from "@deepwrite/contracts";
import { resolveAgentWelcome } from "../data/agentWelcome";
import { useConversationTextReferences } from "../composables/useConversationTextReferences";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type {
  AgentApprovalMode,
  ChatMessage,
  ComposerReferenceOption,
  ConversationHistoryItem,
  ConversationMessageRewriteRequest,
  EditorTextReference
} from "../types/conversation";
import type { IconName } from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { useConversationTurnNavigator } from "../composables/useConversationTurnNavigator";
import AppIcon from "./AppIcon.vue";
import AgentActivityFloatPanel from "./AgentActivityFloatPanel.vue";
import AgentUserInputCard from "./AgentUserInputCard.vue";
import ConversationComposer from "./ConversationComposer.vue";
import ConversationMessageList from "./ConversationMessageList.vue";
import ConversationTurnNavigator from "./ConversationTurnNavigator.vue";
import { AGENT_ACTIVITY_CONTEXT_KEY } from "../composables/agentActivityContext";
import {
  WORKSPACE_WEB_SEARCH_DISABLED_REASON,
  isWorkspaceWebSearchAvailable
} from "../composables/agent-conversation/web-search";

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    conversationHistory: ConversationHistoryItem[];
    currentSessionId: string;
    draft: string;
    responding: boolean;
    canSend: boolean;
    canSendAttachments: boolean;
    canRewriteHistory?: boolean;
    submitEditedMessage?:
      | ((request: ConversationMessageRewriteRequest) => Promise<boolean>)
      | undefined;
    canStop: boolean;
    runtimeAvailable: boolean;
    models: ModelConfig[];
    selectedModelId: string;
    thinkingLevel: ThinkingLevel;
    webSearchEnabled: boolean;
    temperature: number;
    approvalMode: AgentApprovalMode;
    agentTeamMode: AgentTeamRunMode;
    contextTitle: string;
    bookTitle: string;
    stageLabel: string;
    agentLabel: string;
    agentId: WorkspaceAgentId | LongAgentId | undefined;
    agentWorkspaceType?: "short" | "script" | "long";
    allowLiveEditReview?: boolean;
    libraryDomain: LibraryAgentDomain | undefined;
    librarySkills: readonly Pick<LibraryAgentSkill, "name">[] | undefined;
    welcomeShortcuts: readonly [string, string, string] | undefined;
    availableSkills: ComposerReferenceOption[];
    availableMaterials: ComposerReferenceOption[];
    editorReferences: EditorTextReference[];
    longProposalItems?: LongWorkspaceProposalItem[];
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    rightPane?: boolean;
    userInputRequest?: AgentUserInputRequestedPayload | null;
    userInputSubmitting?: boolean;
  }>(),
  {
    allowLiveEditReview: false,
    canRewriteHistory: false,
    longProposalItems: () => [],
    longWorkspaceIndex: null,
    rightPane: false,
    userInputRequest: null,
    userInputSubmitting: false
  }
);

const conversationScrollbar = createTransientScrollbarController();
const agentActivity = inject(AGENT_ACTIVITY_CONTEXT_KEY, null);
const agentActivityItems = computed(() => agentActivity?.items.value ?? []);
const agentActivityCollapsed = computed(
  () => agentActivity?.collapsed.value ?? false
);

function selectAgentActivity(conversationKey: string): void {
  void agentActivity?.selectActivity(conversationKey);
}

const emit = defineEmits<{
  "update:draft": [value: string];
  clearEditorReferences: [];
  removeEditorReference: [referenceId: string];
  locateEditorReference: [reference: EditorTextReference];
  newConversation: [];
  selectConversation: [sessionId: string];
  send: [attachments: UserPromptAttachment[]];
  stop: [];
  suggestion: [value: string];
  toggleLeft: [];
  toggleRight: [];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  toggleWebSearch: [enabled: boolean];
  selectTemperature: [temperature: number];
  selectApproval: [mode: AgentApprovalMode];
  selectAgentTeamMode: [mode: AgentTeamRunMode];
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
  submitUserInput: [answers: AgentUserInputAnswer[]];
}>();

const scroller = ref<HTMLElement>();
const messageList = ref<HTMLElement>();

function setConversationScroller(element: unknown): void {
  scroller.value = element instanceof HTMLElement ? element : undefined;
}

function setConversationMessageList(element: unknown): void {
  messageList.value = element instanceof HTMLElement ? element : undefined;
}
const {
  composerReferences,
  insertConversationReference,
  clearComposerReferences,
  removeComposerReference,
  locateComposerReference
} = useConversationTextReferences({
  sessionId: () => props.currentSessionId,
  externalReferences: () => props.editorReferences,
  messageList,
  clearExternalReferences: () => emit("clearEditorReferences"),
  removeExternalReference: (referenceId) =>
    emit("removeEditorReference", referenceId),
  locateExternalReference: (reference) =>
    emit("locateEditorReference", reference),
  notifications: uiMessage
});
const clock = ref(Date.now());
const hasLiveProcessing = computed(
  () =>
    props.responding ||
    props.messages.some(
      (message) =>
        message.status === "streaming" ||
        message.subagentRuns?.some((run) => run.status === "running")
    )
);
const historyOpen = ref(false);
let clockTimer: number | undefined;
let scrollFrame: number | undefined;
const followsConversationTail = ref(true);
const tailFollowLockedForResponse = ref(false);
let lastConversationScrollTop = 0;

const TAIL_FOLLOW_THRESHOLD = 72;

function isNearConversationTail(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    TAIL_FOLLOW_THRESHOLD
  );
}

function hasActiveConversationResponse(): boolean {
  return (
    props.responding ||
    props.messages.some(
      (message) =>
        message.role === "assistant" && message.status === "streaming"
    )
  );
}

function lockConversationTailForCurrentResponse(): void {
  if (!hasActiveConversationResponse()) return;
  tailFollowLockedForResponse.value = true;
  followsConversationTail.value = false;
  if (scrollFrame !== undefined) {
    globalThis.cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
  }
}

const {
  activeTurnId: activeConversationTurnId,
  scheduleActiveTurnUpdate: scheduleActiveConversationTurnUpdate,
  scrollToTurn: scrollToConversationTurn,
  turns: conversationTurns
} = useConversationTurnNavigator({
  messages: () => props.messages,
  currentSessionId: () => props.currentSessionId,
  scroller,
  messageList,
  beforeNavigate: () => {
    lockConversationTailForCurrentResponse();
    followsConversationTail.value = false;
  }
});

function handleConversationWheel(event: WheelEvent): void {
  if (event.deltaY < 0) lockConversationTailForCurrentResponse();
}

function handleConversationScroll(): void {
  const element = scroller.value;
  if (!element) return;
  conversationScrollbar.reveal(element);
  const nextScrollTop = element.scrollTop;
  if (
    hasActiveConversationResponse() &&
    nextScrollTop < lastConversationScrollTop - 1
  ) {
    lockConversationTailForCurrentResponse();
  }
  if (hasActiveConversationResponse()) {
    followsConversationTail.value = !tailFollowLockedForResponse.value;
  } else {
    followsConversationTail.value = isNearConversationTail(element);
  }
  lastConversationScrollTop = nextScrollTop;
  scheduleActiveConversationTurnUpdate();
}

function scheduleConversationTailFollow(): void {
  if (!followsConversationTail.value || scrollFrame !== undefined) {
    return;
  }
  scrollFrame = globalThis.requestAnimationFrame(() => {
    scrollFrame = undefined;
    const element = scroller.value;
    if (element && followsConversationTail.value) {
      const tailScrollTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight
      );
      if (Math.abs(element.scrollTop - tailScrollTop) > 1) {
        element.scrollTop = tailScrollTop;
        lastConversationScrollTop = tailScrollTop;
      }
    }
  });
}

watch(
  () => {
    const message = props.messages.at(-1);
    return [
      props.messages.length,
      props.responding,
      message?.id,
      message?.content.length,
      message?.thinking?.length,
      message?.retry
        ? `${message.retry.state}:${message.retry.attempt}:${message.retry.retryAt ?? ""}`
        : "",
      message?.toolCalls
        ?.map(
          (toolCall) =>
            `${toolCall.status}:${toolCall.argumentsText?.length ?? 0}`
        )
        .join(","),
      message?.subagentRuns
        ?.map((run) =>
          [
            run.subagentRunId,
            run.status,
            run.thinking?.length ?? 0,
            run.output?.length ?? 0,
            run.toolCalls
              .map((toolCall) => `${toolCall.id}:${toolCall.status}`)
              .join(";")
          ].join(":")
        )
        .join(","),
      message?.editProposals
        ?.map(
          (proposal) =>
            `${proposal.id}:${proposal.status}:${proposal.updatedAt}`
        )
        .join(","),
      props.longProposalItems
        .map((item) => `${item.event.id}:${item.status}:${item.error ?? ""}`)
        .join(",")
    ].join("|");
  },
  async () => {
    if (!followsConversationTail.value) {
      return;
    }
    await nextTick();
    scheduleConversationTailFollow();
  }
);

onMounted(async () => {
  await nextTick();
  lastConversationScrollTop = scroller.value?.scrollTop ?? 0;
  scheduleConversationTailFollow();
});

watch(
  () => props.responding,
  (responding, wasResponding) => {
    if (!responding || wasResponding) return;
    tailFollowLockedForResponse.value = false;
    followsConversationTail.value = true;
    void nextTick(() => {
      scheduleConversationTailFollow();
    });
  }
);

watch(
  () => {
    const message = [...props.messages]
      .reverse()
      .find((candidate) => candidate.role === "assistant");
    return message ? `${message.id}:${message.status ?? "completed"}` : "";
  },
  async (next, previous) => {
    if (
      !tailFollowLockedForResponse.value ||
      !previous.endsWith(":streaming") ||
      next.endsWith(":streaming")
    ) {
      return;
    }
    const element = scroller.value;
    if (!element) return;
    const preservedScrollTop = element.scrollTop;
    await nextTick();
    if (!tailFollowLockedForResponse.value || !scroller.value) return;
    scroller.value.scrollTop = preservedScrollTop;
    lastConversationScrollTop = preservedScrollTop;
  },
  { flush: "pre" }
);

watch(
  () => hasLiveProcessing.value,
  (live) => {
    if (clockTimer !== undefined) {
      globalThis.clearInterval(clockTimer);
      clockTimer = undefined;
    }
    clock.value = Date.now();
    if (live) {
      clockTimer = globalThis.setInterval(() => {
        clock.value = Date.now();
      }, 1_000);
    }
  },
  { immediate: true }
);

watch(
  () => props.currentSessionId,
  () => {
    historyOpen.value = false;
    tailFollowLockedForResponse.value = false;
    followsConversationTail.value = true;
    void nextTick(() => {
      lastConversationScrollTop = scroller.value?.scrollTop ?? 0;
      scheduleConversationTailFollow();
    });
  }
);

onBeforeUnmount(() => {
  if (clockTimer !== undefined) {
    globalThis.clearInterval(clockTimer);
  }
  if (scrollFrame !== undefined) {
    globalThis.cancelAnimationFrame(scrollFrame);
  }
  conversationScrollbar.dispose();
});

const welcomeContent = computed(() =>
  resolveAgentWelcome(
    props.agentId,
    props.libraryDomain,
    props.librarySkills,
    props.welcomeShortcuts,
    props.agentWorkspaceType
  )
);
const selectedModel = computed(() =>
  props.models.find((model) => model.id === props.selectedModelId)
);
const webSearchAvailable = computed(() =>
  isWorkspaceWebSearchAvailable(selectedModel.value)
);
const builtInThinkingLabels: Record<BuiltInReasoningLevel, string> = {
  minimal: "最低",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "极高",
  max: "最高"
};
const fallbackThinkingOptions: Array<{ value: ThinkingLevel; label: string }> =
  [
    { value: "off", label: "关闭" },
    ...BUILT_IN_REASONING_LEVELS.map((value) => ({
      value,
      label: builtInThinkingLabels[value]
    }))
  ];

function thinkingLabel(level: ThinkingLevel): string {
  if (level === "off") {
    return "关闭";
  }
  return BUILT_IN_REASONING_LEVELS.includes(level as BuiltInReasoningLevel)
    ? builtInThinkingLabels[level as BuiltInReasoningLevel]
    : `自定义（${level}）`;
}

const availableThinkingOptions = computed(() =>
  selectedModel.value
    ? [
        { value: "off" as const, label: thinkingLabel("off") },
        ...selectedModel.value.thinkingLevelOptions.map((value) => ({
          value,
          label: thinkingLabel(value)
        }))
      ]
    : fallbackThinkingOptions
);
const modelOptions = computed(() =>
  props.models.map((model) => ({ value: model.id, label: model.label }))
);
const showsTemperature = computed(
  () => Boolean(selectedModel.value) && props.thinkingLevel === "off"
);
const temperatureOptions = computed(
  () => selectedModel.value?.temperatureOptions ?? []
);
const temperatureSelectOptions = computed(() =>
  temperatureOptions.value.map((value) => ({ value, label: String(value) }))
);
const approvalOptions = [
  {
    value: "request-approval" as const,
    label: "请求批准",
    description: "修改或写入正文前均需你的批准"
  },
  {
    value: "auto-approve" as const,
    label: "替我审批",
    description: "自动批准修改并写入正文"
  }
];
const approvalModeIcon = computed<IconName>(() =>
  props.approvalMode === "request-approval" ? "user" : "check"
);

function formatHistoryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
}

function selectHistoryConversation(item: ConversationHistoryItem): void {
  historyOpen.value = false;
  if (item.sessionId !== props.currentSessionId) {
    emit("selectConversation", item.sessionId);
  }
}
</script>

<template>
  <main class="conversation-pane" aria-label="智能体对话">
    <header class="conversation-header">
      <div class="conversation-heading-start">
        <button
          v-if="leftCollapsed"
          class="icon-button"
          type="button"
          aria-label="展开左侧栏"
          @click="emit('toggleLeft')"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <button
          v-if="agentActivity"
          class="icon-button agent-activity-toggle"
          :class="{ 'is-collapsed': agentActivityCollapsed }"
          type="button"
          :aria-label="
            agentActivityCollapsed ? '展开智能体执行列表' : '收起智能体执行列表'
          "
          :aria-expanded="!agentActivityCollapsed"
          aria-controls="agent-activity-panel"
          @click="agentActivity.toggleCollapsed()"
        >
          <AppIcon
            class="agent-activity-toggle-icon"
            name="panel-top"
            :size="18"
          />
          <span
            v-if="agentActivityCollapsed && agentActivityItems.length"
            class="agent-activity-toggle-badge"
            aria-hidden="true"
          >
            {{ Math.min(agentActivityItems.length, 9)
            }}{{ agentActivityItems.length > 9 ? "+" : "" }}
          </span>
        </button>
        <div>
          <strong>{{ agentLabel }}</strong>
          <span class="context-caption">主上下文：{{ contextTitle }}</span>
        </div>
      </div>
      <div class="conversation-header-actions">
        <div
          class="conversation-history-control"
          @keydown.esc.stop="historyOpen = false"
        >
          <button
            class="header-text-button"
            :class="{ 'is-active': historyOpen }"
            type="button"
            aria-haspopup="dialog"
            :aria-expanded="historyOpen"
            aria-controls="conversation-history-panel"
            @click="historyOpen = !historyOpen"
          >
            <AppIcon name="history" :size="16" />
            历史对话
          </button>
          <div
            v-if="historyOpen"
            class="conversation-history-dismiss"
            aria-hidden="true"
            @mousedown="historyOpen = false"
          />
          <section
            v-if="historyOpen"
            id="conversation-history-panel"
            class="conversation-history-panel"
            role="dialog"
            aria-label="历史对话"
          >
            <header>
              <div>
                <strong>历史对话</strong>
                <span>当前智能体的最近记录</span>
              </div>
              <button
                type="button"
                aria-label="关闭历史对话"
                @click="historyOpen = false"
              >
                <AppIcon name="close" :size="15" />
              </button>
            </header>
            <div
              v-if="conversationHistory.length"
              class="conversation-history-list"
            >
              <button
                v-for="item in conversationHistory"
                :key="item.sessionId"
                class="conversation-history-item"
                :class="{ 'is-current': item.current }"
                type="button"
                :disabled="responding && !item.current"
                @click="selectHistoryConversation(item)"
              >
                <span class="conversation-history-icon">
                  <AppIcon
                    :name="item.current ? 'check' : 'message'"
                    :size="15"
                  />
                </span>
                <span class="conversation-history-copy">
                  <span class="conversation-history-title-row">
                    <strong>{{ item.title }}</strong>
                    <time :datetime="item.updatedAt">{{
                      formatHistoryTime(item.updatedAt)
                    }}</time>
                  </span>
                  <small>{{ item.preview || "暂无回复内容" }}</small>
                  <span class="conversation-history-meta">
                    {{
                      item.current
                        ? "当前对话"
                        : `${item.turnCount} 轮 · ${item.messageCount} 条消息`
                    }}
                  </span>
                </span>
              </button>
            </div>
            <div v-else class="conversation-history-empty">
              <AppIcon name="history" :size="22" />
              <strong>还没有历史对话</strong>
              <span>发送消息后，对话会自动保存在这里。</span>
            </div>
            <p class="conversation-history-running-note">
              {{
                responding
                  ? "当前回复完成或停止后，可切换到其他对话。"
                  : "选择历史记录即可切换对话。"
              }}
            </p>
          </section>
        </div>
        <button
          class="header-text-button"
          type="button"
          @click="emit('newConversation')"
        >
          <AppIcon name="plus" :size="16" />
          新建对话
        </button>
        <button
          v-if="rightCollapsed && !rightPane"
          class="icon-button"
          type="button"
          aria-label="展开文本内容栏"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
        <button
          v-if="rightPane"
          class="icon-button"
          type="button"
          aria-label="收起智能体栏"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <div class="conversation-scroll-shell">
      <AgentActivityFloatPanel
        v-if="agentActivity && !agentActivityCollapsed"
        id="agent-activity-panel"
        :items="agentActivityItems"
        @select="selectAgentActivity"
      />
      <ConversationMessageList
        :messages="messages"
        :responding="responding"
        :conversation-session-id="currentSessionId"
        :runtime-available="runtimeAvailable"
        :clock="clock"
        :can-rewrite-history="canRewriteHistory"
        :submit-edited-message="submitEditedMessage"
        :allow-live-edit-review="allowLiveEditReview"
        :long-proposal-items="longProposalItems"
        :long-workspace-index="longWorkspaceIndex"
        :welcome-content="welcomeContent"
        :handle-conversation-wheel="handleConversationWheel"
        :handle-conversation-scroll="handleConversationScroll"
        :set-scroller="setConversationScroller"
        :set-message-list="setConversationMessageList"
        @suggestion="emit('suggestion', $event)"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @discard-edit-proposal="emit('discardEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
        @insert-selection="insertConversationReference"
      />

      <ConversationTurnNavigator
        v-if="conversationTurns.length"
        :turns="conversationTurns"
        :active-turn-id="activeConversationTurnId"
        @select="scrollToConversationTurn"
      />
    </div>

    <footer v-if="userInputRequest" class="composer-wrap">
      <div class="composer-stack">
        <AgentUserInputCard
          :request="userInputRequest"
          :submitting="userInputSubmitting"
          @submit="emit('submitUserInput', $event)"
        />
      </div>
    </footer>

    <ConversationComposer
      v-else
      :draft="draft"
      :responding="responding"
      :can-send="canSend"
      :can-send-attachments="canSendAttachments"
      :can-stop="canStop"
      :runtime-available="runtimeAvailable"
      :current-session-id="currentSessionId"
      :messages="messages"
      :messages-empty="messages.length === 0"
      :book-title="bookTitle"
      :stage-label="stageLabel"
      :selected-model-id="selectedModelId"
      :selected-model="selectedModel"
      :thinking-level="thinkingLevel"
      :web-search-enabled="webSearchEnabled"
      :web-search-available="webSearchAvailable"
      :web-search-disabled-reason="WORKSPACE_WEB_SEARCH_DISABLED_REASON"
      :temperature="temperature"
      :approval-mode="approvalMode"
      :agent-team-mode="agentTeamMode"
      :agent-id="agentId"
      :agent-workspace-type="agentWorkspaceType"
      :library-domain="libraryDomain"
      :available-skills="availableSkills"
      :available-materials="availableMaterials"
      :editor-references="composerReferences"
      :model-options="modelOptions"
      :available-thinking-options="availableThinkingOptions"
      :shows-temperature="showsTemperature"
      :temperature-select-options="temperatureSelectOptions"
      :approval-options="approvalOptions"
      :approval-mode-icon="approvalModeIcon"
      @update:draft="emit('update:draft', $event)"
      @send="emit('send', $event)"
      @stop="emit('stop')"
      @clear-editor-references="clearComposerReferences"
      @remove-editor-reference="removeComposerReference"
      @locate-editor-reference="locateComposerReference"
      @select-model="emit('selectModel', $event)"
      @select-thinking="emit('selectThinking', $event)"
      @toggle-web-search="emit('toggleWebSearch', $event)"
      @select-temperature="emit('selectTemperature', $event)"
      @select-approval="emit('selectApproval', $event)"
      @select-agent-team-mode="emit('selectAgentTeamMode', $event)"
    />
  </main>
</template>
