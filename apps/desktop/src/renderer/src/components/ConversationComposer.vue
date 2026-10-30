<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type {
  AgentTeamRunMode,
  LibraryAgentDomain,
  LongAgentId,
  ModelConfig,
  ThinkingLevel,
  UserPromptAttachment,
  WorkspaceAgentId
} from "@deepwrite/contracts";
import { maxTextAttachmentCharactersForBudget } from "@deepwrite/contracts/renderer";
import type {
  AgentApprovalMode,
  ChatMessage,
  ComposerReferenceOption,
  EditorTextReference
} from "../types/conversation";
import type { IconName } from "../types/workspace";
import type { ModelSelectOption } from "../utils/modelSelectOptions";
import type { ComposerReferenceTrigger } from "../utils/composerReferences";
import { agentTeamMemberReferences } from "../utils/agentTeamMemberReferences";
import { PROMPT_ATTACHMENT_ACCEPT } from "../utils/promptAttachments";
import { useConversationAttachments } from "../composables/useConversationAttachments";
import { useConversationComposer } from "../composables/useConversationComposer";
import { useAttachmentDrop } from "../composables/useAttachmentDrop";
import { countPendingEditReviews } from "../composables/agent-conversation/pending-review";
import { uiMessage } from "../ui-feedback";
import { useVoiceInput } from "../composables/useVoiceInput";
import { useComposerQueue } from "../composables/useComposerQueue";
import type { FollowUpQueueController } from "../composables/agent-conversation/follow-up-queue";
import { useSettingsStore } from "../stores/settingsStore";
import AppIcon from "./AppIcon.vue";
import PromptAttachmentList from "./PromptAttachmentList.vue";
import AgentTeamModeSelect from "./AgentTeamModeSelect.vue";
import ContextCompactionButton from "./ContextCompactionButton.vue";
import ContextWindowIndicator from "./ContextWindowIndicator.vue";
import ConversationModelConfigSelect from "./ConversationModelConfigSelect.vue";
import PopupSelect from "./PopupSelect.vue";
import ComposerContextBar from "./ComposerContextBar.vue";
import ComposerMoreSettings from "./ComposerMoreSettings.vue";
import ComposerQueuedMessages from "./ComposerQueuedMessages.vue";
import VoiceInputBar from "./VoiceInputBar.vue";

const t = createScopedTranslator("components.conversationComposer");

const settingsStore = useSettingsStore();
const textAttachmentsTotalMaxCharacters = () =>
  maxTextAttachmentCharactersForBudget(
    settingsStore.generalSettings.contextCompaction.budgetTokens
  );
const composerStack = ref<HTMLDivElement>();
const referenceMenuMaxHeight = ref<number>();

const props = defineProps<{
  draft: string;
  responding: boolean;
  canSend: boolean;
  canSendAttachments: boolean;
  canStop: boolean;
  runtimeAvailable: boolean;
  currentSessionId: string;
  messages: ChatMessage[];
  messagesEmpty: boolean;
  bookTitle: string;
  stageLabel: string;
  selectedModelId: string;
  selectedModel: ModelConfig | undefined;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  approvalMode: AgentApprovalMode;
  agentTeamMode: AgentTeamRunMode;
  agentId: WorkspaceAgentId | LongAgentId | undefined;
  agentWorkspaceType: "short" | "script" | "long" | undefined;
  libraryDomain: LibraryAgentDomain | undefined;
  availableSkills: ComposerReferenceOption[];
  availableMaterials: ComposerReferenceOption[];
  editorReferences: EditorTextReference[];
  modelOptions: ModelSelectOption[];
  availableThinkingOptions: Array<{ value: ThinkingLevel; label: string }>;
  webSearchEnabled: boolean;
  webSearchAvailable: boolean;
  webSearchDisabledReason: string;
  showsTemperature: boolean;
  temperatureSelectOptions: Array<{ value: number; label: string }>;
  approvalOptions: Array<{
    value: AgentApprovalMode;
    label: string;
    description: string;
  }>;
  approvalModeIcon: IconName;
  /** Messages typed while the agent works; absent where queueing is off. */
  followUps?: FollowUpQueueController | undefined;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  send: [attachments: UserPromptAttachment[]];
  stop: [];
  clearEditorReferences: [];
  removeEditorReference: [referenceId: string];
  locateEditorReference: [reference: EditorTextReference];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  toggleWebSearch: [enabled: boolean];
  selectTemperature: [temperature: number];
  selectApproval: [mode: AgentApprovalMode];
  selectAgentTeamMode: [mode: AgentTeamRunMode];
}>();

