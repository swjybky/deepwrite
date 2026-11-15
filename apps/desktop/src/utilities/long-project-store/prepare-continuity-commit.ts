import {
  applyLongWorkspaceOperations,
  LongWorkspaceOperationError,
  type LongContinuityCommitPreparation,
  type LongWorkspaceFileReference
} from "@deepwrite/contracts";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { loadIndexedFile } from "./cache";
import {
  assertDirectlyMutableDocument,
  validatePortableAndCanonicalPaths
} from "./integrity";
import { indexedFileSlots, requireIndexedFileReference } from "./paths";
import { assertDocumentBaseUnchanged } from "./operations";
import type { LoadedLongProject } from "./types";

export async function prepareContinuityCommit(
  loaded: LoadedLongProject,
  preparation: LongContinuityCommitPreparation,
  chapterCardIds: readonly string[]
) {
  const checkpoint = chapterCardIds.at(-1)!;
  const bodyIds = chapterCardIds.map(
    (id) => loaded.index.chapters.find((c) => c.chapterCardId === id)!.body.id
  );
  if (
    preparation.bodyVersions.length !== bodyIds.length ||
    preparation.bodyVersions.some((v) => !bodyIds.includes(v.fileId))
  )
    throw new LongWorkspaceOperationError(
      "invalid_document_write",
      "合并提交必须校验批次全部正文版本。"
    );
  const fileOperations: ProjectTransactionFileOperation[] = [];
  for (const version of preparation.bodyVersions) {
    const current = await loadIndexedFile(loaded, version.fileId);
    assertDocumentBaseUnchanged(
      {
        ...version,
        mode: "replace",
        content: "",
        proposalId: "proposal_body-check",
        updatedAt: loaded.index.updatedAt,
        reason: "正文版本校验"
      },
      current.disk.content
    );
    fileOperations.push({
      action: "check",
      path: current.reference.path,
      expectedSha256: current.disk.sha256
    });
  }
  for (const operation of preparation.batch.operations) {
    if (
      (operation.type !== "chapterContinuity.worldReveals.create" &&
        operation.type !== "chapterContinuity.character.create") ||
      operation.chapterCardId !== checkpoint
    )
      throw new LongWorkspaceOperationError(
        "invalid_document_write",
        "合并提交只能创建检查点章的连续性文件。"
      );
  }
  const applied = applyLongWorkspaceOperations(loaded.index, preparation.batch);
  if (applied.ledgerRecordEdits.length)
    throw new LongWorkspaceOperationError(
      "invalid_document_write",
      "合并提交不能修改既有账本。"
    );
  validatePortableAndCanonicalPaths(indexedFileSlots(applied.snapshot));
  const chapter = applied.snapshot.chapters.find(
    (c) => c.chapterCardId === checkpoint
  )!;
  const allowed = new Map<string, LongWorkspaceFileReference>(
    [
      chapter.characterState,
      chapter.handoff,
      chapter.foreshadowingChanges,
      ...(chapter.worldReveals ? [chapter.worldReveals] : []),
      ...chapter.characterContinuity.flatMap((c) => [c.currentState, c.history])
    ].map((f) => [f.id, f])
  );
  const contents = new Map<string, string>();
  const versionWrites: { fileId: string; path: string; after: string }[] = [];
  const created = new Set(applied.fileIntents.map((intent) => intent.file.id));
  for (const write of applied.documentWrites) {
    const target = allowed.get(write.fileId);
    if (!target || write.mode === "append")
      throw new LongWorkspaceOperationError(
        "invalid_document_write",
        "合并提交只能替换检查点章的连续性文件。"
      );
    if (write.mode === "create") {
      if (!created.has(write.fileId))
        throw new LongWorkspaceOperationError(
          "invalid_document_write",
          "新文件未包含在连续性创建操作中。"
        );
      fileOperations.push({
        path: target.path,
        content: write.content,
        expectedSha256: null
      });
    } else {
      if (write.expectedSha256 === undefined)
        throw new LongWorkspaceOperationError(
          "invalid_document_write",
          "合并提交缺少文件版本校验。"
        );
      assertDirectlyMutableDocument(loaded.index, write.fileId);
      const current = await loadIndexedFile(loaded, write.fileId);
      assertDocumentBaseUnchanged(write, current.disk.content);
      fileOperations.push({
        path: current.reference.path,
        content: write.content,
        expectedSha256: current.disk.sha256
      });
    }
    const nextFile = requireIndexedFileReference(
      applied.snapshot,
      write.fileId
    );
    nextFile.updatedAt = preparation.batch.updatedAt;
    contents.set(write.fileId, write.content);
    versionWrites.push({
      fileId: write.fileId,
      path: target.path,
      after: write.content
    });
  }
  for (const intent of applied.fileIntents) {
    if (
      intent.action !== "create" ||
      !allowed.has(intent.file.id) ||
      !contents.has(intent.file.id)
    )
      throw new LongWorkspaceOperationError(
        "invalid_document_write",
        "连续性创建操作必须为每个文件提供内容。"
      );
  }
  loaded.index = applied.snapshot;
  return { contents, fileOperations, versionWrites };
}
