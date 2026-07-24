<script setup lang="ts">
import { computed } from "vue";
import type {
  AgentSubagentRun,
  AgentToolTrace,
  ChatMessage
} from "../types/conversation";
import type { IconName } from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import MessageMarkdown from "./MessageMarkdown.vue";

const props = defineProps<{
  message: ChatMessage;
  now: number;
}>();

const runs = computed(() => props.message.subagentRuns ?? []);

type SubagentDisplayItem =
  | { id: string; type: "thinking"; content: string; createdAt: string }
  | { id: string; type: "response"; content: string; createdAt: string }
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt: string };

type SubagentProcessingDisplayItem =
  | Exclude<SubagentDisplayItem, { type: "tool" }>
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt: string }
  | { id: string; type: "tool-group"; tools: AgentToolTrace[] };

const WRITE_TOOL_NAMES = new Set([
  "write_workspace_editor",
  "replace_current_stage_text",
  "create_expert_draft_sections",
  "write_expert_draft_section",
  "replace_expert_draft_section_text",
  "edit_expert_draft_section",
  "replace_section_body_text",
  "write_section_body",
  "replace_character_state_text",
  "write_character_state"
]);

const DIRECT_WRITE_TOOL_NAMES = new Set([
  "write_workspace_editor",
  "create_expert_draft_sections",
  "write_expert_draft_section",
  "write_section_body",
  "write_character_state"
]);

const WORKSPACE_TOOL_LABELS: Record<string, string> = {
  read_workspace_content: "读取工作区内容",
  search_workspace_text: "搜索工作区文本",
  query_linked_material_entries: "查询关联素材",
  load_skill: "加载技能",
  switch_storyline_stage: "切换剧情方向",
  write_workspace_editor: "写入阶段编辑器",
  replace_current_stage_text: "替换阶段文本",
  create_expert_draft_sections: "创建章节文件",
  read_all_expert_draft: "读取全部正文",
  write_expert_draft_section: "写入正文小节",
  replace_expert_draft_section_text: "替换正文小节文本",
  edit_expert_draft_section: "编辑正文",
  read_expert_draft_section: "读取正文小节",
  read_expert_character_state: "读取人物状态",
  replace_section_body_text: "替换小节正文",
  write_section_body: "写入小节正文",
  replace_character_state_text: "替换人物状态",
  write_character_state: "写入人物状态"
};

type ToolKind = "read" | "command" | "write" | "web" | "other";

function isWriteTool(tool: AgentToolTrace): boolean {
  return WRITE_TOOL_NAMES.has(tool.name) || toolKind(tool.name) === "write";
}

function writeToolAction(tool: AgentToolTrace): "write" | "modify" {
  return DIRECT_WRITE_TOOL_NAMES.has(tool.name) || /(?:write|save)/i.test(tool.name)
    ? "write"
    : "modify";
}

function writeActionLabel(action: "write" | "modify"): "写入" | "修改" {
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
  if (kind === "read") return "folder";
  if (kind === "command") return "terminal";
  if (kind === "write") return "file";
  if (kind === "web") return "globe";
  return "sparkles";
}

function workspaceToolLabel(name: string): string {
  return WORKSPACE_TOOL_LABELS[name] ?? name;
}

function toolLabel(tool: AgentToolTrace): string {
  const displayName = workspaceToolLabel(tool.name);
  if (isWriteTool(tool)) {
    const action = writeActionLabel(writeToolAction(tool));
    if (tool.status === "error") return `${action}失败`;
    if (tool.status === "completed") return `${action}结果已生成`;
    return `正在${action}`;
  }
  if (tool.status === "error") return `执行 ${displayName} 时出错`;
  if (tool.status === "preparing") return `正在准备${displayName}`;
  const running = tool.status === "running";
  const kind = toolKind(tool.name);
  if (kind === "read") return running ? "正在读取文件" : "已读取文件";
  if (kind === "command") return running ? "正在运行命令" : "运行了命令";
  if (kind === "write") return running ? "正在提交文本变更" : "已生成文本变更";
  if (kind === "web") return running ? "正在访问页面" : "已访问页面";
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
          replacement &&
          typeof replacement === "object" &&
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
            ]
              .filter(Boolean)
              .join("\n")
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
  if (value === undefined || value === null) return undefined;
  try {
    const formatted = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return formatted.length > 3_000 ? `${formatted.slice(0, 3_000)}\n…` : formatted;
  } catch {
    return String(value);
  }
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
  if (!tool.args || typeof tool.args !== "object") return undefined;
  const args = tool.args as Record<string, unknown>;
  for (const key of ["path", "file", "command", "query", "url"]) {
    if (typeof args[key] === "string") return compactTrace(args[key]);
  }
  try {
    return compactTrace(JSON.stringify(args));
  } catch {
    return undefined;
  }
}

function subagentDisplayItems(run: AgentSubagentRun): SubagentDisplayItem[] {
  if (run.processingSteps.length) {
    const items: SubagentDisplayItem[] = [];
    for (const step of run.processingSteps) {
      if (step.type === "thinking" || step.type === "response") {
        items.push({ ...step });
        continue;
      }
      const tool = run.toolCalls.find((candidate) => candidate.id === step.toolCallId);
      if (tool) {
        items.push({ id: step.id, type: "tool", tool, createdAt: step.createdAt });
      }
    }
    return items;
  }

  const items: SubagentDisplayItem[] = [];
  if (run.thinking) {
    items.push({
      id: `${run.subagentRunId}_thinking`,
      type: "thinking",
      content: run.thinking,
      createdAt: run.startedAt
    });
  }
  if (run.output) {
    items.push({
      id: `${run.subagentRunId}_response`,
      type: "response",
      content: run.output,
      createdAt: run.startedAt
    });
  }
  for (const tool of run.toolCalls) {
    items.push({
      id: `${run.subagentRunId}_${tool.id}`,
      type: "tool",
      tool,
      createdAt: tool.requestedAt
    });
  }
  return items;
}

