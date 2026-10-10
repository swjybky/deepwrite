import { bookTitleDesignAgent } from "./agents/book-identity/title-design";
import { bookSynopsisDesignAgent } from "./agents/book-identity/synopsis-design";
import { bookCoverDesignAgent } from "./agents/book-identity/cover-design";
import {
  assertExtrasAgentBudget,
  type ExtrasAgentResolvedTask,
  type ExtrasAgentRunSpec
} from "@deepwrite/contracts";
import type { ContextPolicy } from "../kernel/context";
import type { AgentRunPlan, AgentRunTarget } from "../kernel/run-plan";
import type { LongCommandExecutor } from "../long-agent-tools";
import { buildSpawnSubagentTool } from "../subagent-runtime";
import type { AgentRunBuildContext } from "../kernel/run-plan";
import { rawUserMessageContent } from "../prompts-user-message";
import type { AgentRuntimeEvent } from "../runtime-types";
import { chatNormalAgent } from "./agents/chat-normal";
import { chatProjectAgent } from "./agents/chat-project";
import { chatRoleplayAgent } from "./agents/chat-roleplay";
import { longBookAnalysisAgent } from "./agents/long-book-analysis";
import { longBookDecompositionAgent } from "./agents/long-book-decomposition/definition";
import { longMaterialGuideAgent } from "./agents/long-material-guide";
import { revisionAnalysisAgent } from "./agents/revision-analysis";
import { shortBookAnalysisAgent } from "./agents/short-book-analysis";
import { styleComparisonAgent } from "./agents/style-comparison";
import {
  bindExtrasAgent,
  bindExtrasConversationAgent,
  type BoundExtrasAgent,
  type BoundExtrasTaskAgent,
  type ExtrasAgentRunServices
} from "./definition";

export interface ExtrasAgentRunInput {
  runId: string;
  spec: ExtrasAgentRunSpec;
  signal?: AbortSignal;
  longCommandExecutor?: LongCommandExecutor;
  bookIdentitySubmit?: ExtrasAgentRunServices["bookIdentitySubmit"];
  decompositionQuery?: ExtrasAgentRunServices["decompositionQuery"];
  decompositionSubmit?: ExtrasAgentRunServices["decompositionSubmit"];
  decompositionPlanTopic?: ExtrasAgentRunServices["decompositionPlanTopic"];
}

/** The extras agent registry: every agent id maps to exactly one definition. */
export function resolveExtrasAgent(
  task: ExtrasAgentResolvedTask
): BoundExtrasAgent {
  switch (task.agentId) {
    case "book-title-design":
      return bindExtrasAgent(bookTitleDesignAgent, task);
    case "book-synopsis-design":
      return bindExtrasAgent(bookSynopsisDesignAgent, task);
    case "book-cover-design":
      return bindExtrasAgent(bookCoverDesignAgent, task);
    case "revision-analysis":
      return bindExtrasAgent(revisionAnalysisAgent, task);
    case "short-book-analysis":
      return bindExtrasAgent(shortBookAnalysisAgent, task);
    case "long-book-analysis":
      return bindExtrasAgent(longBookAnalysisAgent, task);
    case "long-book-decomposition":
      return bindExtrasAgent(longBookDecompositionAgent, task);
    case "long-material-guide":
      return bindExtrasAgent(longMaterialGuideAgent, task);
    case "style-comparison":
      return bindExtrasAgent(styleComparisonAgent, task);
    case "chat-normal":
      return bindExtrasConversationAgent(chatNormalAgent, task);
    case "chat-project":
      return bindExtrasConversationAgent(chatProjectAgent, task);
    case "chat-roleplay":
      return bindExtrasConversationAgent(chatRoleplayAgent, task);
  }
}

type CompletedEvent = Extract<AgentRuntimeEvent, { type: "agent.completed" }>;

function finalOutputEvents(
  agent: BoundExtrasTaskAgent,
  completed: CompletedEvent
): AgentRuntimeEvent[] {
  const { runId, sessionId, payload } = completed;
  if (!agent.finalOutput || payload.stopReason === "aborted") return [];
  const failure = (code: string, message: string): AgentRuntimeEvent => ({
    type: "agent.error",
    runId,
    sessionId,
    payload: { code, message, runtime: payload.runtime }
  });
  if (payload.stopReason === "length") {
    return [
      failure(
        "extras_agent.output_truncated",
        agent.truncatedOutputMessage ?? "模型输出达到长度上限，结果不完整。"
      )
    ];
  }
  try {
    return [
      {
        type: "extras_agent.output_updated",
        runId,
        sessionId,
        payload: {
          agentId: agent.agentId,
          jobId: agent.jobId,
          output: agent.finalOutput(payload.content),
          runtime: payload.runtime
        }
      }
    ];
  } catch (error: unknown) {
    return [
      failure(
        "extras_agent.invalid_output",
        error instanceof Error ? error.message : "模型未返回有效结果。"
      )
    ];
  }
}

/**
 * Plans a "更多功能" run; see `ExtrasTaskAgentDefinition` for one-shot tasks
 * and `ExtrasConversationAgentDefinition` for chats.
 */
