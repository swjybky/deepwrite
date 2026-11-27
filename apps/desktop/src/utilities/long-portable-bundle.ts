import {
  LONG_WORKSPACE_DELETED_LATEST_HANDOFF_SUMMARY,
  LongContinuityProjectionSchema,
  LongProjectManifestSchema,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerCommitChapterIds,
  longLedgerRecordChapterIds,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  parseLongWorldbuildingMarkdownList,
  type LongContinuityProjection,
  type LongLedgerCommitRecord,
  type LongLedgerCommitIndexEntry,
  type LongProjectManifest,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { assertLongV4LedgerFileAudit } from "./long-ledger-v4-audit";
import {
  parseLongLedgerCommitRecord,
  stripLegacyLongVersionMetadata
} from "./long-version-metadata";
import { isRecord, toJsonFileText } from "@deepwrite/shared";
import { sha256Hex } from "@deepwrite/shared/node";

export const LONG_PORTABLE_BUNDLE_SCHEMA =
  "deepwrite.long-book.portable" as const;
export const LONG_PORTABLE_BUNDLE_SCHEMA_VERSION = 1 as const;

/**
 * Portable JSON is currently parsed/stringified in memory. Keep the hard
 * ceiling well below the former 512 MiB value so raw UTF-8, decoded strings
 * and the serialized result cannot combine into a multi-gigabyte peak.
 */
export const LONG_PORTABLE_BUNDLE_MAX_BYTES = 64 * 1024 * 1024;
const LONG_PORTABLE_BUNDLE_MAX_LABEL = "64 MB";
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_LEDGER_RECORD_BYTES = 128 * 1024 * 1024;

export interface LongPortableBundleJsonEntry<T> {
  mediaType: "application/json";
  sha256: string;
  value: T;
}

export interface LongPortableBundleFile {
  id: string;
  path: string;
  kind: "markdown" | "ledger-record";
  sha256: string;
  content: string;
}

export interface LongPortableExportBundle {
  schema: typeof LONG_PORTABLE_BUNDLE_SCHEMA;
  schemaVersion: typeof LONG_PORTABLE_BUNDLE_SCHEMA_VERSION;
  exportedAt: string;
  bookId: string;
  manifest: LongPortableBundleJsonEntry<LongProjectManifest>;
  index: LongPortableBundleJsonEntry<LongWorkspaceIndexSnapshot>;
  files: LongPortableBundleFile[];
  agentsMd?: string;
}

interface IndexedPortableFile {
  reference: LongWorkspaceFileReference;
  kind: LongPortableBundleFile["kind"];
  commitId?: string;
}

function continuityFactKey(
  value: Pick<
    LongContinuityProjection["facts"][number],
    "domain" | "subjectId" | "field"
  >
): string {
  return `${value.domain}\0${value.subjectId}\0${value.field.normalize("NFC")}`;
}

function continuityKnowledgeKey(
  value: Pick<
    LongContinuityProjection["knowledge"][number],
    "factId" | "audienceType" | "audienceId"
  >
): string {
  return `${value.factId}\0${value.audienceType}\0${value.audienceId ?? ""}`;
}

function sameContinuityEntity(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function replayContinuityProjection(
  records: readonly LongLedgerCommitRecord[]
): LongContinuityProjection {
  const projection: LongContinuityProjection = {
    throughCommitId: null,
    facts: [],
    knowledge: [],
    openLoops: [],
    latestHandoff: null
  };
  const factIndexById = new Map<string, number>();
  const factIndexByKey = new Map<string, number>();
  const knowledgeIndexByKey = new Map<string, number>();
  const openLoopIndexById = new Map<string, number>();
  for (const record of records) {
    const replaysTypedContinuity = record.schemaVersion === 3;
    if (replaysTypedContinuity) {
      for (const change of record.factChanges) {
        const factKey = continuityFactKey(change.after);
        const idIndex = factIndexById.get(change.after.factId);
        const keyIndex = factIndexByKey.get(factKey);
        if (
          idIndex !== undefined &&
          keyIndex !== undefined &&
          idIndex !== keyIndex
        ) {
          throw new Error(`连续性事实变更链不一致：${change.after.factId}。`);
        }
        const existingIndex = idIndex ?? keyIndex;
        if (existingIndex === undefined) {
          const nextIndex = projection.facts.length;
          projection.facts.push({ ...change.after });
          factIndexById.set(change.after.factId, nextIndex);
          factIndexByKey.set(factKey, nextIndex);
        } else {
          const previous = projection.facts[existingIndex]!;
          factIndexByKey.delete(continuityFactKey(previous));
          projection.facts[existingIndex] = { ...change.after };
          factIndexById.set(change.after.factId, existingIndex);
          factIndexByKey.set(factKey, existingIndex);
        }
      }
      for (const change of record.knowledgeChanges) {
        const key = continuityKnowledgeKey(change.after);
        const index = knowledgeIndexByKey.get(key);
        if (index === undefined) {
          knowledgeIndexByKey.set(key, projection.knowledge.length);
          projection.knowledge.push({ ...change.after });
        } else {
          projection.knowledge[index] = { ...change.after };
        }
      }
      for (const change of record.openLoopChanges) {
        const index = openLoopIndexById.get(change.after.loopId);
        if (index === undefined) {
          openLoopIndexById.set(
            change.after.loopId,
            projection.openLoops.length
          );
          projection.openLoops.push({ ...change.after });
        } else {
          projection.openLoops[index] = { ...change.after };
        }
      }
    }
    const isCleanupHandoffWatermark =
      record.schemaVersion === 2 &&
      record.chapterOutputs.handoff.summary ===
        LONG_WORKSPACE_DELETED_LATEST_HANDOFF_SUMMARY;
    if (!replaysTypedContinuity && !isCleanupHandoffWatermark) continue;
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

function normalizedTimestamp(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.valueOf())) {
    throw new Error("长篇可移植包导出时间不是有效的 ISO 时间。");
  }
  return date.toISOString();
}

function indexedFiles(
  index: LongWorkspaceIndexSnapshot
): IndexedPortableFile[] {
  return [
    { reference: index.bookLine, kind: "markdown" },
    ...(index.writeReceipts ?? []).map((file) => ({
      reference: file,
      kind: "markdown" as const
    })),
    ...index.worldbuilding.flatMap((category) =>
      (category.format === "text"
        ? [category.file]
        : [
            ...(category.overview ? [category.overview] : []),
            ...category.items.map(({ file }) => file)
          ]
      ).map((reference) => ({
        reference,
        kind: "markdown" as const
      }))
    ),
    ...(index.characterOverview
      ? [{ reference: index.characterOverview, kind: "markdown" as const }]
      : []),
    ...index.characterFiles.flatMap((entry) => [
      { reference: entry.coreProfile, kind: "markdown" as const },
      { reference: entry.relationships, kind: "markdown" as const }
    ]),
    ...index.chapters.flatMap((entry) => [
      { reference: entry.body, kind: "markdown" as const },
      { reference: entry.card, kind: "markdown" as const },
      { reference: entry.characterState, kind: "markdown" as const },
      { reference: entry.handoff, kind: "markdown" as const },
      { reference: entry.foreshadowingChanges, kind: "markdown" as const },
      ...(entry.worldReveals
        ? [{ reference: entry.worldReveals, kind: "markdown" as const }]
        : []),
      ...entry.characterContinuity.flatMap((continuity) => [
        { reference: continuity.currentState, kind: "markdown" as const },
        { reference: continuity.history, kind: "markdown" as const }
      ])
    ]),
    ...index.plot.storyPlots.map((entry) => ({
      reference: entry.file,
      kind: "markdown" as const
    })),
    ...index.ledger.commits.map((commit) => ({
      reference: commit.recordFile,
      kind: "ledger-record" as const,
      commitId: commit.id
    }))
  ];
}

function validateManifestIndexPair(
  manifest: LongProjectManifest,
  index: LongWorkspaceIndexSnapshot
): void {
  if (manifest.id !== index.bookId) {
    throw new Error("长篇清单与工作区索引的 bookId 不一致。");
  }
  if (
    manifest.updatedAt !== index.updatedAt ||
    manifest.workspaceIndexFile.updatedAt !== index.updatedAt
  ) {
    throw new Error("长篇清单与工作区索引的更新时间不一致。");
  }
}

function validateLedgerRecord(
  content: string,
  expectedBookId: string,
  expectedCommitId: string
): LongLedgerCommitRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`账本记录 ${expectedCommitId} 不是有效 JSON。`);
  }
  const record = parseLongLedgerCommitRecord(raw);
  if (record.bookId !== expectedBookId || record.id !== expectedCommitId) {
    throw new Error(`账本记录 ${expectedCommitId} 的身份与索引不一致。`);
  }
  return record;
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  const leftIds = new Set(left);
  const rightIds = new Set(right);
  return (
    left.length === right.length &&
    leftIds.size === left.length &&
    rightIds.size === right.length &&
    leftIds.size === rightIds.size &&
    left.every((id) => rightIds.has(id))
  );
}

