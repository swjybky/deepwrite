import { LibraryManagementRuntimeContextSchema } from "../library-management";
import { z } from "zod";
import { ShortAgentSubagentDefinitionsSchema } from "../agent-team";
import type { ChatAssistantRuntimeContext } from "../chat-assistant";
import { ChatAssistantRequestContextSchema } from "../chat-assistant-base";
import { EnvelopeBaseSchema } from "../envelope";
import { LearningImitationAgentProfileSchema } from "../learning-imitation";
import { LongBookAnalysisAgentProfileSchema } from "../long-book-analysis";
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
import { resolveScriptWorkspaceAgentIdForStage } from "../script-workspace";
import {
  ShortWorkspaceAgentProfileSchema,
  resolveShortWorkspaceAgentIdForStage
} from "../workspace";
import { UserPromptAttachmentsSchema } from "./attachments";
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

export const SessionModeSchema = z.enum(["workspace", "chat-assistant"]);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SESSION_CONVERSATION_HISTORY_MAX_MESSAGES = 80;
export const SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH = 20_000;
export const SESSION_CONVERSATION_HISTORY_MAX_CONTENT_LENGTH = 120_000;

export const SessionConversationHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .min(1)
    .max(SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH)
    .refine((value) => value.trim().length > 0, {
      message: "Conversation history messages cannot be blank."
    }),
  createdAt: z.string().datetime()
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
    message: z.string().trim().min(1).max(20_000),
    conversationHistory: SessionConversationHistorySchema.optional(),
    conversationHistoryMode: z.literal("replace").optional(),
    mode: SessionModeSchema.optional(),
    attachments: UserPromptAttachmentsSchema.optional(),
    modelId: z.string().min(1).max(120).optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional(),
    writeApprovalMode: AgentWriteApprovalModeSchema.optional(),
    agentTeamMode: AgentTeamRunModeSchema.optional(),
    autoApproveCrossStageOperations: z.boolean().optional(),
    webSearchEnabled: z.boolean().optional(),
    chatAssistant: ChatAssistantRequestContextSchema.optional(),
    workspaceContext: WorkspaceRuntimeContextSchema.optional()
  })
  .superRefine((value, context) => {
    if (value.mode !== "chat-assistant") {
      if (value.chatAssistant !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["chatAssistant"],
          message: "Chat assistant context requires chat-assistant mode."
        });
      }
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
      return;
    }
    if (value.webSearchEnabled !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["webSearchEnabled"],
        message:
          "Chat assistant sessions must request web search through chatAssistant.webSearchEnabled."
      });
    }
    if (value.workspaceContext !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["workspaceContext"],
        message: "Chat assistant sessions cannot receive workspace context."
      });
    }
    if (value.writeApprovalMode !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["writeApprovalMode"],
        message: "Chat assistant sessions cannot request write approval."
      });
    }
    if (value.agentTeamMode !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["agentTeamMode"],
        message: "Chat assistant sessions cannot request agent team mode."
      });
    }
    if (value.autoApproveCrossStageOperations !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["autoApproveCrossStageOperations"],
        message:
          "Chat assistant sessions cannot approve cross-stage operations."
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

/**
 * Main fully parses the authoritative snapshot before creating agent.prompt.
 * This internal transport guard deliberately validates only the discriminator
 * needed for cross-process matching, while preserving the already-validated
 * snapshot without making Renderer load the large catalog/usage schema graph.
 */
const ChatAssistantRuntimeContextTransportSchema =
  z.custom<ChatAssistantRuntimeContext>((value) => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { mode?: unknown; project?: unknown };
    if (candidate.mode === "normal") return true;
    if (candidate.mode !== "project") return false;
    const project = candidate.project;
    return Boolean(
      project &&
      typeof project === "object" &&
      typeof (project as { projectId?: unknown }).projectId === "string" &&
      ["short", "script", "long"].includes(
        String((project as { projectType?: unknown }).projectType)
      )
    );
  });

