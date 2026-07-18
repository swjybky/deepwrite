import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type Usage,
  type UserMessage
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type {
  AgentProviderRuntimeConfig,
  AgentRuntimeRef,
  AgentUsage,
  ShortWorkspaceAgentProfile,
  ModelConnectionTestResult,
  ThinkingLevel,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  buildShortWorkspaceTools,
  isShortWorkspaceToolDetails
} from "./short-agent-tools";

export interface AgentRunInput {
  runId: string;
  sessionId: string;
  prompt: string;
  thinkingLevel?: ThinkingLevel;
  runtimeConfig?: AgentProviderRuntimeConfig;
  agentProfile?: ShortWorkspaceAgentProfile;
  workspaceContext?: WorkspaceRuntimeContext;
  signal?: AbortSignal;
}

export type AgentRuntimeEvent =
  | {
      type: "agent.delta";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        delta: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.thinking_delta";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        delta: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.completed";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        content: string;
        thinking?: string;
        stopReason?: string;
        usage?: AgentUsage;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.tool_requested";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        toolName: string;
        args: unknown;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.tool_completed";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        toolName: string;
        resultSummary: string;
        isError: boolean;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "workspace.editor_mutation";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        workspaceId: string;
        stageId: import("@deepwrite/contracts").ShortWorkspaceStageId;
        text: string;
        baseRevision: string;
        summary: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "workspace.stage_selection";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        workspaceId: string;
        stageId: import("@deepwrite/contracts").ShortWorkspaceStageId;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.error";
      runId: string;
      sessionId: string;
      payload: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
        runtime?: AgentRuntimeRef;
      };
    };

export interface AgentRuntime {
  describe(): AgentRuntimeRef;
  start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}

export interface PiRuntimeAdapterOptions {
  requestTimeoutMs?: number;
  tokensPerSecond?: number;
  systemPrompt?: string;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      }
    };
  }
}

const DEEPWRITE_FAUX_RUNTIME: AgentRuntimeRef = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux"
};

