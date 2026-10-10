import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_LONG_AGENTS_MD,
  DEFAULT_LONG_CHARACTER_TYPES,
  LONG_AGENTS_MD_PATH,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongBookIdSchema,
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  type LongLedgerCommitRecord,
  type LongWorkspaceFileReference
} from "@deepwrite/contracts";
import { createId, randomHex8 } from "@deepwrite/shared";
import { assertLongLedgerRecordMatchesIndex } from "../long-portable-bundle";
import { parseLongLedgerCommitRecord } from "../long-version-metadata";
import { readAgentsMdContentOrDefault } from "./agents-md";
import {
  commitLongProjectTransaction,
  ensureSecureDirectory,
  parseJson,
  readSecureTextFile,
  requireMissing,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import {
  assertLongProjectIdAvailable,
  promoteLongProjectStaging
} from "./project-folder";
import { chapterPath, indexedFileSlots } from "./paths";
import type { LongProjectStoreContext } from "./store-context";
import {
  BOOK_LINE_PATH,
  DEFAULT_WORLD_CATEGORIES,
  EMPTY_LINKED_MATERIALS,
  EMPTY_LINKED_SKILLS,
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  type CreateLongBookInput,
  type CreatedLongBook,
  type InitialProjectFiles
} from "./types";

export function replaceExactIdentity<T>(
  value: T,
  sourceId: string,
  targetId: string
): T {
  if (typeof value === "string") {
    return (value === sourceId ? targetId : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      replaceExactIdentity(item, sourceId, targetId)
    ) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceExactIdentity(item, sourceId, targetId)
      ])
    ) as T;
  }
  return value;
}

