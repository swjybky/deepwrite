<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  PROMPT_ATTACHMENT_MAX_ITEMS,
  PROMPT_IMAGE_ATTACHMENTS_MAX_BYTES,
  PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH,
  type BuiltInReasoningLevel,
  type ModelConfig,
  type ShortWorkspaceAgentId,
  type ThinkingLevel,
  type UserPromptAttachment
} from "@deepwrite/contracts";
import { resolveAgentWelcome } from "../data/agentWelcome";
import type {
  AgentApprovalMode,
  AgentEditProposal,
  AgentToolTrace,
  ChatMessage,
  ComposerReferenceOption,
  ConversationHistoryItem
} from "../types/conversation";
import type { IconName } from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import {
  PROMPT_ATTACHMENT_ACCEPT,
  readPromptAttachment
} from "../utils/promptAttachments";
import {
  findComposerReferenceMatch,
  insertComposerReference,
  type ComposerReferenceMatch
} from "../utils/composerReferences";
import AppIcon from "./AppIcon.vue";
import MessageMarkdown from "./MessageMarkdown.vue";
import PopupSelect from "./PopupSelect.vue";

const props = defineProps<{
  messages: ChatMessage[];
  conversationHistory: ConversationHistoryItem[];
  currentSessionId: string;
  draft: string;
  responding: boolean;
  canSend: boolean;
  canSendAttachments: boolean;
  canStop: boolean;
  runtimeAvailable: boolean;
  models: ModelConfig[];
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  approvalMode: AgentApprovalMode;
  contextTitle: string;
  bookTitle: string;
  stageLabel: string;
  agentLabel: string;
  agentId: ShortWorkspaceAgentId | undefined;
  availableSkills: ComposerReferenceOption[];
  availableMaterials: ComposerReferenceOption[];
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  newConversation: [];
  selectConversation: [sessionId: string];
  send: [attachments: UserPromptAttachment[]];
  stop: [];
  suggestion: [value: string];
  toggleLeft: [];
  toggleRight: [];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  selectTemperature: [temperature: number];
  selectApproval: [mode: AgentApprovalMode];
  reviewEdit: [payload: {
    runId: string;
    proposalId: string;
    decision: "accept" | "reject";
  }];
}>();

const scroller = ref<HTMLElement>();
const composerInput = ref<HTMLTextAreaElement>();
const attachmentInput = ref<HTMLInputElement>();
const pendingAttachments = ref<UserPromptAttachment[]>([]);
const readingAttachments = ref(false);
const clock = ref(Date.now());
const copiedMessageId = ref<string | null>(null);
const historyOpen = ref(false);
const activeReference = ref<ComposerReferenceMatch | null>(null);
const activeReferenceIndex = ref(0);
let clockTimer: number | undefined;
let copiedTimer: number | undefined;
let scrollFrame: number | undefined;
let attachmentReadEpoch = 0;
const followsConversationTail = ref(true);

const TAIL_FOLLOW_THRESHOLD = 72;

function isNearConversationTail(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= TAIL_FOLLOW_THRESHOLD;
}

function handleConversationScroll(): void {
  if (scroller.value) {
    followsConversationTail.value = isNearConversationTail(scroller.value);
  }
}

