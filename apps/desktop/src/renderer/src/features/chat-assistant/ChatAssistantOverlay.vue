<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
import { computed, nextTick, ref, toRef, watch } from "vue";
import type {
  CatalogIndexSnapshot,
  LongBookSummary
} from "@deepwrite/contracts";
import ChatAssistantProjectConfig from "./ChatAssistantProjectConfig.vue";
import ChatAssistantRoleplayConfig from "./ChatAssistantRoleplayConfig.vue";
import { useChatAssistantWindow } from "./useChatAssistantWindow";
import { projectTypeLabels } from "./chatAssistantProjectOptions";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { useConversationScrollFollow } from "../../composables/useConversationScrollFollow";
import { uiMessage } from "../../ui-feedback";
import { lastAssistantMessage as findLastAssistantMessage } from "../../utils/conversationMessageLookup";
import ConversationMessageList from "../../components/ConversationMessageList.vue";
import type {
  PopupSelectOption,
  PopupSelectValue
} from "../../components/PopupSelect.vue";
import ChatAssistantHeader from "./ChatAssistantHeader.vue";
import ChatAssistantHome from "./ChatAssistantHome.vue";
import ChatAssistantComposer from "./ChatAssistantComposer.vue";
import { useChatAssistantMode } from "./useChatAssistantMode";
import { useChatAssistantHistoryActions } from "./useChatAssistantHistoryActions";
import { useChatAssistantWebSearch } from "./useChatAssistantWebSearch";
import { useWebSearchStatusStore } from "../../stores/webSearchStatus";
import { buildModelSelectOptions } from "../../utils/modelSelectOptions";

const t = createScopedTranslator("extras");

