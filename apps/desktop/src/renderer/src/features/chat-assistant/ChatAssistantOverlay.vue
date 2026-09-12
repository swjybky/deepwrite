<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRef,
  watch,
  type CSSProperties
} from "vue";
import {
  CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH,
  type CatalogIndexSnapshot,
  type ChatAssistantProjectRef,
  type LongBookSummary
} from "@deepwrite/contracts";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { useConversationScrollFollow } from "../../composables/useConversationScrollFollow";
import { uiMessage } from "../../ui-feedback";
import { lastAssistantMessage as findLastAssistantMessage } from "../../utils/conversationMessageLookup";
import ConversationMessageList from "../../components/ConversationMessageList.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "../../components/PopupSelect.vue";
import ChatAssistantHeader from "./ChatAssistantHeader.vue";
import ChatAssistantHome from "./ChatAssistantHome.vue";
import ChatAssistantComposer from "./ChatAssistantComposer.vue";
import {
  useChatAssistantMode,
  type ChatAssistantProjectOption
} from "./useChatAssistantMode";
import { useChatAssistantHistoryActions } from "./useChatAssistantHistoryActions";
import { useChatAssistantWebSearch } from "./useChatAssistantWebSearch";

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
const SIZE_STORAGE_KEY = "deepwrite:chat-assistant-size:v2";
const DESKTOP_BREAKPOINT = 760;
const WINDOW_MARGIN = 20;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 420;

interface ChatAssistantSize {
  width: number;
  height: number;
}

type ResizeAxis = "width" | "height" | "both";

interface ResizeSession extends ChatAssistantSize {
  pointerId: number;
  startX: number;
  startY: number;
  axis: ResizeAxis;
}

const composer = ref<{ focus(): void } | null>(null);
const viewportWidth = ref(
  typeof window === "undefined" ? 1440 : window.innerWidth
);
const viewportHeight = ref(
  typeof window === "undefined" ? 900 : window.innerHeight
);
const resizeSession = ref<ResizeSession | null>(null);
const projectConfigOpen = ref(false);
const projectConfigMode = ref<"add" | "edit">("add");
const projectConfigProjectKey = ref("");
const projectConfigPrompt = ref("");
const projectConfigCustomized = ref(false);
const projectConfigPending = ref(false);
let previousUserSelect = "";
let previousCursor = "";

function defaultSize(): ChatAssistantSize {
  return {
    width: Math.round(viewportWidth.value * 0.44),
    height: Math.round(viewportHeight.value * 0.88)
  };
}

function clampSize(size: ChatAssistantSize): ChatAssistantSize {
  const maxWidth = Math.max(1, viewportWidth.value - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(1, viewportHeight.value - WINDOW_MARGIN * 2);
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_HEIGHT, maxHeight);
  return {
    width: Math.round(Math.min(maxWidth, Math.max(minWidth, size.width))),
    height: Math.round(Math.min(maxHeight, Math.max(minHeight, size.height)))
  };
}

function readStoredSize(): ChatAssistantSize {
  if (typeof window === "undefined") return clampSize(defaultSize());
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(SIZE_STORAGE_KEY) ?? "null"
    ) as Partial<ChatAssistantSize> | null;
    if (Number.isFinite(stored?.width) && Number.isFinite(stored?.height)) {
      return clampSize({
        width: Number(stored?.width),
        height: Number(stored?.height)
      });
    }
  } catch {
    // Ignore malformed local UI preferences and fall back to the responsive default.
  }
  return clampSize(defaultSize());
}

const windowSize = ref<ChatAssistantSize>(readStoredSize());
const windowStyle = computed<CSSProperties>(() =>
  viewportWidth.value <= DESKTOP_BREAKPOINT
    ? {}
    : {
        width: `${windowSize.value.width}px`,
        height: `${windowSize.value.height}px`
      }
);
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
const title = computed(() => currentHistory.value?.title || "新聊天");
const lastAssistantMessage = computed(() =>
  findLastAssistantMessage(messages.value, true)
);
const selectedModel = computed(() =>
  controller.value!.configuredModels.value.find(
    (model) => model.id === controller.value!.selectedModelId.value
  )
);
const webSearch = useChatAssistantWebSearch({
  selectedModel,
  onAutomaticallyDisabled: () => {
    uiMessage.info(
      "智能搜索已关闭：仅 DeepSeek 的 Responses 或 Anthropic API 模型支持此功能"
    );
  }
});
const webSearchDisabledReason =
  "仅支持 Provider 为 DeepSeek，且 API 类型为 OpenAI Responses 或 Anthropic Messages 的模型";
