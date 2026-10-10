import {
  chatAssistantProjectKey,
  type ImageModelCapability
} from "@deepwrite/contracts";
import type { BookIdentityRunRegistration } from "../book-identity/run-registration";
import { createId } from "@deepwrite/shared";
import {
  CommandEnvelopeSchema,
  EXTRAS_AGENT_USAGE_MODULES,
  SessionPromptAcceptedPayloadSchema,
  assertExtrasAgentBudget,
  createEnvelope,
  isDeepSeekWebSearchCompatible,
  type AgentProviderRuntimeConfig,
  type AgentRuntimeRef,
  type CommandEnvelope,
  type CommandResult,
  type ExtrasAgentRunSpec,
  type ExtrasAgentTask
} from "@deepwrite/contracts";
import {
  withCompactionUsageConfig,
  type ContextCompactionRun
} from "../../main/context-compaction-run";
import { resolveModelRunSettings } from "../../main/model-run-settings";
import {
  createUsageRunContext,
  type UsageRunContext
} from "../../main/usage-observation";
import type { ChatRuntimeSources } from "./chat/runtime-snapshot";
import type { ExtrasAgentConfigStore } from "./config-store";
import type { ExtrasTaskResolution } from "./task-resolver";
import { resolveExtrasTask } from "./task-resolver";
import { decompositionModelCapacity } from "./long-book-decomposition/model-capacity";

type ExtrasAgentRunCommand = Extract<
  CommandEnvelope,
  { type: "extrasAgent.run" }
>;

/** The subset of Main's run registry an extras run needs. */
export interface ExtrasAgentActiveRun {
  sessionId: string;
  correlationId: string;
  runtime: AgentRuntimeRef;
  accepted: boolean;
  bookIdentity?: BookIdentityRunRegistration;
  promptRequestId?: string;
  resourceId?: string;
  usageContext?: UsageRunContext;
  decompositionJobId?: string;
  decompositionOutputVersion?: number;
  decompositionAttemptId?: string;
  decompositionUnitIds?: string[];
  decompositionPhase?: string;
}

export interface ExtrasAgentRunDependencies {
  evaluationMode?: boolean;
  imageCapability?(): Promise<ImageModelCapability | undefined>;
  configStore(): ExtrasAgentConfigStore;
  resolveDecomposition?(
    task: Extract<ExtrasAgentTask, { agentId: "long-book-decomposition" }>
  ): Promise<ExtrasTaskResolution>;
  cancelDecomposition?(
    resolution: ExtrasTaskResolution,
    code?: string
  ): Promise<void>;
  resolveLongMaterialGuide?(
    task: Extract<ExtrasAgentTask, { agentId: "long-material-guide" }>,
    capacity: {
      contextWindow?: number | undefined;
      maxTokens?: number | undefined;
    }
  ): Promise<ExtrasTaskResolution>;
  chatSources: ChatRuntimeSources;
  resolveModel(
    modelId: string | undefined
  ): Promise<AgentProviderRuntimeConfig | undefined>;
  /** Compaction settings for conversations and durable decomposition tasks. */
  resolveContextCompaction(
    runModelId: string | undefined
  ): Promise<ContextCompactionRun>;
  requestAgent(command: CommandEnvelope): Promise<CommandResult>;
  /**
   * Holds the conversation until Agent confirms drainage; undefined while
   * this conversation already has a prompt or a history management operation.
   */
  acquireConversation(
    sessionId: string,
    ownerId: string
  ): (() => void) | undefined;
  activeRuns: Map<string, ExtrasAgentActiveRun>;
  terminalRuns: ReadonlySet<string>;
  pendingUsageContexts: Map<string, UsageRunContext>;
}

const pendingIdentityScopes = new WeakMap<object, Set<string>>();

function rejected(
  command: CommandEnvelope,
  message: string,
  code = "extras_agent.run_failed"
): CommandResult {
  return {
    status: "rejected",
    requestId: command.id,
    error: { code, message }
  };
}