function subagentProcessingDisplayItems(
  run: AgentSubagentRun
): SubagentProcessingDisplayItem[] {
  const displayItems: SubagentProcessingDisplayItem[] = [];
  for (const item of subagentDisplayItems(run)) {
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

const subagentStatusLabels: Record<AgentSubagentRun["status"], string> = {
  running: "执行中",
  completed: "已完成",
  error: "失败",
  stopped: "已停止"
};

function subagentStatusLabel(run: AgentSubagentRun): string {
  return subagentStatusLabels[run.status];
}

function subagentDuration(run: AgentSubagentRun): string {
  const start = Date.parse(run.startedAt);
  const end = run.completedAt
    ? Date.parse(run.completedAt)
    : run.status === "running"
      ? props.now
      : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.ceil((end - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function subagentPendingReviewCount(
  message: ChatMessage,
  run: AgentSubagentRun
): number {
  const toolCallIds = new Set(run.toolCalls.map((toolCall) => toolCall.id));
  return (message.editProposals ?? []).filter(
    (proposal) =>
      (proposal.status === "pending" || proposal.status === "accepting") &&
      proposal.toolCallIds.some((toolCallId) => toolCallIds.has(toolCallId))
  ).length;
}

function subagentWriteToolCount(run: AgentSubagentRun): number {
  return run.toolCalls.filter(isWriteTool).length;
}

function subagentReviewHint(
  message: ChatMessage,
  run: AgentSubagentRun
): string | undefined {
  const pendingCount = subagentPendingReviewCount(message, run);
  if (pendingCount > 0) return `${pendingCount} 项待审阅`;
  const writeCount = subagentWriteToolCount(run);
  return writeCount > 0 ? `${writeCount} 次写入调用` : undefined;
}

function subagentUsageLabel(run: AgentSubagentRun): string | undefined {
  return run.usage
    ? `${run.usage.totalTokens.toLocaleString("zh-CN")} tokens`
    : undefined;
}
</script>

<template>
  <section
    v-if="runs.length"
    class="subagent-run-list"
    aria-label="子智能体执行记录"
  >
    <details
      v-for="run in runs"
      :key="run.parentToolCallId"
      class="subagent-run-card"
      :class="`is-${run.status}`"
      :aria-busy="run.status === 'running'"
    >
      <summary>
        <span class="subagent-run-icon" aria-hidden="true">
          <AppIcon name="user" :size="17" />
        </span>
        <span class="subagent-run-heading">
          <span class="subagent-run-title-row">
            <strong>{{ run.name }}</strong>
            <span class="subagent-run-status" :class="`is-${run.status}`">
              {{ subagentStatusLabel(run) }}
            </span>
          </span>
          <span class="subagent-run-task">{{ run.task }}</span>
        </span>
        <span class="subagent-run-meta" aria-label="子任务运行摘要">
          <span v-if="subagentDuration(run)">{{ subagentDuration(run) }}</span>
          <span>{{ run.toolCalls.length }} 个工具</span>
          <span v-if="subagentReviewHint(message, run)" class="is-review">
            {{ subagentReviewHint(message, run) }}
          </span>
        </span>
        <AppIcon class="subagent-run-chevron" name="chevron" :size="14" />
      </summary>

      <div class="subagent-run-detail">
        <div
          v-if="subagentProcessingDisplayItems(run).length"
          class="subagent-processing-list"
          aria-label="子智能体执行过程"
        >
          <template
            v-for="item in subagentProcessingDisplayItems(run)"
            :key="item.id"
          >
            <details
              v-if="item.type === 'thinking'"
              class="processing-live-item processing-live-thinking"
            >
              <summary>
                <span>{{ run.status === 'running' ? '思考中' : '思考过程' }}</span>
                <AppIcon name="chevron" :size="13" />
              </summary>
              <div class="processing-live-body processing-thinking">
                <MessageMarkdown :content="item.content" />
              </div>
            </details>
            <div
              v-else-if="item.type === 'response'"
              class="processing-step processing-response subagent-processing-response"
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
                <AppIcon
                  v-if="!isWriteTool(item.tool)"
                  name="chevron"
                  :size="13"
                />
              </summary>
              <div class="processing-live-body tool-detail">
                <div v-if="isWriteTool(item.tool)" class="write-tool-detail">
                  <div class="write-tool-output-heading">
                    <span>写入内容</span>
                    <small v-if="writeToolTarget(item.tool)">
                      {{ writeToolTarget(item.tool) }}
                    </small>
                    <small>
                      {{ writeToolText(item.tool).length.toLocaleString('zh-CN') }} 字符
                    </small>
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
        <div v-else-if="run.status === 'running'" class="subagent-run-waiting">
          正在启动独立上下文并接收执行事件…
        </div>

        <section
          v-if="run.summary || run.errorMessage"
          class="subagent-run-handoff"
          :class="{ 'is-error': run.status === 'error' }"
        >
          <strong>{{ run.status === 'completed' ? '交接摘要' : '结束说明' }}</strong>
          <MessageMarkdown v-if="run.summary" :content="run.summary" />
          <p v-if="run.errorMessage">{{ run.errorMessage }}</p>
          <small v-if="subagentUsageLabel(run)">{{ subagentUsageLabel(run) }}</small>
        </section>
      </div>
    </details>
  </section>
</template>
