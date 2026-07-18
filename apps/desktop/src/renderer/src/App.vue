<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { NConfigProvider } from "naive-ui";
import type {
  ModelSettings,
  ModelSettingsInput,
  ShortWorkspaceAgentSettings,
  ShortWorkspaceAgentSettingsInput,
  SystemEventEnvelope,
  ThinkingLevel
} from "@deepwrite/contracts";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  resolveShortWorkspaceAgentIdForStage
} from "@deepwrite/contracts";
import AgentConversation from "./components/AgentConversation.vue";
import LeftSidebar from "./components/LeftSidebar.vue";
import RightEditorPane from "./components/RightEditorPane.vue";
import SettingsPage from "./components/SettingsPage.vue";
import WorkspaceDialog from "./components/WorkspaceDialog.vue";
import {
  useAgentConversation,
  type AgentConversationController
} from "./composables/useAgentConversation";
import {
  findWorkspaceDocument,
  initialMessages,
  resourceSections,
  workspaceDocuments
} from "./data/demoWorkspace";
import type {
  DialogMode,
  EditorDraftState,
  ResourceTreeNode,
  WorkspaceDocument
} from "./types/workspace";
import { uiMessage } from "./ui-feedback";

const themeOverrides = {
  common: {
    primaryColor: "#1f2933",
    primaryColorHover: "#111827",
    borderRadius: "8px",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
  }
};

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const desktopShell = ref<HTMLElement | null>(null);
const leftPaneWidth = ref(window.innerWidth <= 1220 ? 262 : 286);
const rightPaneWidth = ref(
  window.innerWidth <= 1220 ? 395 : Math.min(650, Math.max(410, window.innerWidth * 0.34))
);
const resizingPane = ref<"left" | "right" | null>(null);
const selectedResourceId = ref("short-mist:draft");
const activeCreationResourceId = ref("short-mist:draft");
const documents = ref<WorkspaceDocument[]>(workspaceDocuments.map((document) => ({ ...document })));
const editorDrafts = ref<Record<string, EditorDraftState>>({});
const dialogMode = ref<DialogMode | null>(null);
const currentView = ref<"workspace" | "settings">("workspace");
const modelSettings = ref<ModelSettings | null>(null);
const modelLoading = ref(false);
const modelSaving = ref(false);
const modelError = ref<string | null>(null);
const modelTestMessage = ref<string | null>(null);
const testingModelId = ref<string | null>(null);
const workspaceAgentSettings = ref<ShortWorkspaceAgentSettings>({
  workspaceType: "short",
  agents: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map((agent) => ({
    ...agent,
    readAccess: {
      workspace: [...agent.readAccess.workspace],
      material: [...agent.readAccess.material],
      skill: [...agent.readAccess.skill]
    }
  }))
});
const workspaceAgentLoading = ref(false);
const workspaceAgentSaving = ref(false);
const workspaceAgentError = ref<string | null>(null);
const workspaceAgentStatus = ref<string | null>(null);
let workspaceAgentFeedbackTimer: number | undefined;
let removeSystemListener: (() => void) | undefined;
const conversations = new Map<string, AgentConversationController>();

function conversationForKey(key: string): AgentConversationController {
  const existing = conversations.get(key);
  if (existing) return existing;
  const created = useAgentConversation({
    api: () => window.deepwrite,
    initialMessages
  });
  if (modelSettings.value) {
    created.applyModelSettings(modelSettings.value);
  }
  conversations.set(key, created);
  return created;
}

function allConversations(): AgentConversationController[] {
  return [...conversations.values()];
}

conversationForKey("general");

