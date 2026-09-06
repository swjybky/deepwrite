import {
  LongFileIdSchema,
  LONG_WORKSPACE_INDEX_PATH,
  type LongProjectManifest,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { assertLongLedgerRecordMatchesIndex } from "../long-portable-bundle";
import { parseLongLedgerCommitRecord } from "../long-version-metadata";
import type { WriteClawLongImportPlan } from "../write-claw-long-import";
import { encodeUtf8Strict, parseJson } from "./io";
import {
  indexedFileSlots,
  isCompatibleRolePath,
  portablePathKey
} from "./paths";
import {
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MIGRATION_EVIDENCE_WORLD_ID_PREFIX,
  type IndexedFileSlot
} from "./types";

export function assertMutableChapterDocument(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): void {
  const committedContinuity = index.chapters.some(
    (chapter) =>
      chapter.commitId !== null &&
      [
        chapter.characterState,
        chapter.handoff,
        chapter.foreshadowingChanges,
        chapter.worldReveals,
        ...chapter.characterContinuity.flatMap((character) => [
          character.currentState,
          character.history
        ])
      ].some((file) => file?.id === fileId)
  );
  if (committedContinuity) {
    throw new Error("已提交的连续性文件为只读，请先删除对应提交记录再修改。");
  }
}

export function assertDirectlyMutableDocument(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): void {
  if (
    index.worldbuilding.some(
      (category) =>
        category.id.startsWith(MIGRATION_EVIDENCE_WORLD_ID_PREFIX) &&
        (category.format === "text"
          ? category.file.id === fileId
          : category.overview?.id === fileId ||
            category.items.some(({ file }) => file.id === fileId))
    )
  ) {
    throw new Error("只读迁移证据不能修改。");
  }
  assertMutableChapterDocument(index, fileId);
}

export function assertExactDecisionIds(
  label: string,
  expectedIds: readonly string[],
  receivedIds: readonly string[]
): void {
  const expected = new Set(expectedIds);
  const received = new Set(receivedIds);
  if (
    expected.size !== received.size ||
    [...expected].some((id) => !received.has(id))
  ) {
    throw new Error(`${label}决策必须完整覆盖当前章节且不能包含其他章节。`);
  }
}

export function validateImportPlan(
  plan: WriteClawLongImportPlan,
  manifest: LongProjectManifest,
  index: LongWorkspaceIndexSnapshot
): void {
  if (
    manifest.id !== index.bookId ||
    manifest.updatedAt !== index.updatedAt ||
    manifest.workspaceIndexFile.updatedAt !== index.updatedAt
  ) {
    throw new Error("Write Claw 长篇导入计划的 manifest 与索引不一致。");
  }
  if (
    (plan.committedChapterPolicy === "written-uncommitted" &&
      (index.ledger.commits.length !== 0 ||
        index.ledger.committedThroughChapterId !== null ||
        index.chapters.some(({ commitId }) => commitId !== null))) ||
    (plan.committedChapterPolicy === "legacy-checkpoints" &&
      index.ledger.commits.length === 0)
  ) {
    throw new Error("Write Claw 导入的迁移检查点策略与账本索引不一致。");
  }

  const slots = indexedFileSlots(index);
  validatePortableAndCanonicalPaths(slots);
  if (slots.some((slot) => slot.reference.path !== slot.expectedPath)) {
    throw new Error("Write Claw 导入计划必须使用稳定 ID 推导的规范文件路径。");
  }
  if (plan.documents.length !== slots.length) {
    throw new Error("Write Claw 导入计划没有完整包含全部索引文档。");
  }
  const slotById = new Map(slots.map((slot) => [slot.reference.id, slot]));
  const seenIds = new Set<string>();
  for (const document of plan.documents) {
    const fileId = LongFileIdSchema.parse(document.fileId);
    const slot = slotById.get(fileId);
    if (!slot || seenIds.has(fileId)) {
      throw new Error(`Write Claw 导入计划包含重复或索引外文件：${fileId}。`);
    }
    seenIds.add(fileId);
    const bytes = encodeUtf8Strict(document.content);
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new Error(`Write Claw 导入文档超过 32 MiB：${document.path}`);
    }
    if (document.kind !== slot.kind || document.path !== slot.reference.path) {
      throw new Error(`Write Claw 导入文档与索引不一致：${fileId}。`);
    }
    if (document.kind === "json") {
      const record = parseLongLedgerCommitRecord(
        parseJson(document.content, "Write Claw 迁移检查点")
      );
      const entry = index.ledger.commits.find(
        (candidate) => candidate.recordFile.id === fileId
      );
      if (!entry) {
        throw new Error(`Write Claw 迁移检查点没有索引：${fileId}。`);
      }
      assertLongLedgerRecordMatchesIndex(
        index,
        entry,
        record,
        document.content
      );
    }
  }
}

export function validatePortableAndCanonicalPaths(
  slots: IndexedFileSlot[]
): void {
  const keys = new Set<string>([
    portablePathKey(MANIFEST_PATH),
    portablePathKey(LONG_WORKSPACE_INDEX_PATH)
  ]);
  for (const slot of slots) {
    if (!isCompatibleRolePath(slot)) {
      throw new Error(`长篇文件路径不符合其文件角色：${slot.reference.path}`);
    }
    const key = portablePathKey(slot.reference.path);
    if (keys.has(key)) {
      throw new Error(
        `长篇文件路径存在大小写或 Unicode 等价冲突：${slot.reference.path}`
      );
    }
    keys.add(key);
  }
}