export function assertLongLedgerRecordMatchesIndex(
  index: LongWorkspaceIndexSnapshot,
  entry: LongLedgerCommitIndexEntry,
  record: LongLedgerCommitRecord,
  _recordContent?: string
): void {
  const indexedPosition = index.ledger.commits.findIndex(
    (candidate) => candidate.id === entry.id
  );
  const indexedChapterIds = longLedgerCommitChapterIds(entry);
  const recordedChapterIds = longLedgerRecordChapterIds(record);
  const chaptersMatch =
    indexedChapterIds.length === recordedChapterIds.length &&
    indexedChapterIds.every(
      (chapterCardId, index) => chapterCardId === recordedChapterIds[index]
    );
  const chaptersCarryCommit = indexedChapterIds.every((chapterCardId) =>
    index.chapters.some(
      (candidate) =>
        candidate.chapterCardId === chapterCardId &&
        candidate.commitId === entry.id
    )
  );
  const importCheckpointMatches =
    entry.mode === "import_checkpoint" &&
    record.schemaVersion === 1 &&
    record.placementChanges.length === 0 &&
    record.foreshadowingBeatChanges.length === 0 &&
    record.foreshadowingThreadChanges.length === 0 &&
    record.continuityFiles.length === 0 &&
    record.factChanges.length === 0 &&
    record.knowledgeChanges.length === 0 &&
    record.openLoopChanges.length === 0;
  const modeMatches =
    importCheckpointMatches ||
    (entry.mode === "text_files" && record.schemaVersion === 4) ||
    (entry.mode === "text_files_batch" && record.schemaVersion === 5) ||
    (entry.mode === "structured" &&
      record.schemaVersion !== 4 &&
      record.schemaVersion !== 5);
  if (
    indexedPosition < 0 ||
    record.id !== entry.id ||
    record.bookId !== index.bookId ||
    record.sequence !== entry.sequence ||
    record.chapterCardId !== entry.chapterCardId ||
    !chaptersMatch ||
    record.committedAt !== entry.committedAt ||
    !modeMatches ||
    !chaptersCarryCommit ||
    !sameIdSet(
      entry.placementIds,
      record.placementChanges.map(({ placementId }) => placementId)
    ) ||
    !sameIdSet(
      entry.foreshadowingBeatIds,
      record.foreshadowingBeatChanges.map(({ beatId }) => beatId)
    )
  ) {
    throw new Error(`账本记录 ${entry.id} 与工作区索引不一致。`);
  }
}

