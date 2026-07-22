import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";
import {
  AgentProviderRuntimeConfigSchema,
  TemperatureSchema,
  ThinkingLevelSchema
} from "./models";
import type { ThinkingLevel } from "./models";
import {
  ShortMaterialKindSchema,
  ShortSkillKindSchema,
  ShortWorkspaceStageIdSchema,
  ShortWorkspaceAgentProfileSchema,
  ShortWorkspaceSnapshotSchema
} from "./workspace";

export type { ThinkingLevel } from "./models";

export const AgentWriteApprovalModeSchema = z.enum([
  "request-approval",
  "auto-approve"
]);
export type AgentWriteApprovalMode = z.infer<typeof AgentWriteApprovalModeSchema>;

export const AgentRuntimeRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  mode: z.enum(["local-faux", "provider"])
});
export type AgentRuntimeRef = z.infer<typeof AgentRuntimeRefSchema>;

export const ActiveResourceSnapshotSchema = z.object({
  id: z.string().min(1),
  domain: z.enum(["creation", "skill", "material"]),
  title: z.string().min(1).max(240),
  path: z.array(z.string().min(1).max(240)).max(16),
  format: z.string().min(1).max(80).optional(),
  source: z.literal("live-editor"),
  content: z.string().max(20_000),
  truncated: z.boolean().optional(),
  originalLength: z.number().int().nonnegative().max(10_000_000).optional()
}).superRefine((value, context) => {
  if (
    value.truncated === true &&
    (value.originalLength === undefined || value.originalLength <= value.content.length)
  ) {
    context.addIssue({
      code: "custom",
      path: ["originalLength"],
      message: "A truncated resource must report an originalLength larger than content."
    });
  }
});
export type ActiveResourceSnapshot = z.infer<typeof ActiveResourceSnapshotSchema>;

export const ATTACHED_CONTEXT_MAX_ITEMS = 64;
export const ATTACHED_CONTEXT_MAX_CONTENT_LENGTH = 20_000;

const AttachedContextSnapshotBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(240),
  content: z.string().max(ATTACHED_CONTEXT_MAX_CONTENT_LENGTH)
});

export const AttachedSkillSnapshotSchema = AttachedContextSnapshotBaseSchema.extend({
  source: z.literal("attached-skill"),
  kind: ShortSkillKindSchema.optional()
});

export const AttachedMaterialSnapshotSchema = AttachedContextSnapshotBaseSchema.extend({
  source: z.literal("attached-material"),
  kind: ShortMaterialKindSchema.optional()
});

export const AttachedContextSnapshotSchema = z.discriminatedUnion("source", [
  AttachedSkillSnapshotSchema,
  AttachedMaterialSnapshotSchema
]);
export type AttachedContextSnapshot = z.infer<typeof AttachedContextSnapshotSchema>;

export const WorkspaceRuntimeContextSchema = z.object({
  activeResource: ActiveResourceSnapshotSchema.optional(),
  shortWorkspace: ShortWorkspaceSnapshotSchema.optional(),
  attachedSkills: z
    .array(AttachedSkillSnapshotSchema)
    .max(ATTACHED_CONTEXT_MAX_ITEMS)
    .optional(),
  attachedMaterials: z
    .array(AttachedMaterialSnapshotSchema)
    .max(ATTACHED_CONTEXT_MAX_ITEMS)
    .optional()
}).superRefine((value, context) => {
  const shortWorkspace = value.shortWorkspace;
  const active = value.activeResource;
  if (
    shortWorkspace &&
    active &&
    !shortWorkspace.stages.some(
      (stage) =>
        stage.stageId === shortWorkspace.activeStageId && stage.content === active.content
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["shortWorkspace", "activeStageId"],
      message: "The active short stage must match the live active resource snapshot."
    });
  }
});
export type WorkspaceRuntimeContext = z.infer<typeof WorkspaceRuntimeContextSchema>;

export const PROMPT_ATTACHMENT_MAX_ITEMS = 8;
export const PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH = 100_000;
export const PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH = 200_000;
export const PROMPT_IMAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PROMPT_IMAGE_ATTACHMENTS_MAX_BYTES = 25 * 1024 * 1024;

const PromptAttachmentBaseSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  size: z.number().int().nonnegative().max(25 * 1024 * 1024)
});

export const PromptTextAttachmentSchema = PromptAttachmentBaseSchema.extend({
  kind: z.literal("text"),
  mediaType: z.string().trim().min(1).max(120),
  content: z.string().max(PROMPT_TEXT_ATTACHMENT_MAX_CONTENT_LENGTH),
  truncated: z.boolean().optional(),
  originalLength: z.number().int().nonnegative().max(10_000_000).optional()
}).superRefine((value, context) => {
  if (
    value.truncated === true &&
    (value.originalLength === undefined || value.originalLength <= value.content.length)
  ) {
    context.addIssue({
      code: "custom",
      path: ["originalLength"],
      message: "A truncated text attachment must report its original length."
    });
  }
});
export type PromptTextAttachment = z.infer<typeof PromptTextAttachmentSchema>;

