import type { ConversationExportApi } from "./conversation-export";
import type { LongPreloadApi } from "./long-preload-api";
import type { BuiltinSubagentSettings } from "./builtin-subagents";
import type {
  SessionAbortAcceptedPayload,
  SessionAbortCommandPayload,
  SessionUserInputResponseAcceptedPayload,
  SessionUserInputResponsePayload,
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload
} from "./session";
import type { ModelPreloadApi } from "./model-preload-api";
import type { ModelUsageDashboard, ModelUsageQueryInput } from "./model-usage";
import type { SystemEventEnvelope, SystemHealthPayload } from "./system";
import type {
  WorkspaceAgentId,
  WorkspaceAgentSettings,
  WorkspaceAgentSettingsInput
} from "./workspace";
import type {
  AgentTeamCatalogSnapshot,
  AgentTeamPackageExportResult,
  AgentTeamPackageInstallResult,
  AgentTeamProfileCreateInput,
  AgentTeamProfileRenameInput,
  AgentTeamProfileSaveInput,
  AgentTeamProfileSetEnabledInput,
  AgentTeamProfileTargetInput
} from "./agent-team-catalog";
import type { WorkspaceType } from "./script-workspace";
import type {
  ReadWritingContextInput,
  ReadWritingContextResult,
  WriteWritingContextInput,
  WriteWritingContextResult
} from "./writing-context";
import type { WorkspaceDirectorySettings } from "./workspace-directory";
import type {
  AppearanceCustomFontId,
  AppearanceFontCatalogSnapshot,
  AppearanceFontInstallResult,
  AppearanceFontRemoveResult,
  AppearanceSettings,
  AppearanceSettingsSnapshot
} from "./appearance";
import type {
  GeneralSettings,
  GeneralSettingsSnapshot
} from "./general-settings";
import type {
  ExportShortManuscriptInput,
  ExportShortManuscriptResult
} from "./short-manuscript-export";
import type {
  ExportLongManuscriptInput,
  ExportLongManuscriptResult
} from "./long-manuscript-export";
import type {
  LearningImitationSettings,
  LearningImitationSettingsInput,
  LearningImitationStageId
} from "./learning-imitation";
import type {
  LongBookAnalysisSavedSourceCatalog,
  LongBookAnalysisSettings,
  LongBookAnalysisSettingsInput,
  LongBookAnalysisSource,
  LongBookAnalysisSourceKind
} from "./long-book-analysis";
import type {
  LibraryAgentDomain,
  LibraryAgentSettings,
  LibraryAgentSettingsInput
} from "./library-agent";
import type {
  CatalogDraftSection,
  CatalogDraftRecovery,
  CatalogLibrary,
  CatalogLibraryGroup,
  CatalogLibraryEntry,
  CatalogOpenProjectResult,
  CatalogProjectDomain,
  CatalogIndexSnapshot,
  CatalogReadDocumentInput,
  CatalogReadDocumentResult,
  CatalogSnapshot,
  CatalogLibraryProjectDomain,
  CreateLibraryEntryInput,
  CreateDraftSectionInput,
  CreateDraftSectionsInput,
  CreateDraftSectionsResult,
  CreateLibraryGroupInput,
  CreateLibraryInput,
  UpdateLibraryInput,
  CreateScriptBookInput,
  CreateShortBookInput,
  DeleteCatalogProjectInput,
  DeleteCatalogProjectResult,
  DuplicateCatalogProjectInput,
  DuplicateCatalogProjectResult,
  ExternalLibrarySelectionResult,
  ExternalLibrarySourceKind,
  ImportLibraryEntriesInput,
  ImportLibraryEntriesResult,
  DeleteBookResult,
  DeleteDraftSectionInput,
  DeleteDraftSectionResult,
  MoveDraftSectionInput,
  MoveDraftSectionResult,
  RemoveLibraryEntryInput,
  RemoveLibraryEntryResult,
  MoveLibraryEntryInput,
  MoveLibraryEntryResult,
  SaveDocumentInput,
  SaveDocumentResult,
  SaveLibraryEntryInput,
  ScriptBook,
  ShortBook,
  Book,
  ImportLegacyLibraryResult,
  MutateCharacterStructureInput,
  MutatePlotStructureInput,
  UnregisterCatalogProjectInput,
  UnregisterCatalogProjectResult,
  UpdateBookInput,
  UpdateLibraryGroupInput
} from "./catalog";