const activeDocument = computed(() => {
  return (
    documents.value.find((document) => document.id === selectedResourceId.value) ??
    documents.value[0]!
  );
});
const activeEditorDraft = computed(() => editorDrafts.value[activeDocument.value.id]);
const activePromptDocument = computed<WorkspaceDocument>(() => {
  const active =
    documents.value.find((document) => document.id === activeCreationResourceId.value) ??
    documents.value.find((document) => document.domain === "creation") ??
    documents.value[0]!;
  const live = editorDrafts.value[active.id];
  if (!live) {
    return active;
  }
  return { ...active, title: live.title, content: live.content };
});
const liveWorkspaceDocuments = computed<WorkspaceDocument[]>(() =>
  documents.value.map((document) => {
    const live = editorDrafts.value[document.id];
    return live ? { ...document, title: live.title, content: live.content } : document;
  })
);
function conversationKeyForDocument(
  document: WorkspaceDocument
): string {
  if (
    document.workspaceType !== "short" ||
    !document.workspaceId ||
    !document.stageId
  ) {
    return "general";
  }
  const agentId = resolveShortWorkspaceAgentIdForStage(document.stageId);
  return `${document.workspaceId}:${agentId}`;
}

const activeConversationKey = computed(() =>
  conversationKeyForDocument(activePromptDocument.value)
);
const activeConversation = computed(
  () => conversationForKey(activeConversationKey.value)
);
const messages = computed(() => activeConversation.value.messages.value);
const composerDraft = computed({
  get: () => activeConversation.value.draft.value,
  set: (value: string) => {
    activeConversation.value.draft.value = value;
  }
});
const agentRuntime = computed(() => activeConversation.value.runtime.value);
const thinkingLevel = computed(() => activeConversation.value.thinkingLevel.value);
const configuredModels = computed(
  () => activeConversation.value.configuredModels.value
);
const selectedModelId = computed(
  () => activeConversation.value.selectedModelId.value
);
const conversationError = computed(
  () => activeConversation.value.conversationError.value
);
const responding = computed(() => activeConversation.value.isBusy.value);
const canSend = computed(() => activeConversation.value.canSend.value);
const editorLocked = computed(() => {
  const key = conversationKeyForDocument(activeDocument.value);
  return key !== "general" && conversationForKey(key).isBusy.value;
});
const activeAgentLabel = computed(() => {
  const document = activePromptDocument.value;
  if (document.workspaceType !== "short" || !document.stageId) {
    return "智能体对话";
  }
  const agentId = resolveShortWorkspaceAgentIdForStage(document.stageId);
  return (
    workspaceAgentSettings.value?.agents.find(
      (agent) => agent.id === agentId
    )?.label ?? "短篇智能体"
  );
});

const shellClasses = computed(() => ({
  "is-left-collapsed": leftCollapsed.value,
  "is-right-collapsed": rightCollapsed.value,
  "is-resizing": resizingPane.value !== null
}));
const shellStyle = computed(() => ({
  "--left-pane-width": `${leftPaneWidth.value}px`,
  "--right-pane-width": `${rightPaneWidth.value}px`
}));
const hasDesktopRuntime = computed(() => Boolean(window.deepwrite));

const LEFT_PANE_MIN = 220;
const LEFT_PANE_MAX = 480;
const RIGHT_PANE_MIN = 320;
const RIGHT_PANE_MAX = 760;
const CENTER_PANE_MIN = 390;

function clampPaneWidth(side: "left" | "right", width: number): number {
  const shellWidth = desktopShell.value?.getBoundingClientRect().width ?? window.innerWidth;
  const otherWidth =
    side === "left"
      ? rightCollapsed.value
        ? 0
        : rightPaneWidth.value
      : leftCollapsed.value
        ? 0
        : leftPaneWidth.value;
  const paneMin = side === "left" ? LEFT_PANE_MIN : RIGHT_PANE_MIN;
  const paneMax = side === "left" ? LEFT_PANE_MAX : RIGHT_PANE_MAX;
  const availableMax = Math.max(paneMin, shellWidth - otherWidth - CENTER_PANE_MIN);
  return Math.round(Math.min(Math.max(width, paneMin), paneMax, availableMax));
}

function setPaneWidth(side: "left" | "right", width: number): void {
  if (side === "left") {
    leftPaneWidth.value = clampPaneWidth(side, width);
    return;
  }
  rightPaneWidth.value = clampPaneWidth(side, width);
}

