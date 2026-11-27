import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema,
  longChapterCardFileId,
  type LongProjectManifest,
  type LongWorkspaceFileReference
} from "@deepwrite/contracts";
import {
  commitLongProjectTransaction,
  readSecureTextFile,
  unknownRecord
} from "../io";
import { chapterPath } from "../paths";
import {
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  type SecureTextFile
} from "../types";
import { isNodeError } from "@deepwrite/shared/node";
import { toJsonFileText } from "@deepwrite/shared";

/**
 * Moves legacy chapter-card structured fields (outline / worldConstraints /
 * characterIds) into per-chapter `card.md` files and backfills the card file
 * index entry. The legacy fields are removed from the index afterwards; chapter-card
 * content editing uses the card file, mirroring the story-plot pattern.
 */
export async function migrateLegacyChapterCardContent(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  const plot = unknownRecord(rawIndex?.plot);
  if (!rawIndex || !plot || !Array.isArray(plot.chapterCards)) return false;
  const chapters = Array.isArray(rawIndex.chapters) ? rawIndex.chapters : null;
  if (!chapters) return false;
  const chaptersByCardId = new Map(
    chapters.map((entry) => {
      const chapter = unknownRecord(entry);
      return [chapter?.chapterCardId, chapter] as const;
    })
  );
  const needsMigration = (card: Record<string, unknown>): boolean =>
    "outline" in card ||
    "worldConstraints" in card ||
    "characterIds" in card ||
    !unknownRecord(chaptersByCardId.get(card.id)?.card);
  // Current cards are already file-backed. Checking their bodies here turns
  // every unrelated document read into a scan of every chapter in the book.
  if (
    !plot.chapterCards.some((value) => {
      const card = unknownRecord(value);
      return card && typeof card.id === "string" && needsMigration(card);
    })
  ) {
    return false;
  }

  const characterNames = new Map<string, string>();
  if (Array.isArray(rawIndex.characters)) {
    for (const rawCharacter of rawIndex.characters) {
      const character = unknownRecord(rawCharacter);
      if (
        character &&
        typeof character.id === "string" &&
        typeof character.name === "string"
      ) {
        characterNames.set(character.id, character.name);
      }
    }
  }

  const updatedAt =
    typeof rawIndex.updatedAt === "string"
      ? rawIndex.updatedAt
      : input.manifest.updatedAt;

  let changed = false;
  const nextChapterCards: unknown[] = [];
  const cardWrites: Array<{
    chapterCardId: string;
    file: LongWorkspaceFileReference;
    content: string;
    expectedSha256: string | null;
  }> = [];

  for (const rawCard of plot.chapterCards) {
    const card = unknownRecord(rawCard);
    if (!card || typeof card.id !== "string") {
      nextChapterCards.push(rawCard);
      continue;
    }
    if (!needsMigration(card)) {
      nextChapterCards.push(rawCard);
      continue;
    }
    const hasLegacyFields =
      "outline" in card || "worldConstraints" in card || "characterIds" in card;
    const fileEntryRecord = chaptersByCardId.get(card.id);
    const cardFileRecord = unknownRecord(fileEntryRecord?.card);
    const hasCardFile = cardFileRecord !== null;
    const cardFile = hasCardFile
      ? LongWorkspaceFileReferenceSchema.parse(cardFileRecord)
      : undefined;
    let existingCardFile: SecureTextFile | null | undefined;
    if (cardFile) {
      try {
        existingCardFile = await readSecureTextFile(
          input.projectDirectory,
          cardFile.path,
          MAX_LEDGER_RECORD_BYTES
        );
      } catch (error: unknown) {
        if (!isNodeError(error, "ENOENT")) throw error;
        existingCardFile = null;
      }
    }
    if (!hasLegacyFields && cardFile && existingCardFile) {
      nextChapterCards.push(rawCard);
      continue;
    }
    changed = true;
    const outline = typeof card.outline === "string" ? card.outline : "";
    const worldConstraints =
      typeof card.worldConstraints === "string" ? card.worldConstraints : "";
    const characterIds = Array.isArray(card.characterIds)
      ? card.characterIds.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    const characterLine = characterIds
      .map((id) => characterNames.get(id) ?? id)
      .join("、");
    const content = [
      outline.trim() ? `## 章节规划\n\n${outline.trim()}` : "",
      worldConstraints.trim()
        ? `## 世界约束\n\n${worldConstraints.trim()}`
        : "",
      characterLine ? `## 出场人物\n\n${characterLine}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    const {
      outline: _outline,
      worldConstraints: _worldConstraints,
      characterIds: _characterIds,
      ...strippedCard
    } = card;
    nextChapterCards.push(strippedCard);
    if (!hasCardFile) {
      cardWrites.push({
        chapterCardId: card.id,
        file: {
          id: longChapterCardFileId(card.id),
          path: chapterPath(card.id, "card.md"),
          updatedAt
        },
        content,
        expectedSha256: null
      });
    } else if (cardFile && existingCardFile === null) {
      cardWrites.push({
        chapterCardId: card.id,
        file: {
          ...cardFile,
          updatedAt
        },
        content,
        expectedSha256: null
      });
    } else if (cardFile && existingCardFile && hasLegacyFields && content) {
      const nextContent = existingCardFile.content.includes(content)
        ? existingCardFile.content
        : existingCardFile.content.trim()
          ? `${existingCardFile.content.trimEnd()}\n\n## 旧版章卡补充\n\n${content}\n`
          : content;
      if (nextContent !== existingCardFile.content) {
        cardWrites.push({
          chapterCardId: card.id,
          file: {
            ...cardFile,
            updatedAt
          },
          content: nextContent,
          expectedSha256: existingCardFile.sha256
        });
      }
    }
  }

  if (!changed) return false;

  const cardWriteByChapterId = new Map(
    cardWrites.map((entry) => [entry.chapterCardId, entry])
  );
  const nextChapters = chapters.map((entry) => {
    const candidate = unknownRecord(entry);
    const write = candidate?.chapterCardId
      ? cardWriteByChapterId.get(candidate.chapterCardId as string)
      : undefined;
    return write ? { ...candidate, card: write.file } : entry;
  });

  // card.md may already exist on disk from an interrupted earlier migration
  // while the index entry was never recorded. Prefer the on-disk content in
  // that case instead of clobbering it with reconstructed text.
  const finalCardWrites: typeof cardWrites = [];
  for (const write of cardWrites) {
    if (write.expectedSha256 !== null) {
      finalCardWrites.push(write);
      continue;
    }
    try {
      const existing = await readSecureTextFile(
        input.projectDirectory,
        write.file.path,
        MAX_LEDGER_RECORD_BYTES
      );
      write.file.updatedAt = existing.updatedAt;
      continue;
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
      // File does not exist yet; create it below.
    }
    finalCardWrites.push(write);
  }

  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...rawIndex,
    plot: {
      ...plot,
      chapterCards: nextChapterCards
    },
    chapters: nextChapters
  });
  const indexContent = toJsonFileText(nextIndex);
  const nextManifest = LongProjectManifestSchema.parse({
    ...input.manifest
  });
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
      ...finalCardWrites.map((entry) => ({
        path: entry.file.path,
        content: entry.content,
        expectedSha256: entry.expectedSha256
      })),
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

export async function migrateLegacyChapterBodyStatus(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  if (!rawIndex || !Array.isArray(rawIndex.chapters)) return false;
  const rawChapters = rawIndex.chapters.map(unknownRecord);
  if (
    rawChapters.every(
      (chapter) =>
        chapter?.bodyStatus === "empty" || chapter?.bodyStatus === "written"
    )
  ) {
    return false;
  }
  const parsed = LongWorkspaceIndexSnapshotSchema.parse(rawIndex);
  for (const chapter of parsed.chapters) {
    const disk = await readSecureTextFile(
      input.projectDirectory,
      chapter.body.path,
      MAX_DOCUMENT_BYTES
    );
    chapter.bodyStatus = disk.content.trim() ? "written" : "empty";
  }
  const indexContent = toJsonFileText(parsed);
  const nextManifest = LongProjectManifestSchema.parse({
    ...input.manifest
  });
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
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