export function assertLongLedgerRecordChain(
  index: LongWorkspaceIndexSnapshot,
  records: readonly LongLedgerCommitRecord[],
  continuityFileContents?: ReadonlyMap<string, string>
): void {
  if (records.length !== index.ledger.commits.length) {
    throw new Error("连续性账本记录链数量与索引不一致。");
  }
  const recordsById = new Map(
    records.map((record) => [record.id, record] as const)
  );
  if (recordsById.size !== records.length) {
    throw new Error("连续性账本包含重复记录身份。");
  }
  const characterSubjectIds = new Set(index.characters.map(({ id }) => id));
  const worldSubjectIds = new Set(index.worldbuilding.map(({ id }) => id));
  const plotSubjectIds = new Set<string>([
    index.bookId,
    ...index.plot.volumes.map(({ id }) => id),
    ...index.plot.arcs.map(({ id }) => id),
    ...index.plot.chapterCards.map(({ id }) => id),
    ...index.plot.storyEvents.map(({ id }) => id),
    ...index.plot.storyPlots.map(({ id }) => id),
    ...index.plot.eventConnections.map(({ id }) => id),
    ...index.plot.narrativePlacements.map(({ id }) => id)
  ]);
  const foreshadowingSubjectIds = new Set<string>(
    index.plot.foreshadowing.flatMap((thread) => [
      thread.id,
      ...thread.beats.map(({ id }) => id)
    ])
  );
  const orderedRecords: LongLedgerCommitRecord[] = [];
  for (const entry of index.ledger.commits) {
    const record = recordsById.get(entry.id);
    if (!record) throw new Error(`连续性账本缺少记录：${entry.id}。`);
    assertLongLedgerRecordMatchesIndex(index, entry, record);
    orderedRecords.push(record);
    assertLongV4LedgerFileAudit(index, entry, record, continuityFileContents);
    if (record.schemaVersion === 3) {
      for (const { after: fact } of record.factChanges) {
        const subjectExists =
          fact.domain === "character" || fact.domain === "relationship"
            ? characterSubjectIds.has(fact.subjectId)
            : fact.domain === "world"
              ? worldSubjectIds.has(fact.subjectId)
              : fact.domain === "plot"
                ? plotSubjectIds.has(fact.subjectId)
                : foreshadowingSubjectIds.has(fact.subjectId);
        if (!subjectExists) {
          throw new Error(
            `v3 连续性事实包含孤立 subjectId：${fact.factId} / ${fact.subjectId}。`
          );
        }
      }
    }
  }
  const replayedProjection = replayContinuityProjection(orderedRecords);
  if (!sameContinuityEntity(replayedProjection, index.ledger.projection)) {
    throw new Error("连续性账本类型化投影与记录链不一致。");
  }

  const latestPlacements = new Map<
    string,
    { status: string; commitId: string | null }
  >();
  const latestBeats = new Map<
    string,
    { status: string; commitId: string | null }
  >();
  const latestThreads = new Map<string, string>();
  for (const record of orderedRecords) {
    for (const change of record.placementChanges) {
      latestPlacements.set(change.placementId, { ...change.after });
    }
    for (const change of record.foreshadowingBeatChanges) {
      latestBeats.set(change.beatId, { ...change.after });
    }
    for (const change of record.foreshadowingThreadChanges) {
      latestThreads.set(change.foreshadowingId, change.after);
    }
  }
  for (const [placementId, state] of latestPlacements) {
    const current = index.plot.narrativePlacements.find(
      ({ id }) => id === placementId
    );
    if (
      !current ||
      current.status !== state.status ||
      current.commitId !== state.commitId
    ) {
      throw new Error(`连续性账本叙事落点末态不一致：${placementId}。`);
    }
  }
  for (const [beatId, state] of latestBeats) {
    const current = index.plot.foreshadowing
      .flatMap(({ beats }) => beats)
      .find(({ id }) => id === beatId);
    if (
      !current ||
      current.status !== state.status ||
      current.commitId !== state.commitId
    ) {
      throw new Error(`连续性账本伏笔节拍末态不一致：${beatId}。`);
    }
  }
  for (const [threadId, status] of latestThreads) {
    const current = index.plot.foreshadowing.find(({ id }) => id === threadId);
    if (!current || current.status !== status) {
      throw new Error(`连续性账本伏笔线末态不一致：${threadId}。`);
    }
  }
}

