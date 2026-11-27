import type { DocumentVersionsApi } from "./document-versions";
import type {
  LibraryStructureRequest,
  LibraryStructurePlan
} from "./library-structure";
import type {
  CreateUnboundEntryInput,
  CreateUnboundEntryResult
} from "./library-organization";
import type {
  ReorderLibraryInput,
  LibraryOrganization
} from "./library-organization";
import type {
  BookTemplatesApi,
  CreateBookFromTemplate
} from "./book-templates";
import type { WindowFrameApi } from "./window-frame";
import type {
  FeedbackImage,
  FeedbackImageTarget,
  FeedbackItem,
  FeedbackListFilter,
  FeedbackPage,
  FeedbackSubmitInput
} from "./feedback";
import type {
  MarketplaceEmailCodeInput,
  MarketplaceEmailCodeResult,
  MarketplaceBindEmailInput,
  MarketplaceEmailLoginInput
} from "./marketplace-email";
import type { TextContextMenuPreloadApi } from "./text-context-menu";
import type { ConversationExportApi } from "./conversation-export";
import type { LongPreloadApi } from "./long-preload-api";
import type { BuiltinSubagentSettings } from "./builtin-subagents";
import type {
  SessionAbortAcceptedPayload,
  SessionAbortCommandPayload,
  SessionUserInputResponseAcceptedPayload,
  SessionUserInputResponsePayload,
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload,
  SessionSteerAcceptedPayload,
  SessionSteerCommandPayload
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
  AgentTeamBookBindingInput,
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
import type { StorageSettingsApi } from "./storage-settings";
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
  ExportAcademicManuscriptInput,
  ExportAcademicManuscriptResult
} from "./academic-manuscript-export";
import type {
  ExportShortManuscriptInput,
  ExportShortManuscriptResult
} from "./short-manuscript-export";
import type {
  ExportLongManuscriptInput,
  ExportLongManuscriptResult
} from "./long-manuscript-export";
import type {
  LongBookAnalysisSavedSourceCatalog,
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
  CreateLibraryEntryInput,
  CreateDraftSectionInput,
  CreateDraftSectionsInput,
  CreateDraftSectionsResult,
  CreateLibraryGroupInput,
  CreateLibraryInput,
  UpdateLibraryInput,
  CreateScriptBookInput,
  CreateShortBookInput,
  CreateAcademicBookInput,
  CreateAcademicReferenceCardInput,
  CreateAcademicReferenceCardResult,
  CreativeBook,
  UpdateAcademicReferenceCardInput,
  UpdateAcademicReferenceCardResult,
  DeleteAcademicReferenceCardInput,
  DeleteAcademicReferenceCardResult,
  MutateAcademicFrameworkInput,
  MutateAcademicManuscriptInput,
  MutateAcademicManuscriptResult,
  AcademicBook,
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
  MutateCharacterStructureInput,
  MutatePlotStructureInput,
  UnregisterCatalogProjectInput,
  UnregisterCatalogProjectResult,
  UpdateBookInput,
  UpdateLibraryGroupInput
} from "./catalog";

import type {
  AcademicAgentId,
  AcademicAgentSettings,
  AcademicAgentSettingsInput
} from "./academic-agent-settings";
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
  MarketplaceMaterialDetail,
  MarketplaceMaterialFilter,
  MarketplaceMaterialInstallResult,
  MarketplaceMaterialRef,
  MarketplaceMaterialSummary
} from "./material-marketplace";
import type {
  AgentTeamMarketplaceDetail,
  AgentTeamMarketplaceInstallResult,
  AgentTeamMarketplaceLikeInput,
  AgentTeamMarketplaceListFilter,
  AgentTeamMarketplacePage,
  AgentTeamMarketplacePublishInput,
  AgentTeamMarketplaceSetEnabledInput,
  AgentTeamMarketplaceSummary,
  AgentTeamMarketplaceTarget,
  AgentTeamMarketplaceUpdateInput
} from "./agent-team-marketplace";
import type {
  CloudBackupApplyResult,
  CloudBackupPreview,
  CloudBackupStatus
} from "./cloud-backup";
import type { ConversationPersistenceApi } from "./renderer-state";

