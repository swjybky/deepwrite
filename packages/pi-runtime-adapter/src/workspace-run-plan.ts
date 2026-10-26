import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking
} from "@earendil-works/pi-ai";
import type { AgentTurnRetryPolicyOptions } from "./agent-turn-retry";
import { assertConversationPromptBudget } from "@deepwrite/contracts";
import { conversationAgentKey } from "./conversation-agent-rebuild";
import { buildLocalThinking, buildLocalWritingResponse } from "./faux-local";
import type { AgentRunPlan } from "./kernel/run-plan";
import { libraryManagementParentPrompt } from "./library-management-runtime";
import { resolvePortableToolSchemaProfile } from "./portable-tool-schema";
import { buildLongRuntimeToolBoundary } from "./prompts-long";
import {
  buildEffectiveSystemPrompt,
  buildFollowUpRawUserMessageContent,
  buildLongFollowUpTurnUserMessageContent,
  buildRawUserMessage,
  buildRuntimeUserMessageContent,
  longAgentRefreshesDesignContextOnLaterTurns
} from "./prompts";
import { buildRunTools } from "./run-tools";
import type { AgentRunInput } from "./runtime-types";
import type { AgentToolExecutionHooks } from "./subagent-runtime";
import { workspaceContextPolicy } from "./workspace-context-policy";

export interface WorkspaceRunPlanOptions {
  basePrompt: string;
  toolExecutionHooks: AgentToolExecutionHooks;
  retryPolicy?: AgentTurnRetryPolicyOptions;
  subagentTimeoutMs?: number;
}

/**
 * Assembles creation-space and library runs that arrive through
 * `session.prompt`. "更多功能" agents, chat included, use `planExtrasRun`.
 */
export function planWorkspaceRun(
  input: AgentRunInput,
  options: WorkspaceRunPlanOptions
): AgentRunPlan {
  const shortWorkspace = input.workspaceContext?.shortWorkspace;
  const scriptWorkspace = input.workspaceContext?.scriptWorkspace;
  const contextPolicy = workspaceContextPolicy(input);
  const portableToolSchemaProfile = resolvePortableToolSchemaProfile(
    input.workspaceContext
  );
  return {
    target: input,
    eventSource: input,
    agentKey: conversationAgentKey(input),
    portableToolSchemaProfile,
    assertModelBudget: () =>
      assertConversationPromptBudget(
        { message: input.prompt, attachments: input.attachments },
        input.contextCompactionSettings?.budgetTokens
      ),
    fauxResponses: (thinkingLevel) => [
      fauxAssistantMessage(
        thinkingLevel === "off"
          ? [fauxText(buildLocalWritingResponse(input))]
          : [
              fauxThinking(buildLocalThinking(input)),
              fauxText(buildLocalWritingResponse(input))
            ]
      )
    ],
    build: (context) => {
      const tools = buildRunTools(input, {
        model: context.model,
        thinkingLevel: context.thinkingLevel,
        streamFn: context.spawnStreamFn,
        parentRuntime: context.runtime,
        parentSignal: context.parentSignal,
        requestUserInput: context.requestUserInput,
        portableToolSchemaProfile,
        toolExecutionHooks: options.toolExecutionHooks,
        ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
        ...(options.subagentTimeoutMs === undefined
          ? {}
          : { subagentTimeoutMs: options.subagentTimeoutMs }),
        getParentMessages: context.getParentMessages,
        onContextCompacted: context.onContextCompacted
      });
      return {
        systemPrompt: [
          buildEffectiveSystemPrompt(options.basePrompt, input),
          libraryManagementParentPrompt(input),
          input.longAgentProfile && input.workspaceContext?.longWorkspace
            ? buildLongRuntimeToolBoundary(tools)
            : ""
        ]
          .filter(Boolean)
          .join("\n\n"),
        tools
      };
    },
    ...(contextPolicy ? { contextPolicy } : {}),
    rawUserMessageContent: () => buildRawUserMessage(input).content,
    // Plot-design and draft turns also receive their latest structure
    // snapshots; tools and the system prompt are still refreshed before every run.
    userMessageContent: (firstTurn) =>
      firstTurn
        ? buildRuntimeUserMessageContent(input)
        : (input.agentProfile && shortWorkspace) ||
            (input.scriptAgentProfile && scriptWorkspace)
          ? buildRuntimeUserMessageContent(input)
          : longAgentRefreshesDesignContextOnLaterTurns(
                input.longAgentProfile?.id
              ) && input.workspaceContext?.longWorkspace
            ? buildLongFollowUpTurnUserMessageContent(input)
            : buildFollowUpRawUserMessageContent(input)
  };
}