function assertUniqueIndexedFiles(files: readonly IndexedPortableFile[]): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const { reference } of files) {
    const pathKey = reference.path.normalize("NFC").toLocaleLowerCase("en-US");
    if (ids.has(reference.id) || paths.has(pathKey)) {
      throw new Error(
        `长篇工作区索引包含重复文件：${reference.id} / ${reference.path}。`
      );
    }
    ids.add(reference.id);
    paths.add(pathKey);
  }
}

function parseBundleInput(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") {
    if (!isRecord(raw)) {
      throw new Error("长篇可移植包必须是 JSON 对象。");
    }
    return raw;
  }
  if (Buffer.byteLength(raw, "utf8") > LONG_PORTABLE_BUNDLE_MAX_BYTES) {
    throw new Error(
      `长篇可移植包超过 ${LONG_PORTABLE_BUNDLE_MAX_LABEL} 内存安全上限。`
    );
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw new Error("长篇可移植包不是有效 JSON 对象。");
  }
}

function parseJsonEntry(
  raw: unknown,
  label: string
): {
  sha256: string;
  value: unknown;
} {
  const entry = recordOrThrow(raw, `${label}条目`);
  if (
    entry.mediaType !== "application/json" ||
    typeof entry.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(entry.sha256)
  ) {
    throw new Error(`长篇可移植包的${label}条目格式无效。`);
  }
  return { sha256: entry.sha256, value: entry.value };
}

