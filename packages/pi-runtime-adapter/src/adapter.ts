import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
  type ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  isRetryableAssistantError,
  type Api,
  type AssistantMessage,
  type Model,
  type ThinkingLevel as ProviderThinkingLevel,
  type UserMessage,
  type Usage
} from "@earendil-works/pi-ai";
import type {
  AgentProviderRuntimeConfig,
  AgentRuntimeRef,
  ModelConnectionTestResult,
  SessionUserInputResponseAcceptedPayload,
  SessionUserInputResponsePayload
} from "@deepwrite/contracts";
import {
  runAgentWithTurnRetries,
  type AgentTurnRetryPolicyOptions
} from "./agent-turn-retry";
import { buildChatAssistantTools } from "./chat-assistant-tools";
import {
  isAssistantMessage,
  normalizeUsage,
  reconcileToolCallArguments,
  toRuntimeEvents,
  toToolStreamRuntimeEvent,
  toUsageObservedRuntimeEvent
} from "./event-mapping";
import {
  buildAgentEvaluationSnapshot,
  evaluationConversationHistory
} from "./evaluation";
import {
  DEEPWRITE_FAUX_RUNTIME,
  buildLocalThinking,
  buildLocalWritingResponse
} from "./faux-local";
import { buildLearningImitationTools } from "./learning-imitation-tools";
import { buildLibraryAgentTools } from "./library-agent-tools";
import { buildLongBookAnalysisTools } from "./long-book-analysis/tools";
import {
  buildLongWorkspaceTools,
  createLongWorkspaceToolSharedState
} from "./long-agent-tools";
import {
  applyProviderToolSchemaCompatibility,
  resolvePortableToolSchemaProfile
} from "./portable-tool-schema";
import {
  buildDeepWriteSystemPrompt,
  buildEffectiveSystemPrompt,
  buildLongFollowUpTurnUserMessageContent,
  buildRawUserMessage,
  buildRuntimeUserMessageContent,
  longAgentRefreshesDesignContextOnLaterTurns,
  scriptRuntimeSystemRequirements,
  shortRuntimeSystemRequirements
} from "./prompts";
import {
  buildProviderRuntime,
  buildWorkspaceProviderRuntimes,
  resolveProviderModelCapacity,
  toPiThinkingLevel
} from "./provider-runtime";
import { enforceProviderToolSchemaCompatibility } from "./provider-tool-schema-compat";
import {
  cacheConversationAgent,
  conversationAgentKey,
  selectConversationAgentForRun
} from "./conversation-agent-rebuild";
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentUserInputRequester,
  PiRuntimeAdapterOptions
} from "./runtime-types";
import { RunLifecycle } from "./run-lifecycle";
import { AgentUserInputBroker } from "./user-input-broker";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools,
  createScriptWorkspaceToolSharedState,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import { buildSubagentAuthoringTools } from "./subagent-authoring-tools";
import {
  buildSpawnSubagentTool,
  type AgentToolExecutionHooks
} from "./subagent-runtime";
import {
  interceptToolCallStream,
  type ToolCallAssistantEvent
} from "./tool-stream";

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
        return new Promise<IteratorResult<T>>((resolve) =>
          this.waiters.push(resolve)
        );
      }
    };
  }
}

const TOOL_STREAM_DELTA_FLUSH_MS = 100;

const EMPTY_RESTORED_MESSAGE_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
};

function restoredConversationMessages(
  input: AgentRunInput,
  model: Model<Api>
): AgentMessage[] {
  return (input.conversationHistory ?? []).map((message) => {
    const timestamp = Date.parse(message.createdAt);
    if (message.role === "user") {
      return {
        role: "user",
        content: message.content,
        timestamp
      } satisfies UserMessage;
    }
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: EMPTY_RESTORED_MESSAGE_USAGE,
      stopReason: "stop",
      timestamp
    } satisfies AssistantMessage;
  });
}

