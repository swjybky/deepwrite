import type { Agent } from "@earendil-works/pi-agent-core";
import type { ThinkingLevel as ProviderThinkingLevel } from "@earendil-works/pi-ai";
import type {
  AgentProviderRuntimeConfig,
  AgentRuntimeRef,
  ModelConnectionTestResult,
  SessionSteerAcceptedPayload,
  SessionSteerCommandPayload,
  SessionUserInputResponseAcceptedPayload,
  SessionUserInputResponsePayload
} from "@deepwrite/contracts";
import { isJevModel } from "@deepwrite/contracts";
import { normalizeUsage } from "./event-mapping";
import { testJevConnection } from "./jev-systemone-client";
import { planExtrasRun, type ExtrasAgentRunInput } from "./extras/run-plan";
import { DEEPWRITE_FAUX_RUNTIME } from "./faux-local";
import { ConversationAgentCache } from "./kernel/run-agent";
import { AgentRunKernel } from "./kernel/run-kernel";
import { RunSteeringRegistry } from "./kernel/run-steering";
import {
  buildProviderRuntime,
  resolveProviderModelCapacity,
  toPiThinkingLevel
} from "./provider-runtime";
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeEvent,
  PiRuntimeAdapterOptions
} from "./runtime-types";
import type { AgentToolExecutionHooks } from "./subagent-runtime";
import { AgentUserInputBroker } from "./user-input-broker";
import {
  planWorkspaceRun,
  type WorkspaceRunPlanOptions
} from "./workspace-run-plan";

export class PiAgentRuntimeAdapter implements AgentRuntime {
  private readonly conversationAgents = new Map<string, Agent>();
  private readonly userInputBroker = new AgentUserInputBroker();
  private readonly steering = new RunSteeringRegistry();
  private readonly kernel: AgentRunKernel;
  private readonly workspacePlanOptions: WorkspaceRunPlanOptions;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    const toolExecutionHooks: AgentToolExecutionHooks = {
      ...(options.beforeToolCall
        ? { beforeToolCall: options.beforeToolCall }
        : {}),
      ...(options.afterToolCall ? { afterToolCall: options.afterToolCall } : {})
    };
    this.workspacePlanOptions = {
      ...(options.systemPrompt ? { basePrompt: options.systemPrompt } : {}),
      toolExecutionHooks,
      ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
      ...(options.subagentTimeoutMs === undefined
        ? {}
        : { subagentTimeoutMs: options.subagentTimeoutMs })
    };
    this.kernel = new AgentRunKernel({
      idleTimeoutMs: options.idleTimeoutMs ?? 5 * 60_000,
      tokensPerSecond: options.tokensPerSecond ?? 90,
      evaluationMode: options.evaluationMode === true,
      retryPolicy: options.retryPolicy,
      agents: new ConversationAgentCache(
        this.conversationAgents,
        toolExecutionHooks
      ),
      userInputBroker: this.userInputBroker,
      steering: this.steering,
      describe: (config) => this.describe(config)
    });
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

  /** Queues a user message for the active run's next model call. */
  steer(payload: SessionSteerCommandPayload): SessionSteerAcceptedPayload {
    return this.steering.steer(payload);
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
    // Jev is a judgment model with its own endpoint; a chat probe would only
    // test an unrelated completions route.
    if (isJevModel(config)) return testJevConnection(config);
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

  /** Runs a creation-space or library agent from a `session.prompt` request. */
  async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    yield* this.kernel.run(planWorkspaceRun(input, this.workspacePlanOptions));
  }

  /** Runs a "更多功能" agent from an `agent.extras_run` request. */
  async *startExtras(
    input: ExtrasAgentRunInput
  ): AsyncIterable<AgentRuntimeEvent> {
    yield* this.kernel.run(planExtrasRun(input));
  }
}