export function planExtrasRun(input: ExtrasAgentRunInput): AgentRunPlan {
  const { runId, spec, signal } = input;
  const agent = resolveExtrasAgent(spec.task);
  const identity = { runId, sessionId: spec.sessionId };
  const services: ExtrasAgentRunServices = {
    ...identity,
    ...(input.bookIdentitySubmit
      ? { bookIdentitySubmit: input.bookIdentitySubmit }
      : {}),
    ...(input.decompositionQuery
      ? { decompositionQuery: input.decompositionQuery }
      : {}),
    ...(input.decompositionSubmit
      ? { decompositionSubmit: input.decompositionSubmit }
      : {}),
    ...(input.decompositionPlanTopic
      ? { decompositionPlanTopic: input.decompositionPlanTopic }
      : {}),
    ...(input.longCommandExecutor
      ? { longCommandExecutor: input.longCommandExecutor }
      : {})
  };
  const target: AgentRunTarget = {
    ...identity,
    ...(signal ? { signal } : {}),
    ...(spec.runtimeConfig ? { runtimeConfig: spec.runtimeConfig } : {}),
    ...(spec.thinkingLevel ? { thinkingLevel: spec.thinkingLevel } : {}),
    ...(spec.temperature !== undefined ? { temperature: spec.temperature } : {})
  };
  const shared = {
    eventSource: identity,
    portableToolSchemaProfile: "default" as const,
    assertModelBudget: (model: Parameters<typeof assertExtrasAgentBudget>[1]) =>
      assertExtrasAgentBudget(spec.task, model),
    build: (context: AgentRunBuildContext) => {
      const runServices = {
        ...services,
        localFaux: context.runtime.mode === "local-faux"
      };
      const tools = agent.tools(runServices);
      const orchestration =
        agent.interaction === "task"
          ? agent.orchestration?.(runServices)
          : undefined;
      if (orchestration) {
        const spawn = buildSpawnSubagentTool({
          parentSessionId: spec.sessionId,
          parentSignal: context.parentSignal,
          parentRuntime: context.runtime,
          model: context.model,
          thinkingLevel: context.thinkingLevel,
          streamFn: context.spawnStreamFn,
          getParentMessages: context.getParentMessages,
          definitions: orchestration.definitions,
          prepareChild: orchestration.prepareChild,
          buildChildTools: () => [],
          parallel: true,
          workspaceAccess: "none",
          ...(agent.interaction === "task" &&
          agent.contextTask &&
          spec.contextCompactionSettings
            ? {
                contextPolicy: {
                  settings: spec.contextCompactionSettings,
                  task: agent.contextTask,
                  toolCompactors: agent.toolCompactors ?? {}
                }
              }
            : {})
        });
        if (spawn) tools.push(spawn);
      }
      return { systemPrompt: agent.systemPrompt, tools };
    }
  };
  if (agent.interaction === "task") {
    return {
      ...shared,
      target: {
        ...target,
        ...(spec.compactionRuntimeConfig
          ? { compactionRuntimeConfig: spec.compactionRuntimeConfig }
          : {})
      },
      ...(agent.contextTask && spec.contextCompactionSettings
        ? {
            contextPolicy: {
              settings: spec.contextCompactionSettings,
              task: agent.contextTask,
              toolCompactors: agent.toolCompactors ?? {}
            }
          }
        : {}),
      fauxResponses: () => agent.faux(runId),
      userMessageContent: () => agent.userMessage,
      ...(agent.requiredOutputTool
        ? { requiredOutputTool: agent.requiredOutputTool }
        : {}),
      ...(agent.finalOutput
        ? { completionEvents: (event) => finalOutputEvents(agent, event) }
        : {})
    };
  }
  const turn = spec.conversation;
  if (!turn)
    throw new Error("Conversation agents require the conversation turn.");
  // One-shot analyses are budgeted up front and never compacted: dropping
  // source text would silently weaken their evidence. Chats are compacted.
  const contextPolicy: ContextPolicy | undefined =
    spec.contextCompactionSettings && {
      settings: spec.contextCompactionSettings,
      task: spec.task.agentId === "chat-roleplay" ? "roleplay" : "chat",
      toolCompactors: {},
      ...(turn.checkpoint ? { checkpoint: turn.checkpoint } : {}),
      ...(turn.compaction ? { manual: turn.compaction } : {})
    };
  return {
    ...shared,
    target: {
      ...target,
      ...(turn.history?.length ? { conversationHistory: turn.history } : {}),
      ...(turn.historyMode
        ? { conversationHistoryMode: turn.historyMode }
        : {}),
      ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
      ...(agent.webSearchEnabled ? { webSearchEnabled: true } : {}),
      ...(spec.compactionRuntimeConfig
        ? { compactionRuntimeConfig: spec.compactionRuntimeConfig }
        : {})
    },
    ...(contextPolicy ? { contextPolicy } : {}),
    agentKey: `${spec.sessionId}:extras:${agent.conversationKey}`,
    fauxResponses: (thinkingLevel) =>
      agent.faux({ message: turn.message, thinking: thinkingLevel !== "off" }),
    userMessageContent: () =>
      rawUserMessageContent({
        prompt: turn.message,
        ...(turn.attachments ? { attachments: turn.attachments } : {})
      })
  };
}
