import {
  CatalogDocumentSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogLibrarySchema,
  CatalogLibraryEntrySchema,
  CatalogOpenProjectResultSchema,
  CatalogSnapshotSchema,
  DeleteBookResultSchema,
  RemoveLibraryEntryResultSchema,
  ShortBookSchema,
  UnregisterCatalogProjectResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { existsSync } from "node:fs";
import { CatalogStore } from "./catalog-store";
import {
  FolderCatalogConflictError,
  FolderCatalogStore
} from "./folder-catalog-store";
import { readLegacyBookArchive } from "./legacy-book-import";
import { readLegacyLibraryArchive } from "./legacy-library-import";
import { bootUtility } from "./runtime";

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
          (value): value is string => typeof value === "string" && value.trim() !== ""
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

async function requireCatalogStore(): Promise<FolderCatalogStore> {
  if (!catalogStoreInitialization) {
    const initialization = (async () => {
      const existingFolderStore = new FolderCatalogStore({
        userDataPath: resolvedUserDataPath
      });
      if (existsSync(existingFolderStore.registryPath)) {
        await existingFolderStore.snapshot();
        return existingFolderStore;
      }
      const legacySnapshot = await legacyCatalogStore.snapshot();
      const folderStore = new FolderCatalogStore({
        userDataPath: resolvedUserDataPath,
        initialSnapshot: legacySnapshot
      });
      await folderStore.snapshot();
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
    if (command.type === "catalog.importLegacyBookAtPath") {
      const imported = await catalogStore.importLegacyBook(
        await readLegacyBookArchive(command.payload.archivePath),
        command.payload.parentDirectory
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: ShortBookSchema.parse(imported.resource)
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
    if (command.type === "catalog.openProjectAtPath") {
      const opened =
        command.payload.domain === "book"
          ? await catalogStore.openBookProject(command.payload.projectDirectory)
          : command.payload.domain === "material"
            ? await catalogStore.openMaterialProject(command.payload.projectDirectory)
            : await catalogStore.openSkillProject(command.payload.projectDirectory);
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
        payload: ShortBookSchema.parse(await catalogStore.updateBook(command.payload))
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
        payload: CatalogDocumentSchema.parse(
          await catalogStore.saveDocument(command.payload)
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
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "core.unsupported_command",
        message: `Core Utility does not handle ${command.type}.`
      }
    };
  } catch (error: unknown) {
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