export class PiAgentRuntimeAdapter implements AgentRuntime {
  private readonly requestTimeoutMs: number;
  private readonly tokensPerSecond: number;
  private readonly systemPrompt: string;
  private readonly conversationAgents = new Map<string, Agent>();

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
    this.tokensPerSecond = options.tokensPerSecond ?? 90;
    this.systemPrompt = options.systemPrompt ?? buildDeepWriteSystemPrompt();
  }

  describe(config?: AgentProviderRuntimeConfig): AgentRuntimeRef {
    if (config) {
      return {
        provider: config.provider,
        model: config.modelId,
        mode: "provider"
      };
    }
    return { ...DEEPWRITE_FAUX_RUNTIME };
  }

  async testConnection(
    config: AgentProviderRuntimeConfig
  ): Promise<ModelConnectionTestResult> {
    const { model, streamFn } = buildProviderRuntime(config);
    const stream = streamFn(
      model,
      {
        systemPrompt: "You are a connection test. Reply with OK only.",
        messages: [{ role: "user", content: "OK", timestamp: Date.now() }]
      },
      {
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        maxTokens: 8,
        maxRetries: 0,
        timeoutMs: 15_000
      }
    );
    const result = await (await stream).result();
    if (result.stopReason === "error" || result.stopReason === "aborted") {
      throw new Error(result.errorMessage || "模型连接测试失败。");
    }
    return {
      modelId: config.id,
      ok: true,
      message: "连接成功，模型已返回有效响应。",
      testedAt: new Date().toISOString()
    };
  }

  async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const queue = new AsyncEventQueue<AgentRuntimeEvent>();
    const runtime = this.describe(input.runtimeConfig);
    const messageId = `${input.runId}_assistant`;
    let model: Model<Api>;
    let streamFn: StreamFn;
    let effectiveThinkingLevel: ThinkingLevel;

    if (input.runtimeConfig) {
      const providerRuntime = buildProviderRuntime(input.runtimeConfig);
      model = providerRuntime.model;
      streamFn = providerRuntime.streamFn;
      effectiveThinkingLevel = input.runtimeConfig.reasoning
        ? input.thinkingLevel ?? input.runtimeConfig.defaultThinkingLevel
        : "off";
    } else {
      const models = createModels();
      const faux = fauxProvider({
        api: "deepwrite-faux",
        provider: runtime.provider,
        models: [
          {
            id: runtime.model,
            name: "DeepWrite Local Writing Faux",
            reasoning: true,
            input: ["text"]
          }
        ],
        tokensPerSecond: this.tokensPerSecond,
        tokenSize: { min: 2, max: 4 }
      });
      models.setProvider(faux.provider);
      const fauxModel = faux.getModel(runtime.model);
      if (!fauxModel) {
        throw new Error("DeepWrite faux model is unavailable.");
      }
      model = fauxModel;
      streamFn = models.streamSimple.bind(models) as StreamFn;
      effectiveThinkingLevel = input.thinkingLevel ?? "medium";
      faux.setResponses([
        fauxAssistantMessage(
          effectiveThinkingLevel === "off"
            ? [fauxText(buildLocalWritingResponse(input))]
            : [
                fauxThinking(buildLocalThinking(input)),
                fauxText(buildLocalWritingResponse(input))
              ]
        )
      ]);
    }

    const shortWorkspace = input.workspaceContext?.shortWorkspace;
    const tools = shortWorkspace && input.agentProfile
      ? buildShortWorkspaceTools({
          workspace: shortWorkspace,
          profile: input.agentProfile,
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials
        })
      : [];
    const systemPrompt = buildEffectiveSystemPrompt(this.systemPrompt, input);
    const agentKey = `${input.sessionId}:${input.agentProfile?.id ?? "default"}`;
    let agent = this.conversationAgents.get(agentKey);
    if (agent) {
      if (agent.state.isStreaming) {
        throw new Error("The selected conversation agent is already running.");
      }
      agent.state.systemPrompt = systemPrompt;
      agent.state.model = model;
      agent.state.thinkingLevel = effectiveThinkingLevel;
      agent.state.tools = tools;
      agent.streamFn = streamFn;
      agent.sessionId = input.sessionId;
      agent.toolExecution = "sequential";
      this.conversationAgents.delete(agentKey);
      this.conversationAgents.set(agentKey, agent);
    } else {
      agent = new Agent({
        initialState: {
          systemPrompt,
          model,
          thinkingLevel: effectiveThinkingLevel,
          tools
        },
        streamFn,
        sessionId: input.sessionId,
        toolExecution: "sequential"
      });
      this.conversationAgents.set(agentKey, agent);
      this.trimConversationAgents();
    }

    let settled = false;
    let terminalEmitted = false;
    let timeout: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const emit = (event: AgentRuntimeEvent): void => {
      const terminal = event.type === "agent.completed" || event.type === "agent.error";
      if (terminalEmitted) {
        return;
      }
      if (terminal) {
        terminalEmitted = true;
      }
      queue.push(event);
    };

    const unsubscribe = agent.subscribe((event) => {
      for (const runtimeEvent of toRuntimeEvents(event, input, runtime, messageId)) {
        emit(runtimeEvent);
      }
    });

    const cleanup = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (abortListener && input.signal) {
        input.signal.removeEventListener("abort", abortListener);
      }
      unsubscribe();
      queue.close();
    };

    abortListener = () => {
      emit({
        type: "agent.error",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          code: "pi_agent.aborted",
          message: "智能体运行已中止。",
          runtime
        }
      });
      agent.abort();
      cleanup();
    };
    if (input.signal?.aborted) {
      abortListener();
    } else {
      input.signal?.addEventListener("abort", abortListener, { once: true });
    }

    if (!settled && this.requestTimeoutMs > 0) {
      timeout = setTimeout(() => {
        emit({
          type: "agent.error",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            code: "pi_agent.prompt_timeout",
            message: `智能体响应超时（${this.requestTimeoutMs}ms）。`,
            runtime
          }
        });
        agent.abort();
        cleanup();
      }, this.requestTimeoutMs);
      timeout.unref();
    }

    if (!settled) {
      const runtimeUserMessage: UserMessage = {
        role: "user",
        content: buildRuntimeUserPrompt(input),
        timestamp: Date.now()
      };
      void agent
        .prompt(runtimeUserMessage)
        .catch((error: unknown) => {
          emit({
            type: "agent.error",
            runId: input.runId,
            sessionId: input.sessionId,
            payload: {
              code: "pi_agent.prompt_failed",
              message: error instanceof Error ? error.message : "本地智能体请求失败。",
              details: { kind: error instanceof Error ? error.name : "unknown" },
              runtime
            }
          });
        })
        .finally(() => {
          replaceRuntimePromptInTranscript(agent, runtimeUserMessage, input.prompt);
          if (!terminalEmitted) {
            emit({
              type: "agent.error",
              runId: input.runId,
              sessionId: input.sessionId,
              payload: {
                code: "pi_agent.missing_terminal_event",
                message: "智能体运行结束，但没有收到完成事件。",
                runtime
              }
            });
          }
          cleanup();
        });
    }

    try {
      for await (const event of queue) {
        yield event;
      }
    } finally {
      if (!settled) {
        agent.abort();
        cleanup();
      }
    }
  }

  private trimConversationAgents(limit = 100): void {
    if (this.conversationAgents.size <= limit) return;
    for (const [key, agent] of this.conversationAgents) {
      if (this.conversationAgents.size <= limit) return;
      if (!agent.state.isStreaming) {
        this.conversationAgents.delete(key);
      }
    }
  }
}

