import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterWorldRevealsFileId,
  type LongLedgerCommitRecord,
  type LongProjectManifest,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { assertLongLedgerRecordMatchesIndex } from "../../long-portable-bundle";
import type { ProjectTransactionFileOperation } from "../../project-transaction";
import { parseLongLedgerCommitRecord } from "../../long-version-metadata";
import {
  appendLongCharacterHistoryEntry,
  serializeLongContinuityHandoff
} from "../continuity";
import {
  commitLongProjectTransaction,
  parseJson,
  readSecureTextFile,
  unknownRecord
} from "../io";
import { encodeUtf8Strict } from "../utf8";
import {
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  type SecureTextFile
} from "../types";
import { isNodeError } from "@deepwrite/shared/node";
import { toJsonFileText } from "@deepwrite/shared";

/**
 * Backfills the one continuity document that every chapter owns. Optional
 * world-reveal and per-character documents remain absent until the
 * continuity stage explicitly creates them.
 */
export async function migrateLegacyChapterContinuityFiles(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  if (!rawIndex || !Array.isArray(rawIndex.chapters)) return false;

  let changed = false;
  const fileOperations: ProjectTransactionFileOperation[] = [];
  const chapters: unknown[] = [];
  for (const rawChapter of rawIndex.chapters) {
    const chapter = unknownRecord(rawChapter);
    if (!chapter || typeof chapter.chapterCardId !== "string") {
      chapters.push(rawChapter);
      continue;
    }
    if (unknownRecord(chapter.foreshadowingChanges)) {
      chapters.push(rawChapter);
      continue;
    }

    changed = true;
    const chapterCardId = chapter.chapterCardId;
    const path = longChapterContinuityFilePath(
      chapterCardId,
      "foreshadowing-changes.md"
    );
    let content = "";
    let exists = false;
    try {
      const disk = await readSecureTextFile(
        input.projectDirectory,
        path,
        MAX_DOCUMENT_BYTES
      );
      content = disk.content;
      exists = true;
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    if (!exists) {
      fileOperations.push({
        path,
        content,
        expectedSha256: null
      });
    }
    chapters.push({
      ...chapter,
      foreshadowingChanges: {
        id: longChapterForeshadowingChangesFileId(chapterCardId),
        path,
        updatedAt:
          typeof chapter.body === "object" && chapter.body !== null
            ? (unknownRecord(chapter.body)?.updatedAt ??
              input.manifest.updatedAt)
            : input.manifest.updatedAt
      },
      worldReveals: chapter.worldReveals ?? null,
      characterContinuity: chapter.characterContinuity ?? []
    });
  }
  if (!changed) return false;

  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...rawIndex,
    chapters
  });
  const indexContent = toJsonFileText(nextIndex);
  const nextManifest = LongProjectManifestSchema.parse({
    ...input.manifest
  });
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
      ...fileOperations,
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: indexContent,
        expectedSha256: input.indexDisk.sha256
      },
      {
        path: MANIFEST_PATH,
        content: toJsonFileText(nextManifest),
        expectedSha256: input.manifestDisk.sha256
      }
    ],
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return true;
}

type LegacyProjectedCharacter = {
  characterId: string;
  currentState: string;
  exactHistory: string | null;
  historyEntry: string;
};

/**
 * Projects recoverable v1-v3 structured continuity into the chapter Markdown
 * files used by the current UI. The original record and its `structured` mode
 * remain untouched, so its semantic audit stays available.
 */