function handleResizeMove(event: PointerEvent): void {
  if (!resizingPane.value || !desktopShell.value) {
    return;
  }
  const bounds = desktopShell.value.getBoundingClientRect();
  const width =
    resizingPane.value === "left" ? event.clientX - bounds.left : bounds.right - event.clientX;
  setPaneWidth(resizingPane.value, width);
}

function stopPaneResize(): void {
  resizingPane.value = null;
  window.removeEventListener("pointermove", handleResizeMove);
  window.removeEventListener("pointerup", stopPaneResize);
  window.removeEventListener("pointercancel", stopPaneResize);
}

function startPaneResize(side: "left" | "right", event: PointerEvent): void {
  event.preventDefault();
  resizingPane.value = side;
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", stopPaneResize);
  window.addEventListener("pointercancel", stopPaneResize);
}

function handleResizeKeydown(side: "left" | "right", event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const currentWidth = side === "left" ? leftPaneWidth.value : rightPaneWidth.value;
  setPaneWidth(side, currentWidth + direction * (side === "left" ? 12 : -12));
}

function selectResource(node: ResourceTreeNode): void {
  const document = findWorkspaceDocument(node.id);
  if (!document) {
    return;
  }
  selectedResourceId.value = document.id;
  if (document.domain === "creation") {
    activeCreationResourceId.value = document.id;
  }
  rightCollapsed.value = false;
}

function handleLiveDocumentChange(payload: { id: string; title: string; content: string }): void {
  editorDrafts.value = {
    ...editorDrafts.value,
    [payload.id]: { title: payload.title, content: payload.content, dirty: true }
  };
}

function applyDocument(payload: { id: string; title: string; content: string }): void {
  const index = documents.value.findIndex((document) => document.id === payload.id);
  if (index < 0) {
    return;
  }
  const current = documents.value[index]!;
  documents.value[index] = { ...current, title: payload.title, content: payload.content };
  editorDrafts.value = {
    ...editorDrafts.value,
    [payload.id]: { title: payload.title, content: payload.content, dirty: false }
  };
}

function newConversation(): void {
  activeConversation.value.newConversation();
}

function useSuggestion(value: string): void {
  activeConversation.value.useSuggestion(value);
}

function sendMessage(): void {
  void activeConversation.value.sendMessage(
    activePromptDocument.value,
    liveWorkspaceDocuments.value
  );
}

function seedPrompt(value: string): void {
  composerDraft.value = value;
  dialogMode.value = null;
}

function openSettings(): void {
  currentView.value = "settings";
  if (window.deepwrite) {
    void loadWorkspaceAgentSettings();
  }
}

function closeSettings(): void {
  currentView.value = "workspace";
}

