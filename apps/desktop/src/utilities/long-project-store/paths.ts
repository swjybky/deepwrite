import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  LONG_CHARACTER_OVERVIEW_PATH,
  longChapterCharacterContinuityFilePath,
  longChapterContinuityFilePath,
  longWorldbuildingContentPath,
  longWorldbuildingItemContentPath,
  longWorldbuildingOverviewContentPath,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  BOOK_LINE_PATH,
  type IndexedFileDescriptor,
  type IndexedFileSlot,
  type LoadedLongProject
} from "./types";
import { sha256Hex } from "@deepwrite/shared/node";

export function storageKey(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex").slice(0, 32);
}

export function legacyWorldbuildingPath(categoryId: string): string {
  return `long/worldbuilding/${storageKey(categoryId)}/content.md`;
}

export function legacyWorldbuildingItemPath(
  categoryId: string,
  itemId: string
): string {
  return `long/worldbuilding/${storageKey(categoryId)}/items/${storageKey(itemId)}.md`;
}

export function characterPath(characterId: string, filename: string): string {
  return `long/characters/${storageKey(characterId)}/${filename}`;
}

export function chapterPath(chapterId: string, filename: string): string {
  return `long/chapters/${storageKey(chapterId)}/${filename}`;
}

export function storyPlotPath(storyPlotId: string, filename: string): string {
  return `long/story-plots/${storageKey(storyPlotId)}/${filename}`;
}

export function ledgerPath(commitId: string): string {
  return `long/ledger/${storageKey(commitId)}.json`;
}

