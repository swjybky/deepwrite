import { z } from "zod";
import {
  ChatAssistantProjectConfigGetCommandEnvelopeSchema,
  ChatAssistantProjectConfigListCommandEnvelopeSchema,
  ChatAssistantProjectConfigResetCommandEnvelopeSchema,
  ChatAssistantProjectConfigSaveCommandEnvelopeSchema
} from "./chat-assistant";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";
import {
  AgentAbortCommandEnvelopeSchema,
  AgentUserInputResponseCommandEnvelopeSchema,
  AgentErrorEventEnvelopeSchema,
  AgentEvaluationSnapshotEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentUsageObservedEventEnvelopeSchema,
  AgentRetryScheduledEventEnvelopeSchema,
  AgentThinkingDeltaEventEnvelopeSchema,
  AgentTurnStartedEventEnvelopeSchema,
  AgentPromptCommandEnvelopeSchema,
  SubagentActivityEventEnvelopeSchema,
  SubagentCompletedEventEnvelopeSchema,
  SubagentStartedEventEnvelopeSchema,
  AgentToolCompletedEventEnvelopeSchema,
  AgentUserInputRequestedEventEnvelopeSchema,
  AgentToolCallStreamEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  LearningImitationResultUpdatedEventEnvelopeSchema,
  LongBookAnalysisNoteUpdatedEventEnvelopeSchema,
  LongBookAnalysisResultUpdatedEventEnvelopeSchema,
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
  type AgentEvaluationSnapshotEventEnvelope,
  type AgentMessageCompletedEventEnvelope,
  type AgentMessageDeltaEventEnvelope,
  type AgentUsageObservedEventEnvelope,
  type AgentRetryScheduledEventEnvelope,
  type AgentThinkingDeltaEventEnvelope,
  type AgentTurnStartedEventEnvelope,
  type AgentToolCompletedEventEnvelope,
  type AgentUserInputRequestedEventEnvelope,
  type AgentToolCallStreamEventEnvelope,
  type AgentToolRequestedEventEnvelope,
  type SubagentActivityEventEnvelope,
  type SubagentCompletedEventEnvelope,
  type SubagentStartedEventEnvelope,
  type LearningImitationResultUpdatedEventEnvelope,
  type LongBookAnalysisNoteUpdatedEventEnvelope,
  type LongBookAnalysisResultUpdatedEventEnvelope,
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
  LearningImitationSettingsListCommandEnvelopeSchema,
  LearningImitationSettingsResetCommandEnvelopeSchema,
  LearningImitationSettingsSaveCommandEnvelopeSchema
} from "./learning-imitation";
import {
  LongBookAnalysisChooseSourceCommandEnvelopeSchema,
  LongBookAnalysisListSourcesCommandEnvelopeSchema,
  LongBookAnalysisLoadSourceCommandEnvelopeSchema,
  LongBookAnalysisSettingsListCommandEnvelopeSchema,
  LongBookAnalysisSettingsResetCommandEnvelopeSchema,
  LongBookAnalysisSettingsSaveCommandEnvelopeSchema
} from "./long-book-analysis";
import {
  AgentModelCapacityCommandEnvelopeSchema,
  AgentModelTestCommandEnvelopeSchema,
  ModelsClearOfficialTokenCommandEnvelopeSchema,
  ModelsClearSiteOfficialTokenCommandEnvelopeSchema,
  ModelsRefreshSiteOfficialCommandEnvelopeSchema,
  ModelsQuerySiteOfficialQuotaCommandEnvelopeSchema,
  ModelsSetSiteOfficialModelEnabledCommandEnvelopeSchema,
  ModelsSetOfficialModelEnabledCommandEnvelopeSchema,
  ModelsListCommandEnvelopeSchema,
  ModelsQueryOfficialBalanceCommandEnvelopeSchema,
  ModelsRefreshFreeCommandEnvelopeSchema,
  ModelsSetFreeModelEnabledCommandEnvelopeSchema,
  ModelsRefreshOfficialCommandEnvelopeSchema,
  ModelsSaveOfficialTokenCommandEnvelopeSchema,
  ModelsSaveSiteOfficialTokenCommandEnvelopeSchema,
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
  CatalogImportLegacyLibraryAtPathCommandEnvelopeSchema,
  CatalogImportLegacyLibraryCommandEnvelopeSchema,
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
  RendererStateLoadCommandEnvelopeSchema,
  RendererStateRemoveCommandEnvelopeSchema,
  RendererStateSaveCommandEnvelopeSchema
} from "./renderer-state";
import {
  LongApplyOperationsCommandEnvelopeSchema,
  LongCreateBookAtPathCommandEnvelopeSchema,
  LongCreateBookCommandEnvelopeSchema,
  LongCommitChapterCommandEnvelopeSchema,
  LongDeleteLedgerCommitCommandEnvelopeSchema,
  LongDeleteBookCommandEnvelopeSchema,
  LongDuplicateBookCommandEnvelopeSchema,
  LongGetWorkspaceIndexCommandEnvelopeSchema,
  LongImportPortableAtPathCommandEnvelopeSchema,
  LongImportPortableCommandEnvelopeSchema,
  LongChooseContinuationImportSourceCommandEnvelopeSchema,
  LongPreviewContinuationImportAtPathCommandEnvelopeSchema,
  LongImportContinuationCommandEnvelopeSchema,
  LongImportContinuationAtPathCommandEnvelopeSchema,
  LongChooseLegacySyncSourceCommandEnvelopeSchema,
  LongPreviewLegacySyncAtPathCommandEnvelopeSchema,
  LongApplyLegacySyncCommandEnvelopeSchema,
  LongApplyLegacySyncAtPathCommandEnvelopeSchema,
  LongListBooksCommandEnvelopeSchema,
  LongOpenBookCommandEnvelopeSchema,
  LongOpenBookAtPathCommandEnvelopeSchema,
  LongOpenExistingBookCommandEnvelopeSchema,
  LongRenameBookCommandEnvelopeSchema,
  LongPreviewOperationsCommandEnvelopeSchema,
  LongReadDocumentCommandEnvelopeSchema,
  LongReadAgentsMdCommandEnvelopeSchema,
  LongSearchCommandEnvelopeSchema,
  LongUnregisterBookCommandEnvelopeSchema,
  LongUpdateBindingsCommandEnvelopeSchema,
  LongWriteChapterCommandEnvelopeSchema,
  LongWriteAgentsMdCommandEnvelopeSchema,
  LongWriteDocumentCommandEnvelopeSchema
} from "./long-workspace-api";

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
  RendererStateLoadCommandEnvelopeSchema,
  RendererStateSaveCommandEnvelopeSchema,
  RendererStateRemoveCommandEnvelopeSchema,
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
  CatalogImportLegacyLibraryCommandEnvelopeSchema,
  CatalogCreateShortBookAtPathCommandEnvelopeSchema,
  CatalogCreateScriptBookAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema,
  CatalogOpenProjectAtPathCommandEnvelopeSchema,
  CatalogImportLegacyLibraryAtPathCommandEnvelopeSchema,
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
  LongCreateBookCommandEnvelopeSchema,
  LongCreateBookAtPathCommandEnvelopeSchema,
  LongDuplicateBookCommandEnvelopeSchema,
  LongChooseLegacySyncSourceCommandEnvelopeSchema,
  LongPreviewLegacySyncAtPathCommandEnvelopeSchema,
  LongApplyLegacySyncCommandEnvelopeSchema,
  LongApplyLegacySyncAtPathCommandEnvelopeSchema,
  LongImportPortableCommandEnvelopeSchema,
  LongImportPortableAtPathCommandEnvelopeSchema,
  LongChooseContinuationImportSourceCommandEnvelopeSchema,
  LongPreviewContinuationImportAtPathCommandEnvelopeSchema,
  LongImportContinuationCommandEnvelopeSchema,
  LongImportContinuationAtPathCommandEnvelopeSchema,
  LongListBooksCommandEnvelopeSchema,
  LongOpenBookCommandEnvelopeSchema,
  LongRenameBookCommandEnvelopeSchema,
  LongUpdateBindingsCommandEnvelopeSchema,
  LongOpenExistingBookCommandEnvelopeSchema,
  LongOpenBookAtPathCommandEnvelopeSchema,
  LongUnregisterBookCommandEnvelopeSchema,
  LongDeleteBookCommandEnvelopeSchema,
  LongGetWorkspaceIndexCommandEnvelopeSchema,
  LongReadDocumentCommandEnvelopeSchema,
  LongReadAgentsMdCommandEnvelopeSchema,
  LongSearchCommandEnvelopeSchema,
  LongWriteDocumentCommandEnvelopeSchema,
  LongWriteAgentsMdCommandEnvelopeSchema,
  LongPreviewOperationsCommandEnvelopeSchema,
  LongApplyOperationsCommandEnvelopeSchema,
  LongWriteChapterCommandEnvelopeSchema,
  LongCommitChapterCommandEnvelopeSchema,
  LongDeleteLedgerCommitCommandEnvelopeSchema,
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
  ModelsSaveSiteOfficialTokenCommandEnvelopeSchema,
  ModelsClearSiteOfficialTokenCommandEnvelopeSchema,
  ModelsRefreshSiteOfficialCommandEnvelopeSchema,
  ModelsQuerySiteOfficialQuotaCommandEnvelopeSchema,
  ModelsSetSiteOfficialModelEnabledCommandEnvelopeSchema,
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
  LearningImitationSettingsListCommandEnvelopeSchema,
  LearningImitationSettingsSaveCommandEnvelopeSchema,
  LearningImitationSettingsResetCommandEnvelopeSchema,
  LongBookAnalysisChooseSourceCommandEnvelopeSchema,
  LongBookAnalysisListSourcesCommandEnvelopeSchema,
  LongBookAnalysisLoadSourceCommandEnvelopeSchema,
  LongBookAnalysisSettingsListCommandEnvelopeSchema,
  LongBookAnalysisSettingsSaveCommandEnvelopeSchema,
  LongBookAnalysisSettingsResetCommandEnvelopeSchema,
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
  ChatAssistantProjectConfigListCommandEnvelopeSchema,
  ChatAssistantProjectConfigGetCommandEnvelopeSchema,
  ChatAssistantProjectConfigSaveCommandEnvelopeSchema,
  ChatAssistantProjectConfigResetCommandEnvelopeSchema,
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
  SystemReadyEventEnvelopeSchema,
  SystemWorkerRestartingEventEnvelopeSchema,
  SystemWorkerRestartedEventEnvelopeSchema,
  AgentEvaluationSnapshotEventEnvelopeSchema,
  AgentTurnStartedEventEnvelopeSchema,
  AgentRetryScheduledEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentThinkingDeltaEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentUsageObservedEventEnvelopeSchema,
  AgentToolCallStreamEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  AgentToolCompletedEventEnvelopeSchema,
  AgentUserInputRequestedEventEnvelopeSchema,
  SubagentStartedEventEnvelopeSchema,
  SubagentActivityEventEnvelopeSchema,
  SubagentCompletedEventEnvelopeSchema,
  LearningImitationResultUpdatedEventEnvelopeSchema,
  LongBookAnalysisNoteUpdatedEventEnvelopeSchema,
  LongBookAnalysisResultUpdatedEventEnvelopeSchema,
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
  AgentErrorEventEnvelopeSchema
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
  | SystemReadyEventEnvelope
  | SystemWorkerRestartingEventEnvelope
  | SystemWorkerRestartedEventEnvelope
  | AgentEvaluationSnapshotEventEnvelope
  | AgentTurnStartedEventEnvelope
  | AgentRetryScheduledEventEnvelope
  | AgentMessageDeltaEventEnvelope
  | AgentThinkingDeltaEventEnvelope
  | AgentMessageCompletedEventEnvelope
  | AgentUsageObservedEventEnvelope
  | AgentToolCallStreamEventEnvelope
  | AgentToolRequestedEventEnvelope
  | AgentToolCompletedEventEnvelope
  | AgentUserInputRequestedEventEnvelope
  | SubagentStartedEventEnvelope
  | SubagentActivityEventEnvelope
  | SubagentCompletedEventEnvelope
  | LearningImitationResultUpdatedEventEnvelope
  | LongBookAnalysisNoteUpdatedEventEnvelope
  | LongBookAnalysisResultUpdatedEventEnvelope
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
  | AgentErrorEventEnvelope;