export async function migrateLegacyStructuredContinuityFiles(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  if (!rawIndex || !Array.isArray(rawIndex.characterFiles)) return false;
  const ledger = unknownRecord(rawIndex.ledger);
  if (
    !Array.isArray(ledger?.commits) ||
    !ledger.commits.some((commit) => {
      const entry = unknownRecord(commit);
      // Old entries omit mode; the contract defaults them to structured.
      return entry && (entry.mode === undefined || entry.mode === "structured");
    })
  ) {
    return false;
  }
  const legacyCharacterFiles = rawIndex.characterFiles.map((value) =>
    unknownRecord(value)
  );
  const index = LongWorkspaceIndexSnapshotSchema.parse({
    ...rawIndex,
    characterFiles: rawIndex.characterFiles.map((value) => {
      const entry = unknownRecord(value);
      if (!entry) return value;
      const {
        currentState: _currentState,
        history: _history,
        ...current
      } = entry;
      return current;
    })
  });
  const commits = [...index.ledger.commits]
    .filter(({ mode }) => mode === "structured")
    .sort((left, right) => left.sequence - right.sequence);
  if (commits.length === 0) return false;

  const characterRoleByFileId = new Map<
    string,
    {
      characterId: string;
      role: "relationships" | "current-state" | "history";
    }
  >();
  for (const files of index.characterFiles) {
    const legacy = legacyCharacterFiles.find(
      (entry) => entry?.characterId === files.characterId
    );
    characterRoleByFileId.set(files.relationships.id, {
      characterId: files.characterId,
      role: "relationships"
    });
    const currentState = LongWorkspaceFileReferenceSchema.safeParse(
      legacy?.currentState
    );
    const history = LongWorkspaceFileReferenceSchema.safeParse(legacy?.history);
    if (currentState.success) {
      characterRoleByFileId.set(currentState.data.id, {
        characterId: files.characterId,
        role: "current-state"
      });
    }
    if (history.success) {
      characterRoleByFileId.set(history.data.id, {
        characterId: files.characterId,
        role: "history"
      });
    }
  }

  let changed = false;
  const operations = new Map<string, ProjectTransactionFileOperation>();
  const cumulativeHistory = new Map<string, string>();
  const projectFile = async (options: {
    reference: LongWorkspaceFileReference | null;
    id: string;
    path: string;
    content: string;
    updatedAt: string;
  }): Promise<{ reference: LongWorkspaceFileReference; content: string }> => {
    let disk: SecureTextFile | null = null;
    try {
      disk = await readSecureTextFile(
        input.projectDirectory,
        options.path,
        MAX_DOCUMENT_BYTES
      );
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    const projected = fitLegacyContinuityMarkdown(options.content);
    const content = disk?.content.trim() ? disk.content : projected;
    if (disk === null || content !== disk.content) {
      operations.set(options.path, {
        path: options.path,
        content,
        expectedSha256: disk?.sha256 ?? null
      });
      changed = true;
    }
    const reference = LongWorkspaceFileReferenceSchema.parse({
      id: options.id,
      path: options.path,
      updatedAt:
        disk === null || content !== disk.content || !options.reference
          ? options.updatedAt
          : options.reference.updatedAt
    });
    if (
      !options.reference ||
      options.reference.updatedAt !== reference.updatedAt
    ) {
      changed = true;
    }
    return { reference, content };
  };

  for (const commit of commits) {
    const chapter = index.chapters.find(
      ({ chapterCardId }) => chapterCardId === commit.chapterCardId
    );
    if (!chapter || chapter.commitId !== commit.id) continue;
    const recordDisk = await readSecureTextFile(
      input.projectDirectory,
      commit.recordFile.path,
      MAX_LEDGER_RECORD_BYTES
    );
    const record = parseLongLedgerCommitRecord(
      parseJson(recordDisk.content, `旧版连续性账本 ${commit.id}`)
    );
    assertLongLedgerRecordMatchesIndex(
      index,
      commit,
      record,
      recordDisk.content
    );
    if (record.schemaVersion === 4 || record.schemaVersion === 5) continue;
    const projection = projectLegacyStructuredContinuity(
      index,
      record,
      characterRoleByFileId
    );

    chapter.foreshadowingChanges = (
      await projectFile({
        reference: chapter.foreshadowingChanges,
        id: longChapterForeshadowingChangesFileId(chapter.chapterCardId),
        path: longChapterContinuityFilePath(
          chapter.chapterCardId,
          "foreshadowing-changes.md"
        ),
        content: projection.foreshadowing,
        updatedAt: record.committedAt
      })
    ).reference;

    if (projection.world || chapter.worldReveals) {
      chapter.worldReveals = (
        await projectFile({
          reference: chapter.worldReveals,
          id: longChapterWorldRevealsFileId(chapter.chapterCardId),
          path: longChapterContinuityFilePath(
            chapter.chapterCardId,
            "world-reveals.md"
          ),
          content: projection.world ?? "",
          updatedAt: record.committedAt
        })
      ).reference;
    }
    if (projection.chapterState) {
      chapter.characterState = (
        await projectFile({
          reference: chapter.characterState,
          id: chapter.characterState.id,
          path: chapter.characterState.path,
          content: projection.chapterState,
          updatedAt: record.committedAt
        })
      ).reference;
    }
    if (projection.handoff) {
      chapter.handoff = (
        await projectFile({
          reference: chapter.handoff,
          id: chapter.handoff.id,
          path: chapter.handoff.path,
          content: projection.handoff,
          updatedAt: record.committedAt
        })
      ).reference;
    }

    const entries = new Map(
      chapter.characterContinuity.map((entry) => [entry.characterId, entry])
    );
    for (const character of projection.characters) {
      const existing = entries.get(character.characterId);
      const currentState = await projectFile({
        reference: existing?.currentState ?? null,
        id: longChapterCharacterCurrentStateFileId(
          chapter.chapterCardId,
          character.characterId
        ),
        path: longChapterCharacterContinuityFilePath(
          chapter.chapterCardId,
          character.characterId,
          "current-state.md"
        ),
        content: character.currentState,
        updatedAt: record.committedAt
      });
      const historyContent = character.exactHistory?.trim()
        ? character.exactHistory
        : appendLongCharacterHistoryEntry(
            cumulativeHistory.get(character.characterId) ?? "",
            {
              chapterCardId: chapter.chapterCardId,
              commitId: record.id,
              committedAt: record.committedAt,
              content: character.historyEntry
            }
          );
      const history = await projectFile({
        reference: existing?.history ?? null,
        id: longChapterCharacterHistoryFileId(
          chapter.chapterCardId,
          character.characterId
        ),
        path: longChapterCharacterContinuityFilePath(
          chapter.chapterCardId,
          character.characterId,
          "history.md"
        ),
        content: historyContent,
        updatedAt: record.committedAt
      });
      cumulativeHistory.set(character.characterId, history.content);
      entries.set(character.characterId, {
        characterId: character.characterId,
        currentState: currentState.reference,
        history: history.reference
      });
    }
    chapter.characterContinuity = [...entries.values()];
  }

  if (!changed) return false;
  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse(index);
  const indexContent = toJsonFileText(nextIndex);
  const nextManifest = LongProjectManifestSchema.parse({
    ...input.manifest
  });
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
      ...operations.values(),
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: indexContent,
        expectedSha256: input.indexDisk.sha256
      },
      {
        path: MANIFEST_PATH,
        content: toJsonFileText(nextManifest),
        expectedSha256: input.manifestDisk.sha256
      }
    ],
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return true;
}

