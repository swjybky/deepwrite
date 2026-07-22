import type {
  SessionAbortAcceptedPayload,
  SessionAbortCommandPayload,
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload
} from "./session";
import type {
  ModelConnectionTestResult,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput
} from "./models";
import type { SystemEventEnvelope, SystemHealthPayload } from "./system";
import type {
  ShortWorkspaceAgentId,
  ShortWorkspaceAgentSettings,
  ShortWorkspaceAgentSettingsInput
} from "./workspace";
import type { WorkspaceDirectorySettings } from "./workspace-directory";
import type {
  CatalogDocument,
  CatalogDraftRecovery,
  CatalogLibrary,
  CatalogLibraryGroup,
  CatalogLibraryEntry,
  CatalogOpenProjectResult,
  CatalogProjectDomain,
  CatalogSnapshot,
  CatalogLibraryProjectDomain,
  CreateLibraryEntryInput,
  CreateLibraryGroupInput,
  CreateLibraryInput,
  CreateShortBookInput,
  DeleteCatalogProjectInput,
  DeleteCatalogProjectResult,
  DeleteBookResult,
  RemoveLibraryEntryInput,
  RemoveLibraryEntryResult,
  SaveDocumentInput,
  SaveLibraryEntryInput,
  ShortBook,
  ImportLegacyLibraryResult,
  UnregisterCatalogProjectInput,
  UnregisterCatalogProjectResult,
  UpdateBookInput,
  UpdateLibraryGroupInput
} from "./catalog";

export interface DeepWriteApi {
  system: {
    health(): Promise<SystemHealthPayload>;
  };
  catalog: {
    snapshot(): Promise<CatalogSnapshot>;
    loadDraftRecovery(): Promise<CatalogDraftRecovery>;
    saveDraftRecovery(drafts: CatalogDraftRecovery): Promise<void>;
    createShortBook(input: CreateShortBookInput): Promise<ShortBook | null>;
    createLibrary(input: CreateLibraryInput): Promise<CatalogLibrary | null>;
    createLibraryGroup(input: CreateLibraryGroupInput): Promise<CatalogLibraryGroup | null>;
    openProject(domain: CatalogProjectDomain): Promise<CatalogOpenProjectResult | null>;
    importLegacyBook(): Promise<ShortBook | null>;
    importLegacyLibrary(
      domain: CatalogLibraryProjectDomain
    ): Promise<ImportLegacyLibraryResult | null>;
    updateBook(input: UpdateBookInput): Promise<ShortBook>;
    updateLibraryGroup(input: UpdateLibraryGroupInput): Promise<CatalogLibraryGroup>;
    deleteBook(bookId: string): Promise<DeleteBookResult>;
    saveDocument(input: SaveDocumentInput): Promise<CatalogDocument>;
    saveLibraryEntry(input: SaveLibraryEntryInput): Promise<CatalogLibraryEntry>;
    createLibraryEntry(input: CreateLibraryEntryInput): Promise<CatalogLibraryEntry>;
    removeLibraryEntry(input: RemoveLibraryEntryInput): Promise<RemoveLibraryEntryResult>;
    unregisterProject(
      input: UnregisterCatalogProjectInput
    ): Promise<UnregisterCatalogProjectResult>;
    deleteProject(
      input: DeleteCatalogProjectInput
    ): Promise<DeleteCatalogProjectResult>;
  };
  session: {
    prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload>;
    abort(payload: SessionAbortCommandPayload): Promise<SessionAbortAcceptedPayload>;
  };
  models: {
    list(): Promise<ModelSettings>;
    save(settings: ModelSettingsInput): Promise<ModelSettings>;
    test(model: ModelConfigInput): Promise<ModelConnectionTestResult>;
  };
  workspaceAgents: {
    list(workspaceType: "short"): Promise<ShortWorkspaceAgentSettings>;
    save(settings: ShortWorkspaceAgentSettingsInput): Promise<ShortWorkspaceAgentSettings>;
    reset(
      workspaceType: "short",
      agentId?: ShortWorkspaceAgentId
    ): Promise<ShortWorkspaceAgentSettings>;
  };
  workspaceDirectory: {
    list(): Promise<WorkspaceDirectorySettings>;
    choose(): Promise<WorkspaceDirectorySettings | null>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
