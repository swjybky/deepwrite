<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
import { computed, ref } from "vue";
import {
  maxTextAttachmentCharactersForBudget,
  type ThinkingLevel,
  type UserPromptAttachment
} from "@deepwrite/contracts/renderer";
import { useConversationAttachments } from "../../composables/useConversationAttachments";
import { useAttachmentDrop } from "../../composables/useAttachmentDrop";
import { PROMPT_ATTACHMENT_ACCEPT } from "../../utils/promptAttachments";
import { conversationPromptError } from "../../utils/conversationPromptBudget";
import { uiMessage } from "../../ui-feedback";
import PromptAttachmentList from "../../components/PromptAttachmentList.vue";
import ContextCompactionButton from "../../components/ContextCompactionButton.vue";
import VoiceInputBar from "../../components/VoiceInputBar.vue";
import { useVoiceInput } from "../../composables/useVoiceInput";
import { useSettingsStore } from "../../stores/settingsStore";
import AppIcon from "../../components/AppIcon.vue";
import ConversationModelConfigSelect from "../../components/ConversationModelConfigSelect.vue";
import type { ModelSelectOption } from "../../utils/modelSelectOptions";

const t = createScopedTranslator("extras");
const attachmentT = createScopedTranslator("components.conversationComposer");

const settingsStore = useSettingsStore();

const props = defineProps<{
  sessionId?: string;
  hasHistory?: boolean;
  draft: string;
  runtimeAvailable: boolean;
  busy: boolean;
  canSend: boolean;
  canSendAttachments: boolean;
  canStop: boolean;
  selectedModelId: string;
  modelOptions: ModelSelectOption[];
  thinkingLevel: ThinkingLevel;
  thinkingOptions: Array<{ value: ThinkingLevel; label: string }>;
  temperature: number;
  temperatureOptions: Array<{ value: number; label: string }>;
  showsTemperature: boolean;
  webSearchVisible?: boolean;
  webSearchEnabled: boolean;
  webSearchAvailable: boolean;
  webSearchDisabledReason: string;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  send: [attachments: UserPromptAttachment[]];
  stop: [];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  selectTemperature: [temperature: number];
  toggleWebSearch: [enabled: boolean];
}>();

const input = ref<HTMLTextAreaElement | null>(null);
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
  currentSessionId: () => props.sessionId ?? "",
  closeReferenceMenu: () => {},
  textAttachmentMaxCharacters: () =>
    settingsStore.generalSettings.textAttachmentMaxCharacters,
  textAttachmentsTotalMaxCharacters: () =>
    maxTextAttachmentCharactersForBudget(
      settingsStore.generalSettings.contextCompaction.budgetTokens
    )
});
const canSubmit = computed(
  () =>
    props.runtimeAvailable &&
    !props.busy &&
    !readingAttachments.value &&
    (props.canSend ||
      (props.canSendAttachments && pendingAttachments.value.length > 0))
);
const {
  draggingFiles,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop
} = useAttachmentDrop({
  canReceive: () =>
    props.runtimeAvailable && !props.busy && !readingAttachments.value,
  addFiles: addAttachmentFiles,
  closeReferenceMenu: () => {}
});
function submit(): void {
  if (!canSubmit.value) return;
  const attachments = pendingAttachments.value.map((attachment) => ({
    ...attachment
  }));
  const error = conversationPromptError(
    props.draft,
    settingsStore.generalSettings.contextCompaction.budgetTokens,
    attachments
  );
  if (error) {
    uiMessage.warning(error);
    return;
  }
  pendingAttachments.value = [];
  emit("send", attachments);
}
function paste(event: ClipboardEvent): void {
  if (props.runtimeAvailable && !props.busy) handleComposerPaste(event);
}
const voice = useVoiceInput({
  sessionKey: () => props.sessionId ?? "",
  draft: () => props.draft,
  input,
  updateDraft: (value) => emit("update:draft", value),
  canStart: () => props.runtimeAvailable && !props.busy,
  canSend: () => canSubmit.value,
  send: submit
});