function providerStreams(api: AgentProviderRuntimeConfig["api"]): ProviderStreams {
  if (api === "openai-completions") {
    return openAICompletionsApi();
  }
  if (api === "openai-responses") {
    return openAIResponsesApi();
  }
  if (api === "anthropic-messages") {
    return anthropicMessagesApi();
  }
  return googleGenerativeAIApi();
}

function findBuiltinModel(config: AgentProviderRuntimeConfig): Model<Api> | undefined {
  const provider = getBuiltinProviders().find(
    (candidate) => candidate.toLowerCase() === config.provider.toLowerCase()
  );
  if (!provider) {
    return undefined;
  }
  return getBuiltinModels(provider).find(
    (candidate) => candidate.id.toLowerCase() === config.modelId.toLowerCase()
  ) as Model<Api> | undefined;
}

function buildProviderRuntime(config: AgentProviderRuntimeConfig): {
  model: Model<Api>;
  streamFn: StreamFn;
} {
  const builtin = findBuiltinModel(config);
  const baseUrl = config.baseUrl || (builtin?.api === config.api ? builtin.baseUrl : "");
  if (!baseUrl) {
    throw new Error("当前模型不在 Pi 内置目录中，请填写 API 地址后再试。");
  }

  const model = {
    ...(builtin?.api === config.api ? builtin : {}),
    id: config.modelId,
    name: config.label,
    api: config.api,
    provider: config.provider,
    baseUrl,
    reasoning: config.reasoning,
    input: builtin?.input ?? ["text"],
    cost: builtin?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: builtin?.contextWindow ?? 128_000,
    maxTokens: builtin?.maxTokens ?? 8_192,
    ...(builtin?.headers ? { headers: builtin.headers } : {}),
    ...(builtin?.thinkingLevelMap ? { thinkingLevelMap: builtin.thinkingLevelMap } : {}),
    ...(builtin?.compat && builtin.api === config.api ? { compat: builtin.compat } : {})
  } as Model<Api>;
  const streams = providerStreams(config.api);
  const streamFn = (
    requestModel: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => streams.streamSimple(requestModel, context, {
    ...options,
    ...(config.apiKey
      ? { apiKey: config.apiKey }
      : options?.apiKey
        ? { apiKey: options.apiKey }
        : {})
  });
  return { model, streamFn: streamFn as StreamFn };
}

function toRuntimeEvents(
  event: AgentEvent,
  input: AgentRunInput,
  runtime: AgentRuntimeRef,
  messageId: string
): AgentRuntimeEvent[] {
  if (event.type === "tool_execution_start") {
    return [{
      type: "agent.tool_requested",
      runId: input.runId,
      sessionId: input.sessionId,
      payload: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        runtime
      }
    }];
  }

  if (event.type === "tool_execution_end") {
    const events: AgentRuntimeEvent[] = [{
      type: "agent.tool_completed",
      runId: input.runId,
      sessionId: input.sessionId,
      payload: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        resultSummary: summarizeToolResult(event.result),
        isError: event.isError,
        runtime
      }
    }];
    const details = (event.result as { details?: unknown } | undefined)?.details;
    if (isShortWorkspaceToolDetails(details)) {
      if (details.kind === "workspace-editor-mutation") {
        events.push({
          type: "workspace.editor_mutation",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            workspaceId: details.workspaceId,
            stageId: details.stageId,
            text: details.text,
            baseRevision: details.baseRevision,
            summary: details.summary,
            runtime
          }
        });
      } else if (details.kind === "workspace-stage-selection") {
        events.push({
          type: "workspace.stage_selection",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            workspaceId: details.workspaceId,
            stageId: details.stageId,
            runtime
          }
        });
      }
    }
    return events;
  }

  if (event.type === "message_update" && isAssistantMessage(event.message)) {
    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "text_delta") {
      return [{
        type: "agent.delta",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: { messageId, delta: streamEvent.delta, runtime }
      }];
    }
    if (streamEvent.type === "thinking_delta") {
      return [{
        type: "agent.thinking_delta",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: { messageId, delta: streamEvent.delta, runtime }
      }];
    }
  }

  if (event.type === "message_end" && isAssistantMessage(event.message)) {
    if (event.message.content.some((item) => item.type === "toolCall")) {
      return [];
    }
    if (
      event.message.stopReason === "error" ||
      event.message.stopReason === "aborted" ||
      event.message.errorMessage
    ) {
      return [{
        type: "agent.error",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          code:
            event.message.stopReason === "aborted"
              ? "pi_agent.aborted"
              : "pi_agent.provider_error",
          message:
            event.message.errorMessage ??
            (event.message.stopReason === "aborted"
              ? "智能体运行已中止。"
              : "模型返回错误终态。"),
          runtime
        }
      }];
    }

    const thinking = readAssistantThinking(event.message);
    return [{
      type: "agent.completed",
      runId: input.runId,
      sessionId: input.sessionId,
      payload: {
        messageId,
        content: readAssistantText(event.message),
        ...(thinking ? { thinking } : {}),
        ...(event.message.stopReason ? { stopReason: event.message.stopReason } : {}),
        usage: normalizeUsage(event.message.usage),
        runtime
      }
    }];
  }

  return [];
}