export interface DeepWriteApi extends TextContextMenuPreloadApi {
  voice: import("./voice").VoiceApi;
  bookImages: import("./book-images").BookImagesApi;
  bookIdentity: import("./book-identity").BookIdentityApi;
  longMaterialPack: import("./long-material-pack").LongMaterialPackApi;
  libraryPackage: import("./library-package").LibraryPackageApi;
  localBackup?: import("./local-backup").LocalBackupApi;
  imageModels: import("./image-models").ImageModelsApi;
  webSearch: import("./web-search").WebSearchApi;
  windowFrame?: WindowFrameApi;
  externalControl: import("./external-control/run-tools").ExternalControlPreloadApi;
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
    sendEmailCode(
      input: MarketplaceEmailCodeInput
    ): Promise<MarketplaceEmailCodeResult>;
    bindEmail(input: MarketplaceBindEmailInput): Promise<MarketplaceSession>;
    session(): Promise<MarketplaceSession>;
    register(input: MarketplaceRegisterInput): Promise<MarketplaceSession>;
    login(input: MarketplaceLoginInput): Promise<MarketplaceSession>;
    loginWithEmailCode(
      input: MarketplaceEmailLoginInput
    ): Promise<MarketplaceSession>;
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
    listMaterials(
      filter?: MarketplaceMaterialFilter
    ): Promise<MarketplaceMaterialSummary[]>;
    materialDetail(id: string): Promise<MarketplaceMaterialDetail>;
    installMaterial(
      ref: MarketplaceMaterialRef
    ): Promise<MarketplaceMaterialInstallResult>;
  };
  /** The signed-in user's feedback; sign-in goes through `marketplace`. */
  feedback: {
    list(filter?: FeedbackListFilter): Promise<FeedbackPage>;
    submit(input: FeedbackSubmitInput): Promise<FeedbackItem>;
    image(target: FeedbackImageTarget): Promise<FeedbackImage>;
    captureWindow(): Promise<FeedbackImage>;
  };
  /** Whole-team plaza; sign-in goes through `marketplace`. */
  agentTeamMarketplace: {
    list(
      filter?: AgentTeamMarketplaceListFilter
    ): Promise<AgentTeamMarketplacePage>;
    listMine(
      filter?: AgentTeamMarketplaceListFilter
    ): Promise<AgentTeamMarketplacePage>;
    detail(
      target: AgentTeamMarketplaceTarget
    ): Promise<AgentTeamMarketplaceDetail>;
    myDetail(
      target: AgentTeamMarketplaceTarget
    ): Promise<AgentTeamMarketplaceDetail>;
    publish(
      input: AgentTeamMarketplacePublishInput
    ): Promise<AgentTeamMarketplaceDetail>;
    update(
      input: AgentTeamMarketplaceUpdateInput
    ): Promise<AgentTeamMarketplaceDetail>;
    setEnabled(
      input: AgentTeamMarketplaceSetEnabledInput
    ): Promise<AgentTeamMarketplaceSummary>;
    delete(target: AgentTeamMarketplaceTarget): Promise<void>;
    like(input: AgentTeamMarketplaceLikeInput): Promise<MarketplaceLikeResult>;
    install(
      target: AgentTeamMarketplaceTarget
    ): Promise<AgentTeamMarketplaceInstallResult>;
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
  bookTemplates: BookTemplatesApi;
  catalog: {
    createBookFromTemplate: CreateBookFromTemplate;
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
    previewLibraryStructure(
      input: LibraryStructureRequest
    ): Promise<LibraryStructurePlan>;
    applyLibraryStructure(
      input: LibraryStructurePlan
    ): Promise<{ requestId: string; applied: true }>;
    createUnboundEntry(
      input: CreateUnboundEntryInput
    ): Promise<CreateUnboundEntryResult>;
    reorderLibrary(input: ReorderLibraryInput): Promise<LibraryOrganization>;
    snapshot(): Promise<CatalogSnapshot>;
    loadDraftRecovery(): Promise<CatalogDraftRecovery>;
    saveDraftRecovery(drafts: CatalogDraftRecovery): Promise<void>;
    createShortBook(input: CreateShortBookInput): Promise<ShortBook | null>;
    createScriptBook(input: CreateScriptBookInput): Promise<ScriptBook | null>;
    createAcademicBook(
      input: CreateAcademicBookInput
    ): Promise<AcademicBook | null>;
    createLibrary(input: CreateLibraryInput): Promise<CatalogLibrary | null>;
    updateLibrary(input: UpdateLibraryInput): Promise<CatalogLibrary>;
    createLibraryGroup(
      input: CreateLibraryGroupInput
    ): Promise<CatalogLibraryGroup | null>;
    openProject(
      domain: CatalogProjectDomain
    ): Promise<CatalogOpenProjectResult | null>;
    updateBook(input: UpdateBookInput): Promise<Book>;
    mutateCharacterStructure(
      input: MutateCharacterStructureInput
    ): Promise<CreativeBook>;
    mutatePlotStructure(input: MutatePlotStructureInput): Promise<CreativeBook>;
    mutateAcademicFramework(
      input: MutateAcademicFrameworkInput
    ): Promise<AcademicBook>;
    createAcademicReferenceCard(
      input: CreateAcademicReferenceCardInput
    ): Promise<CreateAcademicReferenceCardResult>;
    updateAcademicReferenceCard(
      input: UpdateAcademicReferenceCardInput
    ): Promise<UpdateAcademicReferenceCardResult>;
    deleteAcademicReferenceCard(
      input: DeleteAcademicReferenceCardInput
    ): Promise<DeleteAcademicReferenceCardResult>;
    mutateAcademicManuscript(
      input: MutateAcademicManuscriptInput
    ): Promise<MutateAcademicManuscriptResult>;
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
    ): Promise<DuplicateCatalogProjectResult | null>;
  };
  long: LongPreloadApi;
  versions: DocumentVersionsApi;
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
    /** Injects a message into the active run before its next model call. */
    steer(
      payload: SessionSteerCommandPayload
    ): Promise<SessionSteerAcceptedPayload>;
  };
  models: ModelPreloadApi;
  modelUsage: {
    query(input?: ModelUsageQueryInput): Promise<ModelUsageDashboard>;
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
  academicAgents: {
    list(): Promise<AcademicAgentSettings>;
    save(settings: AcademicAgentSettingsInput): Promise<AcademicAgentSettings>;
    reset(agentId?: AcademicAgentId): Promise<AcademicAgentSettings>;
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
    duplicate(
      input: AgentTeamProfileTargetInput
    ): Promise<AgentTeamCatalogSnapshot>;
    setEnabled(
      input: AgentTeamProfileSetEnabledInput
    ): Promise<AgentTeamCatalogSnapshot>;
    setBookBinding(
      input: AgentTeamBookBindingInput
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
  extrasAgents: import("./extras-agent").ExtrasAgentApi;
  longBookDecomposition: import("./long-book-decomposition/api").LongBookDecompositionApi;
  shortBookAnalysis: import("./short-book-analysis").ShortBookAnalysisApi;
  longBookAnalysis: {
    chooseSource(
      kind: LongBookAnalysisSourceKind
    ): Promise<LongBookAnalysisSource | null>;
    sources: {
      list(): Promise<LongBookAnalysisSavedSourceCatalog>;
      load(sourceId: string): Promise<LongBookAnalysisSource>;
      delete(sourceId: string): Promise<string>;
      save(
        input: import("./long-book-decomposition").SaveLongBookSourceInput
      ): Promise<LongBookAnalysisSource>;
      confirm(
        input: import("./long-book-decomposition").ConfirmLongBookSourceInput
      ): Promise<
        import("./long-book-decomposition").DecompositionSourceConfirmation
      >;
    };
  };
  workspaceDirectory: {
    list(): Promise<WorkspaceDirectorySettings>;
    choose(): Promise<WorkspaceDirectorySettings | null>;
  };
  storageSettings?: StorageSettingsApi;
  appearance: {
    list(): Promise<AppearanceSettingsSnapshot>;
    save(
      settings: AppearanceSettings,
      options?: { captureCurrentWindowSize?: boolean }
    ): Promise<AppearanceSettingsSnapshot>;
    fonts: {
      list(): Promise<AppearanceFontCatalogSnapshot>;
      install(): Promise<AppearanceFontInstallResult>;
      remove(id: AppearanceCustomFontId): Promise<AppearanceFontRemoveResult>;
    };
  };
  generalSettings: {
    list(): Promise<GeneralSettingsSnapshot>;
    save(settings: GeneralSettings): Promise<GeneralSettingsSnapshot>;
    openNotificationSettings(): Promise<void>;
  };
  manuscript: {
    exportAcademic(
      input: ExportAcademicManuscriptInput
    ): Promise<ExportAcademicManuscriptResult>;
    exportLong(
      input: ExportLongManuscriptInput
    ): Promise<ExportLongManuscriptResult>;
    exportShort(
      input: ExportShortManuscriptInput
    ): Promise<ExportShortManuscriptResult>;
  };
  mystery?: import("./mystery").MysteryPreloadApi;
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
