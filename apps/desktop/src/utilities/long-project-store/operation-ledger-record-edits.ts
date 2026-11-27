import {
  LongLedgerCommitRecordSchema,
  type LongLedgerCommitRecord,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceLedgerRecordEdit
} from "@deepwrite/contracts";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { parseLongLedgerCommitRecord } from "../long-version-metadata";
import { loadIndexedFile } from "./cache";
import { parseJson } from "./io";
import type { LoadedLongProject } from "./types";
import { toJsonFileText } from "@deepwrite/shared";

interface LoadedLedgerRecordEdit {
  edit: LongWorkspaceLedgerRecordEdit;
  record: LongLedgerCommitRecord;
}

function factKey(value: {
  domain: string;
  subjectId: string;
  field: string;
}): string {
  return `${value.domain}\0${value.subjectId}\0${value.field}`;
}

function knowledgeKey(value: {
  factId: string;
  audienceType: string;
  audienceId: string | null;
}): string {
  return `${value.factId}\0${value.audienceType}\0${value.audienceId ?? ""}`;
}

async function loadLedgerRecordEdits(
  loaded: LoadedLongProject,
  edits: readonly LongWorkspaceLedgerRecordEdit[]
): Promise<LoadedLedgerRecordEdit[]> {
  return await Promise.all(
    edits.map(async (edit) => {
      const descriptor = loaded.files.get(edit.recordFile.id);
      if (
        !descriptor ||
        descriptor.kind !== "json" ||
        descriptor.reference.path !== edit.recordFile.path
      ) {
        throw new Error(
          `长篇连续性记录文件与当前索引不一致：${edit.recordFile.id}`
        );
      }
      const current = await loadIndexedFile(loaded, edit.recordFile.id);
      const record = parseLongLedgerCommitRecord(
        parseJson(current.disk.content, "长篇连续性记录")
      );
      if (record.id !== edit.commitId) {
        throw new Error(`长篇连续性记录 ID 与删除影响不一致：${edit.commitId}`);
      }
      return { edit, record };
    })
  );
}

function collectSemanticCleanup(
  records: readonly LoadedLedgerRecordEdit[],
  nextIndex: LongWorkspaceIndexSnapshot
) {
  const removedSubjectIds = new Set(
    records.flatMap(({ edit }) => edit.removeSubjectIds)
  );
  const removedKnowledgeAudienceIds = new Set(
    records.flatMap(({ edit }) => edit.removeKnowledgeAudienceIds)
  );
  const removedFactIds = new Set(
    records.flatMap(({ edit }) => edit.removeFactIds)
  );
  const removedFactKeys = new Set(
    records.flatMap(({ edit }) => edit.removeFactKeys.map(factKey))
  );
  const removedKnowledgeKeys = new Set(
    records.flatMap(({ edit }) => edit.removeKnowledgeKeys.map(knowledgeKey))
  );
  const removedOpenLoopIds = new Set(
    records.flatMap(({ edit }) => edit.removeOpenLoopIds)
  );
  const survivingProjectionFactIds = new Set(
    nextIndex.ledger.projection.facts.map(({ factId }) => factId)
  );
  const survivingProjectionOpenLoopIds = new Set(
    nextIndex.ledger.projection.openLoops.map(({ loopId }) => loopId)
  );

  for (const { record } of records) {
    for (const { after } of record.factChanges) {
      if (
        removedFactIds.has(after.factId) ||
        removedFactKeys.has(factKey(after)) ||
        (removedSubjectIds.has(after.subjectId) &&
          !survivingProjectionFactIds.has(after.factId))
      ) {
        removedFactIds.add(after.factId);
      }
    }
  }
  for (const { record } of records) {
    for (const { after } of record.openLoopChanges) {
      if (
        removedOpenLoopIds.has(after.loopId) ||
        (!survivingProjectionOpenLoopIds.has(after.loopId) &&
          ((after.subjectId !== null &&
            removedSubjectIds.has(after.subjectId)) ||
            (after.factId !== null && removedFactIds.has(after.factId))))
      ) {
        removedOpenLoopIds.add(after.loopId);
      }
    }
  }

  return {
    removedSubjectIds,
    removedKnowledgeAudienceIds,
    removedFactIds,
    removedFactKeys,
    removedKnowledgeKeys,
    removedOpenLoopIds
  };
}