export const PromptImageMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);
export type PromptImageMediaType = z.infer<typeof PromptImageMediaTypeSchema>;

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
}

export const PromptImageAttachmentSchema = PromptAttachmentBaseSchema.extend({
  kind: z.literal("image"),
  mediaType: PromptImageMediaTypeSchema,
  data: z
    .string()
    .min(1)
    .max(Math.ceil(PROMPT_IMAGE_ATTACHMENT_MAX_BYTES / 3) * 4 + 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Image attachment data must be base64 encoded.")
}).superRefine((value, context) => {
  if (value.size > PROMPT_IMAGE_ATTACHMENT_MAX_BYTES) {
    context.addIssue({
      code: "custom",
      path: ["size"],
      message: "Image attachment exceeds the per-file size limit."
    });
  }
  if (decodedBase64ByteLength(value.data) !== value.size) {
    context.addIssue({
      code: "custom",
      path: ["data"],
      message: "Image attachment byte size does not match its base64 payload."
    });
  }
});
export type PromptImageAttachment = z.infer<typeof PromptImageAttachmentSchema>;

export const UserPromptAttachmentSchema = z.discriminatedUnion("kind", [
  PromptTextAttachmentSchema,
  PromptImageAttachmentSchema
]);
export type UserPromptAttachment = z.infer<typeof UserPromptAttachmentSchema>;

export const UserPromptAttachmentsSchema = z
  .array(UserPromptAttachmentSchema)
  .max(PROMPT_ATTACHMENT_MAX_ITEMS)
  .superRefine((attachments, context) => {
    const ids = new Set<string>();
    let textLength = 0;
    let imageBytes = 0;
    attachments.forEach((attachment, index) => {
      if (ids.has(attachment.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Prompt attachment ids must be unique."
        });
      }
      ids.add(attachment.id);
      if (attachment.kind === "text") {
        textLength += attachment.content.length;
      } else {
        imageBytes += attachment.size;
      }
    });
    if (textLength > PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Text attachments exceed the total extracted-content limit."
      });
    }
    if (imageBytes > PROMPT_IMAGE_ATTACHMENTS_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Image attachments exceed the total size limit."
      });
    }
  });

export const SessionPromptCommandPayloadSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().trim().min(1).max(20_000),
  attachments: UserPromptAttachmentsSchema.optional(),
  modelId: z.string().min(1).max(120).optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  temperature: TemperatureSchema.optional(),
  writeApprovalMode: AgentWriteApprovalModeSchema.optional(),
  workspaceContext: WorkspaceRuntimeContextSchema.optional()
});
export type SessionPromptCommandPayload = z.infer<typeof SessionPromptCommandPayloadSchema>;

export const SessionPromptAcceptedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  acceptedAt: z.string().datetime(),
  runtime: AgentRuntimeRefSchema
});
export type SessionPromptAcceptedPayload = z.infer<typeof SessionPromptAcceptedPayloadSchema>;

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
export type SessionAbortCommandPayload = z.infer<typeof SessionAbortCommandPayloadSchema>;

export const SessionAbortAcceptedPayloadSchema = SessionAbortCommandPayloadSchema.extend({
  abortedAt: z.string().datetime()
});
export type SessionAbortAcceptedPayload = z.infer<typeof SessionAbortAcceptedPayloadSchema>;

function validateAbortCommandContext(
  value: {
    context: { sessionId?: string | undefined; runId?: string | undefined };
    payload: SessionAbortCommandPayload;
  },
  context: z.core.$RefinementCtx<any>
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

export const AgentPromptCommandPayloadSchema = SessionPromptCommandPayloadSchema.extend({
  runtimeConfig: AgentProviderRuntimeConfigSchema.optional(),
  agentProfile: ShortWorkspaceAgentProfileSchema.optional()
});
export type AgentPromptCommandPayload = z.infer<typeof AgentPromptCommandPayloadSchema>;

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

const AgentEventIdentitySchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  messageId: z.string().min(1),
  runtime: AgentRuntimeRefSchema
});

export const AgentMessageDeltaPayloadSchema = AgentEventIdentitySchema.extend({
  delta: z.string()
});
export type AgentMessageDeltaPayload = z.infer<typeof AgentMessageDeltaPayloadSchema>;

export const AgentThinkingDeltaPayloadSchema = AgentEventIdentitySchema.extend({
  delta: z.string()
});
export type AgentThinkingDeltaPayload = z.infer<typeof AgentThinkingDeltaPayloadSchema>;

export const AgentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
});
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

export const AgentMessageCompletedPayloadSchema = AgentEventIdentitySchema.extend({
  role: z.literal("assistant"),
  content: z.string(),
  thinking: z.string().optional(),
  stopReason: z.string().min(1).optional(),
  usage: AgentUsageSchema.optional()
});
export type AgentMessageCompletedPayload = z.infer<typeof AgentMessageCompletedPayloadSchema>;

export const AgentToolRequestedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  args: z.unknown(),
  runtime: AgentRuntimeRefSchema
});
export type AgentToolRequestedPayload = z.infer<typeof AgentToolRequestedPayloadSchema>;