const props = defineProps<{
  active: boolean;
  conversationForKey(key: string, scope?: string): AgentConversationController;
  catalogSnapshot: CatalogIndexSnapshot | null;
  longBooks: readonly LongBookSummary[];
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{ minimize: [] }>();
const assistant = useChatAssistantMode({
  conversationForKey: props.conversationForKey,
  catalogSnapshot: toRef(props, "catalogSnapshot"),
  longBooks: toRef(props, "longBooks")
});
const controller = assistant.controller;
const composer = ref<{ focus(): void } | null>(null);
const projectConfig = ref<InstanceType<
  typeof ChatAssistantProjectConfig
> | null>(null);
const roleplayConfig = ref<InstanceType<
  typeof ChatAssistantRoleplayConfig
> | null>(null);
const { windowStyle, startResize, handleResizeKeydown } =
  useChatAssistantWindow();
const messages = computed(() => controller.value!.messages.value);
const { scroller, handleConversationWheel, handleConversationScroll } =
  useConversationScrollFollow({
    messages: () => messages.value,
    responding: () => controller.value!.isBusy.value,
    currentSessionId: () => controller.value!.sessionId.value
  });
const history = computed(() => controller.value!.history.value);
const currentHistory = computed(() =>
  history.value.find((item) => item.current)
);
const title = computed(
  () => currentHistory.value?.title || t("chatAssistant.newChat")
);
const lastAssistantMessage = computed(() =>
  findLastAssistantMessage(messages.value, true)
);
const selectedModel = computed(() =>
  controller.value!.configuredModels.value.find(
    (model) => model.id === controller.value!.selectedModelId.value
  )
);
const webSearchStatus = useWebSearchStatusStore();
void webSearchStatus.ensureLoaded();
const webSearch = useChatAssistantWebSearch({
  available: computed(() => webSearchStatus.usable)
});
const webSearchDisabledReason = computed(() =>
  t("chatAssistant.webSearchUnavailable")
);
const modelOptions = computed(() =>
  buildModelSelectOptions(controller.value!.configuredModels.value).map(
    (option) => ({
      ...option,
      ...(option.value === controller.value!.selectedModelId.value
        ? { description: t("chatAssistant.currentModel") }
        : {})
    })
  )
);
const thinkingLabels: Record<string, string> = {
  get off() {
    return t("longBookAnalysis.thinkingOff");
  },
  get minimal() {
    return t("longBookAnalysis.minimalThinking");
  },
  get low() {
    return t("longBookAnalysis.lowThinking");
  },
  get medium() {
    return t("longBookAnalysis.mediumThinking");
  },
  get high() {
    return t("longBookAnalysis.highThinking");
  },
  get xhigh() {
    return t("longBookAnalysis.extraHighThinking");
  },
  get max() {
    return t("longBookAnalysis.maxThinking");
  }
};
const thinkingOptions = computed(() => [
  { value: "off", label: t("longBookAnalysis.thinkingOff") },
  ...(
    selectedModel.value?.thinkingLevelOptions ?? [
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ]
  ).map((value) => ({ value, label: thinkingLabels[value] ?? value }))
]);
const canSend = computed(() => controller.value!.canSend.value);
const canStop = computed(() => controller.value!.canStop.value);
const effectiveCanSend = computed(
  () => canSend.value && assistant.chatTask.value !== null
);
const activeContextKey = computed(() =>
  assistant.mode.value === "normal"
    ? "context:normal"
    : assistant.mode.value === "roleplay"
      ? `context:roleplay:${assistant.selectedRoleId.value}`
      : `context:project:${assistant.selectedProjectKey.value}`
);
const contextOptions = computed<PopupSelectOption[]>(() => {
  const options: PopupSelectOption[] = [
    { value: "context:normal", label: t("chatAssistant.normalMode") },
    {
      value: "context:add-roleplay",
      label: t("chatAssistant.addRoleplayOption")
    },
    ...assistant.roleplays.value.map((role) => ({
      value: `context:roleplay:${role.id}`,
      label: role.name,
      description: t("chatAssistant.roleplay"),
      actionIcon: "edit" as const,
      actionLabel: t("chatAssistant.editCharacter", { name: role.name })
    }))
  ];
  if (assistant.configuredProjectOptions.value.length) {
    options.push({
      value: "context:projects",
      label: t("chatAssistant.project"),
      disabled: true,
      style: { fontWeight: "600", color: "var(--text-tertiary)" }
    });
    options.push(
      ...assistant.configuredProjectOptions.value.map((option) => ({
        value: `context:project:${option.key}`,
        label: option.label,
        description: option.available
          ? projectTypeLabels[option.project.projectType]
          : t("chatAssistant.linkedBookUnavailable"),
        ...(option.available
          ? {
              actionIcon: "edit" as const,
              actionLabel: t("chatAssistant.editProjectNamed", {
                name: option.label
              })
            }
          : {}),
        style: { paddingLeft: "22px" }
      }))
    );
  }
  options.push({
    value: "context:add-project",
    label: t("chatAssistant.addProjectOption")
  });
  return options;
});
const emptyHint = computed(() => {
  if (assistant.mode.value === "roleplay")
    return assistant.selectedRole.value
      ? t("chatAssistant.roleplayContext", {
          name: assistant.selectedRole.value.name
        })
      : t("chatAssistant.chooseRoleplayFirst");
  if (assistant.mode.value === "normal") {
    return t("chatAssistant.normalContext");
  }
  if (!assistant.selectedProject.value) return t("chatAssistant.linkBookFirst");
  if (!assistant.projectAvailable.value)
    return t("chatAssistant.projectNotUsable");
  return t("chatAssistant.readOnlyProject", {
    project:
      assistant.selectedProjectOption.value?.label ??
      t("chatAssistant.selectedProject")
  });
});

function focusInput(): void {
  void nextTick(() => composer.value?.focus());
}

function setConversationScroller(element: unknown): void {
  scroller.value = element instanceof HTMLElement ? element : undefined;
}

async function send(): Promise<void> {
  if (!effectiveCanSend.value) return;
  await assistant.sendAssistantMessage(
    webSearch.enabled.value && webSearch.available.value
  );
}

function updateContext(value: PopupSelectValue): void {
  const key = String(value);
  if (key === "context:add-roleplay") {
    roleplayConfig.value?.open();
    return;
  }
  if (key.startsWith("context:roleplay:")) {
    assistant.selectRole(key.slice("context:roleplay:".length));
    return;
  }
  if (key === "context:add-project") {
    projectConfig.value?.openAddProject();
    return;
  }
  if (key === "context:normal") {
    if (!assistant.setMode("normal")) {
      uiMessage.info(t("chatAssistant.waitBeforeContextChange"));
    }
    return;
  }
  const prefix = "context:project:";
  if (!key.startsWith(prefix)) return;
  const projectKey = key.slice(prefix.length);
  if (!assistant.selectProject(projectKey) || !assistant.setMode("project")) {
    uiMessage.info(t("chatAssistant.waitBeforeContextChange"));
  }
}

function editContext(value: PopupSelectValue): void {
  const key = String(value);
  if (key.startsWith("context:roleplay:")) {
    const role = assistant.roleplays.value.find(
      (item) => item.id === key.slice("context:roleplay:".length)
    );
    if (role) roleplayConfig.value?.open(role);
  } else {
    void projectConfig.value?.openEditProject(value);
  }
}

const { newConversation, selectConversation } = useChatAssistantHistoryActions({
  controller: () => controller.value!,
  focusInput
});

async function copyLastReply(): Promise<void> {
  const content = lastAssistantMessage.value?.content.trim();
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
    uiMessage.success(t("chatAssistant.lastReplyCopied"));
  } catch {
    uiMessage.error(t("chatAssistant.copyRetryLater"));
  }
}

