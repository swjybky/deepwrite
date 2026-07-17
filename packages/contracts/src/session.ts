import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";
import {
  AgentProviderRuntimeConfigSchema,
  ThinkingLevelSchema
} from "./models";
import type { ThinkingLevel } from "./models";

export type { ThinkingLevel } from "./models";

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

const AttachedContextSnapshotBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(240),
  content: z.string().max(12_000)
});

export const AttachedSkillSnapshotSchema = AttachedContextSnapshotBaseSchema.extend({
  source: z.literal("attached-skill")
});

export const AttachedMaterialSnapshotSchema = AttachedContextSnapshotBaseSchema.extend({
  source: z.literal("attached-material")
});

export const AttachedContextSnapshotSchema = z.discriminatedUnion("source", [
  AttachedSkillSnapshotSchema,
  AttachedMaterialSnapshotSchema
]);
export type AttachedContextSnapshot = z.infer<typeof AttachedContextSnapshotSchema>;

export const WorkspaceRuntimeContextSchema = z.object({
  activeResource: ActiveResourceSnapshotSchema.optional(),
  attachedSkills: z.array(AttachedSkillSnapshotSchema).max(12).optional(),
  attachedMaterials: z.array(AttachedMaterialSnapshotSchema).max(12).optional()
});
export type WorkspaceRuntimeContext = z.infer<typeof WorkspaceRuntimeContextSchema>;

export const SessionPromptCommandPayloadSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().trim().min(1).max(20_000),
  modelId: z.string().min(1).max(120).optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
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

export const AgentPromptCommandPayloadSchema = SessionPromptCommandPayloadSchema.extend({
  runtimeConfig: AgentProviderRuntimeConfigSchema.optional()
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

export const AgentToolCompletedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("tool.execution_completed"),
  payload: AgentToolCompletedPayloadSchema
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
export type AgentToolCompletedEventEnvelope = Envelope<AgentToolCompletedPayload, "tool.execution_completed">;
export type AgentErrorEventEnvelope = Envelope<AgentErrorPayload, "agent.error">;
