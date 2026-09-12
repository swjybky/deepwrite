import { conversationExport } from "./conversation-export-api";
import { cloudBackup } from "./cloud-backup-api";
import { deviceSync } from "./device-sync-api";
import { conversationPersistence } from "./conversation-persistence-api";
import {
  listAgentTeams,
  createAgentTeam,
  renameAgentTeam,
  deleteAgentTeam,
  setAgentTeamEnabled,
  saveAgentTeams,
  downloadAgentTeam,
  installAgentTeam,
  saveBuiltinSubagents
} from "./agent-teams-api";
import { contextBridge, ipcRenderer } from "electron";
import {
  BookSchema,
  SaveDocumentResultSchema,
  CatalogDraftSectionSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogLibrarySchema,
  CatalogLibraryGroupSchema,
  CatalogLibraryEntrySchema,
  CatalogLibraryProjectDomainSchema,
  CatalogOpenProjectResultSchema,
  CatalogProjectDomainSchema,
  CatalogIndexSnapshotSchema,
  CatalogReadDocumentInputSchema,
  CatalogReadDocumentResultSchema,
  ReadWritingContextInputSchema,
  ReadWritingContextResultSchema,
  CatalogSnapshotSchema,
  CreateLibraryEntryInputSchema,
  CreateDraftSectionInputSchema,
  CreateDraftSectionsInputSchema,
  CreateDraftSectionsResultSchema,
  CreateLibraryGroupInputSchema,
  CreateLibraryInputSchema,
  UpdateLibraryInputSchema,
  CreateScriptBookInputSchema,
  CreateShortBookInputSchema,
  DeleteCatalogProjectInputSchema,
  DeleteCatalogProjectResultSchema,
  DeleteBookInputSchema,
  DeleteBookResultSchema,
  DeleteDraftSectionInputSchema,
  DeleteDraftSectionResultSchema,
  MoveDraftSectionInputSchema,
  MoveDraftSectionResultSchema,
  DuplicateCatalogProjectInputSchema,
  DuplicateCatalogProjectResultSchema,
  ExportLongManuscriptInputSchema,
  ExportLongManuscriptResultSchema,
  ExportShortManuscriptInputSchema,
  ExportShortManuscriptResultSchema,
  ExternalLibrarySelectionResultSchema,
  ExternalLibrarySourceKindSchema,
  ImportLibraryEntriesInputSchema,
  ImportLibraryEntriesResultSchema,
  GeneralSettingsSchema,
  GeneralSettingsSnapshotSchema,
  ImportLegacyLibraryResultSchema,
  IPC_EVENT_CHANNEL,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  UpdateStateSchema,
  LearningImitationSettingsInputSchema,
  LearningImitationSettingsSchema,
  LearningImitationStageIdSchema,
  LongBookAnalysisSettingsInputSchema,
  LongBookAnalysisSettingsSchema,
  LongBookAnalysisSavedSourceCatalogSchema,
  LongBookAnalysisSavedSourceIdSchema,
  LongBookAnalysisSourceKindSchema,
  LongBookAnalysisSourceSchema,
  MARKETPLACE_IPC_CHANNEL,
  MarketplaceContentDetailSchema,
  MarketplaceContentPageSchema,
  MarketplaceContentRefSchema,
  MarketplaceContentSummarySchema,
  MarketplaceInstallInputSchema,
  MarketplaceInstallPreviewSchema,
  MarketplaceInstallResultSchema,
  MarketplaceIpcRequestSchema,
  MarketplaceLikeInputSchema,
  MarketplaceLikeResultSchema,
  MarketplaceListFilterSchema,
  MarketplaceLoginInputSchema,
  MarketplacePublishInputSchema,
  MarketplaceRegisterInputSchema,
  MarketplaceSetEnabledInputSchema,
  MarketplaceSessionSchema,
  MarketplaceUpdateInputSchema,
  LibraryAgentDomainSchema,
  LibraryAgentSettingsInputSchema,
  LibraryAgentSettingsSchema,
  LongAgentIdSchema,
  LongAgentSettingsInputSchema,
  LongAgentSettingsSchema,
  MutateCharacterStructureInputSchema,
  MutatePlotStructureInputSchema,
  RemoveLibraryEntryInputSchema,
  RemoveLibraryEntryResultSchema,
  MoveLibraryEntryInputSchema,
  MoveLibraryEntryResultSchema,
  SaveDocumentInputSchema,
  SaveLibraryEntryInputSchema,
  ScriptBookSchema,
  ScriptWorkspaceAgentIdSchema,
  ShortBookSchema,
  ShortWorkspaceAgentIdSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  UnregisterCatalogProjectInputSchema,
  UnregisterCatalogProjectResultSchema,
  WorkspaceDirectorySettingsSchema,
  APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL,
  APP_ALERT_GET_CHANNEL,
  AppAlertDesktopRevisionSchema,
  AppAlertSnapshotSchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  WorkspaceAgentSettingsInputSchema,
  WorkspaceAgentSettingsSchema,
  WorkspaceTypeSchema,
  WriteWritingContextInputSchema,
  WriteWritingContextResultSchema,
  createEnvelope,
  type Book,
  type CatalogDraftSection,
  type CatalogDraftRecovery,
  type CatalogLibrary,
  type CatalogLibraryGroup,
  type CatalogLibraryEntry,
  type CatalogLibraryProjectDomain,
  type CatalogOpenProjectResult,
  type CatalogProjectDomain,
  type CatalogIndexSnapshot,
  type CatalogReadDocumentInput,
  type CatalogReadDocumentResult,
  type ReadWritingContextInput,
  type ReadWritingContextResult,
  type CatalogSnapshot,
  type CreateLibraryEntryInput,
  type CreateDraftSectionInput,
  type CreateDraftSectionsInput,
  type CreateDraftSectionsResult,
  type CreateLibraryGroupInput,
  type CreateLibraryInput,
  type UpdateLibraryInput,
  type CreateScriptBookInput,
  type CreateShortBookInput,
  type DeepWriteApi,
  type DeleteCatalogProjectInput,
  type DeleteCatalogProjectResult,
  type DeleteBookResult,
  type DeleteDraftSectionInput,
  type DeleteDraftSectionResult,
  type MoveDraftSectionInput,
  type MoveDraftSectionResult,
  type DuplicateCatalogProjectInput,
  type DuplicateCatalogProjectResult,
  type ExportLongManuscriptInput,
  type ExportLongManuscriptResult,
  type ExportShortManuscriptInput,
  type ExportShortManuscriptResult,
  type ExternalLibrarySelectionResult,
  type ExternalLibrarySourceKind,
  type ImportLibraryEntriesInput,
  type ImportLibraryEntriesResult,
  type GeneralSettings,
  type GeneralSettingsSnapshot,
  type ImportLegacyLibraryResult,
  type LearningImitationSettings,
  type LearningImitationSettingsInput,
  type LearningImitationStageId,
  type LongBookAnalysisSettings,
  type LongBookAnalysisSettingsInput,
  type LongBookAnalysisSavedSourceCatalog,
  type LongBookAnalysisSource,
  type LongBookAnalysisSourceKind,
  type MarketplaceContentRef,
  type MarketplaceInstallInput,
  type MarketplaceLikeInput,
  type MarketplaceListFilter,
  type MarketplaceLoginInput,
  type MarketplacePublishInput,
  type MarketplaceRegisterInput,
  type MarketplaceSetEnabledInput,
  type MarketplaceUpdateInput,
  type LongAgentId,
  type LongAgentSettings,
  type LongAgentSettingsInput,
  type LibraryAgentDomain,
  type LibraryAgentSettings,
  type LibraryAgentSettingsInput,
  type MutateCharacterStructureInput,
  type MutatePlotStructureInput,
  type RemoveLibraryEntryInput,
  type RemoveLibraryEntryResult,
  type MoveLibraryEntryInput,
  type MoveLibraryEntryResult,
  type SaveDocumentInput,
  type SaveDocumentResult,
  type SaveLibraryEntryInput,
  type ScriptBook,
  type ScriptWorkspaceAgentId,
  type ScriptWorkspaceAgentSettings,
  type ScriptWorkspaceAgentSettingsInput,
  type ShortBook,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput,
  type SystemEventEnvelope,
  type SystemHealthPayload,
  type UnregisterCatalogProjectInput,
  type UnregisterCatalogProjectResult,
  type UpdateBookInput,
  type UpdateLibraryGroupInput,
  type UpdateState,
  type WriteWritingContextInput,
  type WriteWritingContextResult,
  type WorkspaceDirectorySettings,
  type WorkspaceAgentSettings,
  type WorkspaceAgentSettingsInput,
  type WorkspaceType,
  type AppAlertSnapshot
} from "@deepwrite/contracts";