function editLedgerRecord(
  source: LoadedLedgerRecordEdit,
  nextIndex: LongWorkspaceIndexSnapshot,
  cleanup: ReturnType<typeof collectSemanticCleanup>
): LongLedgerCommitRecord {
  const { edit, record } = source;
  const placementIds = new Set(edit.removePlacementIds);
  const beatIds = new Set(edit.removeForeshadowingBeatIds);
  const placementChanges = record.placementChanges.filter(
    ({ placementId }) => !placementIds.has(placementId)
  );
  const foreshadowingBeatChanges = record.foreshadowingBeatChanges.filter(
    ({ beatId }) => !beatIds.has(beatId)
  );
  const reconciledThreadIds = new Set(edit.reconcileForeshadowingThreadIds);
  const remainingBeatIds = new Set(
    foreshadowingBeatChanges.map(({ beatId }) => beatId)
  );
  const foreshadowingThreadChanges = record.foreshadowingThreadChanges
    .filter(({ foreshadowingId }) => !reconciledThreadIds.has(foreshadowingId))
    .concat(
      edit.reconcileForeshadowingThreadIds.flatMap((foreshadowingId) => {
        const thread = nextIndex.plot.foreshadowing.find(
          ({ id }) => id === foreshadowingId
        );
        if (
          !thread ||
          !thread.beats.some(({ id }) => remainingBeatIds.has(id))
        ) {
          return [];
        }
        return [{ foreshadowingId, after: thread.status }];
      })
    );
  const factChanges = record.factChanges.filter(
    ({ after }) =>
      !cleanup.removedSubjectIds.has(after.subjectId) &&
      !cleanup.removedFactIds.has(after.factId) &&
      !cleanup.removedFactKeys.has(factKey(after))
  );
  const knowledgeChanges = record.knowledgeChanges.filter(
    ({ after }) =>
      !cleanup.removedFactIds.has(after.factId) &&
      (after.audienceId === null ||
        !cleanup.removedKnowledgeAudienceIds.has(after.audienceId)) &&
      !cleanup.removedKnowledgeKeys.has(knowledgeKey(after))
  );
  const openLoopChanges = record.openLoopChanges.filter(
    ({ after }) =>
      !cleanup.removedOpenLoopIds.has(after.loopId) &&
      (after.subjectId === null ||
        !cleanup.removedSubjectIds.has(after.subjectId)) &&
      (after.factId === null || !cleanup.removedFactIds.has(after.factId))
  );
  const handoff = edit.replaceHandoff ?? record.chapterOutputs.handoff;

  return LongLedgerCommitRecordSchema.parse({
    ...record,
    placementChanges,
    foreshadowingBeatChanges,
    foreshadowingThreadChanges,
    factChanges,
    knowledgeChanges,
    openLoopChanges,
    chapterOutputs: {
      ...record.chapterOutputs,
      handoff: {
        ...handoff,
        mustCarry: [...handoff.mustCarry],
        nextChapterConstraints: [...handoff.nextChapterConstraints],
        openLoops: handoff.openLoops.filter(
          (loopId) => !cleanup.removedOpenLoopIds.has(loopId)
        )
      }
    }
  });
}

export async function buildLedgerRecordEditOperations(input: {
  loaded: LoadedLongProject;
  nextIndex: LongWorkspaceIndexSnapshot;
  edits: readonly LongWorkspaceLedgerRecordEdit[];
}): Promise<ProjectTransactionFileOperation[]> {
  if (input.edits.length === 0) return [];
  const records = await loadLedgerRecordEdits(input.loaded, input.edits);
  const cleanup = collectSemanticCleanup(records, input.nextIndex);
  return records.map((source) => ({
    path: source.edit.recordFile.path,
    content: toJsonFileText(editLedgerRecord(source, input.nextIndex, cleanup))
  }));
}