watch(
  () => props.active,
  (active) => {
    if (active) focusInput();
  },
  { immediate: true }
);
watch(
  () => controller.value!.conversationError.value,
  (message) => {
    if (message) uiMessage.error(message);
  }
);
watch(
  () => assistant.projectAvailable.value,
  (available, previous) => {
    if (previous && !available && assistant.mode.value === "project") {
      uiMessage.error(t("chatAssistant.reselectProject"));
    }
  }
);
</script>

<template>
  <section
    class="chat-assistant-window"
    :style="windowStyle"
    role="dialog"
    aria-modal="false"
    :aria-label="t('chatAssistant.standaloneAssistant')"
    @keydown.esc.stop.prevent="emit('minimize')"
  >
    <div
      class="chat-assistant-resize-edge is-left"
      role="separator"
      :aria-label="t('chatAssistant.resizeChatWidth')"
      aria-orientation="vertical"
      tabindex="0"
      @pointerdown="startResize($event, 'width')"
      @keydown="handleResizeKeydown($event, 'width')"
    />
    <div
      class="chat-assistant-resize-edge is-top"
      role="separator"
      :aria-label="t('chatAssistant.resizeChatHeight')"
      aria-orientation="horizontal"
      tabindex="0"
      @pointerdown="startResize($event, 'height')"
      @keydown="handleResizeKeydown($event, 'height')"
    />
    <div
      class="chat-assistant-resize-edge is-top-left"
      role="separator"
      :aria-label="t('chatAssistant.resizeChatBoth')"
      tabindex="0"
      @pointerdown="startResize($event, 'both')"
      @keydown="handleResizeKeydown($event, 'both')"
    />
    <ChatAssistantHeader
      :title="title"
      :active-context-key="activeContextKey"
      :context-options="contextOptions"
      :context-disabled="
        assistant.isBusy.value ||
        Boolean(projectConfig?.pending) ||
        Boolean(roleplayConfig?.pending)
      "
      :history="history"
      :session-id="controller.sessionId.value"
      :busy="controller.isBusy.value"
      :can-copy="Boolean(lastAssistantMessage)"
      @update-context="updateContext"
      @edit-project="editContext"
      @select-conversation="selectConversation"
      @new-conversation="newConversation"
      @copy-last-reply="copyLastReply"
      @minimize="emit('minimize')"
    />

    <ConversationMessageList
      class="chat-assistant-content"
      :messages="messages"
      :responding="controller.isBusy.value"
      :runtime-available="runtimeAvailable"
      :set-scroller="setConversationScroller"
      :handle-conversation-wheel="handleConversationWheel"
      :handle-conversation-scroll="handleConversationScroll"
    >
      <template #empty>
        <div class="chat-assistant-home-wrap">
          <ChatAssistantHome
            :history="history"
            :empty-hint="emptyHint"
            @select-conversation="selectConversation"
          />
        </div>
      </template>
    </ConversationMessageList>

    <ChatAssistantComposer
      ref="composer"
      :session-id="controller.sessionId.value"
      :has-history="controller.messages.value.length > 0"
      :draft="controller.draft.value"
      :runtime-available="runtimeAvailable"
      :busy="controller.isBusy.value"
      :can-send="effectiveCanSend"
      :can-stop="canStop"
      :selected-model-id="controller.selectedModelId.value"
      :model-options="modelOptions"
      :thinking-level="controller.thinkingLevel.value"
      :thinking-options="thinkingOptions"
      :web-search-visible="assistant.mode.value !== 'roleplay'"
      :web-search-enabled="
        assistant.mode.value !== 'roleplay' && webSearch.enabled.value
      "
      :web-search-available="webSearch.available.value"
      :web-search-disabled-reason="webSearchDisabledReason"
      @update:draft="controller.draft.value = $event"
      @send="send"
      @stop="controller.stopGeneration()"
      @select-model="controller.selectModel($event)"
      @select-thinking="controller.selectThinkingLevel($event)"
      @toggle-web-search="webSearch.setEnabled($event)"
    />

    <ChatAssistantProjectConfig ref="projectConfig" :assistant="assistant" />
    <ChatAssistantRoleplayConfig ref="roleplayConfig" :assistant="assistant" />
  </section>
