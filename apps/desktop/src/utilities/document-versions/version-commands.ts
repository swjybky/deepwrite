import {
  ListDocumentVersionsResultSchema,
  ReadDocumentVersionResultSchema,
  RestoreDocumentVersionResultSchema,
  type DocumentVersionCommandEnvelope,
  type DocumentVersionSummary,
  type RestoreDocumentVersionInput
} from "@deepwrite/contracts";
import {
  FolderCatalogConflictError,
  type FolderCatalogStore
} from "../folder-catalog-store";
import { LongDocumentConflictError } from "../long-project-store/types";
import type { LongWorkspaceService } from "../long-workspace-service";
import {
  MysteryDocumentConflictError,
  type MysteryWorkspaceService
} from "../mystery-store";
import { ProjectTransactionConflictError } from "../project-transaction";
import type { UtilityRuntimeOptions } from "../runtime";
import { DocumentVersionError } from "./version-errors";
import {
  documentVersionCurrent,
  type DocumentVersionStore
} from "./version-store";

async function restoreVersion<T>(
  input: RestoreDocumentVersionInput,
  versions: DocumentVersionStore,
  currentContent: string,
  save: (
    content: string,
    afterCommit: (before: string) => Promise<void>
  ) => Promise<T>
): Promise<{
  version: DocumentVersionSummary | null;
  current: ReturnType<typeof documentVersionCurrent>;
  document: T;
}> {
  if (
    documentVersionCurrent(currentContent).sha256 !==
    input.expectedCurrentSha256
  )
    throw new DocumentVersionError("version.conflict", "当前内容已变化。");
  const source = await versions.read(input.versionId);
  let version: DocumentVersionSummary | null = null;
  const document = await save(source.content, async (before) => {
    try {
      version = await versions.restore(
        before,
        source.content,
        source.version.seq
      );
    } catch (error) {
      console.warn(
        "[document-versions] Failed to capture restored document history.",
        error instanceof Error ? error.message : "unknown"
      );
    }
  });
  return { version, current: documentVersionCurrent(source.content), document };
}

export async function executeDocumentVersionCommand(
  command: DocumentVersionCommandEnvelope,
  catalog: () => Promise<FolderCatalogStore>,
  longs: LongWorkspaceService,
  mysteries?: MysteryWorkspaceService
): Promise<unknown> {
  const target = command.payload.target;
  if (target.workspace === "catalog") {
    return (await catalog()).withDocumentVersions(
      target.bookId,
      target.documentId,
      async (versions, current, save) => {
        if (command.type === "versions.list")
          return ListDocumentVersionsResultSchema.parse({
            versions: await versions.list(),
            current: documentVersionCurrent(current.content)
          });
        if (command.type === "versions.read")
          return ReadDocumentVersionResultSchema.parse(
            await versions.read(command.payload.versionId)
          );
        const restored = await restoreVersion(
          command.payload,
          versions,
          current.content,
          async (content, afterCommit) => {
            const result = await save(content);
            await afterCommit(current.content);
            return result;
          }
        );
        return RestoreDocumentVersionResultSchema.parse({
          workspace: "catalog",
          ...restored
        });
      }
    );
  }
  if (target.workspace === "mystery") {
    if (!mysteries)
      throw new DocumentVersionError(
        "version.unavailable",
        "当前运行上下文不支持剧本杀文档历史版本。"
      );
    const directory = await mysteries.catalog.resolveProjectDirectory(
      target.bookId
    );
    const result = await mysteries.store.withDocumentVersions(
      directory,
      target.bookId,
      target.target,
      async (versions, content, save) => {
        if (command.type === "versions.list")
          return ListDocumentVersionsResultSchema.parse({
            versions: await versions.list(),
            current: documentVersionCurrent(content)
          });
        if (command.type === "versions.read")
          return ReadDocumentVersionResultSchema.parse(
            await versions.read(command.payload.versionId)
          );
        const restored = await restoreVersion(
          command.payload,
          versions,
          content,
          (restoredContent, afterCommit) =>
            save(
              restoredContent,
              command.payload.expectedCurrentSha256,
              afterCommit
            )
        );
        return RestoreDocumentVersionResultSchema.parse({
          workspace: "mystery",
          ...restored
        });
      }
    );
    if (command.type === "versions.restore") {
      const restored = RestoreDocumentVersionResultSchema.parse(result);
      if (restored.workspace === "mystery")
        await mysteries.catalog
          .updateSummary(target.bookId, restored.document.summary)
          .catch(() => undefined);
    }
    return result;
  }
  const directory = await longs.catalog.resolveProjectDirectory(target.bookId);
  const result = await longs.store.withDocumentVersions(
    directory,
    target.bookId,
    target.fileId,
    async (versions, content, save) => {
      if (command.type === "versions.list")
        return ListDocumentVersionsResultSchema.parse({
          versions: await versions.list(),
          current: documentVersionCurrent(content)
        });
      if (command.type === "versions.read")
        return ReadDocumentVersionResultSchema.parse(
          await versions.read(command.payload.versionId)
        );
      const restored = await restoreVersion(
        command.payload,
        versions,
        content,
        (restoredContent, afterCommit) =>
          save(
            restoredContent,
            command.payload.expectedCurrentSha256,
            afterCommit
          )
      );
      return RestoreDocumentVersionResultSchema.parse({
        workspace: "long",
        ...restored
      });
    }
  );
  if (command.type === "versions.restore") {
    const restored = RestoreDocumentVersionResultSchema.parse(result);
    if (restored.workspace === "long")
      await longs.catalog
        .updateSummary(target.bookId, restored.document.summary)
        .catch(() => undefined);
  }
  return result;
}

export function withDocumentVersionCommands(
  catalog: () => Promise<FolderCatalogStore>,
  longs: LongWorkspaceService,
  handler: NonNullable<UtilityRuntimeOptions["commandHandler"]>,
  mysteries?: MysteryWorkspaceService
): NonNullable<UtilityRuntimeOptions["commandHandler"]> {
  return async (command, emitEvent, context) => {
    if (
      command.type !== "versions.list" &&
      command.type !== "versions.read" &&
      command.type !== "versions.restore"
    )
      return handler(command, emitEvent, context);
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: await executeDocumentVersionCommand(
          command,
          catalog,
          longs,
          mysteries
        )
      };
    } catch (error) {
      const conflict =
        error instanceof FolderCatalogConflictError ||
        error instanceof LongDocumentConflictError ||
        error instanceof MysteryDocumentConflictError ||
        error instanceof ProjectTransactionConflictError;
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code:
            error instanceof DocumentVersionError
              ? error.code
              : conflict
                ? "version.conflict"
                : "version.unavailable",
          message: error instanceof Error ? error.message : "版本记录不可用。"
        }
      };
    }
  };
}
