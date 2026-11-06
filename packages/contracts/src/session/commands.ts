import { LibraryManagementRuntimeContextSchema } from "../library-management";
import { TeamManagementRuntimeContextSchema } from "../agent-team-management";
import { z } from "zod";
import {
  ShortAgentSubagentDefinitionsSchema,
  subagentCustomModelIds
} from "../agent-team";
import { EnvelopeBaseSchema } from "../envelope";
import { LibraryAgentProfileSchema } from "../library-agent";
import {
  LongAgentProfileSchema,
  resolveLongAgentIdForRoot
} from "../long-workspace";
import {
  AgentProviderRuntimeConfigSchema,
  TemperatureSchema,
  ThinkingLevelSchema
} from "../models";
import { ScriptWorkspaceAgentProfileSchema } from "../script-agent-settings";
import { WebSearchRuntimeConfigSchema } from "../web-search/settings";
import { resolveScriptWorkspaceAgentIdForStage } from "../script-workspace";
import {
  ShortWorkspaceAgentProfileSchema,
  resolveShortWorkspaceAgentIdForStage
} from "../workspace";
import { UserPromptAttachmentsSchema } from "./attachments";
import { ProposalSettlementsSchema } from "./proposal-settlements";
import { SESSION_PROMPT_MAX_MESSAGE_LENGTH } from "./prompt-limits";
import {
  ContextCompactionRequestSchema,
  ContextCompactionRunSettingsSchema,
  ConversationCheckpointSchema
} from "./context-compaction-state";
import {
  SessionUserInputResponsePayloadSchema,
  type SessionUserInputResponsePayload
} from "./user-input";
import {
  AgentRuntimeRefSchema,
  AgentTeamRunModeSchema,
  AgentWriteApprovalModeSchema,
  WorkspaceRuntimeContextSchema
} from "./runtime";

import {
  SESSION_CONVERSATION_HISTORY_MAX_MESSAGES,
  SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH,
  SESSION_CONVERSATION_HISTORY_MAX_CONTENT_LENGTH
} from "./history-limits";
export * from "./history-limits";

export const SessionConversationHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .min(1)
    .max(SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH)
    .refine((value) => value.trim().length > 0, {
      message: "Conversation history messages cannot be blank."
    }),
  createdAt: z.string().datetime(),
  /** The run that produced (assistant) or answered (user) this message. */
  runId: z.string().min(1).max(200).optional()
});
export type SessionConversationHistoryMessage = z.infer<
  typeof SessionConversationHistoryMessageSchema
>;

export const SessionConversationHistorySchema = z
  .array(SessionConversationHistoryMessageSchema)
  .max(SESSION_CONVERSATION_HISTORY_MAX_MESSAGES)
  .superRefine((messages, context) => {
    const contentLength = messages.reduce(
      (total, message) => total + message.content.length,
      0
    );
    if (contentLength > SESSION_CONVERSATION_HISTORY_MAX_CONTENT_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Conversation history exceeds the total content limit."
      });
    }
  });

export const SessionPromptCommandPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    message: z.string().trim().min(1).max(SESSION_PROMPT_MAX_MESSAGE_LENGTH),
    conversationHistory: SessionConversationHistorySchema.optional(),
    conversationHistoryMode: z.literal("replace").optional(),
    /** Summary of turns older than `conversationHistory`, if any. */
    conversationCheckpoint: ConversationCheckpointSchema.optional(),
    /** Compact the conversation context before this reply. */
    contextCompaction: ContextCompactionRequestSchema.optional(),
    attachments: UserPromptAttachmentsSchema.optional(),
    modelId: z.string().min(1).max(120).optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional(),
    writeApprovalMode: AgentWriteApprovalModeSchema.optional(),
    /** Outcomes of earlier write proposals, reported once with the next turn. */
    proposalSettlements: ProposalSettlementsSchema.optional(),
    agentTeamMode: AgentTeamRunModeSchema.optional(),
    autoApproveCrossStageOperations: z.boolean().optional(),
    /** The user's switch for this run; Main still checks the search settings. */
    webSearchEnabled: z.boolean().optional(),
    workspaceContext: WorkspaceRuntimeContextSchema.optional()
  })
  .superRefine((value, context) => {
    if (
      value.agentTeamMode !== undefined &&
      !value.workspaceContext?.shortWorkspace &&
      !value.workspaceContext?.scriptWorkspace &&
      !value.workspaceContext?.longWorkspace
    ) {
      context.addIssue({
        code: "custom",
        path: ["agentTeamMode"],
        message: "Agent team mode requires a short, script or long workspace."
      });
    }
  });
export type SessionPromptCommandPayload = z.infer<
  typeof SessionPromptCommandPayloadSchema
>;

export const SessionPromptAcceptedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  acceptedAt: z.string().datetime(),
  runtime: AgentRuntimeRefSchema
});
export type SessionPromptAcceptedPayload = z.infer<
  typeof SessionPromptAcceptedPayloadSchema