function assertWebSearchSupported(
  task: ExtrasAgentTask,
  runtimeConfig: AgentProviderRuntimeConfig | undefined
): void {
  const requested =
    "webSearchEnabled" in task.input && task.input.webSearchEnabled === true;
  if (requested && !isDeepSeekWebSearchCompatible(runtimeConfig)) {
    throw new Error(
      "智能搜索仅支持 Provider 为 DeepSeek，且 API 类型为 OpenAI Responses 或 Anthropic Messages 的模型。"
    );
  }
}

/**
 * Resolves the saved profile, model and budget for a "更多功能" run and hands
 * the authoritative spec to the Agent Utility. Mirrors `session.prompt`
 * bookkeeping so usage, aborts and busy checks see extras runs too.
 */
export async function runExtrasAgent(
  deps: ExtrasAgentRunDependencies,
  command: ExtrasAgentRunCommand
): Promise<CommandResult> {
  const { correlationId } = command.context;
  const { task, conversation, sessionId } = command.payload;
  const ownerId = conversation ? createId("prompt") : command.id;
  const identityScope =
    task.agentId === "book-title-design" ||
    task.agentId === "book-synopsis-design" ||
    task.agentId === "book-cover-design"
      ? `${chatAssistantProjectKey(task.input.book)}:${task.agentId}`
      : undefined;
  let pending = pendingIdentityScopes.get(deps.activeRuns);
  if (!pending) {
    pending = new Set();
    pendingIdentityScopes.set(deps.activeRuns, pending);
  }
  if (
    identityScope &&
    (pending.has(identityScope) ||
      [...deps.activeRuns.values()].some(
        (run) =>
          run.bookIdentity &&
          `${chatAssistantProjectKey(run.bookIdentity.book)}:book-${run.bookIdentity.field === "title" ? "title" : run.bookIdentity.field === "synopsis" ? "synopsis" : "cover"}-design` ===
            identityScope
      ))
  )
    return rejected(
      command,
      "同一本书的该字段正在生成，请等待或停止当前运行。",
      "book_identity.field_busy"
    );
  if (identityScope) pending.add(identityScope);
  const release = conversation
    ? deps.acquireConversation(sessionId, ownerId)
    : () => undefined;
  if (!release) {
    if (identityScope) pending.delete(identityScope);
    return rejected(
      command,
      "此对话仍在运行或管理历史，请稍后重试。",
      "agent.session_busy"
    );
  }
  let resolution: ExtrasTaskResolution | undefined;
  let acceptedRun = false;
  let keepOwnership = false;
  let startFailureCode: string | undefined;
  try {
    const runtimeConfig = await deps.resolveModel(command.payload.modelId);
    assertWebSearchSupported(task, runtimeConfig);
    const guideCapacity =
      task.agentId === "long-material-guide"
        ? runtimeConfig
          ? await decompositionModelCapacity(
              deps.requestAgent,
              command,
              runtimeConfig,
              "guide"
            )
          : deps.evaluationMode
            ? { contextWindow: 128_000, maxTokens: 8192 }
            : undefined
        : undefined;
    if (task.agentId === "long-material-guide" && !guideCapacity)
      throw new Error("请选择可用模型。");
    resolution =
      task.agentId === "long-book-decomposition" && deps.resolveDecomposition
        ? await deps.resolveDecomposition(task)
        : task.agentId === "long-material-guide" &&
            deps.resolveLongMaterialGuide &&
            guideCapacity
          ? await deps.resolveLongMaterialGuide(task, guideCapacity)
          : await resolveExtrasTask(
              deps.configStore(),
              deps.chatSources,
              task,
              task.agentId === "book-cover-design"
                ? await deps.imageCapability?.()
                : undefined
            );
    if (
      resolution.task.agentId === "long-book-decomposition" &&
      command.payload.modelId !== resolution.task.input.modelId
    )
      throw new Error("运行模型必须与任务快照一致。");
    const budgetModel =
      resolution.task.agentId === "long-book-decomposition"
        ? runtimeConfig
          ? await decompositionModelCapacity(
              deps.requestAgent,
              command,
              runtimeConfig,
              "run"
            )
          : deps.evaluationMode
            ? { contextWindow: 128_000, maxTokens: 8192 }
            : undefined
        : resolution.task.agentId === "long-material-guide"
          ? guideCapacity
          : (runtimeConfig ??
            (deps.evaluationMode && resolution.bookIdentity
              ? { contextWindow: 128_000, maxTokens: 8192 }
              : undefined));
    assertExtrasAgentBudget(resolution.task, budgetModel);
    if (resolution.bookIdentity && runtimeConfig)
      resolution.bookIdentity.model = {
        id: runtimeConfig.id,
        label: runtimeConfig.label
      };
    const { thinkingLevel, temperature } = resolveModelRunSettings(
      runtimeConfig,
      {
        thinkingLevel:
          resolution.task.agentId === "long-book-decomposition"
            ? resolution.task.input.thinkingLevel
            : command.payload.thinkingLevel,
        temperature: command.payload.temperature
      }
    );
    const compaction =
      conversation || task.agentId === "long-book-decomposition"
        ? await deps.resolveContextCompaction(runtimeConfig?.id)
        : undefined;
    if (compaction && task.agentId === "long-book-decomposition")
      compaction.contextCompactionSettings.enabled = true;
    const spec: ExtrasAgentRunSpec = {
      sessionId,
      ...(runtimeConfig ? { runtimeConfig } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      task: resolution.task,
      ...(conversation ? { conversation } : {}),
      ...compaction
    };
    const usageContext = createUsageRunContext(
      EXTRAS_AGENT_USAGE_MODULES[task.agentId],
      runtimeConfig,
      compaction ? withCompactionUsageConfig({}, compaction) : {}
    );
    deps.pendingUsageContexts.set(correlationId, usageContext);
    const internalCommand = CommandEnvelopeSchema.parse(
      createEnvelope("agent.extras_run", spec, {
        id: ownerId,
        context: command.context
      })
    );
    keepOwnership = true;
    const result = await deps.requestAgent(internalCommand);
    if (result.status !== "accepted") {
      keepOwnership = false;
      startFailureCode = result.error.code;
      return { ...result, requestId: command.id };
    }
    const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
    acceptedRun = true;
    const provisional = [...deps.activeRuns.entries()].find(
      ([, run]) => run.correlationId === correlationId
    );
    if (
      accepted.sessionId !== sessionId ||
      (provisional && provisional[0] !== accepted.runId)
    ) {
      return rejected(
        command,
        "Agent acceptance does not match the extras agent run.",
        "ipc.invalid_agent_acceptance"
      );
    }
    if (!deps.terminalRuns.has(accepted.runId)) {
      deps.activeRuns.set(accepted.runId, {
        sessionId: accepted.sessionId,
        correlationId,
        runtime: accepted.runtime,
        accepted: true,
        promptRequestId: internalCommand.id,
        ...(resolution.resourceId ? { resourceId: resolution.resourceId } : {}),
        usageContext,
        ...(resolution.bookIdentity
          ? { bookIdentity: resolution.bookIdentity }
          : {}),
        ...(resolution.decompositionJobId
          ? {
              decompositionJobId: resolution.decompositionJobId,
              decompositionOutputVersion: resolution.decompositionOutputVersion,
              decompositionAttemptId: resolution.decompositionAttemptId,
              decompositionUnitIds: resolution.decompositionUnitIds,
              decompositionPhase: resolution.decompositionPhase
            }
          : {})
      });
    }
    return { status: "accepted", requestId: command.id, payload: accepted };
  } catch (error: unknown) {
    return rejected(
      command,
      error instanceof Error ? error.message : "启动智能体失败。"
    );
  } finally {
    if (!acceptedRun && resolution?.decompositionJobId)
      await deps.cancelDecomposition?.(resolution, startFailureCode);
    deps.pendingUsageContexts.delete(correlationId);
    if (!keepOwnership) release();
    if (identityScope) pending.delete(identityScope);
  }
}