export async function createBook(
  ctx: LongProjectStoreContext,
  parentDirectory: string,
  input: CreateLongBookInput
): Promise<CreatedLongBook> {
  const parent = await ensureSecureDirectory(parentDirectory, "长篇项目父目录");
  return await ctx.runExclusive(parent, async () => {
    const bookId = LongBookIdSchema.parse(input.id ?? createId("longbook"));
    await assertLongProjectIdAvailable(parent, bookId);

    const stagingDirectory = join(parent, `.${bookId}.staging-${randomHex8()}`);
    await requireMissing(stagingDirectory, "长篇项目暂存目录已存在。");
    await mkdir(stagingDirectory, { mode: 0o700 });

    try {
      const initial = createInitialProjectFiles(ctx, bookId, input);
      await commitLongProjectTransaction({
        projectRoot: stagingDirectory,
        operations: initial.operations,
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
      const staged = await loadProject(ctx, stagingDirectory);
      const projectDirectory = await promoteLongProjectStaging(
        parent,
        stagingDirectory,
        staged.book.title
      );
      const loaded = await loadProject(ctx, projectDirectory);
      return {
        projectDirectory: loaded.projectDirectory,
        book: loaded.book,
        summary: loaded.summary
      };
    } catch (error: unknown) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function duplicateBook(
  ctx: LongProjectStoreContext,
  parentDirectory: string,
  sourceProjectDirectory: string,
  title: string
): Promise<CreatedLongBook> {
  const parent = await ensureSecureDirectory(parentDirectory, "长篇项目父目录");
  const sourceDirectory = await secureDirectory(
    sourceProjectDirectory,
    "长篇项目目录"
  );
  return await ctx.runExclusive(parent, async () => {
    const source = await loadProject(ctx, sourceDirectory);
    const now = ctx.timestamp();
    const bookId = LongBookIdSchema.parse(createId("longbook"));
    await assertLongProjectIdAvailable(parent, bookId);
    const stagingDirectory = join(parent, `.${bookId}.staging-${randomHex8()}`);
    await requireMissing(stagingDirectory, "长篇项目暂存目录已存在。");
    await mkdir(stagingDirectory, { mode: 0o700 });

    try {
      const index = LongWorkspaceIndexSnapshotSchema.parse(
        replaceExactIdentity(
          structuredClone(source.index),
          source.book.id,
          bookId
        )
      );
      index.updatedAt = now;
      const operations: Array<{
        path: string;
        content: string;
        expectedSha256: null;
      }> = [];
      const records: LongLedgerCommitRecord[] = [];

      for (const slot of indexedFileSlots(source.index)) {
        const disk = await readSecureTextFile(
          source.projectDirectory,
          slot.reference.path,
          slot.kind === "json" ? MAX_LEDGER_RECORD_BYTES : MAX_DOCUMENT_BYTES
        );
        if (slot.kind === "json") {
          const sourceRecord = parseLongLedgerCommitRecord(
            parseJson(disk.content, `长篇账本 ${slot.reference.id}`)
          );
          const record = LongLedgerCommitRecordSchema.parse({
            ...replaceExactIdentity(
              structuredClone(sourceRecord),
              source.book.id,
              bookId
            )
          });
          const content = serializeJson(record);
          const entry = index.ledger.commits.find(
            (candidate) => candidate.id === record.id
          );
          if (!entry) {
            throw new Error(`长篇副本缺少账本索引：${record.id}。`);
          }
          entry.recordFile = LongWorkspaceFileReferenceSchema.parse({
            ...entry.recordFile,
            updatedAt: now
          });
          records.push(record);
          operations.push({
            path: entry.recordFile.path,
            content,
            expectedSha256: null
          });
        } else {
          operations.push({
            path: slot.reference.path,
            content: disk.content,
            expectedSha256: null
          });
        }
      }

      const validatedIndex = LongWorkspaceIndexSnapshotSchema.parse(index);
      for (const record of records) {
        const entry = validatedIndex.ledger.commits.find(
          (candidate) => candidate.id === record.id
        );
        if (!entry) throw new Error(`长篇副本缺少账本索引：${record.id}。`);
        const content = operations.find(
          (operation) => operation.path === entry.recordFile.path
        )?.content;
        assertLongLedgerRecordMatchesIndex(
          validatedIndex,
          entry,
          record,
          content
        );
      }
      const indexContent = serializeJson(validatedIndex);
      const manifest = LongProjectManifestSchema.parse({
        ...replaceExactIdentity(
          structuredClone(source.manifest),
          source.book.id,
          bookId
        ),
        id: bookId,
        title,
        createdAt: now,
        updatedAt: now,
        workspaceIndexFile: {
          ...source.manifest.workspaceIndexFile,
          updatedAt: now
        }
      });
      operations.push(
        {
          path: LONG_AGENTS_MD_PATH,
          content: await readAgentsMdContentOrDefault(source.projectDirectory),
          expectedSha256: null
        },
        {
          path: LONG_WORKSPACE_INDEX_PATH,
          content: indexContent,
          expectedSha256: null
        },
        {
          path: MANIFEST_PATH,
          content: serializeJson(manifest),
          expectedSha256: null
        }
      );

      await commitLongProjectTransaction({
        projectRoot: stagingDirectory,
        operations,
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
      const staged = await loadProject(ctx, stagingDirectory);
      const projectDirectory = await promoteLongProjectStaging(
        parent,
        stagingDirectory,
        staged.book.title
      );
      const loaded = await loadProject(ctx, projectDirectory);
      return {
        projectDirectory: loaded.projectDirectory,
        book: loaded.book,
        summary: loaded.summary
      };
    } catch (error: unknown) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  });
}

export function createInitialProjectFiles(
  ctx: LongProjectStoreContext,
  bookId: string,
  input: CreateLongBookInput
): InitialProjectFiles {
  const timestamp = ctx.timestamp();
  const volumeId = createId("volume");
  const arcId = createId("arc");
  const chapterId = createId("chapter");
  const file = (id: string, path: string): LongWorkspaceFileReference => ({
    id,
    path,
    updatedAt: timestamp
  });
  const worldbuilding = DEFAULT_WORLD_CATEGORIES.map(([id, title], index) => ({
    id,
    title,
    order: index + 1,
    format: "list" as const,
    contentAuthority: "files" as const,
    overview: file(
      longWorldbuildingOverviewFileId(id),
      longWorldbuildingOverviewContentPath(id)
    ),
    items: []
  }));
  const chapterBody = file(
    longChapterBodyFileId(chapterId),
    chapterPath(chapterId, "body.md")
  );
  const chapterCard = file(
    longChapterCardFileId(chapterId),
    chapterPath(chapterId, "card.md")
  );
  const chapterState = file(
    longChapterCharacterStateFileId(chapterId),
    chapterPath(chapterId, "character-state.md")
  );
  const chapterHandoff = file(
    longChapterHandoffFileId(chapterId),
    chapterPath(chapterId, "handoff.md")
  );
  const chapterForeshadowingChanges = file(
    longChapterForeshadowingChangesFileId(chapterId),
    longChapterContinuityFilePath(chapterId, "foreshadowing-changes.md")
  );

  const index = LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId,
    updatedAt: timestamp,
    bookLine: file(LONG_BOOK_LINE_FILE_ID, BOOK_LINE_PATH),
    featureSettings: {
      worldbuildingItemLayout: "right-list",
      characterAndContinuityItemLayout: "right-list",
      plotItemLayout: "right-list"
    },
    worldbuilding,
    characterOverview: file(
      LONG_CHARACTER_OVERVIEW_FILE_ID,
      LONG_CHARACTER_OVERVIEW_PATH
    ),
    characterTypes: structuredClone(DEFAULT_LONG_CHARACTER_TYPES),
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [{ id: volumeId, title: "第一卷", order: 1, summary: "" }],
      arcs: [
        {
          id: arcId,
          volumeId,
          title: "第一剧情点",
          order: 1,
          outline: ""
        }
      ],
      chapterCards: [
        {
          id: chapterId,
          volumeId,
          primaryArcId: arcId,
          title: "第一章",
          narrativeOrder: 1
        }
      ],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [
      {
        chapterCardId: chapterId,
        body: chapterBody,
        card: chapterCard,
        characterState: chapterState,
        handoff: chapterHandoff,
        foreshadowingChanges: chapterForeshadowingChanges,
        worldReveals: null,
        characterContinuity: [],
        commitId: null
      }
    ],
    ledger: { committedThroughChapterId: null, commits: [] }
  });
  const indexContent = serializeJson(index);
  const manifest = LongProjectManifestSchema.parse({
    schemaVersion: 1,
    kind: "deepwrite.long-book",
    id: bookId,
    title: input.title,
    bookType: "long",
    genre: input.genre,
    status: "editing",
    linkedMaterialIdsByKind:
      input.linkedMaterialIdsByKind ?? EMPTY_LINKED_MATERIALS,
    linkedSkillIdsByKind: input.linkedSkillIdsByKind ?? EMPTY_LINKED_SKILLS,
    createdAt: timestamp,
    updatedAt: timestamp,
    workspaceIndexFile: {
      id: LONG_WORKSPACE_INDEX_FILE_ID,
      path: LONG_WORKSPACE_INDEX_PATH,
      updatedAt: timestamp
    }
  });

  return {
    manifest,
    index,
    operations: [
      {
        path: BOOK_LINE_PATH,
        content: "",
        expectedSha256: null as null
      },
      ...worldbuilding.map(({ overview }) => ({
        path: overview.path,
        content: "",
        expectedSha256: null as null
      })),
      {
        path: LONG_CHARACTER_OVERVIEW_PATH,
        content: "",
        expectedSha256: null as null
      },
      ...[
        chapterBody.path,
        chapterCard.path,
        chapterState.path,
        chapterHandoff.path,
        chapterForeshadowingChanges.path
      ].map((path) => ({
        path,
        content: "",
        expectedSha256: null as null
      })),
      {
        path: LONG_AGENTS_MD_PATH,
        content: DEFAULT_LONG_AGENTS_MD,
        expectedSha256: null as null
      },
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: indexContent,
        expectedSha256: null
      },
      {
        path: MANIFEST_PATH,
        content: serializeJson(manifest),
        expectedSha256: null
      }
    ]
  };
}