const modelOptions = computed(() =>
  controller.value!.configuredModels.value.map((model) => ({
    value: model.id,
    label: model.label,
    ...(model.id === controller.value!.selectedModelId.value
      ? { description: "当前模型" }
      : {})
  }))
);
const thinkingLabels: Record<string, string> = {
  off: "关闭",
  minimal: "最低",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "极高",
  max: "最高"
};
const thinkingOptions = computed(() => [
  { value: "off", label: "关闭" },
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
  () => canSend.value && assistant.requestContext.value !== null
);
const projectTypeLabels = {
  short: "短篇",
  script: "剧本",
  long: "长篇"
} as const;
function groupedProjectOptions(
  candidates: readonly ChatAssistantProjectOption[]
): PopupSelectOption[] {
  const options: PopupSelectOption[] = [];
  for (const type of ["short", "script", "long"] as const) {
    const projects = candidates.filter(
      (option) => option.project.projectType === type
    );
    if (!projects.length) continue;
    options.push({
      value: `group:${type}`,
      label: projectTypeLabels[type],
      disabled: true,
      style: { fontWeight: "600", color: "var(--text-tertiary)" }
    });
    options.push(
      ...projects.map((option) => ({
        value: option.key,
        label: option.label,
        description: projectTypeLabels[type],
        style: { paddingLeft: "22px" }
      }))
    );
  }
  return options;
}
const configuredProjectKeys = computed(
  () =>
    new Set(
      assistant.configuredProjects.value.map(
        (project) => `${project.projectType}:${project.projectId}`
      )
    )
);
const availableProjectOptions = computed(() =>
  assistant.projectOptions.value.filter(
    (option) => !configuredProjectKeys.value.has(option.key)
  )
);
const projectBookOptions = computed<PopupSelectOption[]>(() => {
  if (projectConfigMode.value === "edit") {
    const selected = assistant.projectOptions.value.filter(
      (option) => option.key === projectConfigProjectKey.value
    );
    return groupedProjectOptions(selected);
  }
  return groupedProjectOptions(availableProjectOptions.value);
});
const activeContextKey = computed(() =>
  assistant.mode.value === "normal"
    ? "context:normal"
    : `context:project:${assistant.selectedProjectKey.value}`
);
const contextOptions = computed<PopupSelectOption[]>(() => {
  const options: PopupSelectOption[] = [
    { value: "context:normal", label: "普通模式" }
  ];
  if (assistant.configuredProjectOptions.value.length) {
    options.push({
      value: "context:projects",
      label: "项目",
      disabled: true,
      style: { fontWeight: "600", color: "var(--text-tertiary)" }
    });
    options.push(
      ...assistant.configuredProjectOptions.value.map((option) => ({
        value: `context:project:${option.key}`,
        label: option.label,
        description: option.available
          ? projectTypeLabels[option.project.projectType]
          : "关联书籍不可用",
        ...(option.available
          ? {
              actionIcon: "edit" as const,
              actionLabel: `编辑项目：${option.label}`
            }
          : {}),
        style: { paddingLeft: "22px" }
      }))
    );
  }
  options.push({
    value: "context:add-project",
    label: "+ 添加新项目配置"
  });
  return options;
});
const projectConfigOption = computed(
  () =>
    assistant.projectOptions.value.find(
      ({ key }) => key === projectConfigProjectKey.value
    ) ?? null
);
const projectConfigTitle = computed(() =>
  projectConfigMode.value === "add" ? "添加项目" : "编辑项目"
);
const emptyHint = computed(() => {
  if (assistant.mode.value === "normal") {
    return "可查询创作空间目录、资料库、技能库、模型配置和用量，不读取正文。";
  }
  if (!assistant.selectedProject.value)
    return "请添加项目并关联一本书籍后开始聊天。";
  if (!assistant.projectAvailable.value)
    return "所选项目已不存在或暂时不可用，当前无法发送。";
  return `当前只读查询：${assistant.selectedProjectOption.value?.label ?? "所选项目"}`;
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
  if (key === "context:add-project") {
    openAddProject();
    return;
  }
  if (key === "context:normal") {
    if (!assistant.setMode("normal")) {
      uiMessage.info("当前回复完成或停止后，才能切换聊天上下文");
    }
    return;
  }
  const prefix = "context:project:";
  if (!key.startsWith(prefix)) return;
  const projectKey = key.slice(prefix.length);
  if (!assistant.selectProject(projectKey) || !assistant.setMode("project")) {
    uiMessage.info("当前回复完成或停止后，才能切换聊天上下文");
  }
}

async function loadProjectConfigFor(
  project: ChatAssistantProjectRef
): Promise<void> {
  projectConfigPending.value = true;
  try {
    const config = await assistant.loadProjectConfig(project);
    projectConfigPrompt.value = config.systemPrompt;
    projectConfigCustomized.value = config.customized;
  } catch (cause) {
    uiMessage.error(
      cause instanceof Error ? cause.message : "读取项目配置失败"
    );
  } finally {
    projectConfigPending.value = false;
  }
}

function openAddProject(): void {
  if (!availableProjectOptions.value.length) {
    uiMessage.info(
      assistant.projectOptions.value.length
        ? "当前书籍都已添加为聊天项目"
        : "当前没有可关联的短篇、剧本或长篇书籍"
    );
    return;
  }
  projectConfigMode.value = "add";
  projectConfigProjectKey.value = "";
  projectConfigPrompt.value = "";
  projectConfigCustomized.value = false;
  projectConfigOpen.value = true;
}

async function openEditProject(value: PopupSelectValue): Promise<void> {
  const contextKey = String(value);
  const prefix = "context:project:";
  if (!contextKey.startsWith(prefix)) return;
  const projectKey = contextKey.slice(prefix.length);
  const option = assistant.configuredProjectOptions.value.find(
    (candidate) => candidate.key === projectKey
  );
  if (!option?.available) {
    uiMessage.info("当前没有可编辑的关联项目");
    return;
  }
  projectConfigMode.value = "edit";
  projectConfigProjectKey.value = projectKey;
  projectConfigPrompt.value = "";
  projectConfigCustomized.value = false;
  projectConfigOpen.value = true;
  await loadProjectConfigFor(option.project);
}

function updateProjectAssociation(value: PopupSelectValue): void {
  if (projectConfigMode.value !== "add" || projectConfigPending.value) return;
  const key = String(value);
  const option = assistant.projectOptions.value.find(
    (candidate) => candidate.key === key
  );
  if (!option) return;
  projectConfigProjectKey.value = key;
  void loadProjectConfigFor(option.project);
}

async function saveProjectConfig(): Promise<void> {
  const option = projectConfigOption.value;
  if (!option) {
    uiMessage.warning("请选择要关联的书籍");
    return;
  }
  const prompt = projectConfigPrompt.value.trim();
  if (!prompt) {
    uiMessage.warning("项目提示词不能为空");
    return;
  }
  if (prompt.length > CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH) {
    uiMessage.warning(
      `项目提示词不能超过 ${CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH} 个字符`
    );
    return;
  }
  projectConfigPending.value = true;
  try {
    const config = await assistant.saveProjectConfig(prompt, option.project);
    projectConfigPrompt.value = config.systemPrompt;
    projectConfigCustomized.value = config.customized;
    if (projectConfigMode.value === "add") {
      await assistant.refreshConfiguredProjects();
      assistant.selectProject(option.key);
      assistant.setMode("project");
    }
    projectConfigOpen.value = false;
    uiMessage.success(
      projectConfigMode.value === "add" ? "项目已添加" : "项目配置已保存"
    );
  } catch (cause) {
    uiMessage.error(
      cause instanceof Error ? cause.message : "保存项目配置失败"
    );
  } finally {
    projectConfigPending.value = false;
  }
}

async function resetProjectConfig(): Promise<void> {
  const option = projectConfigOption.value;
  if (!option) {
    uiMessage.warning("请先选择关联书籍");
    return;
  }
  projectConfigPending.value = true;
  try {
    const config = await assistant.resetProjectConfig(option.project);
    projectConfigPrompt.value = config.systemPrompt;
    projectConfigCustomized.value = config.customized;
    uiMessage.success("已恢复默认项目提示词");
  } catch (cause) {
    uiMessage.error(
      cause instanceof Error ? cause.message : "恢复默认配置失败"
    );
  } finally {
    projectConfigPending.value = false;
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
    uiMessage.success("已复制最后一条回复");
  } catch {
    uiMessage.error("复制失败，请稍后重试");
  }
}

function persistSize(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SIZE_STORAGE_KEY,
      JSON.stringify(windowSize.value)
    );
  } catch {
    // A blocked storage API should not prevent resizing for the current session.
  }
}

