import { contextBridge, ipcRenderer } from "electron";
import {
  CatalogDocumentSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogLibrarySchema,
  CatalogLibraryEntrySchema,
  CatalogLibraryProjectDomainSchema,
  CatalogOpenProjectResultSchema,
  CatalogProjectDomainSchema,
  CatalogSnapshotSchema,
  CommandResultSchema,
  CreateLibraryEntryInputSchema,
  CreateLibraryInputSchema,
  CreateShortBookInputSchema,
  DeleteBookInputSchema,
  DeleteBookResultSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  ModelConnectionTestResultSchema,
  ModelConfigInputSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  RemoveLibraryEntryInputSchema,
  RemoveLibraryEntryResultSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionAbortCommandPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  SessionPromptCommandPayloadSchema,
  SaveDocumentInputSchema,
  SaveLibraryEntryInputSchema,
  ShortBookSchema,
  ShortWorkspaceAgentIdSchema,
  ShortWorkspaceAgentSettingsInputSchema,
  ShortWorkspaceAgentSettingsSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  UnregisterCatalogProjectInputSchema,
  UnregisterCatalogProjectResultSchema,
  WorkspaceDirectorySettingsSchema,
  UpdateBookInputSchema,
  createEnvelope,
  type CommandEnvelope,
  type CatalogDocument,
  type CatalogDraftRecovery,
  type CatalogLibrary,
  type CatalogLibraryEntry,
  type CatalogLibraryProjectDomain,
  type CatalogOpenProjectResult,
  type CatalogProjectDomain,
  type CatalogSnapshot,
  type CreateLibraryEntryInput,
  type CreateLibraryInput,
  type CreateShortBookInput,
  type DeepWriteApi,
  type DeleteBookResult,
  type ModelConnectionTestResult,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type RemoveLibraryEntryInput,
  type RemoveLibraryEntryResult,
  type SessionAbortAcceptedPayload,
  type SessionAbortCommandPayload,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload,
  type SaveDocumentInput,
  type SaveLibraryEntryInput,
  type ShortBook,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput,
  type SystemEventEnvelope,
  type SystemHealthPayload,
  type UnregisterCatalogProjectInput,
  type UnregisterCatalogProjectResult,
  type UpdateBookInput,
  type WorkspaceDirectorySettings
} from "@deepwrite/contracts";

function browserId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

async function invokeCommand<TPayload>(command: CommandEnvelope): Promise<TPayload> {
  const result = CommandResultSchema.parse(
    await ipcRenderer.invoke(IPC_COMMAND_CHANNEL, command)
  );
  if (result.requestId !== command.id) {
    throw new Error("IPC result requestId does not match command id.");
  }
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.payload as TPayload;
}

async function getHealth(): Promise<SystemHealthPayload> {
  const id = browserId("cmd_health");
  return SystemHealthPayloadSchema.parse(
    await invokeCommand<SystemHealthPayload>(
      createEnvelope("system.health", {}, { id, correlationId: id })
    )
  );
}