function scheduleConversationTailFollow(): void {
  if (!followsConversationTail.value || scrollFrame !== undefined) {
    return;
  }
  scrollFrame = globalThis.requestAnimationFrame(() => {
    scrollFrame = undefined;
    const element = scroller.value;
    if (element && followsConversationTail.value) {
      element.scrollTop = element.scrollHeight;
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
      message?.toolCalls
        ?.map((toolCall) => `${toolCall.status}:${toolCall.argumentsText?.length ?? 0}`)
        .join(","),
      message?.editProposals
        ?.map((proposal) => `${proposal.id}:${proposal.status}:${proposal.updatedAt}`)
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

onMounted(() => {
  scheduleConversationTailFollow();
});

watch(
  () => props.responding,
  (responding) => {
    if (clockTimer !== undefined) {
      globalThis.clearInterval(clockTimer);
      clockTimer = undefined;
    }
    clock.value = Date.now();
    if (responding) {
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
    attachmentReadEpoch += 1;
    readingAttachments.value = false;
    pendingAttachments.value = [];
    followsConversationTail.value = true;
    void nextTick(scheduleConversationTailFollow);
  }
);

const canSubmit = computed(
  () =>
    !readingAttachments.value &&
    (props.canSend ||
      (props.canSendAttachments && pendingAttachments.value.length > 0))
);

function openAttachmentPicker(): void {
  attachmentInput.value?.click();
}

function attachmentKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function pendingAttachmentKey(attachment: UserPromptAttachment): string {
  return `${attachment.name}\u0000${attachment.size}`;
}

function validateAttachmentCapacity(attachment: UserPromptAttachment): string | undefined {
  if (pendingAttachments.value.length >= PROMPT_ATTACHMENT_MAX_ITEMS) {
    return `每条消息最多上传 ${PROMPT_ATTACHMENT_MAX_ITEMS} 个附件。`;
  }
  if (attachment.kind === "text") {
    const textLength = pendingAttachments.value.reduce(
      (total, item) => total + (item.kind === "text" ? item.content.length : 0),
      attachment.content.length
    );
    if (textLength > PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH) {
      return `文本附件合计最多携带 ${PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH.toLocaleString("zh-CN")} 个字符。`;
    }
  } else {
    const imageBytes = pendingAttachments.value.reduce(
      (total, item) => total + (item.kind === "image" ? item.size : 0),
      attachment.size
    );
    if (imageBytes > PROMPT_IMAGE_ATTACHMENTS_MAX_BYTES) {
      return "图片附件合计不能超过 25 MB。";
    }
  }
  return undefined;
}

async function addAttachmentFiles(files: File[]): Promise<void> {
  if (!files.length || readingAttachments.value) return;
  const readEpoch = ++attachmentReadEpoch;
  readingAttachments.value = true;
  const failures: string[] = [];
  let added = 0;
  try {
    const existing = new Set(pendingAttachments.value.map(pendingAttachmentKey));
    const seenFiles = new Set<string>();
    for (const file of files) {
      const fileKey = attachmentKey(file);
      const duplicateKey = `${file.name}\u0000${file.size}`;
      if (seenFiles.has(fileKey) || existing.has(duplicateKey)) continue;
      seenFiles.add(fileKey);
      try {
        const result = await readPromptAttachment(file);
        if (readEpoch !== attachmentReadEpoch) return;
        const capacityError = validateAttachmentCapacity(result.attachment);
        if (capacityError) {
          failures.push(capacityError);
          continue;
        }
        pendingAttachments.value.push(result.attachment);
        existing.add(duplicateKey);
        added += 1;
        if (result.warning) uiMessage.warning(result.warning);
      } catch (error: unknown) {
        failures.push(error instanceof Error ? error.message : `读取“${file.name}”失败。`);
      }
    }
  } finally {
    if (readEpoch === attachmentReadEpoch) {
      readingAttachments.value = false;
    }
  }
  if (readEpoch !== attachmentReadEpoch) return;
  if (failures.length) {
    uiMessage.error(
      failures.length === 1 ? failures[0]! : `${failures[0]}（另有 ${failures.length - 1} 个附件未添加）`
    );
  } else if (added > 0) {
    uiMessage.success(`已添加 ${added} 个附件`);
  }
}

function handleAttachmentChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  void addAttachmentFiles(files);
}

function removePendingAttachment(id: string): void {
  pendingAttachments.value = pendingAttachments.value.filter(
    (attachment) => attachment.id !== id
  );
}

function formatFileSize(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentPreview(attachment: UserPromptAttachment): string | undefined {
  return attachment.kind === "image"
    ? `data:${attachment.mediaType};base64,${attachment.data}`
    : undefined;
}

function submitMessage(): void {
  if (!canSubmit.value) return;
  const attachments = pendingAttachments.value.map((attachment) => ({ ...attachment }));
  pendingAttachments.value = [];
  emit("send", attachments);
}

onBeforeUnmount(() => {
  attachmentReadEpoch += 1;
  if (clockTimer !== undefined) {
    globalThis.clearInterval(clockTimer);
  }
  if (copiedTimer !== undefined) {
    globalThis.clearTimeout(copiedTimer);
  }
  if (scrollFrame !== undefined) {
    globalThis.cancelAnimationFrame(scrollFrame);
  }
});

const referenceOptions = computed(() =>
  activeReference.value?.trigger === "/"
    ? props.availableSkills
    : activeReference.value?.trigger === "@"
      ? props.availableMaterials
      : []
);
const filteredReferenceOptions = computed(() => {
  const query = activeReference.value?.query.trim().toLocaleLowerCase("zh-CN") ?? "";
  const matches = query
    ? referenceOptions.value.filter((option) =>
        `${option.label} ${option.detail}`.toLocaleLowerCase("zh-CN").includes(query)
      )
    : referenceOptions.value;
  return matches.slice(0, 12);
});
const referenceMenuTitle = computed(() =>
  activeReference.value?.trigger === "/" ? "调用技能" : "引用素材"
);
const referenceMenuHint = computed(() =>
  activeReference.value?.trigger === "/" ? "输入名称搜索技能" : "输入名称搜索素材"
);

watch(
  () => filteredReferenceOptions.value.map((option) => option.id).join("\u0000"),
  () => {
    activeReferenceIndex.value = Math.min(
      activeReferenceIndex.value,
      Math.max(0, filteredReferenceOptions.value.length - 1)
    );
  }
);

function updateActiveReference(input: HTMLTextAreaElement): void {
  const next = findComposerReferenceMatch(input.value, input.selectionStart ?? input.value.length);
  const changedTrigger =
    next?.start !== activeReference.value?.start || next?.trigger !== activeReference.value?.trigger;
  activeReference.value = next;
  if (changedTrigger) {
    activeReferenceIndex.value = 0;
  }
}

function handleInput(event: Event): void {
  const input = event.target as HTMLTextAreaElement;
  emit("update:draft", input.value);
  updateActiveReference(input);
}

function closeReferenceMenu(): void {
  activeReference.value = null;
  activeReferenceIndex.value = 0;
}

function selectReference(option: ComposerReferenceOption): void {
  const match = activeReference.value;
  if (!match) {
    return;
  }
  const insertion = insertComposerReference(
    composerInput.value?.value ?? props.draft,
    match,
    option.label
  );
  emit("update:draft", insertion.value);
  closeReferenceMenu();
  void nextTick(() => {
    composerInput.value?.focus();
    composerInput.value?.setSelectionRange(insertion.caret, insertion.caret);
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (activeReference.value && !event.isComposing) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = filteredReferenceOptions.value.length;
      if (count) {
        const offset = event.key === "ArrowDown" ? 1 : -1;
        activeReferenceIndex.value = (activeReferenceIndex.value + offset + count) % count;
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeReferenceMenu();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const option = filteredReferenceOptions.value[activeReferenceIndex.value];
      if (option) {
        selectReference(option);
      } else {
        closeReferenceMenu();
      }
      return;
    }
  }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  if (canSubmit.value) {
    submitMessage();
  }
}

const welcomeContent = computed(() => resolveAgentWelcome(props.agentId));
const hasStreamingAssistant = computed(() =>
  props.messages.some((message) => message.role === "assistant" && message.status === "streaming")
);
const selectedModel = computed(() =>
  props.models.find((model) => model.id === props.selectedModelId)
);
const builtInThinkingLabels: Record<BuiltInReasoningLevel, string> = {
  minimal: "最低",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "极高",
  max: "最高"
};
const fallbackThinkingOptions: Array<{ value: ThinkingLevel; label: string }> = [
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
    ? selectedModel.value.reasoning
      ? [
          { value: "off" as const, label: thinkingLabel("off") },
          ...selectedModel.value.thinkingLevelOptions.map((value) => ({
            value,
            label: thinkingLabel(value)
          }))
        ]
      : [{ value: "off" as const, label: thinkingLabel("off") }]
    : fallbackThinkingOptions
);
const modelOptions = computed(() =>
  props.models.map((model) => ({ value: model.id, label: model.label }))
);
const showsTemperature = computed(
  () => Boolean(selectedModel.value) && props.thinkingLevel === "off"
);
const temperatureOptions = computed(() => selectedModel.value?.temperatureOptions ?? []);
const temperatureSelectOptions = computed(() =>
  temperatureOptions.value.map((value) => ({ value, label: `温度 ${value}` }))
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

function handleModelChange(value: string | number): void {
  emit("selectModel", String(value));
}

function handleThinkingChange(value: string | number): void {
  emit("selectThinking", String(value) as ThinkingLevel);
}

function handleTemperatureChange(value: string | number): void {
  emit("selectTemperature", Number(value));
}

function handleApprovalChange(value: string | number): void {
  if (value === "request-approval" || value === "auto-approve") {
    emit("selectApproval", value);
  }
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

function formatHistoryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
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

function workspaceToolLabel(name: string): string {
  const labels: Record<string, string> = {
    read_workspace_content: "读取工作区内容",
    search_workspace_text: "搜索工作区文本",
    query_linked_material_entries: "查询关联素材",
    load_skill: "加载技能",
    switch_storyline_stage: "切换剧情方向",
    write_workspace_editor: "写入阶段编辑器",
    replace_current_stage_text: "替换阶段文本",
    initialize_expert_draft: "初始化正文",
    edit_expert_draft_section: "编辑正文",
    read_expert_draft_section: "读取正文小节",
    replace_section_body_text: "替换小节正文",
    write_section_body: "写入小节正文",
    replace_character_state_text: "替换人物状态",
    write_character_state: "写入人物状态"
  };
  return labels[name] ?? name;
}

function hasProcessing(message: ChatMessage): boolean {
  return processingItems(message).length > 0;
}

type ProcessingItem =
  | { id: string; type: "thinking"; content: string }
  | { id: string; type: "response"; content: string }
  | { id: string; type: "tool"; tool: AgentToolTrace };

type ProcessingDisplayItem =
  | Exclude<ProcessingItem, { type: "tool" }>
  | { id: string; type: "tool"; tool: AgentToolTrace }
  | { id: string; type: "tool-group"; tools: AgentToolTrace[] };

function processingItems(message: ChatMessage): ProcessingItem[] {
  const items: ProcessingItem[] = [];
  if (message.processingSteps?.length) {
    let lastResponseIndex = -1;
    for (let index = message.processingSteps.length - 1; index >= 0; index -= 1) {
      if (message.processingSteps[index]?.type === "response") {
        lastResponseIndex = index;
        break;
      }
    }
    for (const [index, step] of message.processingSteps.entries()) {
      if (step.type === "thinking") {
        items.push({ id: step.id, type: "thinking", content: step.content });
        continue;
      }
      if (step.type === "response") {
        // While streaming every turn remains visible in arrival order. Once the
        // run ends, the last response moves outside the processed disclosure.
        if (message.status === "streaming" || index !== lastResponseIndex) {
          items.push({ id: step.id, type: "response", content: step.content });
        }
        continue;
      }
      const tool = message.toolCalls?.find((toolCall) => toolCall.id === step.toolCallId);
      if (tool) {
        items.push({ id: step.id, type: "tool", tool });
      }
    }
    return items;
  }
  if (message.thinking) {
    items.push({ id: `${message.id}_thinking`, type: "thinking", content: message.thinking });
  }
  for (const tool of message.toolCalls ?? []) {
    items.push({ id: `${message.id}_${tool.id}`, type: "tool", tool });
  }
  return items;
}

function processingDisplayItems(message: ChatMessage): ProcessingDisplayItem[] {
  const displayItems: ProcessingDisplayItem[] = [];
  for (const item of processingItems(message)) {
    if (item.type !== "tool" || isWriteTool(item.tool)) {
      displayItems.push(item);
      continue;
    }
    const previous = displayItems.at(-1);
    if (previous?.type === "tool-group") {
      previous.tools.push(item.tool);
      continue;
    }
    displayItems.push({
      id: `${item.id}_group`,
      type: "tool-group",
      tools: [item.tool]
    });
  }
  return displayItems;
}

function hasResponseSteps(message: ChatMessage): boolean {
  return message.processingSteps?.some((step) => step.type === "response") ?? false;
}

function visibleResponse(message: ChatMessage): string {
  if (message.status === "streaming" && hasResponseSteps(message)) {
    return "";
  }
  return message.content;
}

function processingLabel(message: ChatMessage): string {
  const start = Date.parse(message.processingStartedAt ?? message.createdAt);
  const end = message.processingCompletedAt
    ? Date.parse(message.processingCompletedAt)
    : message.status === "streaming"
      ? clock.value
      : start + 1_000;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return message.status === "streaming" ? "处理中" : "已处理";
  }
  const seconds = Math.max(1, Math.ceil((end - start) / 1_000));
  return `${message.status === "streaming" ? "处理中" : "已处理"} ${seconds}s`;
}

type ToolKind = "read" | "command" | "write" | "web" | "other";

const WRITE_TOOL_NAMES = new Set([
  "write_workspace_editor",
  "replace_current_stage_text",
  "initialize_expert_draft",
  "edit_expert_draft_section",
  "replace_section_body_text",
  "write_section_body",
  "replace_character_state_text",
  "write_character_state"
]);

const DIRECT_WRITE_TOOL_NAMES = new Set([
  "write_workspace_editor",
  "initialize_expert_draft",
  "write_section_body",
  "write_character_state"
]);

function isWriteTool(tool: AgentToolTrace): boolean {
  return WRITE_TOOL_NAMES.has(tool.name) || toolKind(tool.name) === "write";
}

type WriteToolAction = "write" | "modify";

function writeToolAction(tool: AgentToolTrace): WriteToolAction {
  return DIRECT_WRITE_TOOL_NAMES.has(tool.name) || /(?:write|save)/i.test(tool.name)
    ? "write"
    : "modify";
}

function writeActionLabel(action: WriteToolAction): "写入" | "修改" {
  return action === "write" ? "写入" : "修改";
}

function toolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (WRITE_TOOL_NAMES.has(name) || /(write|edit|replace|patch|save|apply)/.test(name)) {
    return "write";
  }
  if (/(read|list|search|find|glob|file)/.test(name)) {
    return "read";
  }
  if (/(exec|shell|command|terminal|run)/.test(name)) {
    return "command";
  }
  if (/(browser|web|http|fetch|url)/.test(name)) {
    return "web";
  }
  return "other";
}

function toolIcon(tool: AgentToolTrace): IconName {
  const kind = toolKind(tool.name);
  if (kind === "read") {
    return "folder";
  }
  if (kind === "command") {
    return "terminal";
  }
  if (kind === "write") {
    return "file";
  }
  if (kind === "web") {
    return "globe";
  }
  return "sparkles";
}

function toolLabel(tool: AgentToolTrace): string {
  const displayName = workspaceToolLabel(tool.name);
  if (isWriteTool(tool)) {
    const action = writeActionLabel(writeToolAction(tool));
    if (tool.status === "error") return `${action}失败`;
    if (tool.status === "completed") return `${action}结果已生成`;
    return `正在${action}`;
  }
  if (tool.status === "error") {
    return `执行 ${displayName} 时出错`;
  }
  if (tool.status === "preparing") {
    return `正在准备${displayName}`;
  }
  const running = tool.status === "running";
  const kind = toolKind(tool.name);
  if (kind === "read") {
    return running ? "正在读取文件" : "已读取文件";
  }
  if (kind === "command") {
    return running ? "正在运行命令" : "运行了命令";
  }
  if (kind === "write") {
    return running ? "正在提交文本变更" : "已生成文本变更";
  }
  if (kind === "web") {
    return running ? "正在访问页面" : "已访问页面";
  }
  return `${running ? "正在执行" : "已执行"} ${displayName}`;
}

function toolGroupIsRunning(tools: AgentToolTrace[]): boolean {
  return tools.some((tool) => tool.status === "preparing" || tool.status === "running");
}

function toolGroupLabel(tools: AgentToolTrace[]): "执行中" | "执行完成" {
  return toolGroupIsRunning(tools) ? "执行中" : "执行完成";
}

function compactTrace(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

function toolDetail(tool: AgentToolTrace): string | undefined {
  if (tool.status === "preparing") {
    const length = writeToolText(tool).length;
    return length > 0 ? `已生成 ${length.toLocaleString("zh-CN")} 字符` : "参数生成中";
  }
  if (isWriteTool(tool) && tool.status === "running") {
    return `正在提交${writeActionLabel(writeToolAction(tool))}内容`;
  }
  if (tool.resultSummary?.trim()) {
    return compactTrace(tool.resultSummary);
  }
  if (!tool.args || typeof tool.args !== "object") {
    return undefined;
  }
  const args = tool.args as Record<string, unknown>;
  for (const key of ["path", "file", "command", "query", "url"]) {
    if (typeof args[key] === "string") {
      return compactTrace(args[key]);
    }
  }
  try {
    return compactTrace(JSON.stringify(args));
  } catch {
    return undefined;
  }
}

function decodeJsonStringFragment(source: string): string {
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character !== "\\") {
      result += character;
      continue;
    }
    const escaped = source[index + 1];
    if (escaped === undefined) break;
    index += 1;
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t"
    };
    if (escaped === "u") {
      const code = source.slice(index + 1, index + 5);
      if (/^[0-9a-fA-F]{4}$/.test(code)) {
        result += String.fromCharCode(Number.parseInt(code, 16));
        index += 4;
      }
      continue;
    }
    result += simpleEscapes[escaped] ?? escaped;
  }
  return result;
}

function streamedStringField(source: string, field: string): string {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(source);
  if (!match) return "";
  const start = (match.index ?? 0) + match[0].length;
  let escaped = false;
  let end = source.length;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      end = index;
      break;
    }
  }
  return decodeJsonStringFragment(source.slice(start, end));
}

function writeToolText(tool: AgentToolTrace): string {
  if (tool.args && typeof tool.args === "object") {
    const args = tool.args as Record<string, unknown>;
    if (typeof args.text === "string") return args.text;
    if (Array.isArray(args.replacements)) {
      return args.replacements
        .flatMap((replacement) =>
          replacement && typeof replacement === "object" &&
          typeof (replacement as Record<string, unknown>).new_text === "string"
            ? [(replacement as Record<string, unknown>).new_text as string]
            : []
        )
        .join("\n\n");
    }
    if (Array.isArray(args.sections)) {
      return args.sections
        .flatMap((section) => {
          if (!section || typeof section !== "object") return [];
          const value = section as Record<string, unknown>;
          return [
            [
              typeof value.title === "string" ? `## ${value.title}` : "",
              typeof value.body === "string" ? value.body : ""
            ].filter(Boolean).join("\n")
          ];
        })
        .join("\n\n");
    }
  }
  const source = tool.argumentsText ?? "";
  return (
    streamedStringField(source, "text") ||
    streamedStringField(source, "body") ||
    streamedStringField(source, "new_text")
  );
}

function writeToolTarget(tool: AgentToolTrace): string | undefined {
  if (!tool.args || typeof tool.args !== "object") return undefined;
  const args = tool.args as Record<string, unknown>;
  return typeof args.target_stage_id === "string" ? args.target_stage_id : undefined;
}

function visibleToolArguments(tool: AgentToolTrace): unknown {
  return tool.args ?? tool.argumentsText;
}

function formatToolPayload(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    const formatted = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return formatted.length > 3_000 ? `${formatted.slice(0, 3_000)}\n…` : formatted;
  } catch {
    return String(value);
  }
}

const proposalStatusLabels: Record<AgentEditProposal["status"], string> = {
  pending: "待审阅",
  accepting: "正在应用",
  accepted: "已接受",
  rejected: "已拒绝",
  conflict: "版本冲突",
  error: "应用失败"
};

const proposalStatusMessages: Record<AgentEditProposal["status"], string> = {
  pending: "接受后将应用到当前文稿并自动保存到本机。",
  accepting: "正在校验版本、应用变更并保存……",
  accepted: "变更已应用并保存到本机。",
  rejected: "已保留当前文稿，未应用这次变更。",
  conflict: "文稿版本已经变化，未覆盖你的最新内容。",
  error: "变更未能应用，请检查运行详情。"
};

function proposalStatusLabel(proposal: AgentEditProposal): string {
  return proposalStatusLabels[proposal.status];
}

function proposalAcceptLabel(proposal: AgentEditProposal): string {
  if (proposal.status === "accepting") return "保存中…";
  return proposal.status === "error" ? "重试接受并保存" : "接受并保存";
}

function proposalStatusMessage(
  proposal: AgentEditProposal,
  messageStatus: ChatMessage["status"]
): string {
  if (
    messageStatus === "streaming" &&
    (proposal.status === "pending" || proposal.status === "error")
  ) {
    return "生成完成后可审阅。";
  }
  return proposal.statusMessage?.trim() || proposalStatusMessages[proposal.status];
}

function reviewEditProposal(
  proposal: AgentEditProposal,
  decision: "accept" | "reject",
  messageStatus: ChatMessage["status"]
): void {
  if (messageStatus === "streaming") {
    return;
  }
  const reviewable =
    proposal.status === "pending" ||
    proposal.status === "error" ||
    (decision === "reject" && proposal.status === "conflict");
  if (!reviewable) {
    return;
  }
  emit("reviewEdit", {
    runId: proposal.runId,
    proposalId: proposal.id,
    decision
  });
}

function diffLineMark(type: "context" | "addition" | "deletion"): string {
  if (type === "addition") return "+";
  if (type === "deletion") return "−";
  return " ";
}

async function copyMessage(message: ChatMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.content);
    copiedMessageId.value = message.id;
    if (copiedTimer !== undefined) {
      globalThis.clearTimeout(copiedTimer);
    }
    copiedTimer = globalThis.setTimeout(() => {
      copiedMessageId.value = null;
    }, 1_500);
    uiMessage.success("已复制回复");
  } catch {
    uiMessage.error("复制失败，请稍后重试。");
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
        <div>
          <strong>{{ agentLabel }}</strong>
          <span class="context-caption">主上下文：{{ contextTitle }}</span>
        </div>
      </div>
      <div class="conversation-header-actions">
        <div class="conversation-history-control" @keydown.esc.stop="historyOpen = false">
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
              <button type="button" aria-label="关闭历史对话" @click="historyOpen = false">
                <AppIcon name="close" :size="15" />
              </button>
            </header>
            <div v-if="conversationHistory.length" class="conversation-history-list">
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
                  <AppIcon :name="item.current ? 'check' : 'message'" :size="15" />
                </span>
                <span class="conversation-history-copy">
                  <span class="conversation-history-title-row">
                    <strong>{{ item.title }}</strong>
                    <time :datetime="item.updatedAt">{{ formatHistoryTime(item.updatedAt) }}</time>
                  </span>
                  <small>{{ item.preview || '暂无回复内容' }}</small>
                  <span class="conversation-history-meta">
                    {{ item.current ? '当前对话' : `${item.turnCount} 轮 · ${item.messageCount} 条消息` }}
                  </span>
                </span>
              </button>
            </div>
            <div v-else class="conversation-history-empty">
              <AppIcon name="history" :size="22" />
              <strong>还没有历史对话</strong>
              <span>发送消息后，对话会自动保存在这里。</span>
            </div>
            <p v-if="responding" class="conversation-history-running-note">
              当前回复完成或停止后，可切换到其他对话。
            </p>
          </section>
        </div>
        <button class="header-text-button" type="button" @click="emit('newConversation')">
          <AppIcon name="plus" :size="16" />
          新建对话
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

    <section
      ref="scroller"
      class="conversation-scroll"
      aria-live="polite"
      @scroll.passive="handleConversationScroll"
    >
      <div v-if="messages.length === 0" class="conversation-empty">
        <span class="empty-agent-mark"><AppIcon name="logo" :size="40" /></span>
        <h1>{{ welcomeContent.title }}</h1>
        <p>{{ welcomeContent.description }}</p>
        <div class="empty-suggestions">
          <button
            v-for="item in welcomeContent.questions"
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
        <article
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="[
            `is-${message.role}`,
            {
              'is-empty-error':
                message.role === 'assistant' &&
                message.status === 'error' &&
                !message.content &&
                !hasProcessing(message) &&
                !message.editProposals?.length
            }
          ]"
        >
          <div class="message-body">
            <div
              v-if="message.role === 'assistant' && hasProcessing(message) && message.status === 'streaming'"
              class="processing-live-list"
              aria-label="运行过程"
            >
              <div class="processing-live-status" aria-live="off">
                {{ processingLabel(message) }}
              </div>
              <template v-for="item in processingDisplayItems(message)" :key="item.id">
                <details
                  v-if="item.type === 'thinking'"
                  class="processing-live-item processing-live-thinking"
                >
                  <summary>
                    <span>思考中</span>
                    <AppIcon name="chevron" :size="13" />
                  </summary>
                  <div class="processing-live-body processing-thinking">
                    <MessageMarkdown :content="item.content" />
                  </div>
                </details>
                <div
                  v-else-if="item.type === 'response'"
                  class="processing-step processing-response"
                >
                  <MessageMarkdown :content="item.content" />
                </div>
                <details
                  v-else-if="item.type === 'tool'"
                  class="processing-live-item processing-live-tool"
                >
                  <summary>
                    <div
                      class="tool-trace"
                      :class="[`is-${item.tool.status}`, { 'is-write': isWriteTool(item.tool) }]"
                    >
                      <AppIcon v-if="!isWriteTool(item.tool)" :name="toolIcon(item.tool)" :size="17" />
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
                  </summary>
                  <div class="processing-live-body tool-detail">
                    <div v-if="isWriteTool(item.tool)" class="write-tool-detail">
                      <div class="write-tool-output-heading">
                        <span>写入内容</span>
                        <small v-if="writeToolTarget(item.tool)">{{ writeToolTarget(item.tool) }}</small>
                        <small>{{ writeToolText(item.tool).length.toLocaleString('zh-CN') }} 字符</small>
                      </div>
                      <pre
                        class="write-tool-output"
                        :class="{ 'is-streaming': item.tool.status === 'preparing' }"
                      >{{ writeToolText(item.tool) || '正在等待写入内容……' }}</pre>
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
                </details>
                <details
                  v-else
                  class="processing-live-item processing-live-thinking processing-tool-group"
                  :aria-busy="toolGroupIsRunning(item.tools)"
                >
                  <summary>
                    <span>{{ toolGroupLabel(item.tools) }}</span>
                    <AppIcon name="chevron" :size="13" />
                  </summary>
                  <div class="processing-live-body tool-call-list" aria-label="工具调用列表">
                    <details
                      v-for="tool in item.tools"
                      :key="tool.id"
                      class="processing-live-item processing-live-tool tool-call-list-item"
                    >
                      <summary>
                        <div class="tool-trace" :class="`is-${tool.status}`">
                          <AppIcon :name="toolIcon(tool)" :size="17" />
                          <div>
                            <strong>{{ toolLabel(tool) }}</strong>
                            <span v-if="toolDetail(tool)">{{ toolDetail(tool) }}</span>
                          </div>
                        </div>
                        <AppIcon name="chevron" :size="13" />
                      </summary>
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
                    </details>
                  </div>
                </details>
              </template>
            </div>
            <details
              v-else-if="message.role === 'assistant' && hasProcessing(message)"
              class="processing-block"
            >
              <summary>
                <span>{{ processingLabel(message) }}</span>
                <AppIcon name="chevron" :size="13" />
              </summary>
              <div class="processing-content">
                <template v-for="item in processingDisplayItems(message)" :key="item.id">
                  <details
                    v-if="item.type === 'thinking'"
                    class="processing-live-item processing-live-thinking"
                  >
                    <summary>
                      <span>思考过程</span>
                      <AppIcon name="chevron" :size="13" />
                    </summary>
                    <div class="processing-live-body processing-thinking">
                      <MessageMarkdown :content="item.content" />
                    </div>
                  </details>
                  <div
                    v-else-if="item.type === 'response'"
                    class="processing-step processing-response"
                  >
                    <MessageMarkdown :content="item.content" />
                  </div>
                  <details
                    v-else-if="item.type === 'tool'"
                    class="processing-live-item processing-live-tool"
                  >
                    <summary>
                      <div
                        class="tool-trace"
                        :class="[`is-${item.tool.status}`, { 'is-write': isWriteTool(item.tool) }]"
                      >
                        <AppIcon v-if="!isWriteTool(item.tool)" :name="toolIcon(item.tool)" :size="17" />
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
                    </summary>
                    <div class="processing-live-body tool-detail">
                      <div v-if="isWriteTool(item.tool)" class="write-tool-detail">
                        <div class="write-tool-output-heading">
                          <span>写入内容</span>
                          <small v-if="writeToolTarget(item.tool)">{{ writeToolTarget(item.tool) }}</small>
                          <small>{{ writeToolText(item.tool).length.toLocaleString('zh-CN') }} 字符</small>
                        </div>
                        <pre class="write-tool-output">{{ writeToolText(item.tool) || '没有写入内容' }}</pre>
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
                  </details>
                  <details
                    v-else
                    class="processing-live-item processing-live-thinking processing-tool-group"
                  >
                    <summary>
                      <span>{{ toolGroupLabel(item.tools) }}</span>
                      <AppIcon name="chevron" :size="13" />
                    </summary>
                    <div class="processing-live-body tool-call-list" aria-label="工具调用列表">
                      <details
                        v-for="tool in item.tools"
                        :key="tool.id"
                        class="processing-live-item processing-live-tool tool-call-list-item"
                      >
                        <summary>
                          <div class="tool-trace" :class="`is-${tool.status}`">
                            <AppIcon :name="toolIcon(tool)" :size="17" />
                            <div>
                              <strong>{{ toolLabel(tool) }}</strong>
                              <span v-if="toolDetail(tool)">{{ toolDetail(tool) }}</span>
                            </div>
                          </div>
                          <AppIcon name="chevron" :size="13" />
                        </summary>
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
                      </details>
                    </div>
                  </details>
                </template>
              </div>
            </details>
            <div
              v-if="message.role === 'user'"
              class="message-copy user-message-copy"
            >
              <div
                v-if="message.attachments?.length"
                class="message-attachment-list"
                aria-label="本条消息的附件"
              >
                <span
                  v-for="attachment in message.attachments"
                  :key="attachment.id"
                  class="message-attachment-chip"
                  :title="`${attachment.name} · ${formatFileSize(attachment.size)}`"
                >
                  <AppIcon :name="attachment.kind === 'image' ? 'image' : 'file'" :size="14" />
                  <span>{{ attachment.name }}</span>
                  <small v-if="attachment.truncated">已截断</small>
                </span>
              </div>
              {{ message.content }}
            </div>
            <div
              v-else-if="visibleResponse(message)"
              class="message-copy"
              :class="{ 'is-streaming': message.status === 'streaming' }"
            >
              <MessageMarkdown :content="visibleResponse(message)" />
            </div>
            <div v-if="message.status === 'stopped'" class="message-stopped-copy">
              已停止生成
            </div>
            <section
              v-if="message.role === 'assistant' && message.editProposals?.length"
              class="edit-proposal-list"
              aria-label="文稿变更提案"
            >
              <article
                v-for="proposal in message.editProposals"
                :key="proposal.id"
                class="edit-proposal-card"
                :class="`is-${proposal.status}`"
                :aria-busy="proposal.status === 'accepting'"
              >
                <header class="edit-proposal-header">
                  <span class="edit-proposal-icon" aria-hidden="true">
                    <AppIcon name="file" :size="17" />
                  </span>
                  <div class="edit-proposal-heading">
                    <div class="edit-proposal-title-row">
                      <strong>{{ proposal.title }}</strong>
                      <span class="edit-proposal-status" :class="`is-${proposal.status}`">
                        {{ proposalStatusLabel(proposal) }}
                      </span>
                    </div>
                    <p>{{ proposal.summary }}</p>
                  </div>
                  <div
                    class="edit-proposal-stats"
                    :aria-label="`增加 ${proposal.additions} 行，删除 ${proposal.deletions} 行`"
                  >
                    <span class="is-addition">+{{ proposal.additions }}</span>
                    <span class="is-deletion">−{{ proposal.deletions }}</span>
                  </div>
                </header>

                <details v-if="proposal.hunks.length" class="edit-proposal-diff">
                  <summary>
                    <span>查看差异</span>
                    <small>{{ proposal.hunks.length }} 个变更块</small>
                    <AppIcon name="chevron" :size="13" />
                  </summary>
                  <div class="edit-diff-content">
                    <div
                      v-for="(hunk, hunkIndex) in proposal.hunks"
                      :key="`${proposal.id}-hunk-${hunkIndex}`"
                      class="edit-diff-hunk"
                    >
                      <div class="edit-diff-hunk-header">
                        @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{ hunk.newStart }},{{ hunk.newLines }} @@
                      </div>
                      <div
                        v-for="(line, lineIndex) in hunk.lines"
                        :key="`${proposal.id}-${hunkIndex}-${lineIndex}`"
                        class="edit-diff-line"
                        :class="`is-${line.type}`"
                      >
                        <span class="edit-diff-line-number">{{ line.oldLineNumber ?? "" }}</span>
                        <span class="edit-diff-line-number">{{ line.newLineNumber ?? "" }}</span>
                        <span class="edit-diff-line-mark" aria-hidden="true">
                          {{ diffLineMark(line.type) }}
                        </span>
                        <code>{{ line.text }}</code>
                      </div>
                    </div>
                    <p v-if="proposal.truncated" class="edit-diff-truncated">
                      差异较大，仅显示部分变更；行数统计包含完整提案。
                    </p>
                  </div>
                </details>
                <p v-else class="edit-proposal-empty">没有可显示的行级差异。</p>

                <footer class="edit-proposal-footer">
                  <span class="edit-proposal-message">
                    {{ proposalStatusMessage(proposal, message.status) }}
                  </span>
                  <div
                    v-if="
                      proposal.status === 'pending' ||
                      proposal.status === 'accepting' ||
                      proposal.status === 'error' ||
                      proposal.status === 'conflict'
                    "
                    class="edit-proposal-actions"
                  >
                    <button
                      class="edit-review-button is-reject"
                      type="button"
                      :disabled="message.status === 'streaming' || proposal.status === 'accepting'"
                      @click="reviewEditProposal(proposal, 'reject', message.status)"
                    >
                      拒绝
                    </button>
                    <button
                      v-if="proposal.status !== 'conflict'"
                      class="edit-review-button is-accept"
                      type="button"
                      :disabled="message.status === 'streaming' || proposal.status === 'accepting'"
                      @click="reviewEditProposal(proposal, 'accept', message.status)"
                    >
                      {{ proposalAcceptLabel(proposal) }}
                    </button>
                  </div>
                </footer>
              </article>
            </section>
            <div
              v-if="message.role === 'assistant' && message.content && message.status !== 'streaming'"
              class="message-actions"
            >
              <button type="button" :aria-label="copiedMessageId === message.id ? '已复制' : '复制回复'" @click="copyMessage(message)">
                <AppIcon :name="copiedMessageId === message.id ? 'check' : 'copy'" :size="15" />
              </button>
              <span>{{ formatTime(message.createdAt) }}</span>
            </div>
          </div>
        </article>

        <article v-if="responding && !hasStreamingAssistant" class="message is-assistant is-thinking">
          <div class="thinking-row">
            <span>正在思考</span>
          </div>
        </article>
      </div>
    </section>

    <footer class="composer-wrap">
      <div class="composer-stack">
        <div
          v-if="activeReference"
          id="composer-reference-menu"
          class="composer-reference-menu"
          role="listbox"
          :aria-label="referenceMenuTitle"
        >
          <div class="composer-reference-heading">
            <span class="composer-reference-trigger">{{ activeReference.trigger }}</span>
            <div>
              <strong>{{ referenceMenuTitle }}</strong>
              <span>{{ referenceMenuHint }}</span>
            </div>
            <kbd>Esc</kbd>
          </div>
          <div v-if="filteredReferenceOptions.length" class="composer-reference-options">
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
                <AppIcon :name="activeReference.trigger === '/' ? 'sparkles' : 'archive'" :size="17" />
              </span>
              <span class="composer-reference-copy">
                <strong>{{ option.label }}</strong>
                <small>{{ option.detail }}</small>
              </span>
              <span class="composer-reference-token">{{ activeReference.trigger }}</span>
            </button>
          </div>
          <div v-else class="composer-reference-empty">
            {{ referenceOptions.length ? "没有匹配的内容" : activeReference.trigger === "/" ? "当前智能体没有可调用的技能" : "当前智能体没有可用素材" }}
          </div>
          <div class="composer-reference-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 插入</span>
          </div>
        </div>

        <div class="composer" :class="{ 'is-disabled': responding }">
          <div
            v-if="messages.length === 0"
            class="composer-context-bar"
            role="group"
            :aria-label="`当前绑定：书籍 ${bookTitle}，阶段 ${stageLabel}`"
          >
            <div class="composer-context-item composer-book-context" :title="`当前书籍：${bookTitle}`">
              <AppIcon name="book" :size="16" />
              <strong>{{ bookTitle }}</strong>
            </div>
            <div class="composer-context-item composer-stage-context" :title="`当前阶段：${stageLabel}`">
              <AppIcon name="wand" :size="16" />
              <strong>{{ stageLabel }}</strong>
            </div>
          </div>
          <div class="composer-input-surface">
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
              v-if="pendingAttachments.length || readingAttachments"
              class="composer-attachment-list"
              aria-label="待发送附件"
            >
              <article
                v-for="attachment in pendingAttachments"
                :key="attachment.id"
                class="composer-attachment-chip"
              >
                <img
                  v-if="attachmentPreview(attachment)"
                  :src="attachmentPreview(attachment)"
                  alt=""
                />
                <span v-else class="composer-attachment-icon" aria-hidden="true">
                  <AppIcon name="file" :size="16" />
                </span>
                <span class="composer-attachment-copy">
                  <strong>{{ attachment.name }}</strong>
                  <small>
                    {{ attachment.kind === 'image' ? '图片' : attachment.mediaType === 'application/pdf' ? 'PDF 文本' : '文本' }}
                    · {{ formatFileSize(attachment.size) }}
                    <template v-if="attachment.kind === 'text' && attachment.truncated"> · 已截断</template>
                  </small>
                </span>
                <button
                  type="button"
                  :aria-label="`移除附件 ${attachment.name}`"
                  :disabled="responding"
                  @click="removePendingAttachment(attachment.id)"
                >
                  <AppIcon name="close" :size="13" />
                </button>
              </article>
              <span v-if="readingAttachments" class="composer-attachment-loading">
                正在读取附件…
              </span>
            </div>
            <textarea
              ref="composerInput"
              :value="draft"
              rows="1"
              :placeholder="runtimeAvailable ? '随心输入，输入 / 调用技能，输入 @ 引用素材……' : '浏览器预览不可发送，请启动桌面客户端'"
              aria-label="智能体消息"
              aria-autocomplete="list"
              :aria-expanded="Boolean(activeReference)"
              :aria-controls="activeReference ? 'composer-reference-menu' : undefined"
              :aria-activedescendant="activeReference && filteredReferenceOptions.length ? `composer-reference-option-${activeReferenceIndex}` : undefined"
              :disabled="responding || !runtimeAvailable"
              @blur="closeReferenceMenu"
              @click="updateActiveReference($event.target as HTMLTextAreaElement)"
              @input="handleInput"
              @keydown="handleKeydown"
            />
            <div class="composer-toolbar">
              <div class="composer-tools">
                <button
                  class="round-tool-button"
                  type="button"
                  aria-label="上传附件"
                  title="上传 TXT、MD、PDF 或图片"
                  :disabled="responding || !runtimeAvailable || readingAttachments"
                  @click="openAttachmentPicker"
                >
                  <AppIcon name="plus" :size="18" />
                </button>
                <PopupSelect
                  :model-value="selectedModelId"
                  :options="modelOptions"
                  accessible-label="选择模型"
                  placeholder="选择模型"
                  variant="compact"
                  :menu-min-width="210"
                  @update:model-value="handleModelChange"
                >
                  <template #prefix><AppIcon name="model" :size="14" /></template>
                </PopupSelect>
                <PopupSelect
                  :model-value="thinkingLevel"
                  :options="availableThinkingOptions"
                  accessible-label="选择思考等级"
                  variant="compact"
                  :menu-min-width="180"
                  @update:model-value="handleThinkingChange"
                >
                  <template #prefix><AppIcon name="brain" :size="14" /></template>
                </PopupSelect>
                <PopupSelect
                  v-if="showsTemperature"
                  :model-value="temperature"
                  :options="temperatureSelectOptions"
                  accessible-label="选择温度"
                  variant="compact"
                  :menu-min-width="160"
                  @update:model-value="handleTemperatureChange"
                >
                  <template #prefix><AppIcon name="temperature" :size="14" /></template>
                </PopupSelect>
              </div>
              <div class="composer-actions">
                <PopupSelect
                  :model-value="approvalMode"
                  :options="approvalOptions"
                  accessible-label="选择正文修改权限"
                  variant="compact"
                  align="end"
                  :menu-min-width="300"
                  @update:model-value="handleApprovalChange"
                >
                  <template #prefix><AppIcon :name="approvalModeIcon" :size="14" /></template>
                </PopupSelect>
                <button class="round-tool-button" type="button" aria-label="语音输入">
                  <AppIcon name="mic" :size="18" />
                </button>
                <button
                  v-if="!responding"
                  class="send-button"
                  type="button"
                  aria-label="发送消息"
                  :disabled="!canSubmit"
                  @click="submitMessage"
                >
                  <AppIcon name="arrow-up" :size="18" />
                </button>
                <button
                  v-else
                  class="send-button stop-button"
                  type="button"
                  aria-label="停止生成"
                  title="停止生成"
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
      <p class="composer-note">Enter 发送 · Shift + Enter 换行 · + 附件 · / 技能 · @ 素材</p>
    </footer>
  </main>
</template>
