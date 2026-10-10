import {
  BookIdentityCommandSchemas,
  BookIdentityUpdatedEventEnvelopeSchema,
  type BookIdentityUpdatedEventEnvelope
} from "./book-identity/commands";
import { ImageModelCommandSchemas } from "./image-models/commands";
import { LibraryPackageCommandSchemas } from "./library-package/commands";
import {
  LongMaterialCommandSchemas,
  LongMaterialProgressEventEnvelopeSchema,
  type LongMaterialProgressEventEnvelope
} from "./long-material-pack/commands";
import {
  DecompositionTargetUpdatedEventSchema,
  type DecompositionTargetUpdatedEvent
} from "./long-book-decomposition/events";
import { ErrorPayloadSchema, type ErrorPayload } from "./error-payload";
export { ErrorPayloadSchema, type ErrorPayload } from "./error-payload";
import { BookTemplateCommandSchemas } from "./book-templates";
import { VoiceCommandSchemas } from "./voice";
import { StorageSettingsCommandSchemas } from "./storage-settings";
import { ConversationExportCommandEnvelopeSchemas } from "./conversation-export";
import { SiteOfficialModelCommandSchemas } from "./site-official-models";
import { DeviceSyncWorkspaceCommandEnvelopeSchema } from "./device-sync-commands";
import { AgentTeamsSaveBuiltinsCommandEnvelopeSchema } from "./builtin-subagents";
import { CatalogQueryLibraryManagementCommandEnvelopeSchema } from "./library-management";
import { z } from "zod";
import {
  DecompositionCommandSchemas,
  LongBookSourceCommandSchemas
} from "./long-book-decomposition/commands";
import { ShortBookAnalysisCommandSchemas } from "./short-book-analysis-commands";
import {
  ExtrasAgentCommandSchemas,
  ExtrasAgentOutputUpdatedEventEnvelopeSchema,
  type ExtrasAgentOutputUpdatedEventEnvelope
} from "./extras-agent";
import { CatalogQueryMaterialsCommandEnvelopeSchema } from "./material-query";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";
import {
  AgentAbortCommandEnvelopeSchema,
  AgentUserInputResponseCommandEnvelopeSchema,
  AgentErrorEventEnvelopeSchema,
  AgentRunDrainedEventEnvelopeSchema,
  AgentEvaluationSnapshotEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentUsageObservedEventEnvelopeSchema,
  AgentRetryScheduledEventEnvelopeSchema,
  AgentContextCompactionEventEnvelopeSchema,
  AgentThinkingDeltaEventEnvelopeSchema,
  AgentTurnStartedEventEnvelopeSchema,
  AgentPromptCommandEnvelopeSchema,
  SubagentActivityEventEnvelopeSchema,
  SubagentCompletedEventEnvelopeSchema,
  SubagentDrawUpdatedEventEnvelopeSchema,
  SubagentPlannedEventEnvelopeSchema,
  SubagentStartedEventEnvelopeSchema,
  AgentToolCompletedEventEnvelopeSchema,
  AgentUserInputRequestedEventEnvelopeSchema,
  AgentToolCallStreamEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  LongChapterWriteProposalEventEnvelopeSchema,
  LongCharacterFileProposalEventEnvelopeSchema,
  LongContinuityFileProposalEventEnvelopeSchema,
  LongLedgerCommitProposalEventEnvelopeSchema,
  LongMutationProposalEventEnvelopeSchema,
  LongWorldbuildingFileProposalEventEnvelopeSchema,
  SubagentAuthoringDraftUpdatedEventEnvelopeSchema,
  LibraryEditorMutationEventEnvelopeSchema,
  WorkspaceEditorMutationEventEnvelopeSchema,
  WorkspaceStageSelectionEventEnvelopeSchema,
  SessionAbortCommandEnvelopeSchema,
  SessionUserInputResponseCommandEnvelopeSchema,
  SessionPromptCommandEnvelopeSchema,
  type AgentErrorEventEnvelope,
  type AgentRunDrainedEventEnvelope,
  type AgentEvaluationSnapshotEventEnvelope,
  type AgentMessageCompletedEventEnvelope,
  type AgentMessageDeltaEventEnvelope,
  type AgentUsageObservedEventEnvelope,
  type AgentRetryScheduledEventEnvelope,
  type AgentContextCompactionEventEnvelope,
  type AgentThinkingDeltaEventEnvelope,
  type AgentTurnStartedEventEnvelope,
  type AgentToolCompletedEventEnvelope,
  type AgentUserInputRequestedEventEnvelope,
  type AgentToolCallStreamEventEnvelope,
  type AgentToolRequestedEventEnvelope,
  type SubagentActivityEventEnvelope,
  type SubagentCompletedEventEnvelope,
  type SubagentDrawUpdatedEventEnvelope,
  type SubagentPlannedEventEnvelope,
  type SubagentStartedEventEnvelope,
  type LongChapterWriteProposalEventEnvelope,
  type LongCharacterFileProposalEventEnvelope,
  type LongContinuityFileProposalEventEnvelope,
  type LongLedgerCommitProposalEventEnvelope,
  type LongMutationProposalEventEnvelope,
  type LongWorldbuildingFileProposalEventEnvelope,
  type SubagentAuthoringDraftUpdatedEventEnvelope,
  type LibraryEditorMutationEventEnvelope,
  type WorkspaceEditorMutationEventEnvelope,
  type WorkspaceStageSelectionEventEnvelope
} from "./session";
import {
  AgentTeamsCreateCommandEnvelopeSchema,
  AgentTeamsDeleteCommandEnvelopeSchema,
  AgentTeamsExportPackageCommandEnvelopeSchema,
  AgentTeamsInstallPackageCommandEnvelopeSchema,
  AgentTeamsListCommandEnvelopeSchema,
  AgentTeamsRenameCommandEnvelopeSchema,
  AgentTeamsSetEnabledCommandEnvelopeSchema,
  AgentTeamsSaveCommandEnvelopeSchema
} from "./agent-team-catalog";
import {
  LongBookAnalysisChooseSourceCommandEnvelopeSchema,
  LongBookAnalysisListSourcesCommandEnvelopeSchema,
  LongBookAnalysisLoadSourceCommandEnvelopeSchema,
  LongBookAnalysisDeleteSourceCommandEnvelopeSchema
} from "./long-book-analysis";
import {
  AgentModelCapacityCommandEnvelopeSchema,
  AgentModelTestCommandEnvelopeSchema,
  ModelsClearOfficialTokenCommandEnvelopeSchema,
  ModelsSetOfficialModelEnabledCommandEnvelopeSchema,
  ModelsListCommandEnvelopeSchema,
  ModelsQueryOfficialBalanceCommandEnvelopeSchema,
  ModelsRefreshFreeCommandEnvelopeSchema,
  ModelsSetFreeModelEnabledCommandEnvelopeSchema,
  ModelsRefreshOfficialCommandEnvelopeSchema,
  ModelsSaveOfficialTokenCommandEnvelopeSchema,
  ModelsSaveCommandEnvelopeSchema,
  ModelsTestCommandEnvelopeSchema,
  ModelsResolveCapacityCommandEnvelopeSchema,
  ModelsListRemoteCommandEnvelopeSchema
} from "./models";
import { ModelUsageQueryCommandEnvelopeSchema } from "./model-usage";
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
  LongAgentsListCommandEnvelopeSchema,
  LongAgentsResetCommandEnvelopeSchema,
  LongAgentsSaveCommandEnvelopeSchema
} from "./long-agent-settings";
import {
  CatalogCreateLibraryAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryCommandEnvelopeSchema,
  CatalogUpdateLibraryCommandEnvelopeSchema,
  CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryGroupCommandEnvelopeSchema,
  CatalogCreateLibraryEntryCommandEnvelopeSchema,
  CatalogChooseExternalLibraryEntriesCommandEnvelopeSchema,
  CatalogImportLibraryEntriesCommandEnvelopeSchema,
  CatalogCreateDraftSectionCommandEnvelopeSchema,
  CatalogCreateDraftSectionsCommandEnvelopeSchema,
  CatalogCreateScriptBookAtPathCommandEnvelopeSchema,
  CatalogCreateScriptBookCommandEnvelopeSchema,
  CatalogCreateShortBookAtPathCommandEnvelopeSchema,
  CatalogCreateShortBookCommandEnvelopeSchema,
  CatalogDeleteBookCommandEnvelopeSchema,
  CatalogDeleteDraftSectionCommandEnvelopeSchema,
  CatalogMoveDraftSectionCommandEnvelopeSchema,
  CatalogDeleteProjectCommandEnvelopeSchema,
  CatalogDuplicateProjectCommandEnvelopeSchema,
  CatalogOpenProjectAtPathCommandEnvelopeSchema,
  CatalogOpenProjectCommandEnvelopeSchema,
  CatalogLoadDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDocumentCommandEnvelopeSchema,
  CatalogSaveLibraryEntryCommandEnvelopeSchema,
  CatalogRemoveLibraryEntryCommandEnvelopeSchema,
  CatalogMoveLibraryEntryCommandEnvelopeSchema,
  CatalogIndexCommandEnvelopeSchema,
  CatalogReadDocumentCommandEnvelopeSchema,
  CatalogSnapshotCommandEnvelopeSchema,
  CatalogUpdateBookCommandEnvelopeSchema,
  CatalogMutateCharacterStructureCommandEnvelopeSchema,
  CatalogMutatePlotStructureCommandEnvelopeSchema,
  CatalogUpdateLibraryGroupCommandEnvelopeSchema,
  CatalogUnregisterProjectCommandEnvelopeSchema
} from "./catalog";
import {
  WorkspaceDirectoryChooseCommandEnvelopeSchema,
  WorkspaceDirectoryListCommandEnvelopeSchema
} from "./workspace-directory";
import {
  AppearanceFontsInstallCommandEnvelopeSchema,
  AppearanceFontsListCommandEnvelopeSchema,
  AppearanceFontsRemoveCommandEnvelopeSchema,
  AppearanceListCommandEnvelopeSchema,
  AppearanceSaveCommandEnvelopeSchema
} from "./appearance";
import {
  GeneralSettingsListCommandEnvelopeSchema,
  GeneralSettingsSaveCommandEnvelopeSchema
} from "./general-settings";
import { ExportShortManuscriptCommandEnvelopeSchema } from "./short-manuscript-export";
import { ExportLongManuscriptCommandEnvelopeSchema } from "./long-manuscript-export";
import { CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema } from "./marketplace";
import {
  CatalogReadWritingContextCommandEnvelopeSchema,
  CatalogWriteWritingContextCommandEnvelopeSchema
} from "./writing-context";
import {
  RendererStateCommandEnvelopeSchemas,
  RendererStateFlushRequestedEventEnvelopeSchema
} from "./renderer-state";
import { LongWorkspaceCommandSchemas } from "./long-workspace-commands";

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
  ...StorageSettingsCommandSchemas,
  ...VoiceCommandSchemas,
  ...BookIdentityCommandSchemas,
  ...LongMaterialCommandSchemas,
  ...LibraryPackageCommandSchemas,
  ...ImageModelCommandSchemas,
  ...BookTemplateCommandSchemas,
  DeviceSyncWorkspaceCommandEnvelopeSchema,
  CatalogQueryMaterialsCommandEnvelopeSchema,
  SystemHealthCommandEnvelopeSchema,
  ...RendererStateCommandEnvelopeSchemas,
  ...ConversationExportCommandEnvelopeSchemas,
  CatalogIndexCommandEnvelopeSchema,
  CatalogReadDocumentCommandEnvelopeSchema,
  CatalogReadWritingContextCommandEnvelopeSchema,
  CatalogSnapshotCommandEnvelopeSchema,
  CatalogLoadDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDraftRecoveryCommandEnvelopeSchema,
  CatalogCreateShortBookCommandEnvelopeSchema,
  CatalogCreateScriptBookCommandEnvelopeSchema,
  CatalogCreateLibraryCommandEnvelopeSchema,
  CatalogUpdateLibraryCommandEnvelopeSchema,
  CatalogCreateLibraryGroupCommandEnvelopeSchema,
  CatalogOpenProjectCommandEnvelopeSchema,
  CatalogCreateShortBookAtPathCommandEnvelopeSchema,
  CatalogCreateScriptBookAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema,
  CatalogOpenProjectAtPathCommandEnvelopeSchema,
  CatalogUpdateBookCommandEnvelopeSchema,
  CatalogMutateCharacterStructureCommandEnvelopeSchema,
  CatalogMutatePlotStructureCommandEnvelopeSchema,
  CatalogUpdateLibraryGroupCommandEnvelopeSchema,
  CatalogDeleteBookCommandEnvelopeSchema,
  CatalogCreateDraftSectionCommandEnvelopeSchema,
  CatalogCreateDraftSectionsCommandEnvelopeSchema,
  CatalogDeleteDraftSectionCommandEnvelopeSchema,
  CatalogMoveDraftSectionCommandEnvelopeSchema,
  CatalogSaveDocumentCommandEnvelopeSchema,
  CatalogSaveLibraryEntryCommandEnvelopeSchema,
  CatalogCreateLibraryEntryCommandEnvelopeSchema,
  CatalogChooseExternalLibraryEntriesCommandEnvelopeSchema,
  CatalogImportLibraryEntriesCommandEnvelopeSchema,
  CatalogRemoveLibraryEntryCommandEnvelopeSchema,
  CatalogMoveLibraryEntryCommandEnvelopeSchema,
  CatalogUnregisterProjectCommandEnvelopeSchema,
  CatalogDeleteProjectCommandEnvelopeSchema,
  CatalogDuplicateProjectCommandEnvelopeSchema,
  CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema,
  CatalogWriteWritingContextCommandEnvelopeSchema,
  ...LongWorkspaceCommandSchemas,
  SessionPromptCommandEnvelopeSchema,
  SessionAbortCommandEnvelopeSchema,
  SessionUserInputResponseCommandEnvelopeSchema,
  ModelsListCommandEnvelopeSchema,
  ModelsQueryOfficialBalanceCommandEnvelopeSchema,
  ModelsRefreshFreeCommandEnvelopeSchema,
  ModelsSetFreeModelEnabledCommandEnvelopeSchema,
  ModelsRefreshOfficialCommandEnvelopeSchema,
  ModelsSaveOfficialTokenCommandEnvelopeSchema,
  ModelsClearOfficialTokenCommandEnvelopeSchema,
  ...SiteOfficialModelCommandSchemas,
  ModelsSetOfficialModelEnabledCommandEnvelopeSchema,
  ModelsSaveCommandEnvelopeSchema,
  ModelsTestCommandEnvelopeSchema,
  ModelsResolveCapacityCommandEnvelopeSchema,
  ModelsListRemoteCommandEnvelopeSchema,
  ModelUsageQueryCommandEnvelopeSchema,
  WorkspaceAgentsListCommandEnvelopeSchema,
  WorkspaceAgentsSaveCommandEnvelopeSchema,
  WorkspaceAgentsResetCommandEnvelopeSchema,
  LongAgentsListCommandEnvelopeSchema,
  LongAgentsSaveCommandEnvelopeSchema,
  LongAgentsResetCommandEnvelopeSchema,
  LibraryAgentsListCommandEnvelopeSchema,
  LibraryAgentsSaveCommandEnvelopeSchema,
  LibraryAgentsResetCommandEnvelopeSchema,
  ...ExtrasAgentCommandSchemas,
  ...DecompositionCommandSchemas,
  ...LongBookSourceCommandSchemas,
  ...ShortBookAnalysisCommandSchemas,
  LongBookAnalysisChooseSourceCommandEnvelopeSchema,
  LongBookAnalysisListSourcesCommandEnvelopeSchema,
  LongBookAnalysisLoadSourceCommandEnvelopeSchema,
  LongBookAnalysisDeleteSourceCommandEnvelopeSchema,
  AgentTeamsSaveBuiltinsCommandEnvelopeSchema,
  CatalogQueryLibraryManagementCommandEnvelopeSchema,
  AgentTeamsListCommandEnvelopeSchema,
  AgentTeamsCreateCommandEnvelopeSchema,
  AgentTeamsRenameCommandEnvelopeSchema,
  AgentTeamsDeleteCommandEnvelopeSchema,
  AgentTeamsSetEnabledCommandEnvelopeSchema,
  AgentTeamsSaveCommandEnvelopeSchema,
  AgentTeamsExportPackageCommandEnvelopeSchema,
  AgentTeamsInstallPackageCommandEnvelopeSchema,
  WorkspaceDirectoryListCommandEnvelopeSchema,
  WorkspaceDirectoryChooseCommandEnvelopeSchema,
  AppearanceListCommandEnvelopeSchema,
  AppearanceSaveCommandEnvelopeSchema,
  AppearanceFontsListCommandEnvelopeSchema,
  AppearanceFontsInstallCommandEnvelopeSchema,
  AppearanceFontsRemoveCommandEnvelopeSchema,
  GeneralSettingsListCommandEnvelopeSchema,
  GeneralSettingsSaveCommandEnvelopeSchema,
  ExportLongManuscriptCommandEnvelopeSchema,
  ExportShortManuscriptCommandEnvelopeSchema,
  AgentPromptCommandEnvelopeSchema,
  AgentAbortCommandEnvelopeSchema,
  AgentUserInputResponseCommandEnvelopeSchema,
  AgentModelTestCommandEnvelopeSchema,
  AgentModelCapacityCommandEnvelopeSchema
]);
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandType = CommandEnvelope["type"];

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