function focus(): void {
  input.value?.focus();
}

function handleInput(event: Event): void {
  emit("update:draft", (event.target as HTMLTextAreaElement).value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!voice.active.value) submit();
}

defineExpose({ focus });
</script>

<template>
  <footer
    class="chat-assistant-composer"
    :class="{ 'is-file-drag-over': draggingFiles }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
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
    <PromptAttachmentList
      :pending-attachments="pendingAttachments"
      :reading-attachments="readingAttachments"
      @remove="removePendingAttachment"
    />
    <textarea
      ref="input"
      :value="draft"
      :placeholder="
        runtimeAvailable
          ? t('chatAssistant.messageAssistant')
          : t('chatAssistant.desktopRequiredToSend')
      "
      :disabled="!runtimeAvailable || busy || voice.active.value"
      rows="1"
      @input="handleInput"
      @keydown="handleKeydown"
      @paste="paste"
    />
    <VoiceInputBar
      v-if="voice.active.value"
      :state="voice.state.value"
      :elapsed-ms="voice.elapsedMs.value"
      :levels="voice.levels.value"
      :send-disabled="busy || !runtimeAvailable"
      @cancel="voice.cancel"
      @stop="voice.stop"
      @send="voice.stopAndSend"
      @retry="voice.retry"
    />
    <div v-else class="chat-assistant-toolbar">
      <button
        class="chat-assistant-placeholder-action"
        type="button"
        :disabled="!runtimeAvailable || busy || readingAttachments"
        :title="attachmentT('uploadTXTMDPDFWordDocxOrImages')"
        :aria-label="attachmentT('uploadAttachment')"
        @click="openAttachmentPicker"
      >
        <AppIcon name="plus" :size="19" />
      </button>
      <ConversationModelConfigSelect
        :selected-model-id="selectedModelId"
        :model-options="modelOptions"
        :thinking-level="thinkingLevel"
        :thinking-options="thinkingOptions"
        :temperature="temperature"
        :temperature-options="temperatureOptions"
        :shows-temperature="showsTemperature"
        :web-search-enabled="webSearchEnabled"
        :web-search-available="webSearchAvailable"
        :web-search-disabled-reason="webSearchDisabledReason"
        :hides-web-search="webSearchVisible === false"
        :responding="busy"
        @select-model="emit('selectModel', $event)"
        @select-thinking="emit('selectThinking', $event)"
        @select-temperature="emit('selectTemperature', $event)"
        @toggle-web-search="emit('toggleWebSearch', $event)"
      />
      <ContextCompactionButton
        v-if="
          settingsStore.generalSettings.contextCompaction.showManualButton &&
          sessionId &&
          hasHistory
        "
        :session-id="sessionId"
        :disabled="busy || !runtimeAvailable"
      />
      <span class="chat-assistant-toolbar-spacer" />
      <button
        class="chat-assistant-placeholder-action"
        type="button"
        :disabled="!runtimeAvailable || busy"
        :title="t('chatAssistant.voiceInput')"
        :aria-label="t('chatAssistant.voiceInput')"
        @click="voice.start"
      >
        <AppIcon name="mic" :size="18" />
      </button>
      <button
        v-if="canStop"
        class="chat-assistant-send is-stop"
        type="button"
        :aria-label="t('chatAssistant.stopGeneration')"
        @click="emit('stop')"
      >
        <AppIcon name="stop" :size="15" />
      </button>
      <button
        v-else
        class="chat-assistant-send"
        type="button"
        :aria-label="t('chatAssistant.sendMessage')"
        :disabled="!canSubmit"
        @click="submit"
      >
        <AppIcon name="arrow-up" :size="19" />
      </button>
    </div>
  </footer>
</template>

<style scoped src="./chat-assistant-composer.css"></style>
