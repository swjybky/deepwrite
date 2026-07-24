import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";
import {
  AgentAbortCommandEnvelopeSchema,
  AgentErrorEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentThinkingDeltaEventEnvelopeSchema,
  AgentPromptCommandEnvelopeSchema,
  SubagentActivityEventEnvelopeSchema,
  SubagentCompletedEventEnvelopeSchema,
  SubagentStartedEventEnvelopeSchema,
  AgentToolCompletedEventEnvelopeSchema,
  AgentToolCallStreamEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  LearningImitationResultUpdatedEventEnvelopeSchema,
  LibraryEditorMutationEventEnvelopeSchema,
  WorkspaceEditorMutationEventEnvelopeSchema,
  WorkspaceStageSelectionEventEnvelopeSchema,
  SessionAbortCommandEnvelopeSchema,
  SessionPromptCommandEnvelopeSchema,
  type AgentErrorEventEnvelope,
  type AgentMessageCompletedEventEnvelope,
  type AgentMessageDeltaEventEnvelope,
  type AgentThinkingDeltaEventEnvelope,
  type AgentToolCompletedEventEnvelope,
  type AgentToolCallStreamEventEnvelope,
  type AgentToolRequestedEventEnvelope,
  type SubagentActivityEventEnvelope,
  type SubagentCompletedEventEnvelope,
  type SubagentStartedEventEnvelope,
  type LearningImitationResultUpdatedEventEnvelope,
  type LibraryEditorMutationEventEnvelope,
  type WorkspaceEditorMutationEventEnvelope,
  type WorkspaceStageSelectionEventEnvelope
} from "./session";
import {
  AgentTeamsListCommandEnvelopeSchema,
  AgentTeamsSaveCommandEnvelopeSchema
} from "./agent-team";
import {
  LearningImitationSettingsListCommandEnvelopeSchema,
  LearningImitationSettingsResetCommandEnvelopeSchema,
  LearningImitationSettingsSaveCommandEnvelopeSchema
} from "./learning-imitation";
import {
  AgentModelTestCommandEnvelopeSchema,
  ModelsListCommandEnvelopeSchema,
  ModelsSaveCommandEnvelopeSchema,
  ModelsTestCommandEnvelopeSchema
} from "./models";
import {
  WorkspaceAgentsListCommandEnvelopeSchema,
  WorkspaceAgentsResetCommandEnvelopeSchema,
  WorkspaceAgentsSaveCommandEnvelopeSchema
} from "./workspace";
import {
  LibraryAgentsListCommandEnvelopeSchema,
  LibraryAgentsResetCommandEnvelopeSchema,
  LibraryAgentsSaveCommandEnvelopeSchema
} from "./library-agent";
import {
  CatalogCreateLibraryAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryCommandEnvelopeSchema,
  CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryGroupCommandEnvelopeSchema,
  CatalogCreateLibraryEntryCommandEnvelopeSchema,
  CatalogCreateDraftSectionCommandEnvelopeSchema,
  CatalogCreateShortBookAtPathCommandEnvelopeSchema,
  CatalogCreateShortBookCommandEnvelopeSchema,
  CatalogDeleteBookCommandEnvelopeSchema,
  CatalogDeleteDraftSectionCommandEnvelopeSchema,
  CatalogDeleteProjectCommandEnvelopeSchema,
  CatalogImportLegacyBookAtPathCommandEnvelopeSchema,
  CatalogImportLegacyBookCommandEnvelopeSchema,
  CatalogImportLegacyLibraryAtPathCommandEnvelopeSchema,
  CatalogImportLegacyLibraryCommandEnvelopeSchema,
  CatalogOpenProjectAtPathCommandEnvelopeSchema,
  CatalogOpenProjectCommandEnvelopeSchema,
  CatalogLoadDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDocumentCommandEnvelopeSchema,
  CatalogSaveLibraryEntryCommandEnvelopeSchema,
  CatalogRemoveLibraryEntryCommandEnvelopeSchema,
  CatalogSnapshotCommandEnvelopeSchema,
  CatalogUpdateBookCommandEnvelopeSchema,
  CatalogUpdateLibraryGroupCommandEnvelopeSchema,
  CatalogUnregisterProjectCommandEnvelopeSchema
} from "./catalog";
import {
  WorkspaceDirectoryChooseCommandEnvelopeSchema,
  WorkspaceDirectoryListCommandEnvelopeSchema
} from "./workspace-directory";
import {
  AppearanceListCommandEnvelopeSchema,
  AppearanceSaveCommandEnvelopeSchema
} from "./appearance";
import { ExportShortManuscriptCommandEnvelopeSchema } from "./short-manuscript-export";

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
  CatalogSnapshotCommandEnvelopeSchema,
  CatalogLoadDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDraftRecoveryCommandEnvelopeSchema,
  CatalogCreateShortBookCommandEnvelopeSchema,
  CatalogCreateLibraryCommandEnvelopeSchema,
  CatalogCreateLibraryGroupCommandEnvelopeSchema,
  CatalogOpenProjectCommandEnvelopeSchema,
  CatalogImportLegacyBookCommandEnvelopeSchema,
  CatalogImportLegacyLibraryCommandEnvelopeSchema,
  CatalogCreateShortBookAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema,
  CatalogOpenProjectAtPathCommandEnvelopeSchema,
  CatalogImportLegacyBookAtPathCommandEnvelopeSchema,
  CatalogImportLegacyLibraryAtPathCommandEnvelopeSchema,
  CatalogUpdateBookCommandEnvelopeSchema,
  CatalogUpdateLibraryGroupCommandEnvelopeSchema,
  CatalogDeleteBookCommandEnvelopeSchema,
  CatalogCreateDraftSectionCommandEnvelopeSchema,
  CatalogDeleteDraftSectionCommandEnvelopeSchema,
  CatalogSaveDocumentCommandEnvelopeSchema,
  CatalogSaveLibraryEntryCommandEnvelopeSchema,
  CatalogCreateLibraryEntryCommandEnvelopeSchema,
  CatalogRemoveLibraryEntryCommandEnvelopeSchema,
  CatalogUnregisterProjectCommandEnvelopeSchema,
  CatalogDeleteProjectCommandEnvelopeSchema,
  SessionPromptCommandEnvelopeSchema,
  SessionAbortCommandEnvelopeSchema,
  ModelsListCommandEnvelopeSchema,
  ModelsSaveCommandEnvelopeSchema,
  ModelsTestCommandEnvelopeSchema,
  WorkspaceAgentsListCommandEnvelopeSchema,
  WorkspaceAgentsSaveCommandEnvelopeSchema,
  WorkspaceAgentsResetCommandEnvelopeSchema,
  LibraryAgentsListCommandEnvelopeSchema,
  LibraryAgentsSaveCommandEnvelopeSchema,
  LibraryAgentsResetCommandEnvelopeSchema,
  LearningImitationSettingsListCommandEnvelopeSchema,
  LearningImitationSettingsSaveCommandEnvelopeSchema,
  LearningImitationSettingsResetCommandEnvelopeSchema,
  AgentTeamsListCommandEnvelopeSchema,
  AgentTeamsSaveCommandEnvelopeSchema,
  WorkspaceDirectoryListCommandEnvelopeSchema,
  WorkspaceDirectoryChooseCommandEnvelopeSchema,
  AppearanceListCommandEnvelopeSchema,
  AppearanceSaveCommandEnvelopeSchema,
  ExportShortManuscriptCommandEnvelopeSchema,
  AgentPromptCommandEnvelopeSchema,
  AgentAbortCommandEnvelopeSchema,
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
  AgentToolCallStreamEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  AgentToolCompletedEventEnvelopeSchema,
  SubagentStartedEventEnvelopeSchema,
  SubagentActivityEventEnvelopeSchema,
  SubagentCompletedEventEnvelopeSchema,
  LearningImitationResultUpdatedEventEnvelopeSchema,
  LibraryEditorMutationEventEnvelopeSchema,
  WorkspaceEditorMutationEventEnvelopeSchema,
  WorkspaceStageSelectionEventEnvelopeSchema,
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
  | AgentToolCallStreamEventEnvelope
  | AgentToolRequestedEventEnvelope
  | AgentToolCompletedEventEnvelope
  | SubagentStartedEventEnvelope
  | SubagentActivityEventEnvelope
  | SubagentCompletedEventEnvelope
  | LearningImitationResultUpdatedEventEnvelope
  | LibraryEditorMutationEventEnvelope
  | WorkspaceEditorMutationEventEnvelope
  | WorkspaceStageSelectionEventEnvelope
  | AgentErrorEventEnvelope;