export class PiAgentRuntimeAdapter implements AgentRuntime {
  private readonly idleTimeoutMs: number;
  private readonly subagentTimeoutMs: number | undefined;
  private readonly tokensPerSecond: number;
  private readonly systemPrompt: string;
  private readonly evaluationMode: boolean;
  private readonly retryPolicy: AgentTurnRetryPolicyOptions | undefined;
  private readonly toolExecutionHooks: AgentToolExecutionHooks;
  private readonly conversationAgents = new Map<string, Agent>();
  private readonly userInputBroker = new AgentUserInputBroker();

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
    this.subagentTimeoutMs = options.subagentTimeoutMs;
    this.tokensPerSecond = options.tokensPerSecond ?? 90;
    this.systemPrompt = options.systemPrompt ?? buildDeepWriteSystemPrompt();
    this.evaluationMode = options.evaluationMode === true;
    this.retryPolicy = options.retryPolicy;
    this.toolExecutionHooks = {
      ...(options.beforeToolCall
        ? { beforeToolCall: options.beforeToolCall }
        : {}),
      ...(options.afterToolCall ? { afterToolCall: options.afterToolCall } : {})
    };
  }

  describe(config?: AgentProviderRuntimeConfig): AgentRuntimeRef {
    if (config) {
      return {
        provider: config.provider,
        model: config.modelId,
        mode: "provider",
        configId: config.id
      };
    }
    return { ...DEEPWRITE_FAUX_RUNTIME };
  }

  resolveUserInput(
    response: SessionUserInputResponsePayload
  ): SessionUserInputResponseAcceptedPayload {
    return this.userInputBroker.resolve(response);
  }

  resolveModelCapacity(config: AgentProviderRuntimeConfig): {
    modelId: string;
    contextWindow: number;
    maxTokens: number;
  } {
    return {
      modelId: config.id,
      ...resolveProviderModelCapacity(config)
    };
  }

  async testConnection(
    config: AgentProviderRuntimeConfig
  ): Promise<ModelConnectionTestResult> {
    const configuredThinkingLevel = config.defaultThinkingLevel;
    const effectiveTemperature =
      configuredThinkingLevel === "off"
        ? config.temperatureOptions[1]
        : undefined;
    const { model, streamFn } = buildProviderRuntime(
      config,
      effectiveTemperature,
      configuredThinkingLevel
    );
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
        ...(configuredThinkingLevel === "off"
          ? {}
          : {
              reasoning: toPiThinkingLevel(
                configuredThinkingLevel
              ) as ProviderThinkingLevel
            }),
        timeoutMs: 15_000
      }
    );
    const result = await (await stream).result();
    if (result.stopReason === "error" || result.stopReason === "aborted") {
      throw new Error(result.errorMessage || "模型连接测试失败。");
    }
    const usage = normalizeUsage(result.usage);
    return {
      modelId: config.id,
      ok: true,
      message: "连接成功，模型已返回有效响应。",
      testedAt: new Date().toISOString(),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(usage ? { usage } : {})
    };
  }

  async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const queue = new AsyncEventQueue<AgentRuntimeEvent>();
    const runtime = this.describe(input.runtimeConfig);
    const messageId = `${input.runId}_assistant`;
    const agentKey = conversationAgentKey(input);
    const reusableConversationAgent = selectConversationAgentForRun(
      this.conversationAgents,
      agentKey,
      input.conversationHistoryMode
    );
    const portableToolSchemaProfile = resolvePortableToolSchemaProfile(
      input.workspaceContext
    );
    const lifecycle = new RunLifecycle();
    let userInputRequestSequence = 0;
    const requestUserInput: AgentUserInputRequester = async (
      request,
      signal
    ) => {
      const requestId = `${input.runId}:user-input:${++userInputRequestSequence}`;
      const response = this.userInputBroker.wait(
        {
          sessionId: input.sessionId,
          runId: input.runId,
          requestId,
          questions: request.questions
        },
        signal
      );
      userInputWaiting += 1;
      lifecycle.clearIdleTimer();
      emit({
        type: "agent.user_input_requested",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          requestId,
          toolCallId: request.toolCallId,
          source: request.source,
          questions: request.questions,
          runtime
        }
      });
      try {
        return await response;
      } finally {
        userInputWaiting = Math.max(0, userInputWaiting - 1);
        if (userInputWaiting === 0) scheduleIdleTimeout();
      }
    };
    let model: Model<Api>;
    let streamFn: StreamFn;
    let spawnStreamFn: StreamFn;
    let effectiveThinkingLevel: PiThinkingLevel;

    if (input.runtimeConfig) {
      const configuredThinkingLevel =
        input.thinkingLevel ?? input.runtimeConfig.defaultThinkingLevel;
      const effectiveTemperature =
        configuredThinkingLevel === "off"
          ? (input.temperature ?? input.runtimeConfig.temperatureOptions[1])
          : undefined;
      const providerRuntime = buildWorkspaceProviderRuntimes(
        input.runtimeConfig,
        effectiveTemperature,
        configuredThinkingLevel,
        {
          portableToolSchemaProfile,
          webSearchEnabled: input.webSearchEnabled === true
        }
      );
      model = providerRuntime.model;
      streamFn = providerRuntime.streamFn;
      spawnStreamFn = providerRuntime.spawnStreamFn;
      effectiveThinkingLevel = toPiThinkingLevel(configuredThinkingLevel);
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
      spawnStreamFn = streamFn;
      effectiveThinkingLevel = toPiThinkingLevel(
        input.thinkingLevel ?? "medium"
      );
      const analysisContext = input.workspaceContext?.longBookAnalysis;
      if (analysisContext) {
        const chapterStart = analysisContext.selectionStart;
        const chapterEnd = analysisContext.selectionEnd;
        const toolCall =
          analysisContext.phase === "final"
            ? fauxToolCall(
                "write_analysis_result",
                {
                  title: `${input.longBookAnalysisProfile?.name ?? "长篇拆书"}｜第 ${chapterStart}-${chapterEnd} 章`,
                  body: [
                    `# ${input.longBookAnalysisProfile?.name ?? "长篇拆书分析"}`,
                    "",
                    `> 分析范围：第 ${chapterStart}-${chapterEnd} 章`,
                    "",
                    "## 核心发现",
                    "",
                    "- 这是 Faux Runtime 生成的端到端验证结果；真实模型会依据分批笔记填充完整证据、结构与可复用模板。",
                    "",
                    "## 执行模板",
                    "",
                    "1. 识别章节目标与阻力。",
                    "2. 标记转折、兑现与结尾钩子。",
                    "3. 将重复规律整理成可迁移检查清单。"
                  ].join("\n")
                },
                { id: `${input.runId}-analysis-result` }
              )
            : fauxToolCall(
                "write_analysis_note",
                {
                  text: [
                    `范围：第 ${chapterStart}-${chapterEnd} 章。`,
                    `阶段：${analysisContext.phase === "batch" ? "章节分批提炼" : "中间笔记归并"}。`,
                    "Faux 验证笔记：已保留章节范围、关键结构标签与递归归并所需的摘要边界。"
                  ].join("\n")
                },
                { id: `${input.runId}-analysis-note` }
              );
        faux.setResponses([
          fauxAssistantMessage(toolCall, { stopReason: "toolUse" }),
          fauxAssistantMessage(fauxText("当前长篇拆书阶段已完成。"))
        ]);
      } else {
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
    }

    const shortWorkspace = input.workspaceContext?.shortWorkspace;
    const scriptWorkspace = input.workspaceContext?.scriptWorkspace;
    const longWorkspace = input.workspaceContext?.longWorkspace;
    const libraryWorkspace = input.workspaceContext?.libraryWorkspace;
    const learningImitation = input.workspaceContext?.learningImitation;
    const longBookAnalysis = input.workspaceContext?.longBookAnalysis;
    const subagentAuthoring = input.workspaceContext?.subagentAuthoring;
    const imageAttachments =
      input.attachments?.filter((attachment) => attachment.kind === "image") ??
      [];
    if (imageAttachments.length && !model.input.includes("image")) {
      throw new Error(
        runtime.mode === "local-faux"
          ? "DeepWrite Faux 不支持图片理解，请先选择支持多模态的真实模型。"
          : `当前模型 ${runtime.model} 不支持图片输入，请更换支持多模态的模型。`
      );
    }
    const systemPrompt = buildEffectiveSystemPrompt(this.systemPrompt, input);
    const writingToolSharedState =
      scriptWorkspace && input.scriptAgentProfile
        ? createScriptWorkspaceToolSharedState(scriptWorkspace)
        : shortWorkspace && input.agentProfile
          ? createShortWorkspaceToolSharedState(shortWorkspace)
          : undefined;
    const longToolSharedState =
      longWorkspace && input.longAgentProfile
        ? createLongWorkspaceToolSharedState()
        : undefined;
    const buildWritingTools = (): AgentTool[] => {
      if (scriptWorkspace && input.scriptAgentProfile) {
        return buildScriptWorkspaceTools({
          workspace: scriptWorkspace,
          profile: input.scriptAgentProfile,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          autoApproveCrossStageOperations:
            input.autoApproveCrossStageOperations === true,
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials,
          requestUserInput,
          ...(writingToolSharedState
            ? { sharedState: writingToolSharedState }
            : {})
        });
      }
      return shortWorkspace && input.agentProfile
        ? buildShortWorkspaceTools({
            workspace: shortWorkspace,
            profile: input.agentProfile,
            writeApprovalMode: input.writeApprovalMode ?? "request-approval",
            autoApproveCrossStageOperations:
              input.autoApproveCrossStageOperations === true,
            attachedSkills: input.workspaceContext?.attachedSkills,
            attachedMaterials: input.workspaceContext?.attachedMaterials,
            requestUserInput,
            ...(writingToolSharedState
              ? { sharedState: writingToolSharedState }
              : {})
          })
        : [];
    };
    const buildLongTools = (includeAskUserQuestion = true): AgentTool[] =>
      longWorkspace && input.longAgentProfile
        ? buildLongWorkspaceTools({
            workspace: longWorkspace,
            profile: input.longAgentProfile,
            sessionId: input.sessionId,
            runId: input.runId,
            writeApprovalMode: input.writeApprovalMode ?? "request-approval",
            autoApproveCrossStageOperations:
              input.autoApproveCrossStageOperations === true,
            attachedSkills: input.workspaceContext?.attachedSkills,
            attachedMaterials: input.workspaceContext?.attachedMaterials,
            ...(input.longCommandExecutor
              ? { executor: input.longCommandExecutor }
              : {}),
            requestUserInput,
            includeAskUserQuestion,
            ...(longToolSharedState ? { sharedState: longToolSharedState } : {})
          })
        : [];
    let tools: AgentTool[] =
      input.mode === "chat-assistant"
        ? input.chatAssistantRuntimeContext
          ? buildChatAssistantTools({
              runId: input.runId,
              sessionId: input.sessionId,
              context: input.chatAssistantRuntimeContext,
              ...(input.longCommandExecutor
                ? { longCommandExecutor: input.longCommandExecutor }
                : {})
            })
          : []
        : subagentAuthoring
          ? buildSubagentAuthoringTools(subagentAuthoring)
          : learningImitation && input.learningImitationProfile
            ? buildLearningImitationTools(
                learningImitation,
                input.writeApprovalMode ?? "request-approval"
              )
            : longBookAnalysis && input.longBookAnalysisProfile
              ? buildLongBookAnalysisTools(longBookAnalysis)
              : libraryWorkspace && input.libraryAgentProfile
                ? buildLibraryAgentTools({
                    workspace: libraryWorkspace,
                    profile: input.libraryAgentProfile,
                    writeApprovalMode:
                      input.writeApprovalMode ?? "request-approval",
                    attachedSkills: input.workspaceContext?.attachedSkills
                  })
                : longWorkspace && input.longAgentProfile
                  ? buildLongTools()
                  : (scriptWorkspace && input.scriptAgentProfile) ||
                      (shortWorkspace && input.agentProfile)
                    ? buildWritingTools()
                    : [];
    if (
      ((scriptWorkspace && input.scriptAgentProfile) ||
        (shortWorkspace && input.agentProfile) ||
        (longWorkspace && input.longAgentProfile)) &&
      !subagentAuthoring
    ) {
      const spawnTool = buildSpawnSubagentTool({
        parentSessionId: input.sessionId,
        parentRuntime: runtime,
        model,
        thinkingLevel: effectiveThinkingLevel,
        streamFn: spawnStreamFn,
        definitions: input.subagentDefinitions ?? [],
        ...(input.subagentRuntimeConfigs
          ? { subagentRuntimeConfigs: input.subagentRuntimeConfigs }
          : {}),
        buildCustomModelRuntime: (config, options) => {
          const childThinking =
            options?.thinkingLevel ?? config.defaultThinkingLevel ?? "medium";
          const childTemperature =
            childThinking === "off"
              ? (options?.temperature ?? config.temperatureOptions[1])
              : undefined;
          const childRuntime = buildProviderRuntime(
            config,
            childTemperature,
            childThinking,
            { portableToolSchemaProfile }
          );
          return {
            model: childRuntime.model,
            streamFn: childRuntime.streamFn,
            thinkingLevel: toPiThinkingLevel(childThinking)
          };
        },
        buildChildTools:
          longWorkspace && input.longAgentProfile
            ? () => buildLongTools(false)
            : buildWritingTools,
        ...(scriptWorkspace
          ? {
              systemPromptRequirements: scriptRuntimeSystemRequirements(input)
            }
          : shortWorkspace
            ? {
                systemPromptRequirements: shortRuntimeSystemRequirements(input)
              }
            : longWorkspace
              ? {
                  systemPromptRequirements:
                    input.writeApprovalMode === "auto-approve"
                      ? "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId；提案会进入实时自动保存队列，在客户端确认成功前不能宣称已落盘或已提交连续性账本。"
                      : "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId；任何写入仍须形成可审阅提案，不能宣称已落盘或已提交连续性账本。"
                }
              : {}),
        toolExecutionHooks: this.toolExecutionHooks,
        ...(this.retryPolicy ? { retryPolicy: this.retryPolicy } : {}),
        ...(this.subagentTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.subagentTimeoutMs }),
        depth: 0
      });
      if (spawnTool) tools = [...tools, spawnTool];
    }
    let emitToolCallEvent: (
      event: ToolCallAssistantEvent,
      assistantTurnIndex: number
    ) => void = () => {};
    const interceptedStreamFn = interceptToolCallStream(
      streamFn,
      (event, assistantTurnIndex) =>
        emitToolCallEvent(event, assistantTurnIndex)
    );
    let agent = reusableConversationAgent;
    const createdAgent = agent === undefined;
    if (agent) {
      if (agent.state.isStreaming) {
        throw new Error("The selected conversation agent is already running.");
      }
      if (input.learningImitationProfile || input.longBookAnalysisProfile) {
        // Preset analyses are self-contained. Their current inputs are exposed
        // explicitly through tools, so replaying prior calls would only pollute
        // the next batch or reduce pass.
        agent.state.messages = [];
      }
      agent.state.systemPrompt = systemPrompt;
      agent.state.model = model;
      agent.state.thinkingLevel = effectiveThinkingLevel;
      agent.state.tools = tools;
      agent.streamFunction = interceptedStreamFn;
      if (this.toolExecutionHooks.beforeToolCall) {
        agent.beforeToolCall = this.toolExecutionHooks.beforeToolCall;
      } else {
        delete agent.beforeToolCall;
      }
      if (this.toolExecutionHooks.afterToolCall) {
        agent.afterToolCall = this.toolExecutionHooks.afterToolCall;
      } else {
        delete agent.afterToolCall;
      }
      agent.sessionId = input.sessionId;
      agent.toolExecution = "sequential";
      cacheConversationAgent(this.conversationAgents, agentKey, agent);
    } else {
      const restoredMessages = restoredConversationMessages(input, model);
      agent = new Agent({
        initialState: {
          systemPrompt,
          model,
          thinkingLevel: effectiveThinkingLevel,
          ...(restoredMessages.length ? { messages: restoredMessages } : {}),
          tools
        },
        streamFn: interceptedStreamFn,
        ...this.toolExecutionHooks,
        sessionId: input.sessionId,
        toolExecution: "sequential"
      });
      cacheConversationAgent(this.conversationAgents, agentKey, agent);
      this.trimConversationAgents();
    }

    let settled = false;
    let terminalEmitted = false;
    let evaluationSnapshotEmitter: (() => void) | undefined;
    let modelRequestInFlight = false;
    let retryWaiting = false;
    let userInputWaiting = 0;
    let idleModelRequestTimedOut = false;
    let currentTurnAttempt = 0;
    let currentTurnMaxAttempts = 1;
    let scheduleIdleTimeout = (): void => {};
    const retryWaitController = new AbortController();
    const pendingToolDeltas = new Map<
      string,
      Extract<AgentRuntimeEvent, { type: "agent.tool_stream" }>
    >();
    const streamedToolArguments = new Map<string, string>();
    let toolDeltaTimer: NodeJS.Timeout | undefined;

    const emit = (event: AgentRuntimeEvent): void => {
      const terminal =
        event.type === "agent.completed" || event.type === "agent.error";
      if (terminalEmitted && event.type !== "agent.evaluation_snapshot") {
        return;
      }
      for (const childTerminal of lifecycle.observe(event)) {
        queue.push(childTerminal);
      }
      if (terminal) terminalEmitted = true;
      queue.push(event);
      if (!terminal && !terminalEmitted) {
        scheduleIdleTimeout();
      }
    };

    const flushToolDeltas = (): void => {
      if (toolDeltaTimer) {
        clearTimeout(toolDeltaTimer);
        toolDeltaTimer = undefined;
      }
      for (const event of pendingToolDeltas.values()) emit(event);
      pendingToolDeltas.clear();
    };

    const discardAttemptToolDeltas = (): void => {
      if (toolDeltaTimer) {
        clearTimeout(toolDeltaTimer);
        toolDeltaTimer = undefined;
      }
      pendingToolDeltas.clear();
      streamedToolArguments.clear();
    };

    const emitStreamedToolEvent = (
      event: Extract<AgentRuntimeEvent, { type: "agent.tool_stream" }>
    ): void => {
      const currentArguments =
        streamedToolArguments.get(event.payload.streamId) ?? "";
      const normalized = reconcileToolCallArguments(
        currentArguments,
        event.payload.argumentsDelta,
        event.payload.argumentsSnapshot
      );
      event.payload.argumentsDelta = normalized.delta;
      delete event.payload.argumentsSnapshot;
      streamedToolArguments.set(event.payload.streamId, normalized.next);
      if (event.payload.phase !== "delta") {
        flushToolDeltas();
        emit(event);
        return;
      }
      const existing = pendingToolDeltas.get(event.payload.streamId);
      if (existing) {
        existing.payload.argumentsDelta += event.payload.argumentsDelta;
        if (event.payload.toolCallId)
          existing.payload.toolCallId = event.payload.toolCallId;
        if (event.payload.toolName)
          existing.payload.toolName = event.payload.toolName;
      } else {
        pendingToolDeltas.set(event.payload.streamId, event);
      }
      if (!toolDeltaTimer) {
        toolDeltaTimer = setTimeout(
          flushToolDeltas,
          TOOL_STREAM_DELTA_FLUSH_MS
        );
        toolDeltaTimer.unref();
      }
    };

    emitToolCallEvent = (event, assistantTurnIndex) => {
      emitStreamedToolEvent(
        toToolStreamRuntimeEvent(
          event,
          input,
          runtime,
          messageId,
          assistantTurnIndex
        )
      );
    };

    const cleanup = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      lifecycle.clearIdleTimer();
      if (toolDeltaTimer) {
        clearTimeout(toolDeltaTimer);
        toolDeltaTimer = undefined;
      }
      pendingToolDeltas.clear();
      streamedToolArguments.clear();
      lifecycle.dispose();
      this.userInputBroker.cancelRun(input.runId);
      retryWaitController.abort();
      if (abortListener && input.signal) {
        input.signal.removeEventListener("abort", abortListener);
      }
      queue.close();
    };

    const abortListener = () => {
      idleModelRequestTimedOut = false;
      retryWaitController.abort();
      agent.abort();
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
      cleanup();
    };
    if (input.signal?.aborted) {
      abortListener();
    } else {
      input.signal?.addEventListener("abort", abortListener, { once: true });
    }

    scheduleIdleTimeout = (): void => {
      if (
        settled ||
        terminalEmitted ||
        retryWaiting ||
        userInputWaiting > 0 ||
        this.idleTimeoutMs <= 0
      ) {
        return;
      }
      lifecycle.scheduleIdleTimeout(this.idleTimeoutMs, () => {
        if (
          input.runtimeConfig &&
          modelRequestInFlight &&
          currentTurnAttempt < currentTurnMaxAttempts
        ) {
          // Aborting only the current Agent invocation yields an assistant
          // failure that the turn retry coordinator can resume. Tool execution
          // timeouts remain terminal so completed side effects are never replayed.
          idleModelRequestTimedOut = true;
          agent.abort();
          return;
        }
        agent.abort();
        emit({
          type: "agent.error",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            code: "pi_agent.idle_timeout",
            message: "智能体超过 5 分钟没有返回新事件，运行已中止。",
            runtime
          }
        });
        cleanup();
      });
    };

    if (!settled) {
      scheduleIdleTimeout();
      // Preserve the first request wrapper as the stable prefix for later turns.
      // Plot-design and draft turns also receive their latest structure
      // snapshots; tools and the system prompt are still refreshed before every run.
      const persistInitialRuntimeContext =
        createdAgent || agent.state.messages.length === 0;
      const runtimeUserContent =
        input.mode === "chat-assistant"
          ? buildRawUserMessage(input).content
          : persistInitialRuntimeContext
            ? buildRuntimeUserMessageContent(input)
            : (input.agentProfile && shortWorkspace) ||
                (input.scriptAgentProfile && scriptWorkspace)
              ? buildRuntimeUserMessageContent(input)
              : longAgentRefreshesDesignContextOnLaterTurns(
                    input.longAgentProfile?.id
                  ) && input.workspaceContext?.longWorkspace
                ? buildLongFollowUpTurnUserMessageContent(input)
                : buildRawUserMessage(input).content;
      const runtimeUserMessage: UserMessage = {
        role: "user",
        content: runtimeUserContent,
        timestamp: Date.now()
      };
      if (this.evaluationMode) {
        const providerVisibleTools =
          applyProviderToolSchemaCompatibility(
            enforceProviderToolSchemaCompatibility({
              systemPrompt,
              messages: [],
              tools
            }),
            runtime.provider,
            input.runtimeConfig?.toolSchemaProfile,
            portableToolSchemaProfile
          ).tools ?? tools;
        const evaluationTools = providerVisibleTools.map((providerTool) => {
          const executableTool = tools.find(
            (candidate) => candidate.name === providerTool.name
          );
          return {
            name: providerTool.name,
            description: providerTool.description,
            parameters: providerTool.parameters,
            ...(executableTool?.label ? { label: executableTool.label } : {}),
            ...(executableTool?.executionMode
              ? { executionMode: executableTool.executionMode }
              : {})
          };
        });
        const emitEvaluationSnapshot = (): void => {
          emit({
            type: "agent.evaluation_snapshot",
            runId: input.runId,
            sessionId: input.sessionId,
            payload: {
              messageId,
              snapshot: buildAgentEvaluationSnapshot(
                systemPrompt,
                runtimeUserContent,
                persistInitialRuntimeContext,
                evaluationTools,
                new Date().toISOString(),
                evaluationConversationHistory(agent.state.messages)
              ),
              runtime
            }
          });
        };
        emitEvaluationSnapshot();
        evaluationSnapshotEmitter = emitEvaluationSnapshot;
      }
      void runAgentWithTurnRetries({
        agent,
        initialPrompt: runtimeUserMessage,
        runId: input.runId,
        signal: retryWaitController.signal,
        ...(this.retryPolicy ? { retryPolicy: this.retryPolicy } : {}),
        classifyFailure: (message) => {
          if (idleModelRequestTimedOut && message.stopReason === "aborted") {
            return "模型请求长时间没有返回新事件。";
          }
          return isRetryableAssistantError(message)
            ? message.errorMessage || "模型连接暂时不可用。"
            : undefined;
        },
        onTurnStarted: (attempt) => {
          retryWaiting = false;
          modelRequestInFlight = true;
          idleModelRequestTimedOut = false;
          currentTurnAttempt = attempt.attempt;
          currentTurnMaxAttempts = attempt.maxAttempts;
          emit({
            type: "agent.turn_started",
            runId: input.runId,
            sessionId: input.sessionId,
            payload: {
              messageId,
              turnId: attempt.turnId,
              attempt: attempt.attempt,
              maxAttempts: attempt.maxAttempts,
              runtime
            }
          });
        },
        onRetryRollback: () => {
          modelRequestInFlight = false;
          idleModelRequestTimedOut = false;
          lifecycle.clearIdleTimer();
          discardAttemptToolDeltas();
        },
        onRetryScheduled: (schedule) => {
          retryWaiting = true;
          lifecycle.clearIdleTimer();
          emit({
            type: "agent.retry_scheduled",
            runId: input.runId,
            sessionId: input.sessionId,
            payload: {
              messageId,
              ...schedule,
              runtime
            }
          });
        },
        onAssistantMessageEnded: (message, attempt) => {
          const usageEvent = toUsageObservedRuntimeEvent(
            message,
            input,
            runtime,
            messageId,
            attempt
          );
          if (usageEvent) emit(usageEvent);
        },
        onEvent: (event) => {
          if (
            event.type === "message_end" &&
            isAssistantMessage(event.message)
          ) {
            modelRequestInFlight = false;
          } else if (event.type === "tool_execution_start") {
            modelRequestInFlight = false;
          }
          for (const runtimeEvent of toRuntimeEvents(
            event,
            input,
            runtime,
            messageId
          )) {
            emit(runtimeEvent);
          }
        }
      })
        .catch((error: unknown) => {
          if (settled || retryWaitController.signal.aborted) return;
          emit({
            type: "agent.error",
            runId: input.runId,
            sessionId: input.sessionId,
            payload: {
              code: "pi_agent.prompt_failed",
              message:
                error instanceof Error ? error.message : "本地智能体请求失败。",
              details: {
                kind: error instanceof Error ? error.name : "unknown"
              },
              runtime
            }
          });
        })
        .finally(() => {
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
          evaluationSnapshotEmitter?.();
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
