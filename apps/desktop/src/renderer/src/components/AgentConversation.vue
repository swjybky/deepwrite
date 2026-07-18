<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type {
  AgentRuntimeRef,
  ModelConfig,
  ThinkingLevel
} from "@deepwrite/contracts";
import type { ChatMessage } from "../types/conversation";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  messages: ChatMessage[];
  draft: string;
  responding: boolean;
  canSend: boolean;
  runtimeAvailable: boolean;
  runtime: AgentRuntimeRef | null;
  models: ModelConfig[];
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  errorMessage: string | null;
  contextTitle: string;
  agentLabel: string;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  send: [];
  suggestion: [value: string];
  toggleLeft: [];
  toggleRight: [];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
}>();

const scroller = ref<HTMLElement>();

watch(
  () => [
    props.messages.length,
    props.responding,
    props.messages.map((message) => `${message.content.length}:${message.thinking?.length ?? 0}`).join("|")
  ],
  async () => {
    await nextTick();
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: "smooth" });
  }
);

function handleInput(event: Event): void {
  emit("update:draft", (event.target as HTMLTextAreaElement).value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  if (props.canSend) {
    emit("send");
  }
}

const suggestions = ["验证实时文稿快照", "验证 Thinking 流", "验证连续回复事件"];
const hasStreamingAssistant = computed(() =>
  props.messages.some((message) => message.role === "assistant" && message.status === "streaming")
);
const selectedModel = computed(() =>
  props.models.find((model) => model.id === props.selectedModelId)
);
const modelLabel = computed(
  () =>
    selectedModel.value?.label ??
    (props.runtime?.mode === "provider" ? props.runtime.model : "DeepWrite Faux")
);
const thinkingOptions: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "关闭" },
  { value: "minimal", label: "最低" },
  { value: "low", label: "较低" },
  { value: "medium", label: "标准" },
  { value: "high", label: "深度" },
  { value: "xhigh", label: "极高" }
];
const availableThinkingOptions = computed(() =>
  selectedModel.value && !selectedModel.value.reasoning
    ? thinkingOptions.slice(0, 1)
    : thinkingOptions
);

function handleModelChange(event: Event): void {
  emit("selectModel", (event.target as HTMLSelectElement).value);
}

