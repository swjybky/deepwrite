import {
  EMPTY_LONG_CONTINUITY_PROJECTION,
  LongContinuityProjectionSchema,
  type LongContinuityProjection,
  type LongLedgerCommitIndexEntry
} from "@deepwrite/contracts";
import { parseLongLedgerCommitRecord } from "../long-version-metadata";
import { loadIndexedFile } from "./cache";
import { continuityKnowledgeKey } from "./continuity";
import { parseJson } from "./io";
import type { LoadedLongProject } from "./types";

function replaceOrAppend<T>(
  values: T[],
  key: (value: T) => string,
  incoming: T
): void {
  const incomingKey = key(incoming);
  const index = values.findIndex((value) => key(value) === incomingKey);
  if (index < 0) values.push(incoming);
  else values[index] = incoming;
}

/** Replays surviving typed ledger records because commit records keep no before-state. */
export async function rebuildLongContinuityProjection(
  loaded: LoadedLongProject,
  commits: readonly LongLedgerCommitIndexEntry[]
): Promise<LongContinuityProjection> {
  const projection = structuredClone(EMPTY_LONG_CONTINUITY_PROJECTION);
  const structuredCommits = commits.filter(({ mode }) => mode === "structured");

  for (const entry of structuredCommits) {
    const file = await loadIndexedFile(loaded, entry.recordFile.id);
    const record = parseLongLedgerCommitRecord(
      parseJson(file.disk.content, "长篇连续性记录")
    );
    if (
      record.id !== entry.id ||
      record.bookId !== loaded.manifest.id ||
      record.sequence !== entry.sequence ||
      record.chapterCardId !== entry.chapterCardId
    ) {
      throw new Error(`连续性记录与工作区索引不一致：${entry.id}。`);
    }
    if (record.schemaVersion < 3) continue;

    for (const { after } of record.factChanges) {
      replaceOrAppend(projection.facts, ({ factId }) => factId, {
        ...after
      });
    }
    for (const { after } of record.knowledgeChanges) {
      replaceOrAppend(projection.knowledge, continuityKnowledgeKey, {
        ...after
      });
    }
    for (const { after } of record.openLoopChanges) {
      replaceOrAppend(projection.openLoops, ({ loopId }) => loopId, {
        ...after
      });
    }
    projection.throughCommitId = record.id;
    projection.latestHandoff = {
      ...record.chapterOutputs.handoff,
      mustCarry: [...record.chapterOutputs.handoff.mustCarry],
      nextChapterConstraints: [
        ...record.chapterOutputs.handoff.nextChapterConstraints
      ],
      openLoops: [...record.chapterOutputs.handoff.openLoops],
      chapterCardId: record.chapterCardId,
      commitId: record.id
    };
  }

  return LongContinuityProjectionSchema.parse(projection);
}