import { browserId, invokeCommand } from "./invoke";
import { appearance } from "./appearance-api";
import { long } from "./long-api";
import {
  abort,
  getChatAssistantProjectConfig,
  listChatAssistantProjectConfigs,
  models as sessionModels,
  prompt,
  queryModelUsage,
  resetChatAssistantProjectConfig,
  saveChatAssistantProjectConfig,
  submitUserInput
} from "./session-models-api";

async function getHealth(): Promise<SystemHealthPayload> {
  const id = browserId("cmd_health");
  return SystemHealthPayloadSchema.parse(
    await invokeCommand<SystemHealthPayload>(
      createEnvelope("system.health", {}, { id, correlationId: id })
    )
  );
}

async function getUpdateState(): Promise<UpdateState> {
  return UpdateStateSchema.parse(
    await ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL)
  );
}

async function checkForUpdates(): Promise<UpdateState> {
  return UpdateStateSchema.parse(
    await ipcRenderer.invoke(UPDATE_CHECK_CHANNEL)
  );
}

async function downloadUpdate(): Promise<UpdateState> {
  return UpdateStateSchema.parse(
    await ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL)
  );
}

async function installUpdate(): Promise<void> {
  await ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL);
}

async function getAppAlerts(): Promise<AppAlertSnapshot> {
  return AppAlertSnapshotSchema.parse(
    await ipcRenderer.invoke(APP_ALERT_GET_CHANNEL)
  );
}

async function acknowledgeDesktopAlert(rawRevision: string): Promise<void> {
  const revision = AppAlertDesktopRevisionSchema.parse(rawRevision);
  await ipcRenderer.invoke(APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL, revision);
}