function recordOrThrow(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`长篇可移植包的${label}格式无效。`);
  }
  return value;
}

function normalizeLegacyPortableWorldbuilding(
  rawIndex: unknown,
  rawFiles: unknown
): {
  index: unknown;
  files: unknown[];
} {
  if (!Array.isArray(rawFiles)) {
    throw new Error("长篇可移植包的 files 格式无效。");
  }
  if (!isRecord(rawIndex) || !Array.isArray(rawIndex.worldbuilding)) {
    return { index: rawIndex, files: rawFiles };
  }

  let migrated = false;
  let files = [...rawFiles];
  const worldbuilding = rawIndex.worldbuilding.map((rawCategory) => {
    if (
      !isRecord(rawCategory) ||
      rawCategory.format !== "list" ||
      rawCategory.contentAuthority !== "markdown"
    ) {
      return rawCategory;
    }

    const categoryId = typeof rawCategory.id === "string" ? rawCategory.id : "";
    const legacyFile = LongWorkspaceFileReferenceSchema.parse(rawCategory.file);
    const matching = files.filter(
      (rawFile) => isRecord(rawFile) && rawFile.id === legacyFile.id
    );
    if (matching.length !== 1) {
      throw new Error(`旧版世界观分类 ${categoryId} 的聚合文件缺失或重复。`);
    }
    const aggregate = recordOrThrow(
      matching[0],
      `旧版世界观分类 ${categoryId} 的聚合文件`
    );
    if (
      aggregate.kind !== "markdown" ||
      aggregate.path !== legacyFile.path ||
      typeof aggregate.sha256 !== "string" ||
      typeof aggregate.content !== "string" ||
      aggregate.sha256 !== sha256Hex(aggregate.content)
    ) {
      throw new Error(
        `旧版世界观分类 ${categoryId} 的聚合文件完整性校验失败。`
      );
    }

    const items = parseLongWorldbuildingMarkdownList(aggregate.content).map(
      (item, itemIndex) => {
        const path = longWorldbuildingItemContentPath(categoryId, item.id);
        const file = {
          id: longWorldbuildingItemFileId(item.id),
          path,
          updatedAt: legacyFile.updatedAt
        };
        files.push({
          id: file.id,
          path,
          kind: "markdown",
          sha256: sha256Hex(item.content),
          content: item.content
        });
        return {
          id: item.id,
          title: item.title,
          order: itemIndex + 1,
          file
        };
      }
    );
    files = files.filter((rawFile) => rawFile !== matching[0]);
    const overviewPath = longWorldbuildingOverviewContentPath(categoryId);
    const overview = {
      id: longWorldbuildingOverviewFileId(categoryId),
      path: overviewPath,
      updatedAt: legacyFile.updatedAt
    };
    files.push({
      id: overview.id,
      path: overviewPath,
      kind: "markdown",
      sha256: sha256Hex(""),
      content: ""
    });
    migrated = true;
    return {
      id: rawCategory.id,
      title: rawCategory.title,
      order: rawCategory.order,
      format: "list",
      contentAuthority: "files",
      overview,
      items
    };
  });

  return migrated
    ? {
        index: {
          ...rawIndex,
          worldbuilding
        },
        files
      }
    : { index: rawIndex, files };
}