function summarizeToolResult(result: unknown): string {
  if (!result || typeof result !== "object") return "工具执行完成。";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "工具执行完成。";
  const text = content
    .filter(
      (item): item is { type: "text"; text: string } =>
        Boolean(item) &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string"
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
  return text.slice(0, 4_000) || "工具执行完成。";
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return typeof message === "object" && message !== null && message.role === "assistant";
}

function readAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}

function readAssistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "thinking")
    .map((item) => item.thinking)
    .join("\n\n");
}

function normalizeUsage(usage: Usage): AgentUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.totalTokens
  };
}

function replaceRuntimePromptInTranscript(
  agent: Agent,
  runtimeMessage: UserMessage,
  rawUserPrompt: string
): void {
  const messages = [...agent.state.messages];
  const index = messages.findIndex((message) => message === runtimeMessage);
  if (index < 0) return;
  messages[index] = {
    role: "user",
    content: rawUserPrompt,
    timestamp: runtimeMessage.timestamp
  };
  agent.state.messages = messages;
}

function buildDeepWriteSystemPrompt(): string {
  return [
    "你是 DeepWrite 的本地创作协作智能体。",
    "用户当前明确提出的要求优先；当前实时文稿是本轮工作对象，不得凭空推翻已提供的作品事实。",
    "技能是写作方法，不是作品事实；素材是参考信息，不能自动升级为作品设定。",
    "只能声称使用了本轮上下文快照中实际提供或显式附加的内容。",
    "只能调用本轮实际列出的工具；没有列出的写回、保存、文件、Shell、HTTP 或浏览器能力不得声称已经执行。",
    "回复使用结构清晰的中文纯文本，并明确区分建议、示例和已确认事实。"
  ].join("\n");
}

function buildEffectiveSystemPrompt(basePrompt: string, input: AgentRunInput): string {
  const profile = input.agentProfile;
  if (!profile) return basePrompt;
  return [
    basePrompt,
    "",
    `【当前短篇智能体：${profile.label} / ${profile.id}】`,
    profile.systemPrompt.trim(),
    "",
    "【DeepWrite 当前工具边界】",
    "只使用本轮实际提供的工具；没有出现在工具列表中的能力尚未接通，不得声称已经执行。",
    "写入工具只更新本次运行内的编辑草稿，不代表已经持久化到磁盘。",
    profile.id === "expert_draft_coordinator"
      ? "当前已接通正文骨架初始化与局部编辑；后台分节写手调度尚未接通，不能声称已启动后台写作。"
      : ""
  ].filter(Boolean).join("\n");
}