// `#` lists the bound team's members, and only while team mode is on.
const teamMemberOptions = computed(() =>
  props.agentTeamMode === "team" && props.agentWorkspaceType && props.agentId
    ? agentTeamMemberReferences(
        settingsStore.agentTeamCatalog,
        props.agentWorkspaceType,
        props.agentId
      )
    : null
);
const REFERENCE_TRIGGER_ICONS: Record<ComposerReferenceTrigger, IconName> = {
  "/": "sparkles",
  "@": "archive",
  "#": "brain"
};

const closeReferenceMenuHolder = { run() {} };
const {
  attachmentInput,
  pendingAttachments,
  readingAttachments,
  openAttachmentPicker,
  addAttachmentFiles,
  handleAttachmentChange,
  handleComposerPaste,
  removePendingAttachment
} = useConversationAttachments({
  currentSessionId: () => props.currentSessionId,
  closeReferenceMenu: () => closeReferenceMenuHolder.run(),
  textAttachmentMaxCharacters: () =>
    settingsStore.generalSettings.textAttachmentMaxCharacters,
  textAttachmentsTotalMaxCharacters
});
const {
  composerInput,
  activeReference,
  activeReferenceIndex,
  canSubmit,
  hasContent,
  referenceOptions,
  filteredReferenceOptions,
  referenceMenuTitle,
  referenceMenuHint,
  composerPlaceholder,
  updateActiveReference,
  handleInput,
  closeReferenceMenu,
  focusInput,
  selectReference,
  submitMessage,
  handleKeydown
} = useConversationComposer({
  draft: () => props.draft,
  canSend: () => props.canSend,
  canSendAttachments: () => props.canSendAttachments,
  responding: () => props.responding,
  canQueue: () => props.followUps?.canQueue.value ?? false,
  onSubmitBlocked: () => {
    if (blockedByReview.value) notifyReviewBlocked();
  },
  runtimeAvailable: () => props.runtimeAvailable,
  libraryDomain: () => props.libraryDomain,
  availableSkills: () => props.availableSkills,
  availableMaterials: () => props.availableMaterials,
  availableTeamMembers: () => teamMemberOptions.value,
  editorReferences: () => props.editorReferences,
  textAttachmentMaxCharacters: () =>
    settingsStore.generalSettings.textAttachmentMaxCharacters,
  textAttachmentsTotalMaxCharacters,
  contextCompactionBudgetTokens: () =>
    settingsStore.generalSettings.contextCompaction.budgetTokens,
  pendingAttachments,
  readingAttachments,
  emitDraft: (value) => emit("update:draft", value),
  emitSend: (attachments) => emit("send", attachments),
  emitQueue: (attachments) => props.followUps?.enqueue(attachments) ?? false,
  emitClearEditorReferences: () => emit("clearEditorReferences")
});
closeReferenceMenuHolder.run = closeReferenceMenu;
const pendingReviewCount = computed(() =>
  countPendingEditReviews(props.messages)
);
const blockedByReview = computed(
  () =>
    !props.responding &&
    !canSubmit.value &&
    hasContent.value &&
    pendingReviewCount.value > 0
);
const reviewBlockedText = computed(() =>
  t("reviewBlocksSend", { count: pendingReviewCount.value })
);
function notifyReviewBlocked(): void {
  uiMessage.warning(reviewBlockedText.value);
}
const {
  draggingFiles,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop
} = useAttachmentDrop({
  canReceive: () =>
    props.runtimeAvailable &&
    !readingAttachments.value &&
    !(props.responding && !props.followUps),
  addFiles: (files) => addAttachmentFiles(files),
  closeReferenceMenu
});