function normalizeLegacyPortableChapterContinuity(
  rawIndex: unknown,
  rawFiles: unknown
): { index: unknown; files: unknown[] } {
  if (
    !isRecord(rawIndex) ||
    !Array.isArray(rawIndex.chapters) ||
    !Array.isArray(rawFiles)
  ) {
    return {
      index: rawIndex,
      files: Array.isArray(rawFiles) ? rawFiles : []
    };
  }
  let migrated = false;
  const files = [...rawFiles];
  const chapters = rawIndex.chapters.map((rawChapter) => {
    if (
      !isRecord(rawChapter) ||
      typeof rawChapter.chapterCardId !== "string" ||
      isRecord(rawChapter.foreshadowingChanges)
    ) {
      return rawChapter;
    }
    migrated = true;
    const body = isRecord(rawChapter.body) ? rawChapter.body : {};
    const chapterCardId = rawChapter.chapterCardId;
    const id = longChapterForeshadowingChangesFileId(chapterCardId);
    const path = longChapterContinuityFilePath(
      chapterCardId,
      "foreshadowing-changes.md"
    );
    const existing = files.find(
      (rawFile) => isRecord(rawFile) && rawFile.id === id
    );
    const content =
      isRecord(existing) && typeof existing.content === "string"
        ? existing.content
        : "";
    if (!existing) {
      files.push({
        id,
        path,
        kind: "markdown",
        sha256: sha256Hex(content),
        content
      });
    }
    return {
      ...rawChapter,
      foreshadowingChanges: {
        id,
        path,
        updatedAt:
          typeof body.updatedAt === "string"
            ? body.updatedAt
            : "1970-01-01T00:00:00.000Z"
      },
      worldReveals: rawChapter.worldReveals ?? null,
      characterContinuity: rawChapter.characterContinuity ?? []
    };
  });
  return migrated
    ? { index: { ...rawIndex, chapters }, files }
    : { index: rawIndex, files };
}