export function portablePathKey(path: string): string {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

export function requireIndexedFileDescriptor(
  loaded: LoadedLongProject,
  fileId: string
): IndexedFileDescriptor {
  const file = loaded.files.get(fileId);
  if (!file) {
    throw new Error(`长篇项目中不存在文件 ID：${fileId}`);
  }
  return file;
}

export function isPinnedMarkdownFile(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): boolean {
  if (
    index.chapters.some(
      (chapter) =>
        chapter.commitId !== null &&
        (chapter.body.id === fileId ||
          chapter.card.id === fileId ||
          chapter.characterState.id === fileId ||
          chapter.handoff.id === fileId ||
          chapter.foreshadowingChanges.id === fileId ||
          chapter.worldReveals?.id === fileId ||
          chapter.characterContinuity.some(
            (entry) =>
              entry.currentState.id === fileId || entry.history.id === fileId
          ))
    )
  ) {
    return true;
  }
  return (
    index.ledger.commits.some(({ mode }) => mode === "structured") &&
    index.characterFiles.some((entry) => entry.relationships.id === fileId)
  );
}

export function indexedFileSlots(
  index: LongWorkspaceIndexSnapshot
): IndexedFileSlot[] {
  return [
    ...(index.writeReceipts ?? []).map((file) => ({
      reference: file,
      expectedPath: `long/analysis/receipts/${file.id}.md`,
      kind: "markdown" as const
    })),
    {
      reference: index.bookLine,
      expectedPath: BOOK_LINE_PATH,
      kind: "markdown"
    },
    ...index.worldbuilding.flatMap((category) =>
      category.format === "text"
        ? [
            {
              reference: category.file,
              expectedPath: longWorldbuildingContentPath(category.id),
              compatiblePaths: [legacyWorldbuildingPath(category.id)],
              kind: "markdown" as const
            }
          ]
        : [
            ...(category.overview
              ? [
                  {
                    reference: category.overview,
                    expectedPath: longWorldbuildingOverviewContentPath(
                      category.id
                    ),
                    kind: "markdown" as const
                  }
                ]
              : []),
            ...category.items.map((item) => ({
              reference: item.file,
              expectedPath: longWorldbuildingItemContentPath(
                category.id,
                item.id
              ),
              compatiblePaths: [
                legacyWorldbuildingItemPath(category.id, item.id)
              ],
              kind: "markdown" as const
            }))
          ]
    ),
    ...(index.characterOverview
      ? [
          {
            reference: index.characterOverview,
            expectedPath: LONG_CHARACTER_OVERVIEW_PATH,
            kind: "markdown" as const
          }
        ]
      : []),
    ...index.characterFiles.flatMap((entry) => [
      {
        reference: entry.coreProfile,
        expectedPath: characterPath(entry.characterId, "core-profile.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.relationships,
        expectedPath: characterPath(entry.characterId, "relationships.md"),
        kind: "markdown" as const
      }
    ]),
    ...index.chapters.flatMap((entry) => [
      {
        reference: entry.body,
        expectedPath: chapterPath(entry.chapterCardId, "body.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.card,
        expectedPath: chapterPath(entry.chapterCardId, "card.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.characterState,
        expectedPath: chapterPath(entry.chapterCardId, "character-state.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.handoff,
        expectedPath: chapterPath(entry.chapterCardId, "handoff.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.foreshadowingChanges,
        expectedPath: longChapterContinuityFilePath(
          entry.chapterCardId,
          "foreshadowing-changes.md"
        ),
        kind: "markdown" as const
      },
      ...(entry.worldReveals
        ? [
            {
              reference: entry.worldReveals,
              expectedPath: longChapterContinuityFilePath(
                entry.chapterCardId,
                "world-reveals.md"
              ),
              kind: "markdown" as const
            }
          ]
        : []),
      ...entry.characterContinuity.flatMap((continuity) => [
        {
          reference: continuity.currentState,
          expectedPath: longChapterCharacterContinuityFilePath(
            entry.chapterCardId,
            continuity.characterId,
            "current-state.md"
          ),
          kind: "markdown" as const
        },
        {
          reference: continuity.history,
          expectedPath: longChapterCharacterContinuityFilePath(
            entry.chapterCardId,
            continuity.characterId,
            "history.md"
          ),
          kind: "markdown" as const
        }
      ])
    ]),
    ...index.plot.storyPlots.map((entry) => ({
      reference: entry.file,
      expectedPath: storyPlotPath(entry.id, "body.md"),
      kind: "markdown" as const
    })),
    ...index.ledger.commits.map((commit) => ({
      reference: commit.recordFile,
      expectedPath: ledgerPath(commit.id),
      kind: "json" as const
    }))
  ];
}

export function isCompatibleRolePath(slot: IndexedFileSlot): boolean {
  if (
    slot.reference.path === slot.expectedPath ||
    slot.compatiblePaths?.includes(slot.reference.path)
  ) {
    return true;
  }
  if (slot.kind === "json") return false;
  const parts = slot.reference.path.split("/");
  if (slot.expectedPath.startsWith("long/characters/") && parts.length === 4) {
    return (
      parts[0] === "long" &&
      parts[1] === "characters" &&
      Boolean(parts[2]) &&
      parts[3] === basename(slot.expectedPath)
    );
  }
  if (slot.expectedPath.startsWith("long/chapters/") && parts.length === 4) {
    return (
      parts[0] === "long" &&
      parts[1] === "chapters" &&
      Boolean(parts[2]) &&
      parts[3] === basename(slot.expectedPath)
    );
  }
  if (slot.expectedPath.startsWith("long/story-plots/") && parts.length === 4) {
    return (
      parts[0] === "long" &&
      parts[1] === "story-plots" &&
      Boolean(parts[2]) &&
      parts[3] === basename(slot.expectedPath)
    );
  }
  return false;
}

export function requireIndexedFileReference(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): LongWorkspaceFileReference {
  const file = indexedFileSlots(index).find(
    (slot) => slot.reference.id === fileId
  )?.reference;
  if (!file) {
    throw new Error(`长篇索引中不存在文件 ID：${fileId}`);
  }
  return file;
}

export function orderedChapterCards(index: LongWorkspaceIndexSnapshot) {
  const volumeOrder = new Map(
    index.plot.volumes.map((volume) => [volume.id, volume.order])
  );
  return [...index.plot.chapterCards].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder
  );
}

export function firstEmptyChapter(index: LongWorkspaceIndexSnapshot) {
  return orderedChapterCards(index).find((chapter) =>
    index.chapters.some(
      (entry) =>
        entry.chapterCardId === chapter.id && entry.bodyStatus === "empty"
    )
  );
}

export function contiguousRecordedThrough(
  index: LongWorkspaceIndexSnapshot,
  additionalChapterIds?: string | readonly string[]
): string | null {
  const recorded = new Set(
    index.chapters
      .filter(({ commitId }) => commitId !== null)
      .map(({ chapterCardId }) => chapterCardId)
  );
  const additions = Array.isArray(additionalChapterIds)
    ? additionalChapterIds
    : additionalChapterIds
      ? [additionalChapterIds]
      : [];
  additions.forEach((chapterCardId) => recorded.add(chapterCardId));
  let through: string | null = null;
  for (const chapter of orderedChapterCards(index)) {
    if (!recorded.has(chapter.id)) break;
    through = chapter.id;
  }
  return through;
}

export function updateChapterBodyStatus(
  index: LongWorkspaceIndexSnapshot,
  fileId: string,
  content: string
): void {
  const chapter = index.chapters.find(({ body }) => body.id === fileId);
  if (!chapter) return;
  chapter.bodyStatus = content.trim() ? "written" : "empty";
  const commit = index.ledger.commits.find(({ id }) => id === chapter.commitId);
  const evidence = commit?.bodyEvidence?.find(
    ({ chapterCardId }) => chapterCardId === chapter.chapterCardId
  );
  if (!commit || !evidence) return;
  const changed = new Set(commit.changedChapterIds ?? []);
  if (evidence.sha256 === sha256Hex(content))
    changed.delete(chapter.chapterCardId);
  else changed.add(chapter.chapterCardId);
  commit.changedChapterIds = [...changed];
}