>;

export const SessionPromptCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("session.prompt"),
  payload: SessionPromptCommandPayloadSchema
}).superRefine((value, context) => {
  if (value.context.sessionId !== value.payload.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["context", "sessionId"],
      message: "Envelope sessionId must match session.prompt payload."
    });
  }
  const activeResourceId = value.payload.workspaceContext?.activeResource?.id;
  if (activeResourceId && value.context.resourceId !== activeResourceId) {
    context.addIssue({
      code: "custom",
      path: ["context", "resourceId"],
      message: "Envelope resourceId must match the active resource snapshot."
    });
  }
});

export const SessionAbortCommandPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1)
});
export type SessionAbortCommandPayload = z.infer<
  typeof SessionAbortCommandPayloadSchema
>;

export const SessionAbortAcceptedPayloadSchema =
  SessionAbortCommandPayloadSchema.extend({
    abortedAt: z.string().datetime()
  });
export type SessionAbortAcceptedPayload = z.infer<
  typeof SessionAbortAcceptedPayloadSchema
>;

function validateAbortCommandContext(
  value: {
    context: { sessionId?: string | undefined; runId?: string | undefined };
    payload: SessionAbortCommandPayload;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  if (value.context.sessionId !== value.payload.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["context", "sessionId"],
      message: "Envelope sessionId must match abort payload."
    });
  }
  if (value.context.runId !== value.payload.runId) {
    context.addIssue({
      code: "custom",
      path: ["context", "runId"],
      message: "Envelope runId must match abort payload."
    });
  }
}

export const SessionAbortCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("session.abort"),
  payload: SessionAbortCommandPayloadSchema
}).superRefine(validateAbortCommandContext);

function validateUserInputResponseCommandContext(
  value: {
    context: { sessionId?: string | undefined; runId?: string | undefined };
    payload: SessionUserInputResponsePayload;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  if (value.context.sessionId !== value.payload.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["context", "sessionId"],
      message: "Envelope sessionId must match the user-input response."
    });
  }
  if (value.context.runId !== value.payload.runId) {
    context.addIssue({
      code: "custom",
      path: ["context", "runId"],
      message: "Envelope runId must match the user-input response."
    });
  }
}

export const SessionUserInputResponseCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("session.user_input_response"),
    payload: SessionUserInputResponsePayloadSchema
  }).superRefine(validateUserInputResponseCommandContext);