export function parseLongPortableExportBundle(
  raw: unknown
): LongPortableExportBundle {
  const bundle = parseBundleInput(raw);
  if (
    bundle.schema !== LONG_PORTABLE_BUNDLE_SCHEMA ||
    bundle.schemaVersion !== LONG_PORTABLE_BUNDLE_SCHEMA_VERSION
  ) {
    throw new Error("不支持的长篇可移植包 schema。");
  }
  const exportedAt = normalizedTimestamp(bundle.exportedAt);
  const manifestEntry = parseJsonEntry(bundle.manifest, "manifest");
  const indexEntry = parseJsonEntry(bundle.index, "index");
  const rawManifestContent = toJsonFileText(manifestEntry.value);
  const rawIndexContent = toJsonFileText(indexEntry.value);
  if (
    manifestEntry.sha256 !== sha256Hex(rawManifestContent) ||
    indexEntry.sha256 !== sha256Hex(rawIndexContent)
  ) {
    throw new Error("长篇可移植包的 manifest 或 index SHA-256 校验失败。");
  }
  const manifestValue = stripLegacyLongVersionMetadata(
    manifestEntry.value
  ).value;
  const indexValue = stripLegacyLongVersionMetadata(indexEntry.value).value;
  const normalizedWorldbuilding = normalizeLegacyPortableWorldbuilding(
    indexValue,
    bundle.files
  );
  const normalizedContinuity = normalizeLegacyPortableChapterContinuity(
    normalizedWorldbuilding.index,
    normalizedWorldbuilding.files
  );
  const manifest = LongProjectManifestSchema.parse(manifestValue);
  const index = LongWorkspaceIndexSnapshotSchema.parse(
    normalizedContinuity.index
  );
  if (manifest.id !== index.bookId) {
    throw new Error("长篇清单与可移植包原始索引不一致。");
  }
  const normalizedIndexContent = toJsonFileText(index);
  validateManifestIndexPair(manifest, index);
  if (bundle.bookId !== manifest.id) {
    throw new Error("长篇可移植包顶层 bookId 与 manifest 不一致。");
  }

  const expected = indexedFiles(index);
  assertUniqueIndexedFiles(expected);
  const expectedById = new Map(
    expected.map((entry) => [entry.reference.id, entry])
  );
  if (normalizedContinuity.files.length !== expected.length) {
    throw new Error("长篇可移植包没有完整包含索引中的全部文档。");
  }
  let totalBytes = 0;
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const ledgerRecords: LongLedgerCommitRecord[] = [];
  const files = normalizedContinuity.files.map((rawFile) => {
    const file = recordOrThrow(rawFile, "文件条目");
    if (
      typeof file.id !== "string" ||
      typeof file.path !== "string" ||
      typeof file.sha256 !== "string" ||
      typeof file.content !== "string" ||
      (file.kind !== "markdown" && file.kind !== "ledger-record") ||
      !/^[0-9a-f]{64}$/u.test(file.sha256)
    ) {
      throw new Error("长篇可移植包包含格式无效的文件条目。");
    }
    const expectedFile = expectedById.get(file.id);
    if (!expectedFile) {
      throw new Error(`长篇可移植包包含索引外文件：${file.id}。`);
    }
    const pathKey = file.path.normalize("NFC").toLocaleLowerCase("en-US");
    if (seenIds.has(file.id) || seenPaths.has(pathKey)) {
      throw new Error(`长篇可移植包包含重复文件：${file.id}。`);
    }
    seenIds.add(file.id);
    seenPaths.add(pathKey);
    if (
      file.path !== expectedFile.reference.path ||
      file.kind !== expectedFile.kind
    ) {
      throw new Error(`长篇可移植包中文件 ${file.id} 与索引不一致。`);
    }
    const bytes = Buffer.from(file.content, "utf8");
    if (bytes.toString("utf8") !== file.content) {
      throw new Error(`长篇可移植包中文件 ${file.id} 包含无效 Unicode。`);
    }
    totalBytes += bytes.byteLength;
    if (
      bytes.byteLength >
        (expectedFile.kind === "ledger-record"
          ? MAX_LEDGER_RECORD_BYTES
          : MAX_FILE_BYTES) ||
      totalBytes > LONG_PORTABLE_BUNDLE_MAX_BYTES
    ) {
      throw new Error("长篇可移植包的文件内容超过安全上限。");
    }
    if (sha256Hex(bytes) !== file.sha256) {
      throw new Error(`长篇可移植包中文件 ${file.id} 完整性校验失败。`);
    }
    let content = file.content;
    if (file.kind === "ledger-record") {
      const record = validateLedgerRecord(
        file.content,
        index.bookId,
        expectedFile.commitId!
      );
      const entry = index.ledger.commits.find(
        (candidate) => candidate.id === expectedFile.commitId
      )!;
      assertLongLedgerRecordMatchesIndex(index, entry, record, file.content);
      ledgerRecords.push(record);
      content = toJsonFileText(record);
    }
    return {
      id: file.id,
      path: file.path,
      kind: file.kind,
      sha256: sha256Hex(content),
      content
    } satisfies LongPortableBundleFile;
  });
  if (seenIds.size !== expectedById.size) {
    throw new Error("长篇可移植包缺少索引中的文档。");
  }
  const continuityFileContents = new Map(
    files
      .filter(({ kind }) => kind === "markdown")
      .map(({ id, content }) => [id, content] as const)
  );
  assertLongLedgerRecordChain(index, ledgerRecords, continuityFileContents);
  const agentsMd =
    typeof bundle.agentsMd === "string" ? bundle.agentsMd : undefined;
  return {
    schema: LONG_PORTABLE_BUNDLE_SCHEMA,
    schemaVersion: LONG_PORTABLE_BUNDLE_SCHEMA_VERSION,
    exportedAt,
    bookId: manifest.id,
    manifest: {
      mediaType: "application/json",
      sha256: sha256Hex(toJsonFileText(manifest)),
      value: manifest
    },
    index: {
      mediaType: "application/json",
      sha256: sha256Hex(normalizedIndexContent),
      value: index
    },
    files,
    ...(agentsMd !== undefined ? { agentsMd } : {})
  };
}