export const SystemWorkerRestartedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("system.worker_restarted"),
    payload: z.object({
      worker: UtilityWorkerNameSchema,
      reason: z.string().min(1),
      restartedAt: z.string().datetime()
    })
  });

export const SystemWorkerRestartingEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("system.worker_restarting"),
    payload: z.object({
      worker: UtilityWorkerNameSchema,
      reason: z.string().min(1),
      detectedAt: z.string().datetime()
    })
  });

export const SystemEventEnvelopeSchema = z.discriminatedUnion("type", [
  BookIdentityUpdatedEventEnvelopeSchema,
  LongMaterialProgressEventEnvelopeSchema,
  RendererStateFlushRequestedEventEnvelopeSchema,
  SystemReadyEventEnvelopeSchema,
  SystemWorkerRestartingEventEnvelopeSchema,
  SystemWorkerRestartedEventEnvelopeSchema,
  AgentEvaluationSnapshotEventEnvelopeSchema,
  AgentTurnStartedEventEnvelopeSchema,
  AgentRetryScheduledEventEnvelopeSchema,
  AgentContextCompactionEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentThinkingDeltaEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentUsageObservedEventEnvelopeSchema,
  AgentToolCallStreamEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  AgentToolCompletedEventEnvelopeSchema,
  AgentUserInputRequestedEventEnvelopeSchema,
  SubagentPlannedEventEnvelopeSchema,
  SubagentStartedEventEnvelopeSchema,
  SubagentActivityEventEnvelopeSchema,
  SubagentCompletedEventEnvelopeSchema,
  SubagentDrawUpdatedEventEnvelopeSchema,
  ExtrasAgentOutputUpdatedEventEnvelopeSchema,
  DecompositionTargetUpdatedEventSchema,
  SubagentAuthoringDraftUpdatedEventEnvelopeSchema,
  LongMutationProposalEventEnvelopeSchema,
  LongWorldbuildingFileProposalEventEnvelopeSchema,
  LongCharacterFileProposalEventEnvelopeSchema,
  LongContinuityFileProposalEventEnvelopeSchema,
  LongChapterWriteProposalEventEnvelopeSchema,
  LongLedgerCommitProposalEventEnvelopeSchema,
  LibraryEditorMutationEventEnvelopeSchema,
  WorkspaceEditorMutationEventEnvelopeSchema,
  WorkspaceStageSelectionEventEnvelopeSchema,
  AgentErrorEventEnvelopeSchema,
  AgentRunDrainedEventEnvelopeSchema
]);