function handleThinkingChange(event: Event): void {
  emit("selectThinking", (event.target as HTMLSelectElement).value as ThinkingLevel);
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    read_workspace_content: "读取工作区内容",
    search_workspace_text: "搜索工作区文本",
    query_linked_material_entries: "查询关联素材",
    load_skill: "加载技能",
    switch_storyline_stage: "切换剧情方向",
    write_workspace_editor: "写入阶段编辑器",
    replace_current_stage_text: "替换阶段文本",
    initialize_expert_draft: "初始化正文",
    edit_expert_draft_section: "编辑正文"
  };
  return labels[name] ?? name;
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
        <div>
          <strong>{{ agentLabel }}</strong>
          <span class="context-caption">主上下文：{{ contextTitle }}</span>
        </div>
      </div>
      <div class="conversation-header-actions">
        <span class="conversation-runtime-badge" :class="{ 'is-offline': !runtimeAvailable }">
          <i />{{ runtimeAvailable ? modelLabel : "仅预览" }}
        </span>
        <button class="header-text-button" type="button">
          <AppIcon name="history" :size="16" />
          历史对话
        </button>
        <button
          v-if="rightCollapsed"
          class="icon-button"
          type="button"
          aria-label="展开文本内容栏"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <section ref="scroller" class="conversation-scroll" aria-live="polite">
      <div v-if="messages.length === 0" class="conversation-empty">
        <span class="empty-agent-mark"><AppIcon name="logo" :size="28" /></span>
        <h1>从一个创作目标开始</h1>
        <p v-if="runtimeAvailable">当前用于验证实时文稿快照与本地 Faux 流式链路，返回 Thinking 与回复内容。</p>
        <p v-else>当前是浏览器布局预览；请使用 pnpm dev 启动桌面 Agent Runtime 后再发送消息。</p>
        <div class="empty-suggestions">
          <button
            v-for="item in suggestions"
            :key="item"
            type="button"
            :disabled="!runtimeAvailable"
            @click="emit('suggestion', item)"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <div v-else class="message-list">
        <div v-if="errorMessage" class="conversation-error" role="alert">
          <strong>本轮运行未完成</strong>
          <span>{{ errorMessage }}</span>
        </div>
        <article
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="`is-${message.role}`"
        >
          <div v-if="message.role === 'assistant'" class="assistant-avatar">
            <AppIcon name="logo" :size="16" />
          </div>
          <div class="message-body">
            <details
              v-if="message.role === 'assistant' && message.thinking"
              class="thinking-block"
              :open="message.status === 'streaming'"
            >
              <summary>
                <AppIcon name="chevron" :size="13" />
                <AppIcon name="brain" :size="14" />
                <span>{{ message.status === "streaming" ? "Thinking" : "已思考" }}</span>
              </summary>
              <p>{{ message.thinking }}</p>
            </details>
            <div
              v-if="message.role === 'assistant' && message.tools?.length"
              class="tool-activity-list"
            >
              <details
                v-for="tool in message.tools"
                :key="tool.id"
                class="tool-activity"
              >
                <summary>
                  <span class="tool-status-dot" :class="`is-${tool.status}`" />
                  <strong>{{ toolLabel(tool.name) }}</strong>
                  <span>{{ tool.status === "running" ? "执行中" : tool.status === "error" ? "失败" : "已完成" }}</span>
                  <AppIcon name="chevron" :size="12" />
                </summary>
                <p v-if="tool.summary">{{ tool.summary }}</p>
              </details>
            </div>
            <div
              v-if="message.content"
              class="message-copy"
              :class="{ 'is-streaming': message.status === 'streaming' }"
            >
              {{ message.content }}
            </div>
            <div v-if="message.status === 'error'" class="message-error-copy">
              {{ message.errorMessage }}
            </div>
            <div class="message-meta">
              <span>{{ message.role === "assistant" ? "DeepWrite" : "你" }}</span>
              <span>{{ formatTime(message.createdAt) }}</span>
              <span v-if="message.runtime?.mode === 'local-faux'">Faux</span>
              <button v-if="message.role === 'assistant'" type="button" aria-label="复制回复">
                <AppIcon name="copy" :size="13" />
              </button>
            </div>
          </div>
        </article>

        <article v-if="responding && !hasStreamingAssistant" class="message is-assistant is-thinking">
          <div class="assistant-avatar"><AppIcon name="logo" :size="16" /></div>
          <div class="thinking-row">
          <span>正在整理创作上下文</span>
            <i /><i /><i />
          </div>
        </article>
      </div>
    </section>

    <footer class="composer-wrap">
      <div class="composer" :class="{ 'is-disabled': responding }">
        <textarea
          :value="draft"
          rows="1"
          :placeholder="runtimeAvailable ? '随心输入，和智能体一起写……' : '浏览器预览不可发送，请启动桌面客户端'"
          aria-label="智能体消息"
          :disabled="responding || !runtimeAvailable"
          @input="handleInput"
          @keydown="handleKeydown"
        />
        <div class="composer-toolbar">
          <div class="composer-tools">
            <button
              class="round-tool-button"
              type="button"
              aria-label="添加上下文（下一阶段开放）"
              title="技能与素材显式附加将在下一阶段开放"
              disabled
            >
              <AppIcon name="plus" :size="18" />
            </button>
            <label class="composer-select">
              <AppIcon name="model" :size="14" />
              <select
                :value="selectedModelId"
                aria-label="选择模型"
                @change="handleModelChange"
              >
                <option value="">DeepWrite Faux</option>
                <option v-for="model in models" :key="model.id" :value="model.id">
                  {{ model.label }}
                </option>
              </select>
              <AppIcon name="chevron" :size="11" />
            </label>
            <label class="composer-select">
              <AppIcon name="brain" :size="14" />
              <select
                :value="thinkingLevel"
                aria-label="选择思考等级"
                @change="handleThinkingChange"
              >
                <option
                  v-for="option in availableThinkingOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <AppIcon name="chevron" :size="11" />
            </label>
          </div>
          <div class="composer-actions">
            <button class="round-tool-button" type="button" aria-label="语音输入">
              <AppIcon name="mic" :size="18" />
            </button>
            <button
              class="send-button"
              type="button"
              aria-label="发送消息"
              :disabled="!canSend"
              @click="emit('send')"
            >
              <AppIcon name="arrow-up" :size="18" />
            </button>
          </div>
        </div>
      </div>
      <p class="composer-note">Enter 发送 · Shift + Enter 换行</p>
    </footer>
  </main>
</template>