import type {
  LongAgentSettings,
  LongAgentSettingsInput
} from "./long-agent-settings";
import type { LongAgentId } from "./long-workspace";
import type { UpdateState } from "./update";
import type { AppAlertSnapshot } from "./app-alert";
import type {
  MarketplaceContentDetail,
  MarketplaceContentPage,
  MarketplaceContentRef,
  MarketplaceContentSummary,
  MarketplaceInstallInput,
  MarketplaceInstallPreview,
  MarketplaceInstallResult,
  MarketplaceLikeInput,
  MarketplaceLikeResult,
  MarketplaceListFilter,
  MarketplaceLoginInput,
  MarketplacePublishInput,
  MarketplaceRegisterInput,
  MarketplaceSetEnabledInput,
  MarketplaceSession,
  MarketplaceUpdateInput
} from "./marketplace";
import type {
  CloudBackupApplyResult,
  CloudBackupPreview,
  CloudBackupStatus
} from "./cloud-backup";
import type { ConversationPersistenceApi } from "./renderer-state";
import type {
  ChatAssistantProjectConfig,
  ChatAssistantProjectRef
} from "./chat-assistant";

export interface DeepWriteApi {
  system: {
    health(): Promise<SystemHealthPayload>;
  };
  conversationPersistence?: ConversationPersistenceApi;
  conversationExport?: ConversationExportApi;
  updates: {
    getState(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    install(): Promise<void>;
    subscribe(listener: (state: UpdateState) => void): () => void;
  };
  appAlerts: {
    get(): Promise<AppAlertSnapshot>;
    acknowledgeDesktop(revision: string): Promise<void>;
  };
  marketplace: {
    session(): Promise<MarketplaceSession>;
    register(input: MarketplaceRegisterInput): Promise<MarketplaceSession>;
    login(input: MarketplaceLoginInput): Promise<MarketplaceSession>;
    logout(): Promise<MarketplaceSession>;
    list(filter?: MarketplaceListFilter): Promise<MarketplaceContentPage>;
    detail(ref: MarketplaceContentRef): Promise<MarketplaceContentDetail>;
    listMine(filter?: MarketplaceListFilter): Promise<MarketplaceContentPage>;
    myDetail(ref: MarketplaceContentRef): Promise<MarketplaceContentDetail>;
    publish(input: MarketplacePublishInput): Promise<MarketplaceContentDetail>;
    update(input: MarketplaceUpdateInput): Promise<MarketplaceContentDetail>;
    setEnabled(
      input: MarketplaceSetEnabledInput
    ): Promise<MarketplaceContentSummary>;
    delete(ref: MarketplaceContentRef): Promise<void>;
    like(input: MarketplaceLikeInput): Promise<MarketplaceLikeResult>;
    previewInstall(
      ref: MarketplaceContentRef
    ): Promise<MarketplaceInstallPreview>;
    install(input: MarketplaceInstallInput): Promise<MarketplaceInstallResult>;
  };
  deviceSync?: {
    request(
      input: import("./device-sync").SyncRequest
    ): Promise<import("./device-sync").SyncResponse>;
  };
  cloudBackup: {
    status(): Promise<CloudBackupStatus>;
    previewBackup(): Promise<CloudBackupPreview>;
    applyBackup(previewId: string): Promise<CloudBackupApplyResult>;
    previewRestore(machineKey: string): Promise<CloudBackupPreview>;
    applyRestore(previewId: string): Promise<CloudBackupApplyResult>;
  };
  catalog: {
    index(): Promise<CatalogIndexSnapshot>;
    readDocument(
      input: CatalogReadDocumentInput
    ): Promise<CatalogReadDocumentResult>;
    readWritingContext(
      input: ReadWritingContextInput
    ): Promise<ReadWritingContextResult>;
    writeWritingContext(
      input: WriteWritingContextInput
    ): Promise<WriteWritingContextResult>;
    snapshot(): Promise<CatalogSnapshot>;
    loadDraftRecovery(): Promise<CatalogDraftRecovery>;
    saveDraftRecovery(drafts: CatalogDraftRecovery): Promise<void>;
    createShortBook(input: CreateShortBookInput): Promise<ShortBook | null>;
    createScriptBook(input: CreateScriptBookInput): Promise<ScriptBook | null>;
    createLibrary(input: CreateLibraryInput): Promise<CatalogLibrary | null>;
    updateLibrary(input: UpdateLibraryInput): Promise<CatalogLibrary>;
    createLibraryGroup(
      input: CreateLibraryGroupInput
    ): Promise<CatalogLibraryGroup | null>;
    openProject(
      domain: CatalogProjectDomain
    ): Promise<CatalogOpenProjectResult | null>;
    importLegacyLibrary(
      domain: CatalogLibraryProjectDomain
    ): Promise<ImportLegacyLibraryResult | null>;
    updateBook(input: UpdateBookInput): Promise<Book>;
    mutateCharacterStructure(
      input: MutateCharacterStructureInput
    ): Promise<Book>;
    mutatePlotStructure(input: MutatePlotStructureInput): Promise<Book>;
    updateLibraryGroup(
      input: UpdateLibraryGroupInput
    ): Promise<CatalogLibraryGroup>;
    deleteBook(bookId: string): Promise<DeleteBookResult>;
    saveDocument(input: SaveDocumentInput): Promise<SaveDocumentResult>;
    createDraftSection(
      input: CreateDraftSectionInput
    ): Promise<CatalogDraftSection>;
    createDraftSections(
      input: CreateDraftSectionsInput
    ): Promise<CreateDraftSectionsResult>;
    deleteDraftSection(
      input: DeleteDraftSectionInput
    ): Promise<DeleteDraftSectionResult>;
    moveDraftSection(
      input: MoveDraftSectionInput
    ): Promise<MoveDraftSectionResult>;
    saveLibraryEntry(
      input: SaveLibraryEntryInput
    ): Promise<CatalogLibraryEntry>;
    createLibraryEntry(
      input: CreateLibraryEntryInput
    ): Promise<CatalogLibraryEntry>;
    chooseExternalLibraryEntries(
      sourceKind: ExternalLibrarySourceKind
    ): Promise<ExternalLibrarySelectionResult | null>;
    importLibraryEntries(
      input: ImportLibraryEntriesInput
    ): Promise<ImportLibraryEntriesResult>;
    removeLibraryEntry(
      input: RemoveLibraryEntryInput
    ): Promise<RemoveLibraryEntryResult>;
    moveLibraryEntry(
      input: MoveLibraryEntryInput
    ): Promise<MoveLibraryEntryResult>;
    unregisterProject(
      input: UnregisterCatalogProjectInput
    ): Promise<UnregisterCatalogProjectResult>;
    deleteProject(
      input: DeleteCatalogProjectInput
    ): Promise<DeleteCatalogProjectResult>;
    duplicateProject(
      input: DuplicateCatalogProjectInput
    ): Promise<DuplicateCatalogProjectResult>;
  };
  long: LongPreloadApi;
  session: {
    prompt(
      payload: SessionPromptCommandPayload
    ): Promise<SessionPromptAcceptedPayload>;
    abort(
      payload: SessionAbortCommandPayload
    ): Promise<SessionAbortAcceptedPayload>;
    submitUserInput(
      payload: SessionUserInputResponsePayload
    ): Promise<SessionUserInputResponseAcceptedPayload>;
  };
  models: ModelPreloadApi;
  modelUsage: {
    query(input?: ModelUsageQueryInput): Promise<ModelUsageDashboard>;
  };
  chatAssistantProjectConfig?: {
    list(): Promise<ChatAssistantProjectRef[]>;
    get(project: ChatAssistantProjectRef): Promise<ChatAssistantProjectConfig>;
    save(
      project: ChatAssistantProjectRef,
      systemPrompt: string
    ): Promise<ChatAssistantProjectConfig>;
    reset(
      project: ChatAssistantProjectRef
    ): Promise<ChatAssistantProjectConfig>;
  };
  workspaceAgents: {
    list(workspaceType: WorkspaceType): Promise<WorkspaceAgentSettings>;
    save(
      settings: WorkspaceAgentSettingsInput
    ): Promise<WorkspaceAgentSettings>;
    reset(
      workspaceType: WorkspaceType,
      agentId?: WorkspaceAgentId
    ): Promise<WorkspaceAgentSettings>;
  };
  longAgents: {
    list(): Promise<LongAgentSettings>;
    save(settings: LongAgentSettingsInput): Promise<LongAgentSettings>;
    reset(agentId?: LongAgentId): Promise<LongAgentSettings>;
  };
  agentTeams: {
    saveBuiltins(
      input: BuiltinSubagentSettings
    ): Promise<AgentTeamCatalogSnapshot>;
    list(): Promise<AgentTeamCatalogSnapshot>;
    create(
      input: AgentTeamProfileCreateInput
    ): Promise<AgentTeamCatalogSnapshot>;
    rename(
      input: AgentTeamProfileRenameInput
    ): Promise<AgentTeamCatalogSnapshot>;
    delete(
      input: AgentTeamProfileTargetInput
    ): Promise<AgentTeamCatalogSnapshot>;
    setEnabled(
      input: AgentTeamProfileSetEnabledInput
    ): Promise<AgentTeamCatalogSnapshot>;
    save(input: AgentTeamProfileSaveInput): Promise<AgentTeamCatalogSnapshot>;
    download(
      input: AgentTeamProfileTargetInput
    ): Promise<AgentTeamPackageExportResult>;
    install(): Promise<AgentTeamPackageInstallResult>;
  };
  libraryAgents: {
    list(): Promise<LibraryAgentSettings>;
    save(settings: LibraryAgentSettingsInput): Promise<LibraryAgentSettings>;
    reset(domain?: LibraryAgentDomain): Promise<LibraryAgentSettings>;
  };
  learningImitationSettings: {
    list(): Promise<LearningImitationSettings>;
    save(
      settings: LearningImitationSettingsInput
    ): Promise<LearningImitationSettings>;
    reset(
      stageId?: LearningImitationStageId
    ): Promise<LearningImitationSettings>;
  };
  longBookAnalysis: {
    chooseSource(
      kind: LongBookAnalysisSourceKind
    ): Promise<LongBookAnalysisSource | null>;
    sources: {
      list(): Promise<LongBookAnalysisSavedSourceCatalog>;
      load(sourceId: string): Promise<LongBookAnalysisSource>;
    };
    presets: {
      list(): Promise<LongBookAnalysisSettings>;
      save(
        settings: LongBookAnalysisSettingsInput
      ): Promise<LongBookAnalysisSettings>;
      reset(presetId?: string): Promise<LongBookAnalysisSettings>;
    };
  };
  workspaceDirectory: {
    list(): Promise<WorkspaceDirectorySettings>;
    choose(): Promise<WorkspaceDirectorySettings | null>;
  };
  appearance: {
    list(): Promise<AppearanceSettingsSnapshot>;
    save(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>;
    fonts: {
      list(): Promise<AppearanceFontCatalogSnapshot>;
      install(): Promise<AppearanceFontInstallResult>;
      remove(id: AppearanceCustomFontId): Promise<AppearanceFontRemoveResult>;
    };
  };
  generalSettings: {
    list(): Promise<GeneralSettingsSnapshot>;
    save(settings: GeneralSettings): Promise<GeneralSettingsSnapshot>;
  };
  manuscript: {
    exportLong(
      input: ExportLongManuscriptInput
    ): Promise<ExportLongManuscriptResult>;
    exportShort(
      input: ExportShortManuscriptInput
    ): Promise<ExportShortManuscriptResult>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