function buildRuntimeUserPrompt(input: AgentRunInput): string {
  const active = input.workspaceContext?.activeResource;
  const skills = input.workspaceContext?.attachedSkills ?? [];
  const materials = input.workspaceContext?.attachedMaterials ?? [];
  const isShortAgentRun = Boolean(
    input.workspaceContext?.shortWorkspace && input.agentProfile
  );
  const readableSkills = input.agentProfile
    ? skills.filter(
        (item) =>
          item.kind !== undefined && input.agentProfile!.readAccess.skill.includes(item.kind)
      )
    : skills;
  const readableMaterials = input.agentProfile
    ? materials.filter(
        (item) =>
          item.kind !== undefined && input.agentProfile!.readAccess.material.includes(item.kind)
      )
    : materials;
  const skillContext = isShortAgentRun
    ? readableSkills.length
      ? `可按需加载的技能：\n${readableSkills
          .map((item) => `- ${item.title} [${item.kind}]`)
          .join("\n")}\n需要正文时调用 load_skill。`
      : "可按需加载的技能: 无"
    : skills.length
      ? `显式附加技能:\n${skills.map((item) => `- ${item.title}: ${item.content}`).join("\n")}`
      : "显式附加技能: 无";
  const materialContext = isShortAgentRun
    ? readableMaterials.length
      ? `当前读取范围内的关联素材：\n${readableMaterials
          .map((item) => `- ${item.title} [${item.kind}]`)
          .join("\n")}\n需要条目正文时调用 query_linked_material_entries。`
      : "当前读取范围内的关联素材: 无"
    : materials.length
      ? `显式附加素材:\n${materials
          .map((item) => `- ${item.title}: ${item.content}`)
          .join("\n")}`
      : "显式附加素材: 无";
  const lines = [
    "【本轮运行上下文，不写入会话历史】",
    `sessionId: ${input.sessionId}`,
    `runId: ${input.runId}`,
    input.workspaceContext?.shortWorkspace
      ? `短篇作品: 《${input.workspaceContext.shortWorkspace.title}》`
      : "",
    input.workspaceContext?.shortWorkspace
      ? `作品分类: ${input.workspaceContext.shortWorkspace.categories.join("、") || "未分类"}`
      : "",
    input.workspaceContext?.shortWorkspace
      ? `当前阶段: ${input.workspaceContext.shortWorkspace.activeStageId}`
      : "",
    input.agentProfile
      ? `当前智能体: ${input.agentProfile.label} (${input.agentProfile.id})`
      : "",
    active
      ? `当前资源: ${active.title} (${active.domain}${active.format ? ` / ${active.format}` : ""})`
      : "当前资源: 未提供",
    active ? `资源路径: ${active.path.join(" / ")}` : "",
    active && !input.workspaceContext?.shortWorkspace ? `实时内容:\n${active.content}` : "",
    skillContext,
    materialContext,
    "",
    "【用户消息】",
    input.prompt
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function buildLocalThinking(input: AgentRunInput): string {
  const title = input.workspaceContext?.activeResource?.title ?? "未命名资源";
  const agent = input.agentProfile ? `，由「${input.agentProfile.label}」处理` : "";
  return `正在读取发送瞬间的创作上下文快照，确认当前工作对象为《${title}》${agent}，并区分用户要求、作品事实与参考信息。`;
}

function buildLocalWritingResponse(input: AgentRunInput): string {
  const active = input.workspaceContext?.activeResource;
  const request = input.prompt.replace(/\s+/g, " ").slice(0, 220);
  const activeLabel = active ? `《${active.title}》` : "当前创作资源";
  const contentLength = active?.content.replace(/\s/g, "").length ?? 0;
  const snapshotLabel = active?.truncated
    ? `${activeLabel} 前 ${active.content.length.toLocaleString("zh-CN")} 个字符的上下文快照（原文 ${active.originalLength?.toLocaleString("zh-CN") ?? "超过限制"} 个字符）`
    : `${activeLabel} 上下文快照（约 ${contentLength} 字）`;

  return [
    "本地 Faux 流式链路已就绪。",
    "",
    `我已读取本轮发送时的 ${snapshotLabel}，并收到请求：${request}`,
    "",
    "本轮可验证结果",
    "",
    "- 回复由 pi-agent-core 驱动，并通过 Agent Utility 流式返回。",
    "- Thinking 与回复内容使用独立事件，Renderer 会绑定到同一条助手消息。",
    "- 当前是无需 API Key 的本地 Faux 模型，用于验证客户端链路和上下文边界。",
    "- 本轮没有调用写入工具，也没有修改或保存右侧文稿。",
    input.agentProfile
      ? `- 当前已按短篇阶段选择「${input.agentProfile.label}」智能体，并装配 ${
          input.workspaceContext?.shortWorkspace ? "阶段专属工具" : "通用上下文"
        }。`
      : "",
    "",
    "下一切片接入真实模型配置后，可以在保持同一协议的前提下生成正式续写、润色和一致性检查结果。"
  ].filter(Boolean).join("\n");
}
