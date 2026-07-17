import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";
import {
  AgentErrorEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentThinkingDeltaEventEnvelopeSchema,
  AgentPromptCommandEnvelopeSchema,
  AgentToolCompletedEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  SessionPromptCommandEnvelopeSchema,
  type AgentErrorEventEnvelope,
  type AgentMessageCompletedEventEnvelope,
  type AgentMessageDeltaEventEnvelope,
  type AgentThinkingDeltaEventEnvelope,
  type AgentToolCompletedEventEnvelope,
  type AgentToolRequestedEventEnvelope
} from "./session";
import {
  AgentModelTestCommandEnvelopeSchema,
  ModelsListCommandEnvelopeSchema,
  ModelsSaveCommandEnvelopeSchema,
  ModelsTestCommandEnvelopeSchema
} from "./models";

export const IPC_COMMAND_CHANNEL = "deepwrite:command";
export const IPC_EVENT_CHANNEL = "deepwrite:event";

export const UtilityWorkerNameSchema = z.enum(["core", "agent", "tool"]);
export type UtilityWorkerName = z.infer<typeof UtilityWorkerNameSchema>;

export const UtilityHealthPayloadSchema = z.object({
  name: UtilityWorkerNameSchema,
  status: z.enum(["starting", "ok", "degraded", "stopped"]),
  pid: z.number().int().positive().optional(),
  startedAt: z.string().datetime().optional(),
  lastHeartbeatAt: z.string().datetime().optional(),
  details: z.record(z.string(), z.unknown())
});
export type UtilityHealthPayload = z.infer<typeof UtilityHealthPayloadSchema>;

export const SystemHealthPayloadSchema = z.object({
  status: z.enum(["starting", "ok", "degraded"]),
  checkedAt: z.string().datetime(),
  workers: z.array(UtilityHealthPayloadSchema)
});
export type SystemHealthPayload = z.infer<typeof SystemHealthPayloadSchema>;

export const SystemHealthCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.health"),
  payload: z.object({})
});

export const CommandEnvelopeSchema = z.discriminatedUnion("type", [
  SystemHealthCommandEnvelopeSchema,
  SessionPromptCommandEnvelopeSchema,
  ModelsListCommandEnvelopeSchema,
  ModelsSaveCommandEnvelopeSchema,
  ModelsTestCommandEnvelopeSchema,
  AgentPromptCommandEnvelopeSchema,
  AgentModelTestCommandEnvelopeSchema
]);
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandType = CommandEnvelope["type"];

export const ErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional()
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const CommandResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("accepted"),
    requestId: z.string().min(1),
    payload: z.unknown()
  }),
  z.object({
    status: z.literal("rejected"),
    requestId: z.string().min(1),
    error: ErrorPayloadSchema
  })
]);
export type CommandResult<TPayload = unknown> =
  | { status: "accepted"; requestId: string; payload: TPayload }
  | { status: "rejected"; requestId: string; error: ErrorPayload };

export const SystemReadyEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.ready"),
  payload: SystemHealthPayloadSchema
});

export const SystemWorkerRestartedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.worker_restarted"),
  payload: z.object({
    worker: UtilityWorkerNameSchema,
    reason: z.string().min(1),
    restartedAt: z.string().datetime()
  })
});

export const SystemWorkerRestartingEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.worker_restarting"),
  payload: z.object({
    worker: UtilityWorkerNameSchema,
    reason: z.string().min(1),
    detectedAt: z.string().datetime()
  })
});

export const SystemEventEnvelopeSchema = z.discriminatedUnion("type", [
  SystemReadyEventEnvelopeSchema,
  SystemWorkerRestartingEventEnvelopeSchema,
  SystemWorkerRestartedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentThinkingDeltaEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  AgentToolCompletedEventEnvelopeSchema,
  AgentErrorEventEnvelopeSchema
]);

export type SystemReadyEventEnvelope = Envelope<SystemHealthPayload, "system.ready">;
export type SystemWorkerRestartedEventEnvelope = Envelope<
  { worker: UtilityWorkerName; reason: string; restartedAt: string },
  "system.worker_restarted"
>;
export type SystemWorkerRestartingEventEnvelope = Envelope<
  { worker: UtilityWorkerName; reason: string; detectedAt: string },
  "system.worker_restarting"
>;
export type SystemEventEnvelope =
  | SystemReadyEventEnvelope
  | SystemWorkerRestartingEventEnvelope
  | SystemWorkerRestartedEventEnvelope
  | AgentMessageDeltaEventEnvelope
  | AgentThinkingDeltaEventEnvelope
  | AgentMessageCompletedEventEnvelope
  | AgentToolRequestedEventEnvelope
  | AgentToolCompletedEventEnvelope
  | AgentErrorEventEnvelope;