export function projectLegacyStructuredContinuity(
  index: LongWorkspaceIndexSnapshot,
  record: LongLedgerCommitRecord,
  _characterRoleByFileId: ReadonlyMap<
    string,
    {
      characterId: string;
      role: "relationships" | "current-state" | "history";
    }
  >
): {
  foreshadowing: string;
  world: string | null;
  chapterState: string | null;
  handoff: string | null;
  characters: LegacyProjectedCharacter[];
} {
  const notice = `> 从旧版 structured 连续性记录 ${record.id}（${record.committedAt}）恢复。`;
  const list = (items: readonly string[]): string =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- 无";
  const foreshadowing = [
    "# 伏笔变化",
    "",
    notice,
    "",
    "## 章级摘要",
    "",
    record.chapterSummary.foreshadowingStates || "旧版未提供本项摘要。",
    "",
    "## 节拍变化",
    "",
    list(
      record.foreshadowingBeatChanges.map(
        (change) =>
          `${change.beatId}: ${change.after.status}${change.note ? `；${change.note}` : ""}`
      )
    ),
    "",
    "## 伏笔线变化",
    "",
    list(
      record.foreshadowingThreadChanges.map(
        (change) => `${change.foreshadowingId}: ${change.after}`
      )
    ),
    ""
  ].join("\n");

  const worldFacts = record.factChanges.filter(
    ({ after }) => after.domain === "world"
  );
  const worldFactIds = new Set([
    ...index.ledger.projection.facts
      .filter(({ domain }) => domain === "world")
      .map(({ factId }) => factId),
    ...worldFacts.map(({ after }) => after.factId)
  ]);
  const worldKnowledge = record.knowledgeChanges.filter(({ after }) =>
    worldFactIds.has(after.factId)
  );
  const hasWorld = Boolean(
    record.coverage.world.status === "changed" ||
    worldFacts.length ||
    worldKnowledge.length
  );
  const world = hasWorld
    ? [
        "# 世界观揭露",
        "",
        notice,
        "",
        "## 势力状态",
        "",
        record.chapterSummary.factionStates || "旧版未提供本项摘要。",
        "",
        "## 世界与境界状态",
        "",
        record.chapterSummary.realmStates || "旧版未提供本项摘要。",
        "",
        "## 世界事实变化",
        "",
        list(
          worldFacts.map(
            ({ after }) =>
              `${after.subjectId} · ${after.field}: ${after.value}；${after.evidence}`
          )
        ),
        "",
        "## 世界知识揭露",
        "",
        list(
          worldKnowledge.map(
            ({ after }) =>
              `${after.audienceType}${after.audienceId ? ` ${after.audienceId}` : ""} 对 ${after.factId}: ${after.level}；${after.evidence}`
          )
        ),
        ""
      ].join("\n")
    : null;

  const chapterState = record.chapterOutputs.characterState.trim()
    ? record.chapterOutputs.characterState
    : [
        "# 章末状态",
        "",
        notice,
        "",
        "## 时间线",
        "",
        record.chapterSummary.timeline,
        "",
        "## 人物状态",
        "",
        record.chapterSummary.characterStates,
        "",
        "## 连续性备注",
        "",
        record.chapterSummary.continuityNotes,
        ""
      ].join("\n");
  const handoff = record.chapterOutputs.handoff.summary.trim()
    ? serializeLongContinuityHandoff(record.chapterOutputs.handoff)
    : record.chapterSummary.continuityNotes.trim()
      ? `# 接续包\n\n${notice}\n\n${record.chapterSummary.continuityNotes}\n`
      : null;

  const characterIds = new Set<string>();
  for (const { after } of record.factChanges) {
    if (
      (after.domain === "character" || after.domain === "relationship") &&
      index.characters.some(({ id }) => id === after.subjectId)
    ) {
      characterIds.add(after.subjectId);
    }
  }
  const characters = [...characterIds].flatMap<LegacyProjectedCharacter>(
    (characterId) => {
      const character = index.characters.find(({ id }) => id === characterId);
      if (!character) return [];
      const facts = record.factChanges.filter(
        ({ after }) =>
          after.subjectId === characterId &&
          (after.domain === "character" || after.domain === "relationship")
      );
      const factLines = facts.map(
        ({ after }) => `${after.field}: ${after.value}；${after.evidence}`
      );
      const currentState = [
        `# ${character.name} · 当前状态`,
        "",
        notice,
        "",
        record.chapterSummary.characterStates,
        "",
        list(factLines),
        ""
      ].join("\n");
      return [
        {
          characterId,
          currentState,
          exactHistory: null,
          historyEntry: [
            `${character.name}：${record.chapterSummary.characterStates}`,
            ...factLines
          ].join("\n")
        }
      ];
    }
  );
  return {
    foreshadowing,
    world,
    chapterState: chapterState.trim() ? chapterState : null,
    handoff,
    characters
  };
}

export function fitLegacyContinuityMarkdown(content: string): string {
  if (encodeUtf8Strict(content).byteLength <= MAX_DOCUMENT_BYTES) {
    return content;
  }
  const notice =
    "\n\n> 兼容视图超过单文件上限，已截取可显示部分；完整内容仍保留在旧版账本 JSON 中。\n";
  const limit = Math.floor(
    (MAX_DOCUMENT_BYTES - encodeUtf8Strict(notice).byteLength) / 4
  );
  return `${content.slice(0, limit)}${notice}`;
}
