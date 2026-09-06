import {
  BookSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogDraftSectionSchema,
  CatalogIndexSnapshotSchema,
  CatalogLibraryEntrySchema,
  CatalogLibraryGroupSchema,
  CatalogLibrarySchema,
  CatalogOpenProjectResultSchema,
  CatalogReadDocumentResultSchema,
  CatalogSnapshotSchema,
  CommandEnvelopeSchema,
  CreateDraftSectionsResultSchema,
  DeleteBookResultSchema,
  DeleteCatalogProjectResultSchema,
  DeleteDraftSectionResultSchema,
  DuplicateCatalogProjectResultSchema,
  ExternalLibrarySelectionResultSchema,
  ImportLibraryEntriesResultSchema,
  MoveDraftSectionResultSchema,
  MoveLibraryEntryResultSchema,
  RemoveLibraryEntryResultSchema,
  ReadWritingContextResultSchema,
  SaveDocumentResultSchema,
  ScriptBookSchema,
  ShortBookSchema,
  UnregisterCatalogProjectResultSchema,
  WriteWritingContextResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES } from "../legacy-library-import-batch";
import { UtilityCommandTimeoutError } from "../supervisor";
import {
  catalogCommandTimeoutMessage,
  catalogCommandTimeoutMs
} from "../catalog-command-timeout";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export async function handleCatalogCommands(
  ctx: IpcCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    command.type === "catalog.createShortBook" ||
    command.type === "catalog.createScriptBook" ||
    command.type === "catalog.createLibrary" ||
    command.type === "catalog.createLibraryGroup" ||
    command.type === "catalog.openProject" ||
    command.type === "catalog.importLegacyLibrary"
  ) {
    try {
      const workspaceDirectory = await ctx.requireSelectedWorkspaceDirectory();
      if (!workspaceDirectory) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: null
        };
      }

      const domain =
        command.type === "catalog.createShortBook" ||
        command.type === "catalog.createScriptBook"
          ? "book"
          : command.payload.domain;
      const defaultPath =
        command.type === "catalog.createLibraryGroup"
          ? ctx.workspaceGroupParent(workspaceDirectory, command.payload.domain)
          : ctx.workspaceResourceParent(workspaceDirectory, domain);
      let selectedPaths: string[];
      if (
        command.type === "catalog.createShortBook" ||
        command.type === "catalog.createScriptBook" ||
        command.type === "catalog.createLibrary" ||
        command.type === "catalog.createLibraryGroup"
      ) {
        selectedPaths = [defaultPath];
      } else {
        const selection = await ctx.dialog.showOpenDialog({
          title:
            command.type === "catalog.importLegacyLibrary"
              ? `导入旧版${domain === "material" ? "素材" : "技能"}库压缩包`
              : domain === "book"
                ? "打开已有书籍"
                : domain === "material"
                  ? "打开已有素材库"
                  : "打开已有技能库",
          defaultPath,
          ...(command.type === "catalog.importLegacyLibrary"
            ? {
                properties:
                  command.type === "catalog.importLegacyLibrary"
                    ? LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES
                    : (["openFile"] as const),
                filters: [
                  {
                    name: `旧版${domain === "material" ? "素材" : "技能"}库压缩包`,
                    extensions: ["zip"]
                  }
                ]
              }
            : { properties: ["openDirectory"] as const })
        });
        if (selection.canceled || selection.filePaths.length === 0) {
          return {
            status: "accepted",
            requestId: command.id,
            payload: null
          };
        }
        selectedPaths = selection.filePaths;
      }

      const selectedPath = selectedPaths[0]!;

      const internalCommand = CommandEnvelopeSchema.parse(
        command.type === "catalog.createShortBook"
          ? createEnvelope(
              "catalog.createShortBookAtPath",
              {
                parentDirectory: selectedPath,
                input: command.payload
              },
              { id: command.id, context: command.context }
            )
          : command.type === "catalog.createScriptBook"
            ? createEnvelope(
                "catalog.createScriptBookAtPath",
                {
                  parentDirectory: selectedPath,
                  input: command.payload
                },
                { id: command.id, context: command.context }
              )
            : command.type === "catalog.createLibrary"
              ? createEnvelope(
                  "catalog.createLibraryAtPath",
                  {
                    ...command.payload,
                    parentDirectory: selectedPath
                  },
                  { id: command.id, context: command.context }
                )
              : command.type === "catalog.createLibraryGroup"
                ? createEnvelope(
                    "catalog.createLibraryGroupAtPath",
                    {
                      parentDirectory: selectedPath,
                      input: command.payload
                    },
                    { id: command.id, context: command.context }
                  )
                : command.type === "catalog.openProject"
                  ? createEnvelope(
                      "catalog.openProjectAtPath",
                      {
                        projectDirectory: selectedPath,
                        domain: command.payload.domain
                      },
                      { id: command.id, context: command.context }
                    )
                  : createEnvelope(
                      "catalog.importLegacyLibraryAtPath",
                      {
                        domain: command.payload.domain,
                        archivePath: selectedPath,
                        parentDirectory: defaultPath
                      },
                      { id: command.id, context: command.context }
                    )
      );

      if (command.type === "catalog.importLegacyLibrary") {
        const payload = await ctx.importLegacyLibraryArchives(
          selectedPaths,
          async (archivePath, index) => {
            const result = await ctx.supervisor.requestCommand(
              "core",
              createEnvelope(
                "catalog.importLegacyLibraryAtPath",
                {
                  domain: command.payload.domain,
                  archivePath,
                  parentDirectory: defaultPath
                },
                {
                  id: `${command.id}_${index + 1}`,
                  context: command.context
                }
              ),
              0
            );
            if (result.status === "rejected") {
              throw new Error(result.error.message);
            }
            return result.payload;
          }
        );
        return {
          status: "accepted",
          requestId: command.id,
          payload
        };
      }

      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        0
      );
      if (result.status === "rejected") {
        return result;
      }
      const payload =
        command.type === "catalog.createShortBook"
          ? ShortBookSchema.parse(result.payload)
          : command.type === "catalog.createScriptBook"
            ? ScriptBookSchema.parse(result.payload)
            : command.type === "catalog.createLibrary"
              ? CatalogLibrarySchema.parse(result.payload)
              : command.type === "catalog.createLibraryGroup"
                ? CatalogLibraryGroupSchema.parse(result.payload)
                : command.type === "catalog.openProject"
                  ? CatalogOpenProjectResultSchema.parse(result.payload)
                  : CatalogLibrarySchema.parse(result.payload);
      return { status: "accepted", requestId: command.id, payload };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "catalog.forward_failed",
          message: error instanceof Error ? error.message : "目录操作失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "catalog.chooseExternalLibraryEntries") {
    try {
      const selection =
        command.payload.sourceKind === "directory"
          ? ctx.getMainWindow()
            ? await ctx.dialog.showOpenDialog(ctx.getMainWindow(), {
                title: "选择包含技能或素材的文件夹",
                properties: ["openDirectory"]
              })
            : await ctx.dialog.showOpenDialog({
                title: "选择包含技能或素材的文件夹",
                properties: ["openDirectory"]
              })
          : ctx.getMainWindow()
            ? await ctx.dialog.showOpenDialog(ctx.getMainWindow(), {
                title: "选择技能或素材文件",
                properties: ["openFile", "multiSelections"],
                filters: [
                  {
                    name: "文本与文档",
                    extensions: ["txt", "md", "markdown", "doc", "docx", "pdf"]
                  }
                ]
              })
            : await ctx.dialog.showOpenDialog({
                title: "选择技能或素材文件",
                properties: ["openFile", "multiSelections"],
                filters: [
                  {
                    name: "文本与文档",
                    extensions: ["txt", "md", "markdown", "doc", "docx", "pdf"]
                  }
                ]
              });
      if (selection.canceled || selection.filePaths.length === 0) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: null
        };
      }
      return {
        status: "accepted",
        requestId: command.id,
        payload: ExternalLibrarySelectionResultSchema.parse(
          await ctx.readExternalLibraryEntries(
            command.payload.sourceKind,
            selection.filePaths
          )
        )
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "catalog.choose_external_library_entries_failed",
          message:
            error instanceof Error ? error.message : "读取外部资料失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (
    command.type === "catalog.index" ||
    command.type === "catalog.readDocument" ||
    command.type === "catalog.readWritingContext" ||
    command.type === "catalog.writeWritingContext" ||
    command.type === "catalog.snapshot" ||
    command.type === "catalog.loadDraftRecovery" ||
    command.type === "catalog.saveDraftRecovery" ||
    command.type === "catalog.updateBook" ||
    command.type === "catalog.mutateCharacterStructure" ||
    command.type === "catalog.mutatePlotStructure" ||
    command.type === "catalog.updateLibraryGroup" ||
    command.type === "catalog.updateLibrary" ||
    command.type === "catalog.deleteBook" ||
    command.type === "catalog.saveDocument" ||
    command.type === "catalog.createDraftSection" ||
    command.type === "catalog.createDraftSections" ||
    command.type === "catalog.deleteDraftSection" ||
    command.type === "catalog.moveDraftSection" ||
    command.type === "catalog.saveLibraryEntry" ||
    command.type === "catalog.createLibraryEntry" ||
    command.type === "catalog.importLibraryEntries" ||
    command.type === "catalog.removeLibraryEntry" ||
    command.type === "catalog.moveLibraryEntry" ||
    command.type === "catalog.unregisterProject" ||
    command.type === "catalog.deleteProject" ||
    command.type === "catalog.duplicateProject"
  ) {
    try {
      const result = await ctx.supervisor.requestCommand(
        "core",
        command,
        catalogCommandTimeoutMs(command.type)
      );
      if (result.status === "rejected") {
        return result;
      }
      let payload: unknown;
      switch (command.type) {
        case "catalog.index":
          payload = CatalogIndexSnapshotSchema.parse(result.payload);
          break;
        case "catalog.readDocument":
          payload = CatalogReadDocumentResultSchema.parse(result.payload);
          break;
        case "catalog.readWritingContext":
          payload = ReadWritingContextResultSchema.parse(result.payload);
          break;
        case "catalog.writeWritingContext":
          payload = WriteWritingContextResultSchema.parse(result.payload);
          break;
        case "catalog.snapshot":
          payload = CatalogSnapshotSchema.parse(result.payload);
          break;
        case "catalog.loadDraftRecovery":
          payload = CatalogDraftRecoverySchema.parse(result.payload);
          break;
        case "catalog.saveDraftRecovery":
          payload = CatalogDraftRecoverySaveResultSchema.parse(result.payload);
          break;
        case "catalog.deleteBook":
          payload = DeleteBookResultSchema.parse(result.payload);
          break;
        case "catalog.saveDocument":
          payload = SaveDocumentResultSchema.parse(result.payload);
          break;
        case "catalog.createDraftSection":
          payload = CatalogDraftSectionSchema.parse(result.payload);
          break;
        case "catalog.createDraftSections":
          payload = CreateDraftSectionsResultSchema.parse(result.payload);
          break;
        case "catalog.deleteDraftSection":
          payload = DeleteDraftSectionResultSchema.parse(result.payload);
          break;
        case "catalog.moveDraftSection":
          payload = MoveDraftSectionResultSchema.parse(result.payload);
          break;
        case "catalog.saveLibraryEntry":
        case "catalog.createLibraryEntry":
          payload = CatalogLibraryEntrySchema.parse(result.payload);
          break;
        case "catalog.importLibraryEntries":
          payload = ImportLibraryEntriesResultSchema.parse(result.payload);
          break;
        case "catalog.removeLibraryEntry":
          payload = RemoveLibraryEntryResultSchema.parse(result.payload);
          break;
        case "catalog.moveLibraryEntry":
          payload = MoveLibraryEntryResultSchema.parse(result.payload);
          break;
        case "catalog.updateLibrary":
          payload = CatalogLibrarySchema.parse(result.payload);
          break;
        case "catalog.unregisterProject":
          payload = UnregisterCatalogProjectResultSchema.parse(result.payload);
          break;
        case "catalog.deleteProject":
          payload = DeleteCatalogProjectResultSchema.parse(result.payload);
          break;
        case "catalog.duplicateProject":
          payload = DuplicateCatalogProjectResultSchema.parse(result.payload);
          break;
        case "catalog.updateBook":
        case "catalog.mutateCharacterStructure":
        case "catalog.mutatePlotStructure":
          payload = BookSchema.parse(result.payload);
          break;
        case "catalog.updateLibraryGroup":
          payload = CatalogLibraryGroupSchema.parse(result.payload);
          break;
      }
      return { status: "accepted", requestId: command.id, payload };
    } catch (error: unknown) {
      const timedOut = error instanceof UtilityCommandTimeoutError;
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: timedOut ? "catalog.command_timeout" : "catalog.forward_failed",
          message: timedOut
            ? catalogCommandTimeoutMessage(command.type)
            : error instanceof Error
              ? error.message
              : "目录操作失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }
  return undefined;
}
