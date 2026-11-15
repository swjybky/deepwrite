import {
  LONG_WORKSPACE_INDEX_PATH,
  LongLedgerCommitRecordSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongProjectManifestSchema,
  LongWorkspaceOperationError,
  longLedgerCommitChapterIds,
  type LongTextFilesBatchCommitInput
} from "@deepwrite/contracts";
import { projectTransactionContentSha256 } from "../project-transaction";
import { parseLongLedgerCommitRecord } from "../long-version-metadata";
import { loadIndexedFile } from "./cache";
import { commitLongProjectTransaction, serializeJson } from "./io";
import {
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type LoadedLongProject
} from "./types";
import type { LongProjectStoreContext } from "./store-context";

export async function reviewContinuityCommit(
  ctx: LongProjectStoreContext,
  loaded: LoadedLongProject,
  input: LongTextFilesBatchCommitInput
) {
  const review = input.review!;
  const commit = loaded.index.ledger.commits.find(
    ({ id }) => id === review.commitId
  );
  if (
    !commit ||
    input.preparation ||
    JSON.stringify(longLedgerCommitChapterIds(commit)) !==
      JSON.stringify(input.chapterCardIds)
  )
    throw new LongWorkspaceOperationError(
      "invalid_document_write",
      "复核必须对应原账本的完整批次，不能同时提交新文件。"
    );
  const recordFile = await loadIndexedFile(loaded, commit.recordFile.id);
  const record = parseLongLedgerCommitRecord(
    JSON.parse(recordFile.disk.content)
  );
  const chapters = input.chapterCardIds.map((id) =>
    loaded.index.chapters.find((c) => c.chapterCardId === id)!
  );
  const requiredIds = [
    recordFile.reference.id,
    ...chapters.map((c) => c.body.id),
    ...record.continuityFiles.map((f) => f.fileId)
  ];
  const versions = new Map(
    review.versions.map((v) => [v.fileId, v.expectedSha256])
  );
  if (
    versions.size !== review.versions.length ||
    versions.size !== requiredIds.length ||
    requiredIds.some((id) => !versions.has(id))
  )
    throw new LongWorkspaceOperationError(
      "invalid_document_write",
      "复核必须校验账本、全部正文和连续性文件版本。"
    );
  const files = await Promise.all(
    requiredIds.map((id) => loadIndexedFile(loaded, id))
  );
  if (
    files.some(
      (f) =>
        (f.reference.id === recordFile.reference.id
          ? projectTransactionContentSha256(serializeJson(record))
          : f.disk.sha256) !== versions.get(f.reference.id)
    )
  )
    throw new LongWorkspaceOperationError(
      "document_changed",
      "复核依据已变化，请重新读取后复核。"
    );
  const bodyEvidence = chapters.map((c) => ({
    chapterCardId: c.chapterCardId,
    sha256: versions.get(c.body.id)!
  }));
  const timestamp = ctx.timestamp();
  const nextRecord = LongLedgerCommitRecordSchema.parse({
    ...record,
    bodyEvidence
  });
  commit.recordFile.updatedAt = timestamp;
  commit.bodyEvidence = bodyEvidence;
  commit.changedChapterIds = [];
  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...loaded.index,
    updatedAt: timestamp
  });
  const manifest = LongProjectManifestSchema.parse({
    ...loaded.manifest,
    updatedAt: timestamp,
    workspaceIndexFile: {
      ...loaded.manifest.workspaceIndexFile,
      updatedAt: timestamp
    }
  });
  await commitLongProjectTransaction(
    {
      projectRoot: loaded.projectDirectory,
      operations: [
        ...files
          .filter((f) => f.reference.id !== recordFile.reference.id)
          .map((f) => ({
            action: "check" as const,
            path: f.reference.path,
            expectedSha256: f.disk.sha256
          })),
        {
          path: recordFile.reference.path,
          content: serializeJson(nextRecord),
          expectedSha256: recordFile.disk.sha256
        },
        {
          path: LONG_WORKSPACE_INDEX_PATH,
          content: serializeJson(nextIndex),
          expectedSha256: loaded.indexDisk.sha256
        },
        {
          path: MANIFEST_PATH,
          content: serializeJson(manifest),
          expectedSha256: loaded.manifestDisk.sha256
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    },
    undefined,
    true
  );
  return { record: nextRecord };
}