export const AgentPromptCommandPayloadSchema =
  SessionPromptCommandPayloadSchema.extend({
    runtimeConfig: AgentProviderRuntimeConfigSchema.optional(),
    /**
     * Main-resolved web search settings, including the key. Present only when
     * search is on and configured; the Renderer never sends or sees it.
     */
    webSearch: WebSearchRuntimeConfigSchema.optional(),
    agentProfile: ShortWorkspaceAgentProfileSchema.optional(),
    scriptAgentProfile: ScriptWorkspaceAgentProfileSchema.optional(),
    longAgentProfile: LongAgentProfileSchema.optional(),
    libraryManagement: LibraryManagementRuntimeContextSchema.optional(),
    teamManagement: TeamManagementRuntimeContextSchema.optional(),
    subagentDefinitions: ShortAgentSubagentDefinitionsSchema.optional(),
    /**
     * Runtime-only map of model config id → resolved provider config for
     * subagents that use `modelMode: "custom"`. Never persisted with teams.
     */
    subagentRuntimeConfigs: z
      .record(z.string().min(1).max(120), AgentProviderRuntimeConfigSchema)
      .optional(),
    /** The enabled team runs independent delegated tasks concurrently. */
    parallelSubagents: z.literal(true).optional(),
    libraryAgentProfile: LibraryAgentProfileSchema.optional(),
    contextCompactionSettings: ContextCompactionRunSettingsSchema.optional(),
    /** Runtime-only config of the summary model when it differs from the run model. */
    compactionRuntimeConfig: AgentProviderRuntimeConfigSchema.optional()
  }).superRefine((value, context) => {
    const shortWorkspace = value.workspaceContext?.shortWorkspace;
    const scriptWorkspace = value.workspaceContext?.scriptWorkspace;
    const longWorkspace = value.workspaceContext?.longWorkspace;
    if (
      (value.subagentDefinitions !== undefined ||
        value.libraryManagement !== undefined ||
        value.teamManagement !== undefined) &&
      !(
        (shortWorkspace && value.agentProfile) ||
        (scriptWorkspace && value.scriptAgentProfile) ||
        (longWorkspace && value.longAgentProfile)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["subagentDefinitions"],
        message:
          "Subagent definitions require a short, script or long workspace and its agent profile."
      });
    }
    for (const management of [value.libraryManagement, value.teamManagement]) {
      if (!management) continue;
      const scope = management.scope;
      const expectedBookId =
        scope.bookType === "long"
          ? longWorkspace?.bookId
          : scope.bookType === "script"
            ? scriptWorkspace?.id
            : shortWorkspace?.id;
      if (expectedBookId !== scope.bookId)
        context.addIssue({
          code: "custom",
          path: [
            management === value.libraryManagement
              ? "libraryManagement"
              : "teamManagement",
            "scope"
          ],
          message:
            "Library management must be bound to the active writing work."
        });
    }
    if (value.parallelSubagents && value.subagentDefinitions === undefined) {
      context.addIssue({
        code: "custom",
        path: ["parallelSubagents"],
        message: "Parallel subagents require subagent definitions."
      });
    }
    if (
      value.subagentRuntimeConfigs !== undefined &&
      value.subagentDefinitions === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["subagentRuntimeConfigs"],
        message: "Subagent runtime configs require subagent definitions."
      });
    }
    if (value.subagentDefinitions && value.subagentRuntimeConfigs) {
      for (const modelId of subagentCustomModelIds(value.subagentDefinitions)) {
        if (!value.subagentRuntimeConfigs[modelId]) {
          context.addIssue({
            code: "custom",
            path: ["subagentRuntimeConfigs", modelId],
            message: `Missing runtime config for subagent model: ${modelId}`
          });
        }
      }
    }
    if (Boolean(shortWorkspace) !== Boolean(value.agentProfile)) {
      context.addIssue({
        code: "custom",
        path: ["agentProfile"],
        message:
          "Short workspace context and agent profile must be provided together."
      });
    }
    if (shortWorkspace && value.agentProfile) {
      const activeAgentId =
        shortWorkspace.activeAgentId ??
        resolveShortWorkspaceAgentIdForStage(shortWorkspace.activeStageId);
      if (value.agentProfile.id !== activeAgentId) {
        context.addIssue({
          code: "custom",
          path: ["agentProfile", "id"],
          message:
            "Short workspace agent profile must match the active parent agent."
        });
      }
    }
    if (Boolean(scriptWorkspace) !== Boolean(value.scriptAgentProfile)) {
      context.addIssue({
        code: "custom",
        path: ["scriptAgentProfile"],
        message:
          "Script workspace context and agent profile must be provided together."
      });
    }
    if (scriptWorkspace && value.scriptAgentProfile) {
      const activeAgentId =
        scriptWorkspace.activeAgentId ??
        resolveScriptWorkspaceAgentIdForStage(scriptWorkspace.activeStageId);
      if (value.scriptAgentProfile.id !== activeAgentId) {
        context.addIssue({
          code: "custom",
          path: ["scriptAgentProfile", "id"],
          message:
            "Script workspace agent profile must match the active parent agent."
        });
      }
    }
    if (Boolean(longWorkspace) !== Boolean(value.longAgentProfile)) {
      context.addIssue({
        code: "custom",
        path: ["longAgentProfile"],
        message:
          "Long workspace context and agent profile must be provided together."
      });
    }
    if (longWorkspace && value.longAgentProfile) {
      const expectedAgentId =
        longWorkspace.activeAgentId ??
        resolveLongAgentIdForRoot(longWorkspace.activeRoot);
      if (value.longAgentProfile.id !== expectedAgentId) {
        context.addIssue({
          code: "custom",
          path: ["longAgentProfile", "id"],
          message:
            "Long workspace agent profile must match the active long-form agent."
        });
      }
    }
    if (
      Boolean(value.workspaceContext?.libraryWorkspace) !==
      Boolean(value.libraryAgentProfile)
    ) {
      context.addIssue({
        code: "custom",
        path: ["libraryAgentProfile"],
        message:
          "Library workspace context and agent profile must be provided together."
      });
    }
    if (
      value.libraryAgentProfile &&
      value.workspaceContext?.libraryWorkspace?.domain !==
        value.libraryAgentProfile.domain
    ) {
      context.addIssue({
        code: "custom",
        path: ["libraryAgentProfile", "domain"],
        message: "Library agent profile must match the active library domain."
      });
    }
  });
export type AgentPromptCommandPayload = z.infer<
  typeof AgentPromptCommandPayloadSchema
>;

export const AgentPromptCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.prompt"),
  payload: AgentPromptCommandPayloadSchema
}).superRefine((value, context) => {
  if (value.context.sessionId !== value.payload.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["context", "sessionId"],
      message: "Envelope sessionId must match agent.prompt payload."
    });
  }
  const activeResourceId = value.payload.workspaceContext?.activeResource?.id;
  if (activeResourceId && value.context.resourceId !== activeResourceId) {
    context.addIssue({
      code: "custom",
      path: ["context", "resourceId"],
      message: "Envelope resourceId must match the active resource snapshot."
    });
  }
});

export const AgentAbortCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.abort"),
  payload: SessionAbortCommandPayloadSchema
}).superRefine(validateAbortCommandContext);

export const AgentUserInputResponseCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.user_input_response"),
    payload: SessionUserInputResponsePayloadSchema
  }).superRefine(validateUserInputResponseCommandContext);