export const AgentPromptCommandPayloadSchema =
  SessionPromptCommandPayloadSchema.extend({
    chatAssistantRuntimeContext:
      ChatAssistantRuntimeContextTransportSchema.optional(),
    runtimeConfig: AgentProviderRuntimeConfigSchema.optional(),
    agentProfile: ShortWorkspaceAgentProfileSchema.optional(),
    scriptAgentProfile: ScriptWorkspaceAgentProfileSchema.optional(),
    longAgentProfile: LongAgentProfileSchema.optional(),
    libraryManagement: LibraryManagementRuntimeContextSchema.optional(),
    subagentDefinitions: ShortAgentSubagentDefinitionsSchema.optional(),
    /**
     * Runtime-only map of model config id → resolved provider config for
     * subagents that use `modelMode: "custom"`. Never persisted with teams.
     */
    subagentRuntimeConfigs: z
      .record(z.string().min(1).max(120), AgentProviderRuntimeConfigSchema)
      .optional(),
    libraryAgentProfile: LibraryAgentProfileSchema.optional(),
    learningImitationProfile: LearningImitationAgentProfileSchema.optional(),
    longBookAnalysisProfile: LongBookAnalysisAgentProfileSchema.optional()
  }).superRefine((value, context) => {
    if (value.mode === "chat-assistant") {
      const requestedMode = value.chatAssistant?.mode ?? "normal";
      if (!value.chatAssistantRuntimeContext) {
        context.addIssue({
          code: "custom",
          path: ["chatAssistantRuntimeContext"],
          message:
            "Chat assistant runs require an authoritative runtime context."
        });
      } else if (value.chatAssistantRuntimeContext.mode !== requestedMode) {
        context.addIssue({
          code: "custom",
          path: ["chatAssistantRuntimeContext", "mode"],
          message: "Chat assistant runtime mode must match the requested mode."
        });
      } else if (
        requestedMode === "project" &&
        value.chatAssistant?.mode === "project" &&
        value.chatAssistantRuntimeContext.mode === "project" &&
        (value.chatAssistant.project.projectId !==
          value.chatAssistantRuntimeContext.project.projectId ||
          value.chatAssistant.project.projectType !==
            value.chatAssistantRuntimeContext.project.projectType)
      ) {
        context.addIssue({
          code: "custom",
          path: ["chatAssistantRuntimeContext", "project"],
          message:
            "Chat assistant runtime project must match the requested project."
        });
      }
    } else if (value.chatAssistantRuntimeContext !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["chatAssistantRuntimeContext"],
        message: "Chat assistant runtime context requires chat-assistant mode."
      });
    }
    const shortWorkspace = value.workspaceContext?.shortWorkspace;
    const scriptWorkspace = value.workspaceContext?.scriptWorkspace;
    const longWorkspace = value.workspaceContext?.longWorkspace;
    if (
      (value.subagentDefinitions !== undefined ||
        value.libraryManagement !== undefined) &&
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
    if (value.libraryManagement) {
      const scope = value.libraryManagement.scope;
      const expectedBookId =
        scope.bookType === "long"
          ? longWorkspace?.bookId
          : scope.bookType === "script"
            ? scriptWorkspace?.id
            : shortWorkspace?.id;
      if (expectedBookId !== scope.bookId)
        context.addIssue({
          code: "custom",
          path: ["libraryManagement", "scope"],
          message:
            "Library management must be bound to the active writing work."
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
      for (const definition of value.subagentDefinitions) {
        if (definition.modelMode !== "custom" || !definition.modelId) continue;
        if (!value.subagentRuntimeConfigs[definition.modelId]) {
          context.addIssue({
            code: "custom",
            path: ["subagentRuntimeConfigs", definition.modelId],
            message: `Missing runtime config for subagent model: ${definition.modelId}`
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
      Boolean(value.workspaceContext?.learningImitation) !==
      Boolean(value.learningImitationProfile)
    ) {
      context.addIssue({
        code: "custom",
        path: ["learningImitationProfile"],
        message:
          "Learning-imitation context and agent profile must be provided together."
      });
    }
    if (
      value.learningImitationProfile &&
      value.workspaceContext?.learningImitation?.stageId !==
        value.learningImitationProfile.id
    ) {
      context.addIssue({
        code: "custom",
        path: ["learningImitationProfile", "id"],
        message: "Learning-imitation profile must match the active stage."
      });
    }
    if (
      Boolean(value.workspaceContext?.longBookAnalysis) !==
      Boolean(value.longBookAnalysisProfile)
    ) {
      context.addIssue({
        code: "custom",
        path: ["longBookAnalysisProfile"],
        message:
          "Long-book analysis context and agent profile must be provided together."
      });
    }
    if (
      value.longBookAnalysisProfile &&
      value.workspaceContext?.longBookAnalysis?.presetId !==
        value.longBookAnalysisProfile.id
    ) {
      context.addIssue({
        code: "custom",
        path: ["longBookAnalysisProfile", "id"],
        message: "Long-book analysis profile must match the active preset."
      });
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