async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  const id = browserId("cmd_catalog_snapshot");
  return CatalogSnapshotSchema.parse(
    await invokeCommand<CatalogSnapshot>(
      createEnvelope("catalog.snapshot", {}, { id, correlationId: id })
    )
  );
}

async function getCatalogIndex(): Promise<CatalogIndexSnapshot> {
  const id = browserId("cmd_catalog_index");
  return CatalogIndexSnapshotSchema.parse(
    await invokeCommand<CatalogIndexSnapshot>(
      createEnvelope("catalog.index", {}, { id, correlationId: id })
    )
  );
}

async function readCatalogDocument(
  rawInput: CatalogReadDocumentInput
): Promise<CatalogReadDocumentResult> {
  const input = CatalogReadDocumentInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_read_document");
  return CatalogReadDocumentResultSchema.parse(
    await invokeCommand<CatalogReadDocumentResult>(
      createEnvelope("catalog.readDocument", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function readWritingContext(
  rawInput: ReadWritingContextInput
): Promise<ReadWritingContextResult> {
  const input = ReadWritingContextInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_read_writing_context");
  return ReadWritingContextResultSchema.parse(
    await invokeCommand<ReadWritingContextResult>(
      createEnvelope("catalog.readWritingContext", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function writeWritingContext(
  rawInput: WriteWritingContextInput
): Promise<WriteWritingContextResult> {
  const input = WriteWritingContextInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_write_writing_context");
  return WriteWritingContextResultSchema.parse(
    await invokeCommand<WriteWritingContextResult>(
      createEnvelope("catalog.writeWritingContext", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function loadDraftRecovery(): Promise<CatalogDraftRecovery> {
  const id = browserId("cmd_catalog_load_draft_recovery");
  return CatalogDraftRecoverySchema.parse(
    await invokeCommand<CatalogDraftRecovery>(
      createEnvelope("catalog.loadDraftRecovery", {}, { id, correlationId: id })
    )
  );
}

async function saveDraftRecovery(
  rawDrafts: CatalogDraftRecovery
): Promise<void> {
  const drafts = CatalogDraftRecoverySchema.parse(rawDrafts);
  const id = browserId("cmd_catalog_save_draft_recovery");
  CatalogDraftRecoverySaveResultSchema.parse(
    await invokeCommand(
      createEnvelope(
        "catalog.saveDraftRecovery",
        { drafts },
        { id, correlationId: id }
      )
    )
  );
}

async function createShortBook(
  rawInput: CreateShortBookInput
): Promise<ShortBook | null> {
  const input = CreateShortBookInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_book");
  return ShortBookSchema.nullable().parse(
    await invokeCommand<ShortBook | null>(
      createEnvelope("catalog.createShortBook", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function createScriptBook(
  rawInput: CreateScriptBookInput
): Promise<ScriptBook | null> {
  const input = CreateScriptBookInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_script_book");
  return ScriptBookSchema.nullable().parse(
    await invokeCommand<ScriptBook | null>(
      createEnvelope("catalog.createScriptBook", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function createLibrary(
  rawInput: CreateLibraryInput
): Promise<CatalogLibrary | null> {
  const input = CreateLibraryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_library");
  return CatalogLibrarySchema.nullable().parse(
    await invokeCommand<CatalogLibrary | null>(
      createEnvelope("catalog.createLibrary", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function createLibraryGroup(
  rawInput: CreateLibraryGroupInput
): Promise<CatalogLibraryGroup | null> {
  const input = CreateLibraryGroupInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_library_group");
  return CatalogLibraryGroupSchema.nullable().parse(
    await invokeCommand<CatalogLibraryGroup | null>(
      createEnvelope("catalog.createLibraryGroup", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function openProject(
  rawDomain: CatalogProjectDomain
): Promise<CatalogOpenProjectResult | null> {
  const domain = CatalogProjectDomainSchema.parse(rawDomain);
  const id = browserId("cmd_catalog_open_project");
  return CatalogOpenProjectResultSchema.nullable().parse(
    await invokeCommand<CatalogOpenProjectResult | null>(
      createEnvelope(
        "catalog.openProject",
        { domain },
        {
          id,
          correlationId: id
        }
      )
    )
  );
}

async function importLegacyLibrary(
  rawDomain: CatalogLibraryProjectDomain
): Promise<ImportLegacyLibraryResult | null> {
  const domain = CatalogLibraryProjectDomainSchema.parse(rawDomain);
  const id = browserId("cmd_catalog_import_legacy_library");
  return ImportLegacyLibraryResultSchema.nullable().parse(
    await invokeCommand<ImportLegacyLibraryResult | null>(
      createEnvelope(
        "catalog.importLegacyLibrary",
        { domain },
        { id, correlationId: id }
      )
    )
  );
}

async function updateBook(rawInput: UpdateBookInput): Promise<Book> {
  const input = UpdateBookInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_update_book");
  return BookSchema.parse(
    await invokeCommand<Book>(
      createEnvelope("catalog.updateBook", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function mutatePlotStructure(
  rawInput: MutatePlotStructureInput
): Promise<Book> {
  const input = MutatePlotStructureInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_mutate_plot_structure");
  return BookSchema.parse(
    await invokeCommand<Book>(
      createEnvelope("catalog.mutatePlotStructure", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function mutateCharacterStructure(
  rawInput: MutateCharacterStructureInput
): Promise<Book> {
  const input = MutateCharacterStructureInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_mutate_character_structure");
  return BookSchema.parse(
    await invokeCommand<Book>(
      createEnvelope("catalog.mutateCharacterStructure", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function updateLibraryGroup(
  rawInput: UpdateLibraryGroupInput
): Promise<CatalogLibraryGroup> {
  const input = UpdateLibraryGroupInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_update_library_group");
  return CatalogLibraryGroupSchema.parse(
    await invokeCommand<CatalogLibraryGroup>(
      createEnvelope("catalog.updateLibraryGroup", input, {
        id,
        correlationId: id,
        context: { resourceId: input.groupId }
      })
    )
  );
}

async function deleteBook(bookId: string): Promise<DeleteBookResult> {
  const input = DeleteBookInputSchema.parse({ bookId });
  const id = browserId("cmd_catalog_delete_book");
  return DeleteBookResultSchema.parse(
    await invokeCommand<DeleteBookResult>(
      createEnvelope("catalog.deleteBook", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function saveDocument(
  rawInput: SaveDocumentInput
): Promise<SaveDocumentResult> {
  const input = SaveDocumentInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_save_document");
  return SaveDocumentResultSchema.parse(
    await invokeCommand<SaveDocumentResult>(
      createEnvelope("catalog.saveDocument", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function createDraftSection(
  rawInput: CreateDraftSectionInput
): Promise<CatalogDraftSection> {
  const input = CreateDraftSectionInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_draft_section");
  return CatalogDraftSectionSchema.parse(
    await invokeCommand<CatalogDraftSection>(
      createEnvelope("catalog.createDraftSection", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function createDraftSections(
  rawInput: CreateDraftSectionsInput
): Promise<CreateDraftSectionsResult> {
  const input = CreateDraftSectionsInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_draft_sections");
  return CreateDraftSectionsResultSchema.parse(
    await invokeCommand<CreateDraftSectionsResult>(
      createEnvelope("catalog.createDraftSections", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function deleteDraftSection(
  rawInput: DeleteDraftSectionInput
): Promise<DeleteDraftSectionResult> {
  const input = DeleteDraftSectionInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_delete_draft_section");
  return DeleteDraftSectionResultSchema.parse(
    await invokeCommand<DeleteDraftSectionResult>(
      createEnvelope("catalog.deleteDraftSection", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function moveDraftSection(
  rawInput: MoveDraftSectionInput
): Promise<MoveDraftSectionResult> {
  const input = MoveDraftSectionInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_move_draft_section");
  return MoveDraftSectionResultSchema.parse(
    await invokeCommand<MoveDraftSectionResult>(
      createEnvelope("catalog.moveDraftSection", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function saveLibraryEntry(
  rawInput: SaveLibraryEntryInput
): Promise<CatalogLibraryEntry> {
  const input = SaveLibraryEntryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_save_library_entry");
  return CatalogLibraryEntrySchema.parse(
    await invokeCommand<CatalogLibraryEntry>(
      createEnvelope("catalog.saveLibraryEntry", input, {
        id,
        correlationId: id,
        context: { resourceId: input.libraryId }
      })
    )
  );
}

async function createLibraryEntry(
  rawInput: CreateLibraryEntryInput
): Promise<CatalogLibraryEntry> {
  const input = CreateLibraryEntryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_library_entry");
  return CatalogLibraryEntrySchema.parse(
    await invokeCommand<CatalogLibraryEntry>(
      createEnvelope("catalog.createLibraryEntry", input, {
        id,
        correlationId: id,
        context: { resourceId: input.libraryId }
      })
    )
  );
}

async function chooseExternalLibraryEntries(
  rawSourceKind: ExternalLibrarySourceKind
): Promise<ExternalLibrarySelectionResult | null> {
  const sourceKind = ExternalLibrarySourceKindSchema.parse(rawSourceKind);
  const id = browserId("cmd_catalog_choose_external_library_entries");
  const result = await invokeCommand<ExternalLibrarySelectionResult | null>(
    createEnvelope(
      "catalog.chooseExternalLibraryEntries",
      { sourceKind },
      { id, correlationId: id }
    )
  );
  return result === null
    ? null
    : ExternalLibrarySelectionResultSchema.parse(result);
}

async function importLibraryEntries(
  rawInput: ImportLibraryEntriesInput
): Promise<ImportLibraryEntriesResult> {
  const input = ImportLibraryEntriesInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_import_library_entries");
  return ImportLibraryEntriesResultSchema.parse(
    await invokeCommand<ImportLibraryEntriesResult>(
      createEnvelope("catalog.importLibraryEntries", input, {
        id,
        correlationId: id,
        context: { resourceId: input.libraryId }
      })
    )
  );
}

async function updateLibrary(
  rawInput: UpdateLibraryInput
): Promise<CatalogLibrary> {
  const input = UpdateLibraryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_update_library");
  return CatalogLibrarySchema.parse(
    await invokeCommand<CatalogLibrary>(
      createEnvelope("catalog.updateLibrary", input, {
        id,
        correlationId: id,
        context: { resourceId: input.libraryId }
      })
    )
  );
}

async function removeLibraryEntry(
  rawInput: RemoveLibraryEntryInput
): Promise<RemoveLibraryEntryResult> {
  const input = RemoveLibraryEntryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_remove_library_entry");
  return RemoveLibraryEntryResultSchema.parse(
    await invokeCommand<RemoveLibraryEntryResult>(
      createEnvelope("catalog.removeLibraryEntry", input, {
        id,
        correlationId: id,
        context: { resourceId: input.libraryId }
      })
    )
  );
}

async function moveLibraryEntry(
  rawInput: MoveLibraryEntryInput
): Promise<MoveLibraryEntryResult> {
  const input = MoveLibraryEntryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_move_library_entry");
  return MoveLibraryEntryResultSchema.parse(
    await invokeCommand<MoveLibraryEntryResult>(
      createEnvelope("catalog.moveLibraryEntry", input, {
        id,
        correlationId: id,
        context: { resourceId: input.targetLibraryId }
      })
    )
  );
}

async function unregisterProject(
  rawInput: UnregisterCatalogProjectInput
): Promise<UnregisterCatalogProjectResult> {
  const input = UnregisterCatalogProjectInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_unregister_project");
  return UnregisterCatalogProjectResultSchema.parse(
    await invokeCommand<UnregisterCatalogProjectResult>(
      createEnvelope("catalog.unregisterProject", input, {
        id,
        correlationId: id,
        context: { resourceId: input.projectId }
      })
    )
  );
}

async function deleteProject(
  rawInput: DeleteCatalogProjectInput
): Promise<DeleteCatalogProjectResult> {
  const input = DeleteCatalogProjectInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_delete_project");
  return DeleteCatalogProjectResultSchema.parse(
    await invokeCommand<DeleteCatalogProjectResult>(
      createEnvelope("catalog.deleteProject", input, {
        id,
        correlationId: id,
        context: { resourceId: input.projectId }
      })
    )
  );
}

async function duplicateProject(
  rawInput: DuplicateCatalogProjectInput
): Promise<DuplicateCatalogProjectResult> {
  const input = DuplicateCatalogProjectInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_duplicate_project");
  return DuplicateCatalogProjectResultSchema.parse(
    await invokeCommand<DuplicateCatalogProjectResult>(
      createEnvelope("catalog.duplicateProject", input, {
        id,
        correlationId: id,
        context: { resourceId: input.projectId }
      })
    )
  );
}

async function listWorkspaceAgents(
  workspaceType: "short"
): Promise<ShortWorkspaceAgentSettings>;
async function listWorkspaceAgents(
  workspaceType: "script"
): Promise<ScriptWorkspaceAgentSettings>;
async function listWorkspaceAgents(
  rawWorkspaceType: WorkspaceType
): Promise<WorkspaceAgentSettings>;
async function listWorkspaceAgents(
  rawWorkspaceType: WorkspaceType
): Promise<WorkspaceAgentSettings> {
  const workspaceType = WorkspaceTypeSchema.parse(rawWorkspaceType);
  const id = browserId("cmd_workspace_agents_list");
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope(
        "workspaceAgents.list",
        { workspaceType },
        { id, correlationId: id }
      )
    )
  );
}

async function listLongAgents(): Promise<LongAgentSettings> {
  const id = browserId("cmd_long_agents_list");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope("longAgents.list", {}, { id, correlationId: id })
    )
  );
}

async function saveLongAgents(
  rawSettings: LongAgentSettingsInput
): Promise<LongAgentSettings> {
  const settings = LongAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_long_agents_save");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope("longAgents.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function resetLongAgents(
  rawAgentId?: LongAgentId
): Promise<LongAgentSettings> {
  const agentId = rawAgentId ? LongAgentIdSchema.parse(rawAgentId) : undefined;
  const id = browserId("cmd_long_agents_reset");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope(
        "longAgents.reset",
        { ...(agentId ? { agentId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

async function saveWorkspaceAgents(
  rawSettings: ShortWorkspaceAgentSettingsInput
): Promise<ShortWorkspaceAgentSettings>;
async function saveWorkspaceAgents(
  rawSettings: ScriptWorkspaceAgentSettingsInput
): Promise<ScriptWorkspaceAgentSettings>;
async function saveWorkspaceAgents(
  rawSettings: WorkspaceAgentSettingsInput
): Promise<WorkspaceAgentSettings>;
async function saveWorkspaceAgents(
  rawSettings: WorkspaceAgentSettingsInput
): Promise<WorkspaceAgentSettings> {
  const settings = WorkspaceAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_workspace_agents_save");
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope("workspaceAgents.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function resetWorkspaceAgents(
  workspaceType: "short",
  rawAgentId?: ShortWorkspaceAgentId
): Promise<ShortWorkspaceAgentSettings>;
async function resetWorkspaceAgents(
  workspaceType: "script",
  rawAgentId?: ScriptWorkspaceAgentId
): Promise<ScriptWorkspaceAgentSettings>;
async function resetWorkspaceAgents(
  rawWorkspaceType: WorkspaceType,
  rawAgentId?: ShortWorkspaceAgentId | ScriptWorkspaceAgentId
): Promise<WorkspaceAgentSettings>;
async function resetWorkspaceAgents(
  rawWorkspaceType: WorkspaceType,
  rawAgentId?: ShortWorkspaceAgentId | ScriptWorkspaceAgentId
): Promise<WorkspaceAgentSettings> {
  const workspaceType = WorkspaceTypeSchema.parse(rawWorkspaceType);
  const agentId = rawAgentId
    ? workspaceType === "script"
      ? ScriptWorkspaceAgentIdSchema.parse(rawAgentId)
      : ShortWorkspaceAgentIdSchema.parse(rawAgentId)
    : undefined;
  const id = browserId("cmd_workspace_agents_reset");
  const payload =
    workspaceType === "script"
      ? {
          workspaceType,
          ...(agentId
            ? { agentId: ScriptWorkspaceAgentIdSchema.parse(agentId) }
            : {})
        }
      : {
          workspaceType,
          ...(agentId
            ? { agentId: ShortWorkspaceAgentIdSchema.parse(agentId) }
            : {})
        };
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope("workspaceAgents.reset", payload, {
        id,
        correlationId: id
      })
    )
  );
}

async function listLibraryAgents(): Promise<LibraryAgentSettings> {
  const id = browserId("cmd_library_agents_list");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope("libraryAgents.list", {}, { id, correlationId: id })
    )
  );
}

async function saveLibraryAgents(
  rawSettings: LibraryAgentSettingsInput
): Promise<LibraryAgentSettings> {
  const settings = LibraryAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_library_agents_save");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope("libraryAgents.save", settings, { id, correlationId: id })
    )
  );
}

async function resetLibraryAgents(
  rawDomain?: LibraryAgentDomain
): Promise<LibraryAgentSettings> {
  const domain = rawDomain
    ? LibraryAgentDomainSchema.parse(rawDomain)
    : undefined;
  const id = browserId("cmd_library_agents_reset");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope(
        "libraryAgents.reset",
        { ...(domain ? { domain } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

async function listLearningImitationSettings(): Promise<LearningImitationSettings> {
  const id = browserId("cmd_learning_imitation_settings_list");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope(
        "learningImitationSettings.list",
        {},
        { id, correlationId: id }
      )
    )
  );
}

async function saveLearningImitationSettings(
  rawSettings: LearningImitationSettingsInput
): Promise<LearningImitationSettings> {
  const settings = LearningImitationSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_learning_imitation_settings_save");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope("learningImitationSettings.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function resetLearningImitationSettings(
  rawStageId?: LearningImitationStageId
): Promise<LearningImitationSettings> {
  const stageId = rawStageId
    ? LearningImitationStageIdSchema.parse(rawStageId)
    : undefined;
  const id = browserId("cmd_learning_imitation_settings_reset");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope(
        "learningImitationSettings.reset",
        { ...(stageId ? { stageId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

async function chooseLongBookAnalysisSource(
  rawKind: LongBookAnalysisSourceKind
): Promise<LongBookAnalysisSource | null> {
  const kind = LongBookAnalysisSourceKindSchema.parse(rawKind);
  const id = browserId("cmd_long_book_analysis_choose_source");
  return LongBookAnalysisSourceSchema.nullable().parse(
    await invokeCommand<LongBookAnalysisSource | null>(
      createEnvelope(
        "longBookAnalysis.chooseSource",
        { kind },
        { id, correlationId: id }
      )
    )
  );
}

async function listLongBookAnalysisSources(): Promise<LongBookAnalysisSavedSourceCatalog> {
  const id = browserId("cmd_long_book_analysis_sources_list");
  return LongBookAnalysisSavedSourceCatalogSchema.parse(
    await invokeCommand<LongBookAnalysisSavedSourceCatalog>(
      createEnvelope(
        "longBookAnalysis.listSources",
        {},
        { id, correlationId: id }
      )
    )
  );
}

async function loadLongBookAnalysisSource(
  rawSourceId: string
): Promise<LongBookAnalysisSource> {
  const sourceId = LongBookAnalysisSavedSourceIdSchema.parse(rawSourceId);
  const id = browserId("cmd_long_book_analysis_source_load");
  return LongBookAnalysisSourceSchema.parse(
    await invokeCommand<LongBookAnalysisSource>(
      createEnvelope(
        "longBookAnalysis.loadSource",
        { sourceId },
        { id, correlationId: id }
      )
    )
  );
}

async function listLongBookAnalysisPresets(): Promise<LongBookAnalysisSettings> {
  const id = browserId("cmd_long_book_analysis_presets_list");
  return LongBookAnalysisSettingsSchema.parse(
    await invokeCommand<LongBookAnalysisSettings>(
      createEnvelope(
        "longBookAnalysisSettings.list",
        {},
        { id, correlationId: id }
      )
    )
  );
}

async function saveLongBookAnalysisPresets(
  rawSettings: LongBookAnalysisSettingsInput
): Promise<LongBookAnalysisSettings> {
  const settings = LongBookAnalysisSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_long_book_analysis_presets_save");
  return LongBookAnalysisSettingsSchema.parse(
    await invokeCommand<LongBookAnalysisSettings>(
      createEnvelope("longBookAnalysisSettings.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function resetLongBookAnalysisPresets(
  presetId?: string
): Promise<LongBookAnalysisSettings> {
  const id = browserId("cmd_long_book_analysis_presets_reset");
  return LongBookAnalysisSettingsSchema.parse(
    await invokeCommand<LongBookAnalysisSettings>(
      createEnvelope(
        "longBookAnalysisSettings.reset",
        { ...(presetId ? { presetId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

async function listWorkspaceDirectory(): Promise<WorkspaceDirectorySettings> {
  const id = browserId("cmd_workspace_directory_list");
  return WorkspaceDirectorySettingsSchema.parse(
    await invokeCommand<WorkspaceDirectorySettings>(
      createEnvelope("workspaceDirectory.list", {}, { id, correlationId: id })
    )
  );
}

async function chooseWorkspaceDirectory(): Promise<WorkspaceDirectorySettings | null> {
  const id = browserId("cmd_workspace_directory_choose");
  return WorkspaceDirectorySettingsSchema.nullable().parse(
    await invokeCommand<WorkspaceDirectorySettings | null>(
      createEnvelope("workspaceDirectory.choose", {}, { id, correlationId: id })
    )
  );
}

async function listGeneralSettings(): Promise<GeneralSettingsSnapshot> {
  const id = browserId("cmd_general_settings_list");
  return GeneralSettingsSnapshotSchema.parse(
    await invokeCommand<GeneralSettingsSnapshot>(
      createEnvelope("generalSettings.list", {}, { id, correlationId: id })
    )
  );
}

async function saveGeneralSettings(
  rawSettings: GeneralSettings
): Promise<GeneralSettingsSnapshot> {
  const settings = GeneralSettingsSchema.parse(rawSettings);
  const id = browserId("cmd_general_settings_save");
  return GeneralSettingsSnapshotSchema.parse(
    await invokeCommand<GeneralSettingsSnapshot>(
      createEnvelope("generalSettings.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function exportShortManuscript(
  rawInput: ExportShortManuscriptInput
): Promise<ExportShortManuscriptResult> {
  const input = ExportShortManuscriptInputSchema.parse(rawInput);
  const id = browserId("cmd_manuscript_export_short");
  return ExportShortManuscriptResultSchema.parse(
    await invokeCommand<ExportShortManuscriptResult>(
      createEnvelope("manuscript.exportShort", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function exportLongManuscript(
  rawInput: ExportLongManuscriptInput
): Promise<ExportLongManuscriptResult> {
  const input = ExportLongManuscriptInputSchema.parse(rawInput);
  const id = browserId("cmd_manuscript_export_long");
  return ExportLongManuscriptResultSchema.parse(
    await invokeCommand<ExportLongManuscriptResult>(
      createEnvelope("manuscript.exportLong", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function invokeMarketplace(rawRequest: unknown): Promise<unknown> {
  const request = MarketplaceIpcRequestSchema.parse(rawRequest);
  return ipcRenderer.invoke(
    MARKETPLACE_IPC_CHANNEL,
    request
  ) as Promise<unknown>;
}

const api: DeepWriteApi = {
  system: {
    health: getHealth
  },
  conversationPersistence,
  conversationExport,
  updates: {
    getState: getUpdateState,
    check: checkForUpdates,
    download: downloadUpdate,
    install: installUpdate,
    subscribe(listener: (state: UpdateState) => void): () => void {
      const handler = (
        _event: Electron.IpcRendererEvent,
        rawState: unknown
      ): void => {
        const parsed = UpdateStateSchema.safeParse(rawState);
        if (!parsed.success) {
          console.warn("DeepWrite discarded an invalid update state event.");
          return;
        }
        listener(parsed.data);
      };
      ipcRenderer.on(UPDATE_STATE_EVENT_CHANNEL, handler);
      return () =>
        ipcRenderer.removeListener(UPDATE_STATE_EVENT_CHANNEL, handler);
    }
  },
  appAlerts: {
    get: getAppAlerts,
    acknowledgeDesktop: acknowledgeDesktopAlert
  },
  marketplace: {
    async session() {
      return MarketplaceSessionSchema.parse(
        await invokeMarketplace({ operation: "session" })
      );
    },
    async register(input: MarketplaceRegisterInput) {
      return MarketplaceSessionSchema.parse(
        await invokeMarketplace({
          operation: "register",
          input: MarketplaceRegisterInputSchema.parse(input)
        })
      );
    },
    async login(input: MarketplaceLoginInput) {
      return MarketplaceSessionSchema.parse(
        await invokeMarketplace({
          operation: "login",
          input: MarketplaceLoginInputSchema.parse(input)
        })
      );
    },
    async logout() {
      return MarketplaceSessionSchema.parse(
        await invokeMarketplace({ operation: "logout" })
      );
    },
    async list(filter: MarketplaceListFilter = {}) {
      return MarketplaceContentPageSchema.parse(
        await invokeMarketplace({
          operation: "list",
          filter: MarketplaceListFilterSchema.parse(filter)
        })
      );
    },
    async detail(ref: MarketplaceContentRef) {
      return MarketplaceContentDetailSchema.parse(
        await invokeMarketplace({
          operation: "detail",
          ref: MarketplaceContentRefSchema.parse(ref)
        })
      );
    },
    async listMine(filter: MarketplaceListFilter = {}) {
      return MarketplaceContentPageSchema.parse(
        await invokeMarketplace({
          operation: "listMine",
          filter: MarketplaceListFilterSchema.parse(filter)
        })
      );
    },
    async myDetail(ref: MarketplaceContentRef) {
      return MarketplaceContentDetailSchema.parse(
        await invokeMarketplace({
          operation: "myDetail",
          ref: MarketplaceContentRefSchema.parse(ref)
        })
      );
    },
    async publish(input: MarketplacePublishInput) {
      return MarketplaceContentDetailSchema.parse(
        await invokeMarketplace({
          operation: "publish",
          input: MarketplacePublishInputSchema.parse(input)
        })
      );
    },
    async update(input: MarketplaceUpdateInput) {
      return MarketplaceContentDetailSchema.parse(
        await invokeMarketplace({
          operation: "update",
          input: MarketplaceUpdateInputSchema.parse(input)
        })
      );
    },
    async setEnabled(input: MarketplaceSetEnabledInput) {
      return MarketplaceContentSummarySchema.parse(
        await invokeMarketplace({
          operation: "setEnabled",
          input: MarketplaceSetEnabledInputSchema.parse(input)
        })
      );
    },
    async delete(ref: MarketplaceContentRef) {
      await invokeMarketplace({
        operation: "delete",
        ref: MarketplaceContentRefSchema.parse(ref)
      });
    },
    async like(input: MarketplaceLikeInput) {
      return MarketplaceLikeResultSchema.parse(
        await invokeMarketplace({
          operation: "like",
          input: MarketplaceLikeInputSchema.parse(input)
        })
      );
    },
    async previewInstall(ref: MarketplaceContentRef) {
      return MarketplaceInstallPreviewSchema.parse(
        await invokeMarketplace({
          operation: "previewInstall",
          ref: MarketplaceContentRefSchema.parse(ref)
        })
      );
    },
    async install(input: MarketplaceInstallInput) {
      return MarketplaceInstallResultSchema.parse(
        await invokeMarketplace({
          operation: "install",
          input: MarketplaceInstallInputSchema.parse(input)
        })
      );
    }
  },
  deviceSync,
  cloudBackup,
  catalog: {
    index: getCatalogIndex,
    readDocument: readCatalogDocument,
    readWritingContext,
    writeWritingContext,
    snapshot: getCatalogSnapshot,
    loadDraftRecovery,
    saveDraftRecovery,
    createShortBook,
    createScriptBook,
    createLibrary,
    updateLibrary,
    createLibraryGroup,
    openProject,
    importLegacyLibrary,
    updateBook,
    mutateCharacterStructure,
    mutatePlotStructure,
    updateLibraryGroup,
    deleteBook,
    saveDocument,
    createDraftSection,
    createDraftSections,
    deleteDraftSection,
    moveDraftSection,
    saveLibraryEntry,
    createLibraryEntry,
    chooseExternalLibraryEntries,
    importLibraryEntries,
    removeLibraryEntry,
    moveLibraryEntry,
    unregisterProject,
    deleteProject,
    duplicateProject
  },
  long,
  session: {
    prompt,
    abort,
    submitUserInput
  },
  models: sessionModels,
  modelUsage: {
    query: queryModelUsage
  },
  chatAssistantProjectConfig: {
    list: listChatAssistantProjectConfigs,
    get: getChatAssistantProjectConfig,
    save: saveChatAssistantProjectConfig,
    reset: resetChatAssistantProjectConfig
  },
  workspaceAgents: {
    list: listWorkspaceAgents,
    save: saveWorkspaceAgents,
    reset: resetWorkspaceAgents
  },
  longAgents: {
    list: listLongAgents,
    save: saveLongAgents,
    reset: resetLongAgents
  },
  agentTeams: {
    saveBuiltins: saveBuiltinSubagents,
    list: listAgentTeams,
    create: createAgentTeam,
    rename: renameAgentTeam,
    delete: deleteAgentTeam,
    setEnabled: setAgentTeamEnabled,
    save: saveAgentTeams,
    download: downloadAgentTeam,
    install: installAgentTeam
  },
  libraryAgents: {
    list: listLibraryAgents,
    save: saveLibraryAgents,
    reset: resetLibraryAgents
  },
  learningImitationSettings: {
    list: listLearningImitationSettings,
    save: saveLearningImitationSettings,
    reset: resetLearningImitationSettings
  },
  longBookAnalysis: {
    chooseSource: chooseLongBookAnalysisSource,
    sources: {
      list: listLongBookAnalysisSources,
      load: loadLongBookAnalysisSource
    },
    presets: {
      list: listLongBookAnalysisPresets,
      save: saveLongBookAnalysisPresets,
      reset: resetLongBookAnalysisPresets
    }
  },
  workspaceDirectory: {
    list: listWorkspaceDirectory,
    choose: chooseWorkspaceDirectory
  },
  appearance,
  generalSettings: {
    list: listGeneralSettings,
    save: saveGeneralSettings
  },
  manuscript: {
    exportLong: exportLongManuscript,
    exportShort: exportShortManuscript
  },
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void {
      const handler = (
        _event: Electron.IpcRendererEvent,
        rawEvent: unknown
      ): void => {
        const parsed = SystemEventEnvelopeSchema.safeParse(rawEvent);
        if (!parsed.success) {
          console.warn("DeepWrite discarded an invalid desktop event.");
          return;
        }
        listener(parsed.data as SystemEventEnvelope);
      };
      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    }
  }
};

contextBridge.exposeInMainWorld("deepwrite", api);