export type SystemReadyEventEnvelope = Envelope<
  SystemHealthPayload,
  "system.ready"
>;
export type SystemWorkerRestartedEventEnvelope = Envelope<
  { worker: UtilityWorkerName; reason: string; restartedAt: string },
  "system.worker_restarted"
>;
export type SystemWorkerRestartingEventEnvelope = Envelope<
  { worker: UtilityWorkerName; reason: string; detectedAt: string },
  "system.worker_restarting"
>;
export type SystemEventEnvelope =
  | BookIdentityUpdatedEventEnvelope
  | LongMaterialProgressEventEnvelope
  | DecompositionTargetUpdatedEvent
  | ExtrasAgentOutputUpdatedEventEnvelope
  | z.infer<typeof RendererStateFlushRequestedEventEnvelopeSchema>
  | SystemReadyEventEnvelope
  | SystemWorkerRestartingEventEnvelope
  | SystemWorkerRestartedEventEnvelope
  | AgentEvaluationSnapshotEventEnvelope
  | AgentTurnStartedEventEnvelope
  | AgentRetryScheduledEventEnvelope
  | AgentContextCompactionEventEnvelope
  | AgentMessageDeltaEventEnvelope
  | AgentThinkingDeltaEventEnvelope
  | AgentMessageCompletedEventEnvelope
  | AgentUsageObservedEventEnvelope
  | AgentToolCallStreamEventEnvelope
  | AgentToolRequestedEventEnvelope
  | AgentToolCompletedEventEnvelope
  | AgentUserInputRequestedEventEnvelope
  | SubagentPlannedEventEnvelope
  | SubagentStartedEventEnvelope
  | SubagentActivityEventEnvelope
  | SubagentCompletedEventEnvelope
  | SubagentDrawUpdatedEventEnvelope
  | SubagentAuthoringDraftUpdatedEventEnvelope
  | LongMutationProposalEventEnvelope
  | LongWorldbuildingFileProposalEventEnvelope
  | LongCharacterFileProposalEventEnvelope
  | LongContinuityFileProposalEventEnvelope
  | LongChapterWriteProposalEventEnvelope
  | LongLedgerCommitProposalEventEnvelope
  | LibraryEditorMutationEventEnvelope
  | WorkspaceEditorMutationEventEnvelope
  | WorkspaceStageSelectionEventEnvelope
  | AgentErrorEventEnvelope
  | AgentRunDrainedEventEnvelope;