function handleSystemEvent(event: SystemEventEnvelope): void {
  if (event.type === "workspace.editor_mutation") {
    const sourceConversation = allConversations().find((conversation) =>
      conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
    const target = liveWorkspaceDocuments.value.find(
      (document) =>
        document.workspaceId === event.payload.workspaceId &&
        document.stageId === event.payload.stageId
    );
    if (
      sourceConversation &&
      target &&
      !target.readOnly &&
      createShortWorkspaceContentRevision(target.content) ===
        event.payload.baseRevision
    ) {
      editorDrafts.value = {
        ...editorDrafts.value,
        [target.id]: {
          title: target.title,
          content: event.payload.text,
          dirty: true
        }
      };
    } else if (
      sourceConversation &&
      target &&
      createShortWorkspaceContentRevision(target.content) !==
        event.payload.baseRevision
    ) {
      const conflictMessage =
        "文稿版本已变化，本次工具写入未应用，未覆盖你的最新编辑。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        conflictMessage
      );
      uiMessage.warning(conflictMessage);
    }
  }
  if (event.type === "workspace.stage_selection") {
    const sourceConversation = allConversations().find((conversation) =>
      conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
    const target = liveWorkspaceDocuments.value.find(
      (document) =>
        document.workspaceId === event.payload.workspaceId &&
        document.stageId === event.payload.stageId
    );
    if (sourceConversation && target) {
      selectedResourceId.value = target.id;
      activeCreationResourceId.value = target.id;
      rightCollapsed.value = false;
    }
  }
  for (const conversation of allConversations()) {
    conversation.handleEvent(event);
  }
}

async function loadModelSettings(): Promise<void> {
  if (!window.deepwrite) {
    return;
  }
  modelLoading.value = true;
  modelError.value = null;
  try {
    const settings = await window.deepwrite.models.list();
    modelSettings.value = settings;
    for (const conversation of allConversations()) {
      conversation.applyModelSettings(settings);
    }
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "加载模型配置失败。";
  } finally {
    modelLoading.value = false;
  }
}

async function saveModelSettings(settings: ModelSettingsInput): Promise<void> {
  if (!window.deepwrite || modelSaving.value) {
    return;
  }
  modelSaving.value = true;
  modelError.value = null;
  modelTestMessage.value = null;
  try {
    const saved = await window.deepwrite.models.save(settings);
    modelSettings.value = saved;
    for (const conversation of allConversations()) {
      conversation.applyModelSettings(saved);
    }
    modelTestMessage.value = "模型配置已保存，并已同步到后续对话。";
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "保存模型配置失败。";
  } finally {
    modelSaving.value = false;
  }
}

async function testModel(modelId: string): Promise<void> {
  if (!window.deepwrite || testingModelId.value) {
    return;
  }
  testingModelId.value = modelId;
  modelError.value = null;
  modelTestMessage.value = null;
  try {
    const result = await window.deepwrite.models.test(modelId);
    modelTestMessage.value = result.message;
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "模型连接测试失败。";
  } finally {
    testingModelId.value = null;
  }
}

function showWorkspaceAgentFeedback(
  kind: "error" | "status",
  message: string
): void {
  if (workspaceAgentFeedbackTimer !== undefined) {
    window.clearTimeout(workspaceAgentFeedbackTimer);
  }
  workspaceAgentError.value = kind === "error" ? message : null;
  workspaceAgentStatus.value = kind === "status" ? message : null;
  workspaceAgentFeedbackTimer = window.setTimeout(() => {
    workspaceAgentError.value = null;
    workspaceAgentStatus.value = null;
    workspaceAgentFeedbackTimer = undefined;
  }, 3_600);
}

async function loadWorkspaceAgentSettings(): Promise<void> {
  if (!window.deepwrite || workspaceAgentLoading.value) return;
  workspaceAgentLoading.value = true;
  workspaceAgentError.value = null;
  try {
    workspaceAgentSettings.value = await window.deepwrite.workspaceAgents.list("short");
  } catch (error: unknown) {
    showWorkspaceAgentFeedback(
      "error",
      error instanceof Error ? error.message : "加载创作空间智能体设置失败。"
    );
  } finally {
    workspaceAgentLoading.value = false;
  }
}

async function saveWorkspaceAgentSettings(
  settings: ShortWorkspaceAgentSettingsInput
): Promise<void> {
  if (!window.deepwrite || workspaceAgentSaving.value) return;
  workspaceAgentSaving.value = true;
  try {
    workspaceAgentSettings.value = await window.deepwrite.workspaceAgents.save(settings);
    showWorkspaceAgentFeedback("status", "短篇智能体提示词与读取范围已保存，下一轮对话立即生效。");
  } catch (error: unknown) {
    showWorkspaceAgentFeedback(
      "error",
      error instanceof Error ? error.message : "保存创作空间智能体设置失败。"
    );
  } finally {
    workspaceAgentSaving.value = false;
  }
}

function selectThinking(level: ThinkingLevel): void {
  activeConversation.value.selectThinkingLevel(level);
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    newConversation();
  }
  if (event.key === "Escape") {
    dialogMode.value = null;
    if (currentView.value === "settings") {
      closeSettings();
    }
  }
}

