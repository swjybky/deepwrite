import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
  type ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type ThinkingLevelMap,
  type Usage,
  type UserMessage
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  renderLearningImitationSystemPrompt,
  type AgentProviderRuntimeConfig,
  type AgentRuntimeRef,
  type AgentUsage,
  type AgentWriteApprovalMode,
  type LearningImitationAgentProfile,
  type LibraryAgentProfile,
  type ShortAgentSubagentDefinition,
  type ShortWorkspaceAgentProfile,
  type SubagentActivity,
  type ModelConnectionTestResult,
  type ThinkingLevel as ConfiguredThinkingLevel,
  type UserPromptAttachment,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  buildShortWorkspaceTools,
  createShortWorkspaceToolSharedState,
  isShortWorkspaceToolDetails
} from "./short-agent-tools";
import {
  buildSpawnSubagentTool,
  isSubagentToolProgressDetails,
  type AgentToolExecutionHooks,
  type SubagentToolProgress
} from "./subagent-runtime";
import {
  buildLearningImitationTools,
  isLearningImitationToolDetails
} from "./learning-imitation-tools";
import {
  buildLibraryAgentTools,
  isLibraryAgentToolDetails
} from "./library-agent-tools";

export interface AgentRunInput {
  runId: string;
  sessionId: string;
  prompt: string;
  attachments?: UserPromptAttachment[];
  writeApprovalMode?: AgentWriteApprovalMode;
  thinkingLevel?: ConfiguredThinkingLevel;
  temperature?: number;
  runtimeConfig?: AgentProviderRuntimeConfig;
  agentProfile?: ShortWorkspaceAgentProfile;
  subagentDefinitions?: ShortAgentSubagentDefinition[];
  subagentRuntimeConfigs?: Readonly<Record<string, AgentProviderRuntimeConfig>>;
  libraryAgentProfile?: LibraryAgentProfile;
  learningImitationProfile?: LearningImitationAgentProfile;
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
      type: "agent.tool_stream";
      runId: string;
      sessionId: string;
      payload: {
        streamId: string;
        toolCallId?: string;
        toolName?: string;
        phase: "start" | "delta" | "end";
        argumentsDelta: string;
        /**
         * Provider-side cumulative argument text. This stays inside the runtime
         * adapter and is reduced to argumentsDelta before crossing IPC.
         */
        argumentsSnapshot?: string;
        args?: unknown;
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
      type: "subagent.started";
      runId: string;
      sessionId: string;
      payload: {
        parentToolCallId: string;
        subagentRunId: string;
        subagentId: string;
        name: string;
        task: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "subagent.activity";
      runId: string;
      sessionId: string;
      payload: {
        parentToolCallId: string;
        subagentRunId: string;
        subagentId: string;
        name: string;
        activity: SubagentActivity;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "subagent.completed";
      runId: string;
      sessionId: string;
      payload: {
        parentToolCallId: string;
        subagentRunId: string;
        subagentId: string;
        name: string;
        status: "completed" | "error" | "aborted";
        summary: string;
        errorMessage?: string;
        usage?: AgentUsage;
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
        mutationTarget?: {
          kind: "expert-draft-file";
          documentId: string;
          sectionId: string;
          fileKind: "body" | "characterState";
        } | {
          kind: "expert-draft-section-creation";
          sections: Array<{
            title: string;
            wordCountRequirement: string;
            provisionalSectionId: string;
          }>;
          afterSectionId?: string;
        };
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
      type: "library.editor_mutation";
      runId: string;
      sessionId: string;
      payload:
        | {
            toolCallId: string;
            operation: "create";
            domain: "material" | "skill";
            libraryId: string;
            stageId: string;
            title: string;
            text: string;
            baseRevision: string;
            baseProjectRevision?: number;
            summary: string;
            runtime: AgentRuntimeRef;
          }
        | {
            toolCallId: string;
            operation: "edit";
            domain: "material" | "skill";
            libraryId: string;
            entryId: string;
            documentId: string;
            stageId: string;
            title: string;
            text: string;
            baseRevision: string;
            baseProjectRevision?: number;
            summary: string;
            runtime: AgentRuntimeRef;
          };
    }
  | {
      type: "learning_imitation.result_updated";
      runId: string;
      sessionId: string;
      payload: {
        toolCallId: string;
        stageId: import("@deepwrite/contracts").LearningImitationStageId;
        update: import("@deepwrite/contracts").LearningImitationWritePayload;
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

export interface PiRuntimeAdapterOptions extends AgentToolExecutionHooks {
  idleTimeoutMs?: number;
  subagentTimeoutMs?: number;
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

type ToolCallAssistantEvent = Extract<
  AssistantMessageEvent,
  { type: "toolcall_start" | "toolcall_delta" | "toolcall_end" }
>;

/**
 * Observes provider tool-call chunks before pi-agent-core processes or executes
 * the completed tool. This keeps UI activity tied to the raw model stream.
 */
export function interceptToolCallStream(
  sourceStreamFn: StreamFn,
  onToolCallEvent: (event: ToolCallAssistantEvent, assistantTurnIndex: number) => void
): StreamFn {
  let assistantTurnIndex = 0;
  return async (model, context, options) => {
    const currentTurnIndex = assistantTurnIndex;
    assistantTurnIndex += 1;
    const source = await sourceStreamFn(model, context, options);
    const forwarded = createAssistantMessageEventStream();
    void (async () => {
      for await (const event of source) {
        if (
          event.type === "toolcall_start" ||
          event.type === "toolcall_delta" ||
          event.type === "toolcall_end"
        ) {
          onToolCallEvent(event, currentTurnIndex);
        }
        forwarded.push(event);
      }
    })();
    return forwarded;
  };
}

const DEEPWRITE_FAUX_RUNTIME: AgentRuntimeRef = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux"
};

const TOOL_STREAM_DELTA_FLUSH_MS = 100;

export class PiAgentRuntimeAdapter implements AgentRuntime {
  private readonly idleTimeoutMs: number;
  private readonly subagentTimeoutMs: number | undefined;
  private readonly tokensPerSecond: number;
  private readonly systemPrompt: string;
  private readonly toolExecutionHooks: AgentToolExecutionHooks;
  private readonly conversationAgents = new Map<string, Agent>();

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
    this.subagentTimeoutMs = options.subagentTimeoutMs;
    this.tokensPerSecond = options.tokensPerSecond ?? 90;
    this.systemPrompt = options.systemPrompt ?? buildDeepWriteSystemPrompt();
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
    let effectiveThinkingLevel: PiThinkingLevel;

    if (input.runtimeConfig) {
      const configuredThinkingLevel =
        input.thinkingLevel ?? input.runtimeConfig.defaultThinkingLevel;
      const effectiveTemperature = configuredThinkingLevel === "off"
        ? input.temperature ?? input.runtimeConfig.temperatureOptions[1]
        : undefined;
      const providerRuntime = buildProviderRuntime(
        input.runtimeConfig,
        effectiveTemperature,
        configuredThinkingLevel
      );
      model = providerRuntime.model;
      streamFn = providerRuntime.streamFn;
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
      effectiveThinkingLevel = toPiThinkingLevel(input.thinkingLevel ?? "medium");
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
    const libraryWorkspace = input.workspaceContext?.libraryWorkspace;
    const learningImitation = input.workspaceContext?.learningImitation;
    const imageAttachments = input.attachments?.filter(
      (attachment) => attachment.kind === "image"
    ) ?? [];
    if (imageAttachments.length && !model.input.includes("image")) {
      throw new Error(
        runtime.mode === "local-faux"
          ? "DeepWrite Faux 不支持图片理解，请先选择支持多模态的真实模型。"
          : `当前模型 ${runtime.model} 不支持图片输入，请更换支持多模态的模型。`
      );
    }
    const systemPrompt = buildEffectiveSystemPrompt(this.systemPrompt, input);
    const shortToolSharedState = shortWorkspace && input.agentProfile
      ? createShortWorkspaceToolSharedState(shortWorkspace)
      : undefined;
    const buildShortTools = (): AgentTool[] =>
      shortWorkspace && input.agentProfile
        ? buildShortWorkspaceTools({
            workspace: shortWorkspace,
            profile: input.agentProfile,
            writeApprovalMode: input.writeApprovalMode ?? "request-approval",
            attachedSkills: input.workspaceContext?.attachedSkills,
            attachedMaterials: input.workspaceContext?.attachedMaterials,
            ...(shortToolSharedState ? { sharedState: shortToolSharedState } : {})
          })
        : [];
    let tools: AgentTool[] = learningImitation && input.learningImitationProfile
      ? buildLearningImitationTools(learningImitation)
      : libraryWorkspace && input.libraryAgentProfile
        ? buildLibraryAgentTools({
            workspace: libraryWorkspace,
            profile: input.libraryAgentProfile,
            writeApprovalMode: input.writeApprovalMode ?? "request-approval",
            attachedSkills: input.workspaceContext?.attachedSkills
          })
      : shortWorkspace && input.agentProfile
        ? buildShortTools()
        : [];
    if (shortWorkspace && input.agentProfile) {
      const spawnTool = buildSpawnSubagentTool({
        parentSessionId: input.sessionId,
        model,
        thinkingLevel: effectiveThinkingLevel,
        streamFn,
        definitions: input.subagentDefinitions ?? [],
        ...(input.subagentRuntimeConfigs
          ? { subagentRuntimeConfigs: input.subagentRuntimeConfigs }
          : {}),
        buildCustomModelRuntime: (config, options) => {
          const childThinking =
            options?.thinkingLevel ?? config.defaultThinkingLevel ?? "medium";
          const childTemperature =
            childThinking === "off"
              ? options?.temperature ?? config.temperatureOptions[1]
              : undefined;
          const childRuntime = buildProviderRuntime(
            config,
            childTemperature,
            childThinking
          );
          return {
            model: childRuntime.model,
            streamFn: childRuntime.streamFn,
            thinkingLevel: toPiThinkingLevel(childThinking)
          };
        },
        buildChildTools: buildShortTools,
        toolExecutionHooks: this.toolExecutionHooks,
        ...(this.subagentTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.subagentTimeoutMs }),
        depth: 0
      });
      if (spawnTool) tools = [...tools, spawnTool];
    }
    const agentKey = `${input.sessionId}:${
      input.learningImitationProfile
        ? `learning-imitation:${input.learningImitationProfile.id}`
        : input.libraryAgentProfile && libraryWorkspace
          ? `library:${input.libraryAgentProfile.domain}:${libraryWorkspace.libraryId}`
        : input.agentProfile?.id ?? "default"
    }`;
    let emitToolCallEvent: (
      event: ToolCallAssistantEvent,
      assistantTurnIndex: number
    ) => void = () => {};
    const interceptedStreamFn = interceptToolCallStream(
      streamFn,
      (event, assistantTurnIndex) => emitToolCallEvent(event, assistantTurnIndex)
    );
    let agent = this.conversationAgents.get(agentKey);
    if (agent) {
      if (agent.state.isStreaming) {
        throw new Error("The selected conversation agent is already running.");
      }
      if (input.learningImitationProfile) {
        // Every preset analysis is self-contained. The latest documents and
        // accumulated preview are injected explicitly, so replaying prior tool
        // calls would only pollute the next learning pass.
        agent.state.messages = [];
      }
      agent.state.systemPrompt = systemPrompt;
      agent.state.model = model;
      agent.state.thinkingLevel = effectiveThinkingLevel;
      agent.state.tools = tools;
      agent.streamFn = interceptedStreamFn;
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
        streamFn: interceptedStreamFn,
        ...this.toolExecutionHooks,
        sessionId: input.sessionId,
        toolExecution: "sequential"
      });
      this.conversationAgents.set(agentKey, agent);
      this.trimConversationAgents();
    }

    let settled = false;
    let terminalEmitted = false;
    let idleTimeout: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    let scheduleIdleTimeout = (): void => {};
    const pendingToolDeltas = new Map<
      string,
      Extract<AgentRuntimeEvent, { type: "agent.tool_stream" }>
    >();
    const streamedToolArguments = new Map<string, string>();
    const activeSubagents = new Map<
      string,
      Extract<AgentRuntimeEvent, { type: "subagent.started" }>["payload"]
    >();
    let toolDeltaTimer: NodeJS.Timeout | undefined;

    const emit = (event: AgentRuntimeEvent): void => {
      const terminal = event.type === "agent.completed" || event.type === "agent.error";
      if (terminalEmitted) {
        return;
      }
      if (event.type === "subagent.started") {
        activeSubagents.set(event.payload.subagentRunId, event.payload);
      } else if (event.type === "subagent.completed") {
        activeSubagents.delete(event.payload.subagentRunId);
      }
      if (terminal) {
        const aborted =
          event.type === "agent.error" && event.payload.code === "pi_agent.aborted";
        for (const active of activeSubagents.values()) {
          const summary = aborted
            ? "父智能体运行已中止，子智能体同步停止。"
            : "父智能体运行已结束，子智能体未返回完整终态。";
          queue.push({
            type: "subagent.completed",
            runId: input.runId,
            sessionId: input.sessionId,
            payload: {
              parentToolCallId: active.parentToolCallId,
              subagentRunId: active.subagentRunId,
              subagentId: active.subagentId,
              name: active.name,
              status: aborted ? "aborted" : "error",
              summary,
              errorMessage: summary,
              runtime: active.runtime
            }
          });
        }
        activeSubagents.clear();
        terminalEmitted = true;
        if (idleTimeout) {
          clearTimeout(idleTimeout);
          idleTimeout = undefined;
        }
      }
      queue.push(event);
      if (!terminal) {
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

    const emitStreamedToolEvent = (
      event: Extract<AgentRuntimeEvent, { type: "agent.tool_stream" }>
    ): void => {
      const currentArguments = streamedToolArguments.get(event.payload.streamId) ?? "";
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
        if (event.payload.toolCallId) existing.payload.toolCallId = event.payload.toolCallId;
        if (event.payload.toolName) existing.payload.toolName = event.payload.toolName;
      } else {
        pendingToolDeltas.set(event.payload.streamId, event);
      }
      if (!toolDeltaTimer) {
        toolDeltaTimer = setTimeout(flushToolDeltas, TOOL_STREAM_DELTA_FLUSH_MS);
        toolDeltaTimer.unref();
      }
    };

    emitToolCallEvent = (event, assistantTurnIndex) => {
      emitStreamedToolEvent(
        toToolStreamRuntimeEvent(event, input, runtime, messageId, assistantTurnIndex)
      );
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
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = undefined;
      }
      if (toolDeltaTimer) {
        clearTimeout(toolDeltaTimer);
        toolDeltaTimer = undefined;
      }
      pendingToolDeltas.clear();
      streamedToolArguments.clear();
      activeSubagents.clear();
      if (abortListener && input.signal) {
        input.signal.removeEventListener("abort", abortListener);
      }
      unsubscribe();
      queue.close();
    };

    abortListener = () => {
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
      if (settled || terminalEmitted || this.idleTimeoutMs <= 0) {
        return;
      }
      if (idleTimeout) {
        clearTimeout(idleTimeout);
      }
      idleTimeout = setTimeout(() => {
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
      }, this.idleTimeoutMs);
      idleTimeout.unref();
    };

    if (!settled) {
      scheduleIdleTimeout();
      const runtimeUserMessage: UserMessage = {
        role: "user",
        content: buildRuntimeUserMessageContent(input),
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
          replaceRuntimePromptInTranscript(
            agent,
            runtimeUserMessage,
            buildRawUserMessage(input, runtimeUserMessage.timestamp)
          );
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

function toPiThinkingLevel(level: ConfiguredThinkingLevel): PiThinkingLevel {
  if (
    level === "off" ||
    level === "minimal" ||
    level === "low" ||
    level === "medium" ||
    level === "high" ||
    level === "xhigh"
  ) {
    return level;
  }
  // Pi exposes five reasoning carriers. The model-level map below rewrites the
  // xhigh carrier to max or to the user's provider-specific custom value.
  return "xhigh";
}

/** @internal Exported for runtime-configuration regression tests. */
export function buildProviderRuntime(
  config: AgentProviderRuntimeConfig,
  temperature?: number,
  configuredThinkingLevel?: ConfiguredThinkingLevel
): {
  model: Model<Api>;
  streamFn: StreamFn;
} {
  const builtin = findBuiltinModel(config);
  const baseUrl = config.baseUrl || (builtin?.api === config.api ? builtin.baseUrl : "");
  if (!baseUrl) {
    throw new Error("当前模型不在 Pi 内置目录中，请填写 API 地址后再试。");
  }

  const thinkingLevelMap: ThinkingLevelMap = {
    ...(builtin?.thinkingLevelMap ?? {})
  };
  if (configuredThinkingLevel && configuredThinkingLevel !== "off") {
    const carrier = toPiThinkingLevel(configuredThinkingLevel);
    if (configuredThinkingLevel !== carrier) {
      thinkingLevelMap[carrier] = configuredThinkingLevel;
    } else if (carrier === "xhigh" && thinkingLevelMap.xhigh === undefined) {
      thinkingLevelMap.xhigh = "xhigh";
    }
  }
  const model = {
    ...(builtin?.api === config.api ? builtin : {}),
    id: config.modelId,
    name: config.label,
    api: config.api,
    provider: config.provider,
    baseUrl,
    reasoning: configuredThinkingLevel === undefined
      ? config.reasoning
      : configuredThinkingLevel !== "off",
    // A custom endpoint has no Pi catalog metadata. Keep image blocks enabled
    // and let that endpoint return an explicit capability error if its selected
    // model is text-only; silently dropping a user image is never acceptable.
    input: builtin?.input ?? ["text", "image"],
    cost: builtin?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: builtin?.contextWindow ?? 128_000,
    maxTokens: builtin?.maxTokens ?? 8_192,
    ...(builtin?.headers ? { headers: builtin.headers } : {}),
    ...(Object.keys(thinkingLevelMap).length > 0 ? { thinkingLevelMap } : {}),
    ...(builtin?.compat && builtin.api === config.api ? { compat: builtin.compat } : {})
  } as Model<Api>;
  const streams = providerStreams(config.api);
  const streamFn = (
    requestModel: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => streams.streamSimple(requestModel, context, {
    ...options,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(config.apiKey
      ? { apiKey: config.apiKey }
      : options?.apiKey
        ? { apiKey: options.apiKey }
        : {})
  });
  return { model, streamFn: streamFn as StreamFn };
}

/** @internal Exported for protocol regression tests. */
export function toToolStreamRuntimeEvent(
  streamEvent: ToolCallAssistantEvent,
  input: AgentRunInput,
  runtime: AgentRuntimeRef,
  messageId: string,
  assistantTurnIndex: number
): Extract<AgentRuntimeEvent, { type: "agent.tool_stream" }> {
  const content = streamEvent.partial.content[streamEvent.contentIndex];
  const toolCall = content?.type === "toolCall" ? content : undefined;
  const argumentsSnapshot = toolCallArgumentsSnapshot(streamEvent, toolCall);
  const phase = streamEvent.type === "toolcall_start"
    ? "start"
    : streamEvent.type === "toolcall_delta"
      ? "delta"
      : "end";
  return {
    type: "agent.tool_stream",
    runId: input.runId,
    sessionId: input.sessionId,
    payload: {
      streamId: `${messageId}:${assistantTurnIndex}:${streamEvent.contentIndex}`,
      ...(toolCall?.id ? { toolCallId: toolCall.id } : {}),
      ...(toolCall?.name ? { toolName: toolCall.name } : {}),
      phase,
      argumentsDelta: streamEvent.type === "toolcall_delta" ? streamEvent.delta : "",
      ...(argumentsSnapshot !== undefined ? { argumentsSnapshot } : {}),
      ...(streamEvent.type === "toolcall_end"
        ? { args: streamEvent.toolCall.arguments }
        : {}),
      runtime
    }
  };
}

function serializedToolArguments(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  if (Object.keys(value).length === 0) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** @internal Exported for protocol regression tests. */
export function toolCallArgumentsSnapshot(
  streamEvent: ToolCallAssistantEvent,
  toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }> | undefined
): string | undefined {
  const providerToolCall = toolCall as
    | (typeof toolCall & { partialJson?: unknown; partialArgs?: unknown })
    | undefined;
  for (const candidate of [providerToolCall?.partialJson, providerToolCall?.partialArgs]) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  if (streamEvent.type === "toolcall_end") {
    return serializedToolArguments(streamEvent.toolCall.arguments);
  }
  if (streamEvent.type === "toolcall_start") {
    return serializedToolArguments(toolCall?.arguments);
  }
  return undefined;
}

/** @internal Exported for protocol regression tests. */
export function reconcileToolCallArguments(
  current: string,
  incomingDelta: string,
  snapshot?: string
): { delta: string; next: string } {
  let delta = incomingDelta;
  if (snapshot !== undefined) {
    if (snapshot.startsWith(current)) {
      delta = snapshot.slice(current.length);
    } else if (current.startsWith(snapshot)) {
      delta = "";
    } else if (!current) {
      delta = snapshot;
    }
  }
  return { delta, next: `${current}${delta}` };
}

/** @internal Exported for runtime event contract tests. */
export function toRuntimeEvents(
  event: AgentEvent,
  input: AgentRunInput,
  runtime: AgentRuntimeRef,
  messageId: string
): AgentRuntimeEvent[] {
  if (event.type === "tool_execution_update") {
    const details = (event.partialResult as { details?: unknown } | undefined)?.details;
    if (isSubagentToolProgressDetails(details)) {
      return toSubagentRuntimeEvents(details.progress, input, runtime, messageId);
    }
    return [];
  }

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
      if (
        details.kind === "workspace-editor-mutation" ||
        details.kind === "workspace-expert-draft-file-mutation" ||
        details.kind === "workspace-expert-draft-section-creation"
      ) {
        const text =
          details.kind === "workspace-expert-draft-section-creation"
            ? details.sections
                .map(
                  (section, index) =>
                    `${index + 1}. ${section.title}${section.wordCountRequirement ? `（${section.wordCountRequirement}）` : ""}`
                )
                .join("\n")
            : details.text;
        events.push({
          type: "workspace.editor_mutation",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            toolCallId: event.toolCallId,
            workspaceId: details.workspaceId,
            stageId: details.stageId,
            text,
            ...(details.kind === "workspace-expert-draft-file-mutation"
              ? {
                  mutationTarget: {
                    kind: "expert-draft-file" as const,
                    documentId: details.documentId,
                    sectionId: details.sectionId,
                    fileKind: details.fileKind
                  }
                }
              : details.kind === "workspace-expert-draft-section-creation"
                ? {
                    mutationTarget: {
                      kind: "expert-draft-section-creation" as const,
                      sections: details.sections,
                      ...(details.afterSectionId
                        ? { afterSectionId: details.afterSectionId }
                        : {})
                    }
                  }
              : {}),
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
    } else if (
      isLibraryAgentToolDetails(details) &&
      details.kind === "library-entry-mutation"
    ) {
      events.push({
        type: "library.editor_mutation",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: details.operation === "create"
          ? {
              toolCallId: event.toolCallId,
              operation: details.operation,
              domain: details.domain,
              libraryId: details.libraryId,
              stageId: details.stageId,
              title: details.title,
              text: details.text,
              baseRevision: details.baseRevision,
              ...(details.baseProjectRevision === undefined
                ? {}
                : { baseProjectRevision: details.baseProjectRevision }),
              summary: details.summary,
              runtime
            }
          : {
              toolCallId: event.toolCallId,
              operation: details.operation,
              domain: details.domain,
              libraryId: details.libraryId,
              entryId: details.entryId,
              documentId: details.documentId,
              stageId: details.stageId,
              title: details.title,
              text: details.text,
              baseRevision: details.baseRevision,
              ...(details.baseProjectRevision === undefined
                ? {}
                : { baseProjectRevision: details.baseProjectRevision }),
              summary: details.summary,
              runtime
            }
      });
    } else if (isLearningImitationToolDetails(details)) {
      events.push({
        type: "learning_imitation.result_updated",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          toolCallId: event.toolCallId,
          stageId: details.stageId,
          update: details.update,
          runtime
        }
      });
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

    if (event.message.content.some((item) => item.type === "toolCall")) {
      return [];
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

/** @internal Exported for subagent protocol regression tests. */
export function toSubagentRuntimeEvents(
  progress: SubagentToolProgress,
  input: AgentRunInput,
  runtime: AgentRuntimeRef,
  messageId: string
): AgentRuntimeEvent[] {
  const base = {
    parentToolCallId: progress.parentToolCallId,
    subagentRunId: progress.subagentRunId,
    subagentId: progress.subagentId,
    name: progress.name,
    runtime
  };
  if (progress.type === "started") {
    return [{
      type: "subagent.started",
      runId: input.runId,
      sessionId: input.sessionId,
      payload: { ...base, task: progress.task }
    }];
  }
  if (progress.type === "activity") {
    return [{
      type: "subagent.activity",
      runId: input.runId,
      sessionId: input.sessionId,
      payload: { ...base, activity: progress.activity }
    }];
  }
  if (progress.type === "completed") {
    return [{
      type: "subagent.completed",
      runId: input.runId,
      sessionId: input.sessionId,
      payload: {
        ...base,
        status: progress.status,
        summary: progress.summary,
        ...(progress.errorMessage ? { errorMessage: progress.errorMessage } : {}),
        ...(progress.usage ? { usage: progress.usage } : {})
      }
    }];
  }

  // Child workspace mutations remain ordinary parent-run workspace events so
  // the existing review/approval chain can process them. Only their tool-call
  // id is namespaced to the ephemeral child run.
  return toRuntimeEvents(
    {
      type: "tool_execution_end",
      toolCallId: progress.toolCallId,
      toolName: progress.toolName,
      result: progress.result,
      isError: progress.isError
    },
    input,
    runtime,
    messageId
  ).filter(
    (event) =>
      event.type === "workspace.editor_mutation" ||
      event.type === "workspace.stage_selection"
  );
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

function summarizeToolResult(result: unknown): string {
  if (typeof result === "object" && result !== null && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (item): item is { type: "text"; text: string } =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "text" &&
            "text" in item &&
            typeof item.text === "string"
        )
        .map((item) => item.text)
        .join("\n");
      if (text) {
        return text.slice(0, 4_000);
      }
    }
  }
  if (result === undefined || result === null) {
    return "工具执行完成。";
  }
  try {
    const summary = JSON.stringify(result);
    return summary ? summary.slice(0, 4_000) : "工具执行完成。";
  } catch {
    return "工具已执行完成。";
  }
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
  rawUserMessage: UserMessage
): void {
  const messages = [...agent.state.messages];
  const index = messages.findIndex((message) => message === runtimeMessage);
  if (index < 0) return;
  messages[index] = rawUserMessage;
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
  const learningProfile = input.learningImitationProfile;
  const learningContext = input.workspaceContext?.learningImitation;
  if (learningProfile && learningContext) {
    return [
      basePrompt,
      "",
      `【当前学习仿写智能体：${learningProfile.label} / ${learningProfile.id}】`,
      renderLearningImitationSystemPrompt(
        learningProfile.systemPrompt,
        learningContext
      ).trim(),
      "",
      "【DeepWrite 学习仿写工具边界】",
      "只能使用本轮列出的样本文档读取、搜索与预览写入工具。write_learning_result 只更新预览区，不会写入正式素材库或技能库。正式落盘必须等待用户在界面中确认。"
    ].join("\n");
  }
  const libraryProfile = input.libraryAgentProfile;
  const libraryWorkspace = input.workspaceContext?.libraryWorkspace;
  if (libraryProfile && libraryWorkspace) {
    const writeBoundary =
      input.writeApprovalMode === "auto-approve"
        ? "写入工具只提交资料库条目变更；客户端会在本轮完成后自动批准并尝试保存。当前回复可以说明已提交自动写入，但不得提前声称已经保存成功。"
        : "写入工具提交待用户审阅的资料库条目变更；用户接受后客户端才会保存到本地 Markdown，当前回复不得提前声称已经保存。";
    return [
      basePrompt,
      "",
      `【当前资料库智能体：${libraryProfile.label} / ${libraryProfile.domain}】`,
      libraryProfile.systemPrompt.trim(),
      "",
      "【DeepWrite 当前资料库工具边界】",
      "写入只允许管理本轮指定的当前资料库；若该库属于分组，list/read/search 也可读取同分组其它成员库条目，但不得写入那些库。",
      "条目正文必须通过本轮实际列出的读取和搜索工具按需取得。",
      "需要整理、创建或初始化等方法时，调用 load_skill 按需加载本轮可用技能；技能是方法，不会自动成为资料库事实。",
      libraryWorkspace.readOnly
        ? "当前资料库只读，本轮不会装配任何创建或编辑工具。"
        : writeBoundary,
      "库介绍当前只读；删除条目、修改分组、绑定书籍和写入其它资料库均未接通。"
    ].join("\n");
  }
  const profile = input.agentProfile;
  if (!profile) return basePrompt;
  const writeBoundary =
    input.writeApprovalMode === "auto-approve"
      ? "写入工具只提交文本变更；客户端会在本轮完成后自动批准并尝试保存到本地 Markdown。当前回复可以说明已提交自动写入，但不得提前声称已经保存成功。"
      : "写入工具提交待用户审阅的文本变更；用户接受后客户端才会自动持久化到本地 Markdown，当前回复不得提前声称已经保存。";
  return [
    basePrompt,
    "",
    `【当前短篇智能体：${profile.label} / ${profile.id}】`,
    profile.systemPrompt.trim(),
    "",
    "【DeepWrite 当前工具边界】",
    "只使用本轮实际提供的工具；没有出现在工具列表中的能力尚未接通，不得声称已经执行。",
    writeBoundary,
    profile.id === "expert_draft_coordinator"
      ? "当前已接通正文目录索引、批量创建空白章节文件、全部/单章正文读取及按章节正文文件写入与替换；删除、改名、排序和后台分节写手调度尚未接通，不得声称已经执行。"
      : profile.id === "expert_section_writer"
        ? "当前分节写手只允许修改运行上下文锁定的小节；正文与人物状态工具分别按 documentId 提交到两个独立文件，由客户端生成独立的待审阅变更。"
        : ""
  ].filter(Boolean).join("\n");
}

/** @internal Exported for prompt-boundary regression tests. */
export function buildRuntimeUserPrompt(input: AgentRunInput): string {
  const active = input.workspaceContext?.activeResource;
  const libraryContext = input.workspaceContext?.libraryWorkspace;
  const skills = input.workspaceContext?.attachedSkills ?? [];
  const materials = input.workspaceContext?.attachedMaterials ?? [];
  const isShortAgentRun = Boolean(
    input.workspaceContext?.shortWorkspace && input.agentProfile
  );
  const isLibraryAgentRun = Boolean(
    libraryContext && input.libraryAgentProfile
  );
  const learningContext = input.workspaceContext?.learningImitation;
  const readableSkills = input.agentProfile
    ? skills.filter(
        (item) =>
          item.kind !== undefined && input.agentProfile!.readAccess.skill.includes(item.kind)
      )
    : input.libraryAgentProfile
      ? skills
      : skills;
  const readableMaterials = input.agentProfile
    ? materials.filter(
        (item) =>
          item.kind !== undefined && input.agentProfile!.readAccess.material.includes(item.kind)
      )
    : materials;
  const skillContext = isShortAgentRun || isLibraryAgentRun
    ? readableSkills.length
      ? isLibraryAgentRun
        ? `可按需加载的技能：\n${input.libraryAgentProfile!.readAccess.skills
            .map((skill) => `- ${skill.name}：${skill.description || "无描述"}`)
            .join("\n")}\n需要正文时调用 load_skill。`
        : `可按需加载的技能：\n${readableSkills
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
    input.workspaceContext?.shortWorkspace?.activeSectionId
      ? `当前小节: ${input.workspaceContext.shortWorkspace.activeSectionId}`
      : "",
    input.workspaceContext?.shortWorkspace?.expertDraft.sections.length
      ? `正文目录小节（由早到晚）: ${input.workspaceContext.shortWorkspace.expertDraft.sections
          .map((section) => `${section.title} (${section.id})`)
          .join("、")}`
      : "",
    input.agentProfile
      ? `当前智能体: ${input.agentProfile.label} (${input.agentProfile.id})`
      : input.libraryAgentProfile
        ? `当前智能体: ${input.libraryAgentProfile.label} (${input.libraryAgentProfile.domain})`
      : input.learningImitationProfile
        ? `当前智能体: ${input.learningImitationProfile.label} (${input.learningImitationProfile.id})`
      : "",
    learningContext
      ? `学习阶段: ${learningContext.stageId}；样本文档: ${learningContext.documents.length} 篇`
      : "",
    libraryContext
      ? `当前资料库: 《${libraryContext.title}》 (${libraryContext.domain} / ${libraryContext.libraryType} / ${libraryContext.kind})`
      : "",
    libraryContext
      ? `资料库状态: ${libraryContext.readOnly ? "只读" : "可写"}${libraryContext.projectRevision === undefined ? "" : `；项目版本 ${libraryContext.projectRevision}`}`
      : "",
    libraryContext?.activeEntryId
      ? `当前条目: ${libraryContext.activeEntryId}`
      : "",
    libraryContext
      ? `库介绍${libraryContext.overviewTruncated ? "（已截断）" : ""}:\n${libraryContext.overview || "未填写"}`
      : "",
    libraryContext
      ? `条目索引（正文请通过工具读取）:\n${
          libraryContext.entries.length
            ? libraryContext.entries
                .map(
                  (entry) =>
                    `- ${entry.title} (${entry.id}) [${entry.stageId}]${entry.readOnly ? " [只读]" : ""}${entry.truncated ? " [正文快照已截断]" : ""}`
                )
                .join("\n")
            : "- 无条目"
        }${libraryContext.omittedEntryCount ? `\n- 另有 ${libraryContext.omittedEntryCount} 个条目未进入本轮快照` : ""}`
      : "",
    active
      ? `当前资源: ${active.title} (${active.domain}${active.format ? ` / ${active.format}` : ""})`
      : learningContext
        ? "当前资源: 学习仿写样本文档（正文请通过工具按需读取）"
        : "当前资源: 未提供",
    active ? `资源路径: ${active.path.join(" / ")}` : "",
    active &&
    !input.workspaceContext?.shortWorkspace &&
    !input.workspaceContext?.libraryWorkspace
      ? `实时内容:\n${active.content}`
      : "",
    skillContext,
    materialContext,
    "",
    "【用户消息与上传附件】",
    buildRawUserText(input)
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function buildRawUserText(input: AgentRunInput): string {
  const attachments = input.attachments ?? [];
  const textAttachments = attachments.filter(
    (attachment) => attachment.kind === "text"
  );
  const imageAttachments = attachments.filter(
    (attachment) => attachment.kind === "image"
  );
  const lines = [input.prompt];
  if (textAttachments.length) {
    lines.push("", "【用户上传的文本附件】");
    for (const attachment of textAttachments) {
      lines.push(
        "",
        `--- ${attachment.name} (${attachment.mediaType}) ---`,
        attachment.content,
        attachment.truncated
          ? `[DeepWrite：附件文本已截断；原文 ${attachment.originalLength?.toLocaleString("zh-CN") ?? "超过限制"} 个字符。]`
          : ""
      );
    }
  }
  if (imageAttachments.length) {
    lines.push(
      "",
      `【用户上传的图片】${imageAttachments.map((attachment) => attachment.name).join("、")}`
    );
  }
  return lines.filter((line) => line !== "").join("\n");
}

function imageContentBlocks(input: AgentRunInput): Array<{
  type: "image";
  data: string;
  mimeType: string;
}> {
  return (input.attachments ?? []).flatMap((attachment) =>
    attachment.kind === "image"
      ? [{ type: "image" as const, data: attachment.data, mimeType: attachment.mediaType }]
      : []
  );
}

function buildRuntimeUserMessageContent(input: AgentRunInput): UserMessage["content"] {
  const images = imageContentBlocks(input);
  return images.length
    ? [{ type: "text", text: buildRuntimeUserPrompt(input) }, ...images]
    : buildRuntimeUserPrompt(input);
}

/** @internal Exported for prompt-content regression tests. */
export function buildRawUserMessage(input: AgentRunInput, timestamp = Date.now()): UserMessage {
  const text = buildRawUserText(input);
  const images = imageContentBlocks(input);
  return {
    role: "user",
    content: images.length ? [{ type: "text", text }, ...images] : text,
    timestamp
  };
}

function buildLocalThinking(input: AgentRunInput): string {
  const title = input.workspaceContext?.activeResource?.title ?? "未命名资源";
  const selectedProfile = input.agentProfile ?? input.libraryAgentProfile;
  const agent = selectedProfile ? `，由「${selectedProfile.label}」处理` : "";
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
      : input.libraryAgentProfile
        ? `- 当前已选择「${input.libraryAgentProfile.label}」，并且装配当前资料库读写工具与按需 load_skill。`
      : "",
    "",
    "下一切片接入真实模型配置后，可以在保持同一协议的前提下生成正式续写、润色和一致性检查结果。"
  ].filter(Boolean).join("\n");
}
