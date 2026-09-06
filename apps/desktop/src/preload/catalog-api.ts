import {
  BookSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogDraftSectionSchema,
  CatalogIndexSnapshotSchema,
  CatalogLibraryEntrySchema,
  CatalogLibraryGroupSchema,
  CatalogLibraryProjectDomainSchema,
  CatalogLibrarySchema,
  CatalogOpenProjectResultSchema,
  CatalogProjectDomainSchema,
  CatalogReadDocumentInputSchema,
  CatalogReadDocumentResultSchema,
  CatalogSnapshotSchema,
  CreateDraftSectionInputSchema,
  CreateDraftSectionsInputSchema,
  CreateDraftSectionsResultSchema,
  CreateLibraryEntryInputSchema,
  CreateLibraryGroupInputSchema,
  CreateLibraryInputSchema,
  CreateScriptBookInputSchema,
  CreateShortBookInputSchema,
  DeleteBookInputSchema,
  DeleteBookResultSchema,
  DeleteCatalogProjectInputSchema,
  DeleteCatalogProjectResultSchema,
  DeleteDraftSectionInputSchema,
  DeleteDraftSectionResultSchema,
  DuplicateCatalogProjectInputSchema,
  DuplicateCatalogProjectResultSchema,
  ExternalLibrarySelectionResultSchema,
  ExternalLibrarySourceKindSchema,
  ImportLibraryEntriesInputSchema,
  ImportLibraryEntriesResultSchema,
  ImportLegacyLibraryResultSchema,
  MoveDraftSectionInputSchema,
  MoveDraftSectionResultSchema,
  MoveLibraryEntryInputSchema,
  MoveLibraryEntryResultSchema,
  MutateCharacterStructureInputSchema,
  MutatePlotStructureInputSchema,
  RemoveLibraryEntryInputSchema,
  RemoveLibraryEntryResultSchema,
  SaveDocumentInputSchema,
  SaveDocumentResultSchema,
  SaveLibraryEntryInputSchema,
  ScriptBookSchema,
  ShortBookSchema,
  UnregisterCatalogProjectInputSchema,
  UnregisterCatalogProjectResultSchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  UpdateLibraryInputSchema,
  createEnvelope,
  type Book,
  type CatalogDraftRecovery,
  type CatalogDraftSection,
  type CatalogIndexSnapshot,
  type CatalogLibrary,
  type CatalogLibraryEntry,
  type CatalogLibraryGroup,
  type CatalogLibraryProjectDomain,
  type CatalogOpenProjectResult,
  type CatalogProjectDomain,
  type CatalogReadDocumentInput,
  type CatalogReadDocumentResult,
  type CatalogSnapshot,
  type CreateDraftSectionInput,
  type CreateDraftSectionsInput,
  type CreateDraftSectionsResult,
  type CreateLibraryEntryInput,
  type CreateLibraryGroupInput,
  type CreateLibraryInput,
  type CreateScriptBookInput,
  type CreateShortBookInput,
  type DeleteBookResult,
  type DeleteCatalogProjectInput,
  type DeleteCatalogProjectResult,
  type DeleteDraftSectionInput,
  type DeleteDraftSectionResult,
  type DuplicateCatalogProjectInput,
  type DuplicateCatalogProjectResult,
  type ExternalLibrarySelectionResult,
  type ExternalLibrarySourceKind,
  type ImportLibraryEntriesInput,
  type ImportLibraryEntriesResult,
  type ImportLegacyLibraryResult,
  type MoveDraftSectionInput,
  type MoveDraftSectionResult,
  type MoveLibraryEntryInput,
  type MoveLibraryEntryResult,
  type MutateCharacterStructureInput,
  type MutatePlotStructureInput,
  type RemoveLibraryEntryInput,
  type RemoveLibraryEntryResult,
  type SaveDocumentInput,
  type SaveDocumentResult,
  type SaveLibraryEntryInput,
  type ScriptBook,
  type ShortBook,
  type UnregisterCatalogProjectInput,
  type UnregisterCatalogProjectResult,
  type UpdateBookInput,
  type UpdateLibraryGroupInput,
  type UpdateLibraryInput
} from "@deepwrite/contracts";

import { browserId, invokeCommand } from "./invoke";

export async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  const id = browserId("cmd_catalog_snapshot");
  return CatalogSnapshotSchema.parse(
    await invokeCommand<CatalogSnapshot>(
      createEnvelope("catalog.snapshot", {}, { id, correlationId: id })
    )
  );
}
export async function getCatalogIndex(): Promise<CatalogIndexSnapshot> {
  const id = browserId("cmd_catalog_index");
  return CatalogIndexSnapshotSchema.parse(
    await invokeCommand<CatalogIndexSnapshot>(
      createEnvelope("catalog.index", {}, { id, correlationId: id })
    )
  );
}
export async function readCatalogDocument(
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
export async function loadDraftRecovery(): Promise<CatalogDraftRecovery> {
  const id = browserId("cmd_catalog_load_draft_recovery");
  return CatalogDraftRecoverySchema.parse(
    await invokeCommand<CatalogDraftRecovery>(
      createEnvelope("catalog.loadDraftRecovery", {}, { id, correlationId: id })
    )
  );
}
export async function saveDraftRecovery(
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
export async function createShortBook(
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
export async function createScriptBook(
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
export async function createLibrary(
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
export async function createLibraryGroup(
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
export async function openProject(
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
export async function importLegacyLibrary(
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
export async function updateBook(rawInput: UpdateBookInput): Promise<Book> {
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
export async function mutatePlotStructure(
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
export async function mutateCharacterStructure(
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
export async function updateLibraryGroup(
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
export async function deleteBook(bookId: string): Promise<DeleteBookResult> {
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
export async function saveDocument(
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
export async function createDraftSection(
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
export async function createDraftSections(
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
export async function deleteDraftSection(
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
export async function moveDraftSection(
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
export async function saveLibraryEntry(
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
export async function createLibraryEntry(
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
export async function chooseExternalLibraryEntries(
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

export async function importLibraryEntries(
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
export async function updateLibrary(
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
export async function removeLibraryEntry(
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
export async function moveLibraryEntry(
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
export async function unregisterProject(
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
export async function deleteProject(
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
export async function duplicateProject(
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