</template>

<style scoped>
.chat-assistant-window {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 90;
  width: min(44vw, calc(100vw - 40px));
  min-width: 480px;
  max-width: calc(100vw - 40px);
  height: min(88vh, calc(100vh - 40px));
  min-height: 420px;
  max-height: calc(100vh - 40px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
  border-radius: 28px;
  box-shadow: 0 24px 70px color-mix(in srgb, #000 20%, transparent);
}
.chat-assistant-resize-edge {
  position: absolute;
  z-index: 3;
  outline: 0;
}
.chat-assistant-resize-edge.is-left {
  top: 20px;
  bottom: 20px;
  left: 0;
  width: 8px;
  cursor: ew-resize;
}
.chat-assistant-resize-edge.is-top {
  top: 0;
  right: 20px;
  left: 20px;
  height: 8px;
  cursor: ns-resize;
}
.chat-assistant-resize-edge.is-top-left {
  top: 0;
  left: 0;
  z-index: 4;
  width: 24px;
  height: 24px;
  cursor: nwse-resize;
}
.chat-assistant-resize-edge:focus-visible {
  background: var(--accent-soft);
}
.chat-assistant-content {
  min-height: 0;
  padding: 0;
}
.chat-assistant-content :deep(.message-list) {
  width: min(720px, calc(100% - 36px));
  padding: 28px 0 48px;
}
.chat-assistant-home-wrap {
  display: grid;
  width: min(720px, calc(100% - 60px));
  height: 100%;
  min-height: 100%;
  margin: 0 auto;
  padding: 22px 0;
  box-sizing: border-box;
}
@media (max-width: 760px) {
  .chat-assistant-window {
    inset: 12px;
    width: auto;
    min-width: 0;
    max-width: none;
    height: auto;
    min-height: 0;
    max-height: none;
    border-radius: 22px;
  }
  .chat-assistant-resize-edge {
    display: none;
  }
  .chat-assistant-content :deep(.message-list),
  .chat-assistant-home-wrap {
    width: calc(100% - 32px);
  }
}
</style>