export const AgentToolCallStreamPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  streamId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  toolName: z.string().min(1).optional(),
  phase: z.enum(["start", "delta", "end"]),
  argumentsDelta: z.string(),
  args: z.unknown().optional(),
  runtime: AgentRuntimeRefSchema
});
export type AgentToolCallStreamPayload = z.infer<typeof AgentToolCallStreamPayloadSchema>;

export const AgentToolCompletedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  resultSummary: z.string().max(4_000),
  isError: z.boolean(),
  runtime: AgentRuntimeRefSchema
});
export type AgentToolCompletedPayload = z.infer<typeof AgentToolCompletedPayloadSchema>;

export const WorkspaceEditorMutationTargetSchema = z.object({
  kind: z.literal("expert-draft-section"),
  sectionId: z.string().trim().min(1).max(120),
  field: z.enum(["body", "characterState"])
});
export type WorkspaceEditorMutationTarget = z.infer<
  typeof WorkspaceEditorMutationTargetSchema
>;

export const WorkspaceEditorMutationPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    toolCallId: z.string().min(1),
    workspaceId: z.string().min(1).max(240),
    stageId: ShortWorkspaceStageIdSchema,
    text: z.string().max(10_000_000),
    mutationTarget: WorkspaceEditorMutationTargetSchema.optional(),
    baseRevision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    summary: z.string().min(1).max(1_000),
    runtime: AgentRuntimeRefSchema
  })
  .superRefine((value, context) => {
    if (value.mutationTarget !== undefined && value.stageId !== "draft") {
      context.addIssue({
        code: "custom",
        path: ["mutationTarget"],
        message: "Expert draft section mutations must target the draft stage."
      });
    }
  });
export type WorkspaceEditorMutationPayload = z.infer<
  typeof WorkspaceEditorMutationPayloadSchema
>;

export const WorkspaceStageSelectionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  workspaceId: z.string().min(1).max(240),
  stageId: ShortWorkspaceStageIdSchema,
  runtime: AgentRuntimeRefSchema
});
export type WorkspaceStageSelectionPayload = z.infer<
  typeof WorkspaceStageSelectionPayloadSchema
>;

export const AgentErrorPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  runtime: AgentRuntimeRefSchema.optional()
});
export type AgentErrorPayload = z.infer<typeof AgentErrorPayloadSchema>;

export const AgentMessageDeltaEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.message_delta"),
  payload: AgentMessageDeltaPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentThinkingDeltaEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.thinking_delta"),
  payload: AgentThinkingDeltaPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentMessageCompletedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.message_completed"),
  payload: AgentMessageCompletedPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentToolRequestedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("tool.call_requested"),
  payload: AgentToolRequestedPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentToolCallStreamEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("tool.call_stream"),
  payload: AgentToolCallStreamPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentToolCompletedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("tool.execution_completed"),
  payload: AgentToolCompletedPayloadSchema
}).superRefine(validateAgentEventContext);

export const WorkspaceEditorMutationEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("workspace.editor_mutation"),
  payload: WorkspaceEditorMutationPayloadSchema
}).superRefine(validateAgentEventContext);

export const WorkspaceStageSelectionEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("workspace.stage_selection"),
  payload: WorkspaceStageSelectionPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentErrorEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.error"),
  payload: AgentErrorPayloadSchema
}).superRefine(validateAgentEventContext);

function validateAgentEventContext(
  value: {
    context: { sessionId?: string | undefined; runId?: string | undefined };
    payload: { sessionId: string; runId: string };
  },
  context: z.core.$RefinementCtx<any>
): void {
  if (value.context.sessionId !== value.payload.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["context", "sessionId"],
      message: "Envelope and payload sessionId must match."
    });
  }
  if (value.context.runId !== value.payload.runId) {
    context.addIssue({
      code: "custom",
      path: ["context", "runId"],
      message: "Envelope and payload runId must match."
    });
  }
}

export type AgentMessageDeltaEventEnvelope = Envelope<AgentMessageDeltaPayload, "agent.message_delta">;
export type AgentThinkingDeltaEventEnvelope = Envelope<AgentThinkingDeltaPayload, "agent.thinking_delta">;
export type AgentMessageCompletedEventEnvelope = Envelope<AgentMessageCompletedPayload, "agent.message_completed">;
export type AgentToolRequestedEventEnvelope = Envelope<AgentToolRequestedPayload, "tool.call_requested">;
export type AgentToolCallStreamEventEnvelope = Envelope<
  AgentToolCallStreamPayload,
  "tool.call_stream"
>;
export type AgentToolCompletedEventEnvelope = Envelope<AgentToolCompletedPayload, "tool.execution_completed">;
export type WorkspaceEditorMutationEventEnvelope = Envelope<
  WorkspaceEditorMutationPayload,
  "workspace.editor_mutation"
>;
export type WorkspaceStageSelectionEventEnvelope = Envelope<
  WorkspaceStageSelectionPayload,
  "workspace.stage_selection"
>;
export type AgentErrorEventEnvelope = Envelope<AgentErrorPayload, "agent.error">;