function stopResize(): void {
  if (!resizeSession.value) return;
  resizeSession.value = null;
  window.removeEventListener("pointermove", handleResizeMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
  document.body.style.userSelect = previousUserSelect;
  document.body.style.cursor = previousCursor;
  persistSize();
}

function handleResizeMove(event: PointerEvent): void {
  const session = resizeSession.value;
  if (!session || event.pointerId !== session.pointerId) return;
  windowSize.value = clampSize({
    width:
      session.axis === "height"
        ? session.width
        : session.width + session.startX - event.clientX,
    height:
      session.axis === "width"
        ? session.height
        : session.height + session.startY - event.clientY
  });
}

function startResize(event: PointerEvent, axis: ResizeAxis): void {
  if (viewportWidth.value <= DESKTOP_BREAKPOINT || event.button !== 0) return;
  event.preventDefault();
  resizeSession.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    axis,
    ...windowSize.value
  };
  previousUserSelect = document.body.style.userSelect;
  previousCursor = document.body.style.cursor;
  document.body.style.userSelect = "none";
  document.body.style.cursor =
    axis === "width"
      ? "ew-resize"
      : axis === "height"
        ? "ns-resize"
        : "nwse-resize";
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
}

function handleResizeKeydown(event: KeyboardEvent, axis: ResizeAxis): void {
  if (viewportWidth.value <= DESKTOP_BREAKPOINT) return;
  const step = event.shiftKey ? 32 : 16;
  let nextSize: ChatAssistantSize | null = null;
  if (event.key === "ArrowLeft" && axis !== "height") {
    nextSize = { ...windowSize.value, width: windowSize.value.width + step };
  } else if (event.key === "ArrowRight" && axis !== "height") {
    nextSize = { ...windowSize.value, width: windowSize.value.width - step };
  } else if (event.key === "ArrowUp" && axis !== "width") {
    nextSize = { ...windowSize.value, height: windowSize.value.height + step };
  } else if (event.key === "ArrowDown" && axis !== "width") {
    nextSize = { ...windowSize.value, height: windowSize.value.height - step };
  }
  if (!nextSize) return;
  event.preventDefault();
  windowSize.value = clampSize(nextSize);
  persistSize();
}

