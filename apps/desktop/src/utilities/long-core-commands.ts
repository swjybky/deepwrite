import {
  LongApplyOperationsResultSchema,
  LongApplyLegacySyncResultSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitResultSchema,
  LongImportPortableResultSchema,
  LongImportContinuationResultSchema,
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
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { LongWorkspaceService } from "./long-workspace-service";
import { resolveLongWorkspaceConflicts } from "./long-workspace-recovery";
export async function handleLongCoreCommand(
  service: LongWorkspaceService,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "long.resolveConflicts") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: await resolveLongWorkspaceConflicts(service, command.payload)
    };
  }
  if (command.type === "long.list") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongListBooksResultSchema.parse(await service.list())
    };
  }
  if (command.type === "long.createBookAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.create(
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
        await service.duplicateBook(command.payload)
      )
    };
  }
  if (command.type === "long.previewLegacySyncAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongPreviewLegacySyncAtPathResultSchema.parse(
        await service.previewLegacySync(command.payload.sourcePath)
      )
    };
  }
  if (command.type === "long.applyLegacySyncAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongApplyLegacySyncResultSchema.parse(
        await service.applyLegacySync(command.payload)
      )
    };
  }
  if (command.type === "long.previewContinuationImportAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongPreviewContinuationImportAtPathResultSchema.parse(
        await service.previewContinuationImport(command.payload.sourcePath)
      )
    };
  }
  if (command.type === "long.importContinuationAtPath") {
    const imported = await service.importContinuationBook(command.payload);
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
    const imported = await service.importPortableBundle(
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
        await service.openAtPath(command.payload.projectDirectory)
      )
    };
  }
  if (command.type === "long.open") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.open(command.payload)
      )
    };
  }
  if (command.type === "long.rename") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.renameBook(command.payload)
      )
    };
  }
  if (command.type === "long.updateBindings") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.updateBindings(command.payload)
      )
    };
  }
  if (command.type === "long.getWorkspaceIndex") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongWorkspaceIndexResultSchema.parse(
        await service.getWorkspaceIndex(command.payload)
      )
    };
  }
  if (command.type === "long.readDocument") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongReadDocumentResultSchema.parse(
        await service.readDocument(command.payload)
      )
    };
  }
  if (command.type === "long.readAgentsMd") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongReadAgentsMdResultSchema.parse(
        await service.readAgentsMd(command.payload)
      )
    };
  }
  if (command.type === "long.search") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongSearchResultSchema.parse(
        await service.search(command.payload)
      )
    };
  }
  if (command.type === "long.writeDocument") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongWriteDocumentResultSchema.parse(
        await service.writeDocument(command.payload)
      )
    };
  }
  if (command.type === "long.writeAgentsMd") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongWriteAgentsMdResultSchema.parse(
        await service.writeAgentsMd(command.payload)
      )
    };
  }
  if (command.type === "long.previewOperations") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongPreviewOperationsResultSchema.parse(
        await service.previewOperations(command.payload)
      )
    };
  }
  if (command.type === "long.applyOperations") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongApplyOperationsResultSchema.parse(
        await service.applyOperations(command.payload)
      )
    };
  }
  if (command.type === "long.writeChapter") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongWriteChapterResultSchema.parse(
        await service.writeChapter(command.payload)
      )
    };
  }
  if (command.type === "long.commitChapter") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongCommitChapterResultSchema.parse(
        await service.commitChapter(command.payload)
      )
    };
  }
  if (command.type === "long.deleteLedgerCommit") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongDeleteLedgerCommitResultSchema.parse(
        await service.deleteLedgerCommit(command.payload)
      )
    };
  }
  if (command.type === "long.unregister") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongRemoveBookResultSchema.parse(
        await service.unregister(command.payload)
      )
    };
  }
  if (command.type === "long.delete") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongRemoveBookResultSchema.parse(
        await service.delete(command.payload)
      )
    };
  }
  return undefined;
}
