<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { NConfigProvider } from "naive-ui";
import type {
  SystemEventEnvelope,
  SystemHealthPayload,
  UtilityWorkerName
} from "@deepwrite/contracts";
import AgentConversation from "./components/AgentConversation.vue";
import LeftSidebar from "./components/LeftSidebar.vue";
import RightEditorPane from "./components/RightEditorPane.vue";
import WorkspaceDialog from "./components/WorkspaceDialog.vue";
import { useAgentConversation } from "./composables/useAgentConversation";
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
const selectedResourceId = ref("chapter-3");
const activeCreationResourceId = ref("chapter-3");
const documents = ref<WorkspaceDocument[]>(workspaceDocuments.map((document) => ({ ...document })));
const editorDrafts = ref<Record<string, EditorDraftState>>({});
const dialogMode = ref<DialogMode | null>(null);
const runtimeHealth = ref<SystemHealthPayload | null>(null);
const runtimeError = ref(false);
const restartingWorkers = ref<Set<UtilityWorkerName>>(new Set());
let removeSystemListener: (() => void) | undefined;
const conversation = useAgentConversation({
  api: () => window.deepwrite,
  initialMessages
});
const {
  messages,
  draft: composerDraft,
  runtime: agentRuntime,
  conversationError,
  isBusy: responding,
  canSend
} = conversation;

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

const shellClasses = computed(() => ({
  "is-left-collapsed": leftCollapsed.value,
  "is-right-collapsed": rightCollapsed.value
}));
const hasDesktopRuntime = computed(() => Boolean(window.deepwrite));

const runtimeTone = computed<"ok" | "preview" | "degraded">(() => {
  if (runtimeError.value || restartingWorkers.value.size > 0) {
    return "degraded";
  }
  if (!window.deepwrite) {
    return "preview";
  }
  return runtimeHealth.value?.status === "ok" ? "ok" : "preview";
});

const runtimeLabel = computed(() => {
  if (restartingWorkers.value.size > 0) {
    return "正在重启桌面运行时";
  }
  if (runtimeError.value) {
    return "运行时异常";
  }
  if (!window.deepwrite) {
    return "浏览器预览模式";
  }
  if (!runtimeHealth.value) {
    return "正在连接运行时";
  }
  return runtimeHealth.value.status === "ok" ? "桌面运行时就绪" : "运行时启动中";
});

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
  conversation.newConversation();
}

function useSuggestion(value: string): void {
  conversation.useSuggestion(value);
}

function sendMessage(): void {
  void conversation.sendMessage(activePromptDocument.value);
}

function seedPrompt(value: string): void {
  composerDraft.value = value;
  dialogMode.value = null;
}

function handleSystemEvent(event: SystemEventEnvelope): void {
  if (event.type === "system.ready") {
    runtimeHealth.value = event.payload;
    runtimeError.value = false;
    restartingWorkers.value = new Set();
  }
  if (event.type === "system.worker_restarting") {
    restartingWorkers.value = new Set([...restartingWorkers.value, event.payload.worker]);
    runtimeHealth.value = null;
  }
  if (event.type === "system.worker_restarted") {
    const next = new Set(restartingWorkers.value);
    next.delete(event.payload.worker);
    restartingWorkers.value = next;
    if (next.size === 0) {
      void refreshRuntimeHealth();
    }
  }
  conversation.handleEvent(event);
}

async function refreshRuntimeHealth(): Promise<void> {
  if (!window.deepwrite) {
    return;
  }
  try {
    runtimeHealth.value = await window.deepwrite.system.health();
    runtimeError.value = false;
  } catch {
    runtimeError.value = true;
  }
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    newConversation();
  }
  if (event.key === "Escape") {
    dialogMode.value = null;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", handleGlobalKeydown);
  if (!window.deepwrite) {
    return;
  }

  removeSystemListener = window.deepwrite.events.subscribe(handleSystemEvent);
  await refreshRuntimeHealth();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  removeSystemListener?.();
  conversation.dispose();
});
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides">
    <div class="desktop-shell" :class="shellClasses" data-testid="desktop-shell">
      <LeftSidebar
        v-if="!leftCollapsed"
        :sections="resourceSections"
        :selected-id="selectedResourceId"
        :runtime-label="runtimeLabel"
        :runtime-tone="runtimeTone"
        @collapse="leftCollapsed = true"
        @new-conversation="newConversation"
        @open-dialog="dialogMode = $event"
        @select-resource="selectResource"
      />

      <AgentConversation
        v-model:draft="composerDraft"
        :messages="messages"
        :responding="responding"
        :can-send="canSend"
        :runtime-available="hasDesktopRuntime"
        :runtime="agentRuntime"
        :error-message="conversationError"
        :context-title="activePromptDocument.title"
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightCollapsed"
        @send="sendMessage"
        @suggestion="useSuggestion"
        @toggle-left="leftCollapsed = !leftCollapsed"
        @toggle-right="rightCollapsed = !rightCollapsed"
      />

      <RightEditorPane
        v-if="!rightCollapsed"
        :document="activeDocument"
        :draft-state="activeEditorDraft"
        @collapse="rightCollapsed = true"
        @save="applyDocument"
        @live-change="handleLiveDocumentChange"
      />
    </div>

    <WorkspaceDialog
      :mode="dialogMode"
      @close="dialogMode = null"
      @seed-prompt="seedPrompt"
    />
  </NConfigProvider>
</template>