function handleViewportResize(): void {
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
  windowSize.value = clampSize(windowSize.value);
}

onMounted(() => {
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
  windowSize.value = readStoredSize();
  window.addEventListener("resize", handleViewportResize);
});

onBeforeUnmount(() => {
  stopResize();
  window.removeEventListener("resize", handleViewportResize);
});

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
      uiMessage.error("所选项目已删除或不可用，请重新选择项目");
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
    aria-label="独立聊天助手"
    @keydown.esc.stop.prevent="emit('minimize')"
  >
    <div
      class="chat-assistant-resize-edge is-left"
      role="separator"
      aria-label="调整聊天窗口宽度"
      aria-orientation="vertical"
      tabindex="0"
      @pointerdown="startResize($event, 'width')"
      @keydown="handleResizeKeydown($event, 'width')"
    />
    <div
      class="chat-assistant-resize-edge is-top"
      role="separator"
      aria-label="调整聊天窗口高度"
      aria-orientation="horizontal"
      tabindex="0"
      @pointerdown="startResize($event, 'height')"
      @keydown="handleResizeKeydown($event, 'height')"
    />
    <div
      class="chat-assistant-resize-edge is-top-left"
      role="separator"
      aria-label="同时调整聊天窗口宽高"
      tabindex="0"
      @pointerdown="startResize($event, 'both')"
      @keydown="handleResizeKeydown($event, 'both')"
    />
    <ChatAssistantHeader
      :title="title"
      :active-context-key="activeContextKey"
      :context-options="contextOptions"
      :context-disabled="assistant.isBusy.value || projectConfigPending"
      :history="history"
      :session-id="controller.sessionId.value"
      :busy="controller.isBusy.value"
      :can-copy="Boolean(lastAssistantMessage)"
      @update-context="updateContext"
      @edit-project="openEditProject"
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
      :draft="controller.draft.value"
      :runtime-available="runtimeAvailable"
      :busy="controller.isBusy.value"
      :can-send="effectiveCanSend"
      :can-stop="canStop"
      :selected-model-id="controller.selectedModelId.value"
      :model-options="modelOptions"
      :thinking-level="controller.thinkingLevel.value"
      :thinking-options="thinkingOptions"
      :web-search-enabled="webSearch.enabled.value"
      :web-search-available="webSearch.available.value"
      :web-search-disabled-reason="webSearchDisabledReason"
      @update:draft="controller.draft.value = $event"
      @send="send"
      @stop="controller.stopGeneration()"
      @select-model="controller.selectModel($event)"
      @select-thinking="controller.selectThinkingLevel($event)"
      @toggle-web-search="webSearch.setEnabled($event)"
    />

    <div
      v-if="projectConfigOpen"
      class="chat-assistant-config-backdrop"
      @mousedown.self="!projectConfigPending && (projectConfigOpen = false)"
      @keydown.esc.stop.prevent="
        !projectConfigPending && (projectConfigOpen = false)
      "
    >
      <section
        class="chat-assistant-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="项目配置"
      >
        <header>
          <div>
            <strong>{{ projectConfigTitle }}</strong>
            <span>配置项目提示词和关联书籍</span>
          </div>
          <button
            type="button"
            aria-label="关闭项目配置"
            :disabled="projectConfigPending"
            @click="projectConfigOpen = false"
          >
            ×
          </button>
        </header>
        <label for="chat-assistant-project-book">关联书籍</label>
        <PopupSelect
          id="chat-assistant-project-book"
          :model-value="projectConfigProjectKey"
          :options="projectBookOptions"
          accessible-label="关联书籍"
          placeholder="选择短篇、剧本或长篇书籍"
          :disabled="projectConfigMode === 'edit' || projectConfigPending"
          :menu-min-width="320"
          :menu-z-index="130"
          @update:model-value="updateProjectAssociation"
        />
        <p class="chat-assistant-project-lock-hint">
          {{
            projectConfigMode === "edit"
              ? "关联书籍已锁定，不可更换；后续项目记忆将始终归属这本书。"
              : "书籍关联在项目保存后锁定，后续不可更换。"
          }}
        </p>
        <label for="chat-assistant-project-prompt">项目提示词</label>
        <textarea
          id="chat-assistant-project-prompt"
          v-model="projectConfigPrompt"
          :maxlength="CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH"
          :disabled="projectConfigPending || !projectConfigOption"
          rows="10"
        />
        <div class="chat-assistant-config-meta">
          <span>{{
            projectConfigCustomized
              ? "当前使用自定义提示词"
              : "当前使用默认提示词"
          }}</span>
          <span
            >{{ projectConfigPrompt.length }} /
            {{ CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH }}</span
          >
        </div>
        <p>此内容会追加到固定系统底座，不能覆盖只读、脱敏或工具边界。</p>
        <footer>
          <button
            type="button"
            class="is-secondary"
            :disabled="projectConfigPending || !projectConfigOption"
            @click="resetProjectConfig"
          >
            恢复默认
          </button>
          <span />
          <button
            type="button"
            class="is-secondary"
            :disabled="projectConfigPending"
            @click="projectConfigOpen = false"
          >
            取消
          </button>
          <button
            type="button"
            class="is-primary"
            :disabled="projectConfigPending || !projectConfigOption"
            @click="saveProjectConfig"
          >
            保存
          </button>
        </footer>
      </section>
    </div>
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
.chat-assistant-config-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, #000 35%, transparent);
}
.chat-assistant-config-dialog {
  width: min(620px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 40px));
  overflow: auto;
  padding: 22px;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 1px solid var(--theme-line);
  border-radius: 18px;
  box-shadow: 0 24px 70px color-mix(in srgb, #000 28%, transparent);
}
.chat-assistant-config-dialog > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.chat-assistant-config-dialog > header > div {
  display: grid;
  gap: 4px;
}
.chat-assistant-config-dialog > header span,
.chat-assistant-config-dialog > p,
.chat-assistant-config-meta {
  color: var(--text-tertiary);
  font-size: 0.82rem;
}
.chat-assistant-config-dialog > header button {
  width: 32px;
  height: 32px;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  border-radius: 9px;
  font-size: 1.35rem;
}
.chat-assistant-config-dialog > header button:hover {
  background: var(--surface-hover);
}
.chat-assistant-config-dialog > label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary);
}
.chat-assistant-project-lock-hint {
  margin: 8px 0 18px !important;
}
.chat-assistant-config-dialog > textarea {
  width: 100%;
  min-height: 240px;
  resize: vertical;
  padding: 12px 14px;
  color: var(--text-primary);
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
  border-radius: 12px;
  outline: 0;
  font: inherit;
  line-height: 1.6;
}
.chat-assistant-config-dialog > textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.chat-assistant-config-meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 7px;
}
.chat-assistant-config-dialog > p {
  margin: 14px 0 0;
  line-height: 1.5;
}
.chat-assistant-config-dialog > footer {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 20px;
}
.chat-assistant-config-dialog > footer > span {
  flex: 1;
}
.chat-assistant-config-dialog > footer button {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  font: inherit;
}
.chat-assistant-config-dialog > footer .is-secondary {
  color: var(--text-secondary);
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
}
.chat-assistant-config-dialog > footer .is-primary {
  color: var(--surface-main);
  background: var(--text-primary);
  border: 1px solid var(--text-primary);
}
.chat-assistant-config-dialog > footer button:disabled {
  opacity: 0.45;
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