onMounted(async () => {
  window.addEventListener("keydown", handleGlobalKeydown);
  if (!window.deepwrite) {
    return;
  }

  removeSystemListener = window.deepwrite.events.subscribe(handleSystemEvent);
  await Promise.all([loadModelSettings(), loadWorkspaceAgentSettings()]);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  stopPaneResize();
  removeSystemListener?.();
  if (workspaceAgentFeedbackTimer !== undefined) {
    window.clearTimeout(workspaceAgentFeedbackTimer);
  }
  for (const conversation of allConversations()) {
    conversation.dispose();
  }
});
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides">
      <SettingsPage
        v-if="currentView === 'settings'"
        :workspace-agent-settings="workspaceAgentSettings"
        :workspace-agent-loading="workspaceAgentLoading"
        :workspace-agent-saving="workspaceAgentSaving"
        :workspace-agent-error="workspaceAgentError"
        :workspace-agent-status="workspaceAgentStatus"
        :runtime-available="hasDesktopRuntime"
        @back="closeSettings"
        @save-workspace-agents="saveWorkspaceAgentSettings"
      />

    <div
      v-else
      ref="desktopShell"
      class="desktop-shell"
      :class="shellClasses"
      :style="shellStyle"
      data-testid="desktop-shell"
    >
      <LeftSidebar
        v-if="!leftCollapsed"
        :sections="resourceSections"
        :selected-id="selectedResourceId"
        @collapse="leftCollapsed = true"
        @new-conversation="newConversation"
        @open-dialog="dialogMode = $event"
        @open-settings="openSettings"
        @select-resource="selectResource"
      />

      <AgentConversation
        v-model:draft="composerDraft"
        :messages="messages"
        :responding="responding"
        :can-send="canSend"
        :runtime-available="hasDesktopRuntime"
        :runtime="agentRuntime"
        :models="configuredModels"
        :selected-model-id="selectedModelId"
        :thinking-level="thinkingLevel"
        :error-message="conversationError"
        :context-title="activePromptDocument.title"
        :agent-label="activeAgentLabel"
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightCollapsed"
        @send="sendMessage"
        @suggestion="useSuggestion"
        @toggle-left="leftCollapsed = !leftCollapsed"
        @toggle-right="rightCollapsed = !rightCollapsed"
        @select-model="activeConversation.selectModel"
        @select-thinking="selectThinking"
      />

      <RightEditorPane
        v-if="!rightCollapsed"
        :document="activeDocument"
        :draft-state="activeEditorDraft"
        :locked="editorLocked"
        @collapse="rightCollapsed = true"
        @save="applyDocument"
        @live-change="handleLiveDocumentChange"
      />

      <div
        v-if="!leftCollapsed"
        class="pane-resizer pane-resizer-left"
        role="separator"
        aria-label="调整左侧栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="LEFT_PANE_MIN"
        :aria-valuemax="LEFT_PANE_MAX"
        :aria-valuenow="leftPaneWidth"
        tabindex="0"
        @pointerdown="startPaneResize('left', $event)"
        @keydown="handleResizeKeydown('left', $event)"
      />

      <div
        v-if="!rightCollapsed"
        class="pane-resizer pane-resizer-right"
        role="separator"
        aria-label="调整右侧栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="RIGHT_PANE_MIN"
        :aria-valuemax="RIGHT_PANE_MAX"
        :aria-valuenow="rightPaneWidth"
        tabindex="0"
        @pointerdown="startPaneResize('right', $event)"
        @keydown="handleResizeKeydown('right', $event)"
      />
    </div>

    <WorkspaceDialog
      :mode="dialogMode"
      :model-settings="modelSettings"
      :model-loading="modelLoading"
      :model-saving="modelSaving"
      :model-error="modelError"
      :model-test-message="modelTestMessage"
      :testing-model-id="testingModelId"
      @close="dialogMode = null"
      @seed-prompt="seedPrompt"
      @save-models="saveModelSettings"
      @test-model="testModel"
    />
  </NConfigProvider>
</template>
