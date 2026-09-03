import {
  SaveDocumentResultSchema,
  CatalogDraftSectionSchema,
  CreateDraftSectionsResultSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogLibrarySchema,
  CatalogLibraryGroupSchema,
  CatalogLibraryEntrySchema,
  CatalogOpenProjectResultSchema,
  CatalogIndexSnapshotSchema,
  CatalogReadDocumentResultSchema,
  ReadWritingContextResultSchema,
  CatalogSnapshotSchema,
  BookSchema,
  DeleteCatalogProjectResultSchema,
  DeleteBookResultSchema,
  DeleteDraftSectionResultSchema,
  MoveDraftSectionResultSchema,
  DuplicateCatalogProjectResultSchema,
  CatalogInstallMarketplaceSkillContentResultSchema,
  RemoveLibraryEntryResultSchema,
  MoveLibraryEntryResultSchema,
  ScriptBookSchema,
  ShortBookSchema,
  LongApplyOperationsResultSchema,
  LongApplyLegacySyncResultSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitResultSchema,
  LongImportPortableResultSchema,
  LongImportContinuationResultSchema,
  LongWorkspaceOperationError,
  LongPreviewContinuationImportAtPathResultSchema,
  LongPreviewLegacySyncAtPathResultSchema,
  LongListBooksResultSchema,
  LongOpenBookResultSchema,
  LongPreviewOperationsResultSchema,
  LongReadDocumentResultSchema,
  LongReadAgentsMdResultSchema,
  LongRemoveBookResultSchema,
  LongSearchResultSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentResultSchema,
  LongWriteAgentsMdResultSchema,
  RendererStateLoadResultSchema,
  RendererStateMutationResultSchema,
  UnregisterCatalogProjectResultSchema,
  WriteWritingContextResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { existsSync } from "node:fs";
import { CatalogStore } from "./catalog-store";
import {
  FolderCatalogConflictError,
  FolderCatalogStore
} from "./folder-catalog-store";
import { readLegacyLibraryArchive } from "./legacy-library-import";
import { bootUtility } from "./runtime";
import { LongWorkspaceService } from "./long-workspace-service";
import { RendererStateStore } from "./renderer-state-store";

const userDataPath = process.env.DEEPWRITE_USER_DATA_PATH?.trim();
if (!userDataPath) {
  throw new Error("Core Utility requires DEEPWRITE_USER_DATA_PATH.");
}
const resolvedUserDataPath = userDataPath;

function legacyDataRootsFromEnvironment(): string[] {
  const encodedRoots = process.env.DEEPWRITE_LEGACY_DATA_ROOTS?.trim();
  if (encodedRoots) {
    try {
      const parsed = JSON.parse(encodedRoots) as unknown;
      if (Array.isArray(parsed)) {
        const roots = parsed.filter(
          (value): value is string =>
            typeof value === "string" && value.trim() !== ""
        );
        if (roots.length > 0) {
          return roots;
        }
      }
    } catch {
      // Fall back to the single-root environment variable for older launchers.
    }
  }
  const legacyDataRoot = process.env.DEEPWRITE_LEGACY_DATA_ROOT?.trim();
  return legacyDataRoot ? [legacyDataRoot] : [];
}

const legacyDataRoots = legacyDataRootsFromEnvironment();
const legacyCatalogStore = new CatalogStore({
  userDataPath: resolvedUserDataPath,
  ...(legacyDataRoots.length > 0 ? { legacyDataRoots } : {})
});
let catalogStoreInitialization: Promise<FolderCatalogStore> | undefined;
const draftRecoveryStore = new FolderCatalogStore({
  userDataPath: resolvedUserDataPath
});
const longWorkspaceService = new LongWorkspaceService({
  userDataPath: resolvedUserDataPath
});
const rendererStateStore = new RendererStateStore(resolvedUserDataPath);

async function requireCatalogStore(): Promise<FolderCatalogStore> {
  if (!catalogStoreInitialization) {
    const initialization = (async () => {
      const existingFolderStore = new FolderCatalogStore({
        userDataPath: resolvedUserDataPath
      });
      if (existsSync(existingFolderStore.registryPath)) {
        await existingFolderStore.indexSnapshot();
        return existingFolderStore;
      }
      const legacySnapshot = await legacyCatalogStore.snapshot();
      const folderStore = new FolderCatalogStore({
        userDataPath: resolvedUserDataPath,
        initialSnapshot: legacySnapshot
      });
      await folderStore.indexSnapshot();
      return folderStore;
    })();
    catalogStoreInitialization = initialization.catch((error: unknown) => {
      catalogStoreInitialization = undefined;
      throw error;
    });
  }
  return await catalogStoreInitialization;
}

async function handleCatalogCommand(
  command: CommandEnvelope
): Promise<CommandResult> {
  try {
    if (command.type === "rendererState.load") {
      const value = await rendererStateStore.load(command.payload.key);
      return {
        status: "accepted",
        requestId: command.id,
        payload: RendererStateLoadResultSchema.parse(
          value === undefined ? { found: false } : { found: true, value }
        )
      };
    }
    if (command.type === "rendererState.save") {
      await rendererStateStore.save(command.payload.key, command.payload.value);
      return {
        status: "accepted",
        requestId: command.id,
        payload: RendererStateMutationResultSchema.parse({ ok: true })
      };
    }
    if (command.type === "rendererState.remove") {
      await rendererStateStore.remove(command.payload.key);
      return {
        status: "accepted",
        requestId: command.id,
        payload: RendererStateMutationResultSchema.parse({ ok: true })
      };
    }
    if (command.type === "long.list") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongListBooksResultSchema.parse(
          await longWorkspaceService.list()
        )
      };
    }
    if (command.type === "long.createBookAtPath") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.create(
            command.payload.parentDirectory,
            command.payload.input
          )
        )
      };
    }
    if (command.type === "long.duplicateBook") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.duplicateBook(command.payload)
        )
      };
    }
    if (command.type === "long.previewLegacySyncAtPath") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongPreviewLegacySyncAtPathResultSchema.parse(
          await longWorkspaceService.previewLegacySync(
            command.payload.sourcePath
          )
        )
      };
    }
    if (command.type === "long.applyLegacySyncAtPath") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongApplyLegacySyncResultSchema.parse(
          await longWorkspaceService.applyLegacySync(command.payload)
        )
      };
    }
    if (command.type === "long.previewContinuationImportAtPath") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongPreviewContinuationImportAtPathResultSchema.parse(
          await longWorkspaceService.previewContinuationImport(
            command.payload.sourcePath
          )
        )
      };
    }
    if (command.type === "long.importContinuationAtPath") {
      const imported = await longWorkspaceService.importContinuationBook(
        command.payload
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongImportContinuationResultSchema.parse({
          book: imported.book,
          summary: imported.summary,
          importedVolumeCount: imported.importedVolumeCount,
          importedChapterCount: imported.importedChapterCount,
          checkpointCount: imported.checkpointCount,
          pendingChapterCardId: imported.pendingChapterCardId,
          warnings: imported.warnings
        })
      };
    }
    if (command.type === "long.importPortableAtPath") {
      const imported = await longWorkspaceService.importPortableBundle(
        command.payload.parentDirectory,
        command.payload.sourcePath
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongImportPortableResultSchema.parse({
          book: imported.book,
          summary: imported.summary,
          exportedAt: imported.exportedAt
        })
      };
    }
    if (command.type === "long.openAtPath") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.openAtPath(
            command.payload.projectDirectory
          )
        )
      };
    }
    if (command.type === "long.open") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.open(command.payload)
        )
      };
    }
    if (command.type === "long.rename") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.renameBook(command.payload)
        )
      };
    }
    if (command.type === "long.updateBindings") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.updateBindings(command.payload)
        )
      };
    }
    if (command.type === "long.getWorkspaceIndex") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongWorkspaceIndexResultSchema.parse(
          await longWorkspaceService.getWorkspaceIndex(command.payload)
        )
      };
    }
    if (command.type === "long.readDocument") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongReadDocumentResultSchema.parse(
          await longWorkspaceService.readDocument(command.payload)
        )
      };
    }
    if (command.type === "long.readAgentsMd") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongReadAgentsMdResultSchema.parse(
          await longWorkspaceService.readAgentsMd(command.payload)
        )
      };
    }
    if (command.type === "long.search") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongSearchResultSchema.parse(
          await longWorkspaceService.search(command.payload)
        )
      };
    }
    if (command.type === "long.writeDocument") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongWriteDocumentResultSchema.parse(
          await longWorkspaceService.writeDocument(command.payload)
        )
      };
    }
    if (command.type === "long.writeAgentsMd") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongWriteAgentsMdResultSchema.parse(
          await longWorkspaceService.writeAgentsMd(command.payload)
        )
      };
    }
    if (command.type === "long.previewOperations") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongPreviewOperationsResultSchema.parse(
          await longWorkspaceService.previewOperations(command.payload)
        )
      };
    }
    if (command.type === "long.applyOperations") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongApplyOperationsResultSchema.parse(
          await longWorkspaceService.applyOperations(command.payload)
        )
      };
    }
    if (command.type === "long.writeChapter") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongWriteChapterResultSchema.parse(
          await longWorkspaceService.writeChapter(command.payload)
        )
      };
    }
    if (command.type === "long.commitChapter") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongCommitChapterResultSchema.parse(
          await longWorkspaceService.commitChapter(command.payload)
        )
      };
    }
    if (command.type === "long.deleteLedgerCommit") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongDeleteLedgerCommitResultSchema.parse(
          await longWorkspaceService.deleteLedgerCommit(command.payload)
        )
      };
    }
    if (command.type === "long.unregister") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongRemoveBookResultSchema.parse(
          await longWorkspaceService.unregister(command.payload)
        )
      };
    }
    if (command.type === "long.delete") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongRemoveBookResultSchema.parse(
          await longWorkspaceService.delete(command.payload)
        )
      };
    }
    if (command.type === "catalog.loadDraftRecovery") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogDraftRecoverySchema.parse(
          await draftRecoveryStore.loadDraftRecovery()
        )
      };
    }
    if (command.type === "catalog.saveDraftRecovery") {
      await draftRecoveryStore.saveDraftRecovery(command.payload.drafts);
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogDraftRecoverySaveResultSchema.parse({ saved: true })
      };
    }
    const catalogStore = await requireCatalogStore();
    if (command.type === "catalog.index") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogIndexSnapshotSchema.parse(
          await catalogStore.indexSnapshot()
        )
      };
    }
    if (command.type === "catalog.readDocument") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogReadDocumentResultSchema.parse(
          await catalogStore.readDocument(command.payload)
        )
      };
    }
    if (command.type === "catalog.readWritingContext") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: ReadWritingContextResultSchema.parse(
          await catalogStore.readWritingContext(command.payload)
        )
      };
    }
    if (command.type === "catalog.writeWritingContext") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: WriteWritingContextResultSchema.parse(
          await catalogStore.writeWritingContext(command.payload)
        )
      };
    }
    if (command.type === "catalog.snapshot") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogSnapshotSchema.parse(await catalogStore.snapshot())
      };
    }
    if (command.type === "catalog.createShortBook") {
      const created = await catalogStore.createShortBook(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: ShortBookSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createScriptBook") {
      const created = await catalogStore.createScriptBook(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: ScriptBookSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createShortBookAtPath") {
      const created = await catalogStore.createShortBook(
        command.payload.input,
        command.payload.parentDirectory
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: ShortBookSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createScriptBookAtPath") {
      const created = await catalogStore.createScriptBook(
        command.payload.input,
        command.payload.parentDirectory
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: ScriptBookSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.importLegacyLibraryAtPath") {
      const imported = await catalogStore.importLegacyLibrary(
        await readLegacyLibraryArchive(
          command.payload.archivePath,
          command.payload.domain
        ),
        command.payload.parentDirectory
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibrarySchema.parse(imported.resource)
      };
    }
    if (command.type === "catalog.createLibraryAtPath") {
      const created = await catalogStore.createLibrary(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibrarySchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createLibraryGroup") {
      const created = await catalogStore.createLibraryGroup(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryGroupSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createLibraryGroupAtPath") {
      const created = await catalogStore.createLibraryGroup({
        ...command.payload.input,
        parentDirectory: command.payload.parentDirectory
      });
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryGroupSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.openProjectAtPath") {
      const opened =
        command.payload.domain === "book"
          ? await catalogStore.openBookProject(command.payload.projectDirectory)
          : command.payload.domain === "material"
            ? await catalogStore.openMaterialProject(
                command.payload.projectDirectory
              )
            : await catalogStore.openSkillProject(
                command.payload.projectDirectory
              );
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogOpenProjectResultSchema.parse({
          domain: command.payload.domain,
          id: opened.resource.id,
          title: opened.resource.title
        })
      };
    }
    if (command.type === "catalog.updateBook") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: BookSchema.parse(
          await catalogStore.updateBook(command.payload)
        )
      };
    }
    if (command.type === "catalog.mutatePlotStructure") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: BookSchema.parse(
          await catalogStore.mutatePlotStructure(command.payload)
        )
      };
    }
    if (command.type === "catalog.mutateCharacterStructure") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: BookSchema.parse(
          await catalogStore.mutateCharacterStructure(command.payload)
        )
      };
    }
    if (command.type === "catalog.updateLibraryGroup") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryGroupSchema.parse(
          await catalogStore.updateLibraryGroup(command.payload)
        )
      };
    }
    if (command.type === "catalog.deleteBook") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: DeleteBookResultSchema.parse(
          await catalogStore.removeBook(command.payload.bookId)
        )
      };
    }
    if (command.type === "catalog.saveDocument") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: SaveDocumentResultSchema.parse(
          await catalogStore.saveDocument(command.payload)
        )
      };
    }
    if (command.type === "catalog.createDraftSection") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogDraftSectionSchema.parse(
          await catalogStore.createDraftSection(command.payload)
        )
      };
    }
    if (command.type === "catalog.createDraftSections") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CreateDraftSectionsResultSchema.parse(
          await catalogStore.createDraftSections(command.payload)
        )
      };
    }
    if (command.type === "catalog.deleteDraftSection") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: DeleteDraftSectionResultSchema.parse(
          await catalogStore.deleteDraftSection(command.payload)
        )
      };
    }
    if (command.type === "catalog.moveDraftSection") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: MoveDraftSectionResultSchema.parse(
          await catalogStore.moveDraftSection(command.payload)
        )
      };
    }
    if (command.type === "catalog.saveLibraryEntry") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryEntrySchema.parse(
          await catalogStore.saveLibraryEntry(command.payload)
        )
      };
    }
    if (command.type === "catalog.createLibraryEntry") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryEntrySchema.parse(
          await catalogStore.createLibraryEntry(command.payload)
        )
      };
    }
    if (command.type === "catalog.updateLibrary") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibrarySchema.parse(
          await catalogStore.updateLibrary(command.payload)
        )
      };
    }
    if (command.type === "catalog.moveLibraryEntry") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: MoveLibraryEntryResultSchema.parse(
          await catalogStore.moveLibraryEntry(command.payload)
        )
      };
    }
    if (command.type === "catalog.removeLibraryEntry") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: RemoveLibraryEntryResultSchema.parse(
          await catalogStore.removeLibraryEntry(command.payload)
        )
      };
    }
    if (command.type === "catalog.unregisterProject") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: UnregisterCatalogProjectResultSchema.parse(
          await catalogStore.unregisterProject(command.payload)
        )
      };
    }
    if (command.type === "catalog.deleteProject") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: DeleteCatalogProjectResultSchema.parse(
          await catalogStore.deleteProject(command.payload)
        )
      };
    }
    if (command.type === "catalog.duplicateProject") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: DuplicateCatalogProjectResultSchema.parse(
          await catalogStore.duplicateProject(command.payload)
        )
      };
    }
    if (command.type === "catalog.installMarketplaceSkillContent") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogInstallMarketplaceSkillContentResultSchema.parse(
          await catalogStore.installMarketplaceSkillContent(command.payload)
        )
      };
    }
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "core.unsupported_command",
        message: `Core Utility does not handle ${command.type}.`
      }
    };
  } catch (error: unknown) {
    if (command.type.startsWith("rendererState.")) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "renderer_state.command_failed",
          message:
            error instanceof Error ? error.message : "会话历史持久化操作失败。",
          details: {
            kind: error instanceof Error ? error.name : "unknown"
          }
        }
      };
    }
    if (error instanceof LongWorkspaceOperationError) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: `long.operation.${error.code}`,
          message: error.message,
          details: {
            kind: error.name,
            operationCode: error.code
          }
        }
      };
    }
    if (error instanceof FolderCatalogConflictError) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "catalog.conflict",
          message: error.message,
          details: {
            expectedRevision: error.expectedRevision,
            actualRevision: error.actualRevision
          }
        }
      };
    }
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "catalog.command_failed",
        message: error instanceof Error ? error.message : "目录操作失败。",
        details: {
          kind: error instanceof Error ? error.name : "unknown"
        }
      }
    };
  }
}

bootUtility("core", {
  mode: "catalog-store",
  commandHandler: handleCatalogCommand
});
