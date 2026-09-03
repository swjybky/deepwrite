import {
  CommandEnvelopeSchema,
  LongApplyLegacySyncResultSchema,
  LongApplyOperationsResultSchema,
  LongChooseContinuationImportSourceResultSchema,
  LongChooseLegacySyncSourceResultSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitResultSchema,
  LongImportContinuationResultSchema,
  LongImportPortableResultSchema,
  LongListBooksResultSchema,
  LongOpenBookResultSchema,
  LongPreviewContinuationImportAtPathResultSchema,
  LongPreviewLegacySyncAtPathResultSchema,
  LongPreviewOperationsResultSchema,
  LongReadAgentsMdResultSchema,
  LongReadDocumentResultSchema,
  LongRemoveBookResultSchema,
  LongSearchResultSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteAgentsMdResultSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

export async function handleLongCommands(
  ctx: IpcCommandContext,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    command.type === "long.createBook" ||
    command.type === "long.openExisting"
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
      const defaultPath = ctx.workspaceResourceParent(
        workspaceDirectory,
        "book"
      );
      let selectedPath = defaultPath;
      if (command.type === "long.openExisting") {
        const selection = await ctx.dialog.showOpenDialog({
          title: "打开已有长篇项目",
          defaultPath,
          properties: ["openDirectory"]
        });
        if (selection.canceled || selection.filePaths.length === 0) {
          return {
            status: "accepted",
            requestId: command.id,
            payload: null
          };
        }
        selectedPath = selection.filePaths[0]!;
      }
      const internalCommand = CommandEnvelopeSchema.parse(
        command.type === "long.createBook"
          ? createEnvelope(
              "long.createBookAtPath",
              {
                parentDirectory: selectedPath,
                input: command.payload
              },
              { id: command.id, context: command.context }
            )
          : createEnvelope(
              "long.openAtPath",
              { projectDirectory: selectedPath },
              { id: command.id, context: command.context }
            )
      );
      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        0
      );
      if (result.status === "rejected") return result;
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(result.payload)
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long.forward_failed",
          message:
            error instanceof Error ? error.message : "长篇目录操作失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "long.chooseContinuationImportSource") {
    try {
      const selection = await ctx.dialog.showOpenDialog(ctx.getMainWindow(), {
        title: "选择续写章节文件夹",
        defaultPath: ctx.getDocumentsPath(),
        buttonLabel: "扫描章节",
        properties: ["openDirectory"]
      });
      const sourcePath = selection.filePaths[0];
      if (selection.canceled || !sourcePath) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: null
        };
      }
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "long.previewContinuationImportAtPath",
          { sourcePath },
          { id: command.id, context: command.context }
        )
      );
      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        0
      );
      if (result.status === "rejected") return result;
      const preview = LongPreviewContinuationImportAtPathResultSchema.parse(
        result.payload
      );
      const { previewId, expiresAt } = ctx.continuationImportPreviews.register({
        webContentsId: ctx.senderWebContentsId,
        sourcePath,
        sourceFingerprint: preview.sourceFingerprint
      });
      const { sourceFingerprint: _sourceFingerprint, ...publicPreview } =
        preview;
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongChooseContinuationImportSourceResultSchema.parse({
          ...publicPreview,
          previewId,
          expiresAt: new Date(expiresAt).toISOString()
        })
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long.preview_continuation_import_failed",
          message:
            error instanceof Error ? error.message : "扫描续写章节文件夹失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "long.chooseLegacySyncSource") {
    try {
      const selection = await ctx.dialog.showOpenDialog(ctx.getMainWindow(), {
        title: "选择旧版本长篇压缩包",
        defaultPath: ctx.getDocumentsPath(),
        buttonLabel: "上传并预览",
        filters: [{ name: "旧版本长篇压缩包", extensions: ["zip"] }],
        properties: ["openFile"]
      });
      const sourcePath = selection.filePaths[0];
      if (selection.canceled || !sourcePath) {
        return { status: "accepted", requestId: command.id, payload: null };
      }
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "long.previewLegacySyncAtPath",
          { sourcePath },
          { id: command.id, context: command.context }
        )
      );
      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        0
      );
      if (result.status === "rejected") return result;
      const preview = LongPreviewLegacySyncAtPathResultSchema.parse(
        result.payload
      );
      const { previewId, expiresAt } = ctx.legacySyncPreviews.register({
        webContentsId: ctx.senderWebContentsId,
        sourcePath,
        sourceFingerprint: preview.sourceFingerprint
      });
      const { sourceFingerprint: _fingerprint, ...publicPreview } = preview;
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongChooseLegacySyncSourceResultSchema.parse({
          ...publicPreview,
          previewId,
          expiresAt: new Date(expiresAt).toISOString()
        })
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long.preview_legacy_sync_failed",
          message:
            error instanceof Error ? error.message : "读取旧版本压缩包失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "long.applyLegacySync") {
    try {
      const registration = ctx.legacySyncPreviews.resolve(
        command.payload.previewId,
        ctx.senderWebContentsId
      );
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "long.applyLegacySyncAtPath",
          {
            bookId: command.payload.bookId,
            modules: command.payload.modules,
            sourcePath: registration.sourcePath,
            expectedFingerprint: registration.sourceFingerprint
          },
          { id: command.id, context: command.context }
        )
      );
      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        0
      );
      if (result.status === "rejected") return result;
      ctx.legacySyncPreviews.consume(command.payload.previewId);
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongApplyLegacySyncResultSchema.parse(result.payload)
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long.apply_legacy_sync_failed",
          message: error instanceof Error ? error.message : "同步旧版本失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "long.importContinuation") {
    try {
      const registration = ctx.continuationImportPreviews.resolve(
        command.payload.previewId,
        ctx.senderWebContentsId
      );
      const workspaceDirectory = await ctx.requireSelectedWorkspaceDirectory();
      if (!workspaceDirectory) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: null
        };
      }
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "long.importContinuationAtPath",
          {
            parentDirectory: ctx.workspaceResourceParent(
              workspaceDirectory,
              "book"
            ),
            sourcePath: registration.sourcePath,
            expectedFingerprint: registration.sourceFingerprint,
            title: command.payload.title,
            genre: command.payload.genre
          },
          { id: command.id, context: command.context }
        )
      );
      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        0
      );
      if (result.status === "rejected") return result;
      ctx.continuationImportPreviews.consume(command.payload.previewId);
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongImportContinuationResultSchema.parse(result.payload)
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long.import_continuation_failed",
          message: error instanceof Error ? error.message : "续写导入失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "long.importPortable") {
    try {
      const workspaceDirectory = await ctx.requireSelectedWorkspaceDirectory();
      if (!workspaceDirectory) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: null
        };
      }
      const selection = await ctx.dialog.showOpenDialog(ctx.getMainWindow(), {
        title: "导入 DeepWrite 长篇可移植工程",
        defaultPath: ctx.getDocumentsPath(),
        buttonLabel: "选择并导入",
        filters: [
          {
            name: "DeepWrite 长篇可移植工程",
            extensions: ["json"]
          }
        ],
        properties: ["openFile"]
      });
      const sourcePath = selection.filePaths[0];
      if (selection.canceled || !sourcePath) {
        return {
          status: "accepted",
          requestId: command.id,
          payload: null
        };
      }
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "long.importPortableAtPath",
          {
            parentDirectory: ctx.workspaceResourceParent(
              workspaceDirectory,
              "book"
            ),
            sourcePath
          },
          { id: command.id, context: command.context }
        )
      );
      const result = await ctx.supervisor.requestCommand(
        "core",
        internalCommand,
        0
      );
      if (result.status === "rejected") return result;
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongImportPortableResultSchema.parse(result.payload)
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long.import_portable_failed",
          message:
            error instanceof Error ? error.message : "导入长篇可移植工程失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (
    command.type === "long.list" ||
    command.type === "long.open" ||
    command.type === "long.duplicateBook" ||
    command.type === "long.rename" ||
    command.type === "long.updateBindings" ||
    command.type === "long.getWorkspaceIndex" ||
    command.type === "long.readDocument" ||
    command.type === "long.readAgentsMd" ||
    command.type === "long.search" ||
    command.type === "long.writeDocument" ||
    command.type === "long.writeAgentsMd" ||
    command.type === "long.previewOperations" ||
    command.type === "long.applyOperations" ||
    command.type === "long.writeChapter" ||
    command.type === "long.commitChapter" ||
    command.type === "long.deleteLedgerCommit" ||
    command.type === "long.unregister" ||
    command.type === "long.delete"
  ) {
    try {
      const result = await ctx.supervisor.requestCommand("core", command, 0);
      if (result.status === "rejected") return result;
      let payload: unknown;
      switch (command.type) {
        case "long.list":
          payload = LongListBooksResultSchema.parse(result.payload);
          break;
        case "long.open":
        case "long.duplicateBook":
        case "long.rename":
        case "long.updateBindings":
          payload = LongOpenBookResultSchema.parse(result.payload);
          break;
        case "long.getWorkspaceIndex":
          payload = LongWorkspaceIndexResultSchema.parse(result.payload);
          break;
        case "long.readDocument":
          payload = LongReadDocumentResultSchema.parse(result.payload);
          break;
        case "long.readAgentsMd":
          payload = LongReadAgentsMdResultSchema.parse(result.payload);
          break;
        case "long.search":
          payload = LongSearchResultSchema.parse(result.payload);
          break;
        case "long.writeDocument":
          payload = LongWriteDocumentResultSchema.parse(result.payload);
          break;
        case "long.writeAgentsMd":
          payload = LongWriteAgentsMdResultSchema.parse(result.payload);
          break;
        case "long.previewOperations":
          payload = LongPreviewOperationsResultSchema.parse(result.payload);
          break;
        case "long.applyOperations":
          payload = LongApplyOperationsResultSchema.parse(result.payload);
          break;
        case "long.writeChapter":
          payload = LongWriteChapterResultSchema.parse(result.payload);
          break;
        case "long.commitChapter":
          payload = LongCommitChapterResultSchema.parse(result.payload);
          break;
        case "long.deleteLedgerCommit":
          payload = LongDeleteLedgerCommitResultSchema.parse(result.payload);
          break;
        case "long.unregister":
        case "long.delete":
          payload = LongRemoveBookResultSchema.parse(result.payload);
          break;
      }
      return { status: "accepted", requestId: command.id, payload };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long.forward_failed",
          message: error instanceof Error ? error.message : "长篇操作失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }
  return undefined;
}