async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  const id = browserId("cmd_catalog_snapshot");
  return CatalogSnapshotSchema.parse(
    await invokeCommand<CatalogSnapshot>(
      createEnvelope("catalog.snapshot", {}, { id, correlationId: id })
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

async function openProject(
  rawDomain: CatalogProjectDomain
): Promise<CatalogOpenProjectResult | null> {
  const domain = CatalogProjectDomainSchema.parse(rawDomain);
  const id = browserId("cmd_catalog_open_project");
  return CatalogOpenProjectResultSchema.nullable().parse(
    await invokeCommand<CatalogOpenProjectResult | null>(
      createEnvelope("catalog.openProject", { domain }, {
        id,
        correlationId: id
      })
    )
  );
}

async function importLegacyBook(): Promise<ShortBook | null> {
  const id = browserId("cmd_catalog_import_legacy_book");
  return ShortBookSchema.nullable().parse(
    await invokeCommand<ShortBook | null>(
      createEnvelope("catalog.importLegacyBook", {}, { id, correlationId: id })
    )
  );
}

async function importLegacyLibrary(
  rawDomain: CatalogLibraryProjectDomain
): Promise<CatalogLibrary | null> {
  const domain = CatalogLibraryProjectDomainSchema.parse(rawDomain);
  const id = browserId("cmd_catalog_import_legacy_library");
  return CatalogLibrarySchema.nullable().parse(
    await invokeCommand<CatalogLibrary | null>(
      createEnvelope(
        "catalog.importLegacyLibrary",
        { domain },
        { id, correlationId: id }
      )
    )
  );
}

async function updateBook(rawInput: UpdateBookInput): Promise<ShortBook> {
  const input = UpdateBookInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_update_book");
  return ShortBookSchema.parse(
    await invokeCommand<ShortBook>(
      createEnvelope("catalog.updateBook", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
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
): Promise<CatalogDocument> {
  const input = SaveDocumentInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_save_document");
  return CatalogDocumentSchema.parse(
    await invokeCommand<CatalogDocument>(
      createEnvelope("catalog.saveDocument", input, {
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

async function prompt(
  rawPayload: SessionPromptCommandPayload
): Promise<SessionPromptAcceptedPayload> {
  const payload = SessionPromptCommandPayloadSchema.parse(rawPayload);
  const id = browserId("cmd_prompt");
  const resourceId = payload.workspaceContext?.activeResource?.id;
  const accepted = SessionPromptAcceptedPayloadSchema.parse(
    await invokeCommand<SessionPromptAcceptedPayload>(
      createEnvelope("session.prompt", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          ...(resourceId ? { resourceId } : {})
        }
      })
    )
  );
  if (accepted.sessionId !== payload.sessionId) {
    throw new Error("Agent acceptance sessionId does not match the prompt request.");
  }
  return accepted;
}

async function abort(
  rawPayload: SessionAbortCommandPayload
): Promise<SessionAbortAcceptedPayload> {
  const payload = SessionAbortCommandPayloadSchema.parse(rawPayload);
  const id = browserId("cmd_abort");
  return SessionAbortAcceptedPayloadSchema.parse(
    await invokeCommand<SessionAbortAcceptedPayload>(
      createEnvelope("session.abort", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          runId: payload.runId
        }
      })
    )
  );
}

async function listModels(): Promise<ModelSettings> {
  const id = browserId("cmd_models_list");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.list", {}, { id, correlationId: id })
    )
  );
}

async function saveModels(rawSettings: ModelSettingsInput): Promise<ModelSettings> {
  const settings = ModelSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_models_save");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.save", settings, { id, correlationId: id })
    )
  );
}

async function testModel(rawModel: ModelConfigInput): Promise<ModelConnectionTestResult> {
  const model = ModelConfigInputSchema.parse(rawModel);
  const id = browserId("cmd_models_test");
  return ModelConnectionTestResultSchema.parse(
    await invokeCommand<ModelConnectionTestResult>(
      createEnvelope("models.test", { model }, { id, correlationId: id })
    )
  );
}

async function listWorkspaceAgents(
  workspaceType: "short"
): Promise<ShortWorkspaceAgentSettings> {
  const id = browserId("cmd_workspace_agents_list");
  return ShortWorkspaceAgentSettingsSchema.parse(
    await invokeCommand<ShortWorkspaceAgentSettings>(
      createEnvelope(
        "workspaceAgents.list",
        { workspaceType },
        { id, correlationId: id }
      )
    )
  );
}

async function saveWorkspaceAgents(
  rawSettings: ShortWorkspaceAgentSettingsInput
): Promise<ShortWorkspaceAgentSettings> {
  const settings = ShortWorkspaceAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_workspace_agents_save");
  return ShortWorkspaceAgentSettingsSchema.parse(
    await invokeCommand<ShortWorkspaceAgentSettings>(
      createEnvelope("workspaceAgents.save", settings, { id, correlationId: id })
    )
  );
}

async function resetWorkspaceAgents(
  workspaceType: "short",
  rawAgentId?: ShortWorkspaceAgentId
): Promise<ShortWorkspaceAgentSettings> {
  const agentId = rawAgentId
    ? ShortWorkspaceAgentIdSchema.parse(rawAgentId)
    : undefined;
  const id = browserId("cmd_workspace_agents_reset");
  return ShortWorkspaceAgentSettingsSchema.parse(
    await invokeCommand<ShortWorkspaceAgentSettings>(
      createEnvelope(
        "workspaceAgents.reset",
        { workspaceType, ...(agentId ? { agentId } : {}) },
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

const api: DeepWriteApi = {
  system: {
    health: getHealth
  },
  catalog: {
    snapshot: getCatalogSnapshot,
    loadDraftRecovery,
    saveDraftRecovery,
    createShortBook,
    createLibrary,
    openProject,
    importLegacyBook,
    importLegacyLibrary,
    updateBook,
    deleteBook,
    saveDocument,
    saveLibraryEntry,
    createLibraryEntry,
    removeLibraryEntry,
    unregisterProject
  },
  session: {
    prompt,
    abort
  },
  models: {
    list: listModels,
    save: saveModels,
    test: testModel
  },
  workspaceAgents: {
    list: listWorkspaceAgents,
    save: saveWorkspaceAgents,
    reset: resetWorkspaceAgents
  },
  workspaceDirectory: {
    list: listWorkspaceDirectory,
    choose: chooseWorkspaceDirectory
  },
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown): void => {
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