function updateReferenceMenuHeight(): void {
  if (!activeReference.value || !composerStack.value) return;
  const body = composerStack.value.closest(".conversation-body");
  const bodyTop = body?.getBoundingClientRect().top ?? 0;
  const stackTop = composerStack.value.getBoundingClientRect().top;
  referenceMenuMaxHeight.value = Math.max(
    96,
    Math.floor(stackTop - bodyTop - 16)
  );
}

watch(activeReference, (reference) => {
  if (reference) void nextTick(updateReferenceMenuHeight);
});

onMounted(() => {
  window.addEventListener("resize", updateReferenceMenuHeight);
  window.addEventListener("scroll", updateReferenceMenuHeight, true);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateReferenceMenuHeight);
  window.removeEventListener("scroll", updateReferenceMenuHeight, true);
});

const voice = useVoiceInput({
  sessionKey: () => props.currentSessionId,
  draft: () => props.draft,
  input: composerInput,
  updateDraft: (value) => emit("update:draft", value),
  canStart: () =>
    props.runtimeAvailable && !(props.responding && !props.followUps),
  canSend: () => canSubmit.value && props.runtimeAvailable,
  send: submitMessage
});

// Without a queue the composer keeps waiting for the run, as before.
const lockedWhileRunning = computed(() => props.responding && !props.followUps);
const queue = useComposerQueue({
  draft: () => props.draft,
  emitDraft: (value) => emit("update:draft", value),
  input: composerInput,
  pendingAttachments,
  take: (itemId) => props.followUps?.withdraw(itemId),
  tooManyAttachments: () => t("withdrawTooManyAttachments")
});

function startVoice(): void {
  closeReferenceMenu();
  void voice.start();
}

function editorReferenceTooltip(reference: EditorTextReference): string {
  const preview =
    reference.text.length > 1_000
      ? `${reference.text.slice(0, 1_000)}…`
      : reference.text;
  return t("valueLinesValueValueValue", {
    arg0: reference.documentPath.join(" / "),
    arg1: reference.startLine,
    arg2: reference.endLine,
    arg3: preview
  });
}
function handleApprovalChange(value: string | number): void {
  if (value === "request-approval" || value === "auto-approve")
    emit("selectApproval", value);
}

defineExpose({ focusInput });
</script>

<template>
  <footer
    class="composer-wrap"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div ref="composerStack" class="composer-stack">
      <div
        v-if="activeReference"
        id="composer-reference-menu"
        class="composer-reference-menu"
        role="listbox"
        :aria-label="referenceMenuTitle"
        :style="
          referenceMenuMaxHeight === undefined
            ? undefined
            : { maxHeight: `${referenceMenuMaxHeight}px` }
        "
      >
        <div class="composer-reference-heading">
          <span class="composer-reference-trigger">{{
            activeReference.trigger
          }}</span>
          <div>
            <strong>{{ referenceMenuTitle }}</strong>
            <span>{{ referenceMenuHint }}</span>
          </div>
          <kbd>Esc</kbd>
        </div>
        <div
          v-if="filteredReferenceOptions.length"
          class="composer-reference-options"
        >
          <button
            v-for="(option, index) in filteredReferenceOptions"
            :id="`composer-reference-option-${index}`"
            :key="option.id"
            type="button"
            role="option"
            :aria-selected="index === activeReferenceIndex"
            :class="{ 'is-selected': index === activeReferenceIndex }"
            @mouseenter="activeReferenceIndex = index"
            @mousedown.prevent="selectReference(option)"
          >
            <span class="composer-reference-icon">
              <AppIcon
                :name="REFERENCE_TRIGGER_ICONS[activeReference.trigger]"
                :size="17"
              />
            </span>
            <span class="composer-reference-copy">
              <strong>{{ option.label }}</strong>
              <small>{{ option.detail }}</small>
            </span>
            <span class="composer-reference-token">{{
              activeReference.trigger
            }}</span>
          </button>
        </div>
        <div v-else class="composer-reference-empty">
          {{
            referenceOptions.length
              ? t("noMatchingContent")
              : activeReference.trigger === "/"
                ? t("thisAgentHasNoAvailableSkills")
                : activeReference.trigger === "#"
                  ? t("thisTeamHasNoEnabledMembers")
                  : t("thisAgentHasNoAvailableMaterials")
          }}
        </div>
        <div class="composer-reference-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> {{ t("select") }}</span>
          <span><kbd>Enter</kbd> {{ t("insert") }}</span>
        </div>
      </div>

      <ComposerQueuedMessages
        v-if="followUps?.waitingItems.value.length"
        :items="followUps.waitingItems.value"
        :responding="responding"
        :has-pending-edit-review="followUps.reviewPending.value"
        :can-send-now="followUps.canSendNow.value"
        @withdraw="queue.withdraw"
        @send-now="followUps.sendNow"
      />
      <div class="composer" :class="{ 'is-disabled': lockedWhileRunning }">
        <ComposerContextBar
          v-if="messagesEmpty"
          :book-title="bookTitle"
          :stage-label="stageLabel"
          :responding="responding"
        />
        <div
          class="composer-input-surface"
          :class="{ 'is-file-drag-over': draggingFiles }"
        >
          <div
            v-if="draggingFiles"
            class="composer-file-drop-hint"
            aria-hidden="true"
          >
            <AppIcon name="file" :size="20" />
            <span>{{ t("dropFilesToAttach") }}</span>
          </div>
          <input
            ref="attachmentInput"
            class="composer-file-input"
            type="file"
            multiple
            :accept="PROMPT_ATTACHMENT_ACCEPT"
            tabindex="-1"
            aria-hidden="true"
            @change="handleAttachmentChange"
          />
          <div
            v-if="editorReferences.length"
            class="composer-editor-reference-list"
            :aria-label="t('referencedManuscriptSelections')"
          >
            <div
              v-for="editorReference in editorReferences"
              :key="editorReference.id"
              class="composer-editor-reference"
            >
              <button
                class="composer-editor-reference-main"
                type="button"
                :title="editorReferenceTooltip(editorReference)"
                :aria-label="
                  t('goToValue', {
                    arg0: editorReference.label
                  })
                "
                @click="emit('locateEditorReference', editorReference)"
              >
                <AppIcon name="quote" :size="13" />
                <span>{{ editorReference.label }}</span>
              </button>
              <button
                class="composer-editor-reference-remove"
                type="button"
                :aria-label="
                  t('removeManuscriptReferenceValue', {
                    arg0: editorReference.label
                  })
                "
                @click="emit('removeEditorReference', editorReference.id)"
              >
                <AppIcon name="close" :size="11" />
              </button>
            </div>
          </div>
          <PromptAttachmentList
            :pending-attachments="pendingAttachments"
            :reading-attachments="readingAttachments"
            @remove="removePendingAttachment"
          />
          <textarea
            ref="composerInput"
            :value="draft"
            rows="1"
            :placeholder="composerPlaceholder"
            :aria-label="t('agentMessage')"
            aria-autocomplete="list"
            :aria-expanded="Boolean(activeReference)"
            :aria-controls="
              activeReference ? 'composer-reference-menu' : undefined
            "
            :aria-activedescendant="
              activeReference && filteredReferenceOptions.length
                ? `composer-reference-option-${activeReferenceIndex}`
                : undefined
            "
            :disabled="
              !runtimeAvailable || voice.active.value || lockedWhileRunning
            "
            @blur="closeReferenceMenu"
            @click="updateActiveReference($event.target as HTMLTextAreaElement)"
            @input="handleInput"
            @keydown="handleKeydown"
            @paste="handleComposerPaste"
          />
          <VoiceInputBar
            v-if="voice.active.value"
            :state="voice.state.value"
            :elapsed-ms="voice.elapsedMs.value"
            :levels="voice.levels.value"
            :send-disabled="!runtimeAvailable"
            @cancel="voice.cancel"
            @stop="voice.stop"
            @send="voice.stopAndSend"
            @retry="voice.retry"
          />
          <div v-else class="composer-toolbar">
            <div class="composer-tools">
              <button
                class="round-tool-button"
                type="button"
                :aria-label="t('uploadAttachment')"
                :title="t('uploadTXTMDPDFWordDocxOrImages')"
                :disabled="
                  !runtimeAvailable || readingAttachments || lockedWhileRunning
                "
                @click="openAttachmentPicker"
              >
                <AppIcon name="plus" :size="18" />
              </button>
              <ConversationModelConfigSelect
                :selected-model-id="selectedModelId"
                :model-options="modelOptions"
                :thinking-level="thinkingLevel"
                :thinking-options="availableThinkingOptions"
                :temperature="temperature"
                :temperature-options="temperatureSelectOptions"
                :shows-temperature="showsTemperature"
                :web-search-enabled="webSearchEnabled"
                :web-search-available="webSearchAvailable"
                :web-search-disabled-reason="webSearchDisabledReason"
                :responding="responding"
                @select-model="emit('selectModel', $event)"
                @select-thinking="emit('selectThinking', $event)"
                @select-temperature="emit('selectTemperature', $event)"
                @toggle-web-search="emit('toggleWebSearch', $event)"
              />
            </div>
            <div class="composer-actions">
              <ComposerMoreSettings>
                <ContextWindowIndicator
                  v-if="settingsStore.generalSettings.showContextUsage"
                  :messages="messages"
                  :model="selectedModel"
                />
                <ContextCompactionButton
                  v-if="
                    settingsStore.generalSettings.contextCompaction
                      .showManualButton && !messagesEmpty
                  "
                  :session-id="currentSessionId"
                  :disabled="responding"
                />
                <AgentTeamModeSelect
                  v-if="agentWorkspaceType && agentId"
                  :model-value="agentTeamMode"
                  :workspace-type="agentWorkspaceType"
                  :parent-agent-id="agentId"
                  @update:model-value="emit('selectAgentTeamMode', $event)"
                />
                <PopupSelect
                  :model-value="approvalMode"
                  :options="approvalOptions"
                  :accessible-label="t('selectManuscriptEditingPermission')"
                  variant="compact"
                  align="end"
                  :menu-min-width="300"
                  @update:model-value="handleApprovalChange"
                >
                  <template #prefix
                    ><AppIcon :name="approvalModeIcon" :size="14"
                  /></template>
                </PopupSelect>
              </ComposerMoreSettings>
              <button
                class="round-tool-button"
                type="button"
                :aria-label="t('voiceInput')"
                :title="t('voiceInput')"
                :disabled="!runtimeAvailable || lockedWhileRunning"
                @click="startVoice"
              >
                <AppIcon name="mic" :size="18" />
              </button>
              <button
                v-if="!responding || (followUps && hasContent)"
                class="send-button"
                type="button"
                :class="{ 'is-blocked': blockedByReview }"
                :aria-label="responding ? t('queueMessage') : t('sendMessage')"
                :aria-disabled="!canSubmit"
                :title="
                  blockedByReview
                    ? reviewBlockedText
                    : responding
                      ? t('queueMessage')
                      : undefined
                "
                :disabled="!canSubmit && !blockedByReview"
                @click="
                  blockedByReview ? notifyReviewBlocked() : submitMessage()
                "
              >
                <AppIcon name="arrow-up" :size="18" />
              </button>
              <button
                v-else
                class="send-button stop-button"
                type="button"
                :aria-label="t('stopGeneration')"
                :title="t('stopGeneration')"
                :disabled="!canStop"
                @click="emit('stop')"
              >
                <AppIcon name="stop" :size="15" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </footer>
</template>
