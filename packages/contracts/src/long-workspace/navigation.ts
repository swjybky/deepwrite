import { z } from "zod";

import {
  LongArcIdSchema,
  LongBookIdSchema,
  LongChapterBodyStatusSchema,
  LongChapterCardIdSchema,
  LongCharacterIdSchema,
  LongVolumeIdSchema,
  LongWorldbuildingCategoryIdSchema,
  LongWorkspaceSchemaVersionSchema
} from "./ids";
import {
  DEFAULT_LONG_CHARACTER_TYPES,
  LongCharacterGroupSchema,
  LongCharacterTypeSchema
} from "./characters";
import type { LongWorkspaceIndexSnapshot } from "./index-validation";
import {
  addIssue,
  groupOrderedEntries,
  validateContiguousOrder,
  validateUniqueValues
} from "./index-validation-helpers";
import { LongTimestampSchema, LongTitleSchema } from "./primitives";
import { LongWorldbuildingFormatSchema } from "./worldbuilding";

export const LongWorkspaceNavigationCountsSchema = z
  .object({
    worldbuildingCategories: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    volumes: z.number().int().nonnegative(),
    arcs: z.number().int().nonnegative(),
    chapterCards: z.number().int().nonnegative(),
    storyEvents: z.number().int().nonnegative(),
    storyPlots: z.number().int().nonnegative().default(0),
    foreshadowingThreads: z.number().int().nonnegative(),
    committedChapters: z.number().int().nonnegative()
  })
  .strict();
export type LongWorkspaceNavigationCounts = z.infer<
  typeof LongWorkspaceNavigationCountsSchema
>;

const LongWorldbuildingNavigationEntrySchema = z
  .object({
    id: LongWorldbuildingCategoryIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    format: LongWorldbuildingFormatSchema
  })
  .strict();
const LongCharacterNavigationEntrySchema = z
  .object({
    id: LongCharacterIdSchema,
    name: LongTitleSchema,
    group: LongCharacterGroupSchema,
    order: z.number().int().positive()
  })
  .strict();
const LongCharacterTypeNavigationEntrySchema = LongCharacterTypeSchema;
const LongVolumeNavigationEntrySchema = z
  .object({
    id: LongVolumeIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive()
  })
  .strict();
const LongArcNavigationEntrySchema = z
  .object({
    id: LongArcIdSchema,
    volumeId: LongVolumeIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive()
  })
  .strict();
const LongChapterCardNavigationEntrySchema = z
  .object({
    id: LongChapterCardIdSchema,
    volumeId: LongVolumeIdSchema,
    primaryArcId: LongArcIdSchema.nullable(),
    title: LongTitleSchema,
    narrativeOrder: z.number().int().positive(),
    bodyStatus: LongChapterBodyStatusSchema.default("empty")
  })
  .strict();

/**
 * Lightweight catalog/navigation projection. It intentionally excludes file
 * references, chapter bodies, long outlines, event details and ledger records.
 */
export const LongWorkspaceNavigationSnapshotSchema = z
  .object({
    schemaVersion: LongWorkspaceSchemaVersionSchema,
    bookId: LongBookIdSchema,
    updatedAt: LongTimestampSchema,
    counts: LongWorkspaceNavigationCountsSchema,
    worldbuilding: z.array(LongWorldbuildingNavigationEntrySchema).max(10_000),
    characterTypes: z
      .array(LongCharacterTypeNavigationEntrySchema)
      .max(10_000)
      .default(() =>
        DEFAULT_LONG_CHARACTER_TYPES.map((value) => ({ ...value }))
      ),
    characters: z.array(LongCharacterNavigationEntrySchema).max(100_000),
    volumes: z.array(LongVolumeNavigationEntrySchema).max(10_000),
    arcs: z.array(LongArcNavigationEntrySchema).max(100_000),
    chapterCards: z.array(LongChapterCardNavigationEntrySchema).max(100_000),
    committedThroughChapterId: LongChapterCardIdSchema.nullable()
  })
  .strict()
  .superRefine((snapshot, context) => {
    const expectedCounts = {
      worldbuildingCategories: snapshot.worldbuilding.length,
      characters: snapshot.characters.length,
      volumes: snapshot.volumes.length,
      arcs: snapshot.arcs.length,
      chapterCards: snapshot.chapterCards.length
    };
    for (const [key, expected] of Object.entries(expectedCounts)) {
      if (snapshot.counts[key as keyof typeof expectedCounts] !== expected) {
        context.addIssue({
          code: "custom",
          path: ["counts", key],
          message: `Navigation count ${key} must match its index entries.`
        });
      }
    }
    if (snapshot.counts.committedChapters > snapshot.counts.chapterCards) {
      context.addIssue({
        code: "custom",
        path: ["counts", "committedChapters"],
        message: "Committed chapter count cannot exceed chapter count."
      });
    }
    if (
      snapshot.committedThroughChapterId !== null &&
      !snapshot.chapterCards.some(
        ({ id }) => id === snapshot.committedThroughChapterId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["committedThroughChapterId"],
        message: "Recorded-through navigation chapter must exist."
      });
    }

    validateUniqueValues(
      snapshot.worldbuilding.map(({ id }) => id),
      (index) => ["worldbuilding", index, "id"],
      "navigation worldbuilding id",
      context
    );
    validateContiguousOrder(
      snapshot.worldbuilding.map(({ order }, index) => ({ index, order })),
      (index) => ["worldbuilding", index, "order"],
      "Navigation worldbuilding",
      context
    );

    validateUniqueValues(
      snapshot.characterTypes.map(({ id }) => id),
      (index) => ["characterTypes", index, "id"],
      "navigation character type id",
      context
    );
    validateContiguousOrder(
      snapshot.characterTypes.map(({ order }, index) => ({ index, order })),
      (index) => ["characterTypes", index, "order"],
      "Navigation character type",
      context
    );
    const characterTypeIds = new Set(
      snapshot.characterTypes.map(({ id }) => id)
    );
    snapshot.characters.forEach((character, index) => {
      if (!characterTypeIds.has(character.group)) {
        context.addIssue({
          code: "custom",
          path: ["characters", index, "group"],
          message:
            "Navigation character group must reference an existing character type."
        });
      }
    });

    validateUniqueValues(
      snapshot.characters.map(({ id }) => id),
      (index) => ["characters", index, "id"],
      "navigation character id",
      context
    );
    for (const [group, entries] of groupOrderedEntries(
      snapshot.characters,
      ({ group }) => group,
      ({ order }) => order
    )) {
      validateContiguousOrder(
        entries,
        (index) => ["characters", index, "order"],
        `Navigation character group ${group}`,
        context
      );
    }

    validateUniqueValues(
      snapshot.volumes.map(({ id }) => id),
      (index) => ["volumes", index, "id"],
      "navigation volume id",
      context
    );
    validateContiguousOrder(
      snapshot.volumes.map(({ order }, index) => ({ index, order })),
      (index) => ["volumes", index, "order"],
      "Navigation volume",
      context
    );
    const volumeById = new Map(
      snapshot.volumes.map((volume) => [volume.id, volume])
    );

    validateUniqueValues(
      snapshot.arcs.map(({ id }) => id),
      (index) => ["arcs", index, "id"],
      "navigation arc id",
      context
    );
    snapshot.arcs.forEach((arc, index) => {
      if (!volumeById.has(arc.volumeId)) {
        addIssue(
          context,
          ["arcs", index, "volumeId"],
          "Navigation arc must reference an existing volume."
        );
      }
    });
    for (const [volumeId, entries] of groupOrderedEntries(
      snapshot.arcs,
      ({ volumeId }) => volumeId,
      ({ order }) => order
    )) {
      validateContiguousOrder(
        entries,
        (index) => ["arcs", index, "order"],
        `Navigation arcs in ${volumeId}`,
        context
      );
    }
    const arcById = new Map(snapshot.arcs.map((arc) => [arc.id, arc]));

    validateUniqueValues(
      snapshot.chapterCards.map(({ id }) => id),
      (index) => ["chapterCards", index, "id"],
      "navigation chapter-card id",
      context
    );
    snapshot.chapterCards.forEach((chapter, index) => {
      const arc =
        chapter.primaryArcId === null
          ? undefined
          : arcById.get(chapter.primaryArcId);
      if (!volumeById.has(chapter.volumeId)) {
        addIssue(
          context,
          ["chapterCards", index, "volumeId"],
          "Navigation chapter must reference an existing volume."
        );
      }
      if (chapter.primaryArcId !== null && !arc) {
        addIssue(
          context,
          ["chapterCards", index, "primaryArcId"],
          "Navigation chapter must reference an existing primary arc."
        );
      } else if (arc && arc.volumeId !== chapter.volumeId) {
        addIssue(
          context,
          ["chapterCards", index, "primaryArcId"],
          "Navigation chapter and primary arc must share a volume."
        );
      }
    });
    for (const [volumeId, entries] of groupOrderedEntries(
      snapshot.chapterCards,
      ({ volumeId }) => volumeId,
      ({ narrativeOrder }) => narrativeOrder
    )) {
      validateContiguousOrder(
        entries,
        (index) => ["chapterCards", index, "narrativeOrder"],
        `Navigation chapter order in ${volumeId}`,
        context
      );
    }

    const orderedChapters = [...snapshot.chapterCards].sort((left, right) => {
      const leftVolumeOrder =
        volumeById.get(left.volumeId)?.order ?? Number.MAX_SAFE_INTEGER;
      const rightVolumeOrder =
        volumeById.get(right.volumeId)?.order ?? Number.MAX_SAFE_INTEGER;
      return (
        leftVolumeOrder - rightVolumeOrder ||
        left.narrativeOrder - right.narrativeOrder
      );
    });
    void orderedChapters;
  });
export type LongWorkspaceNavigationSnapshot = z.infer<
  typeof LongWorkspaceNavigationSnapshotSchema
>;

export function createLongWorkspaceNavigationSnapshot(
  workspace: LongWorkspaceIndexSnapshot
): LongWorkspaceNavigationSnapshot {
  const chapterByCardId = new Map<
    LongWorkspaceIndexSnapshot["chapters"][number]["chapterCardId"],
    LongWorkspaceIndexSnapshot["chapters"][number]
  >();
  for (const chapter of workspace.chapters) {
    const chapterCardId = chapter.chapterCardId;
    if (!chapterByCardId.has(chapterCardId)) {
      chapterByCardId.set(chapterCardId, chapter);
    }
  }

  return LongWorkspaceNavigationSnapshotSchema.parse({
    schemaVersion: workspace.schemaVersion,
    bookId: workspace.bookId,
    updatedAt: workspace.updatedAt,
    counts: {
      worldbuildingCategories: workspace.worldbuilding.length,
      characters: workspace.characters.length,
      volumes: workspace.plot.volumes.length,
      arcs: workspace.plot.arcs.length,
      chapterCards: workspace.plot.chapterCards.length,
      storyEvents: workspace.plot.storyEvents.length,
      storyPlots: workspace.plot.storyPlots.length,
      foreshadowingThreads: workspace.plot.foreshadowing.length,
      committedChapters: workspace.chapters.filter(
        ({ commitId }) => commitId !== null
      ).length
    },
    worldbuilding: workspace.worldbuilding.map(
      ({ id, title, order, format }) => ({ id, title, order, format })
    ),
    characterTypes: workspace.characterTypes.map(({ id, title, order }) => ({
      id,
      title,
      order
    })),
    characters: workspace.characters.map(({ id, name, group, order }) => ({
      id,
      name,
      group,
      order
    })),
    volumes: workspace.plot.volumes.map(({ id, title, order }) => ({
      id,
      title,
      order
    })),
    arcs: workspace.plot.arcs.map(({ id, volumeId, title, order }) => ({
      id,
      volumeId,
      title,
      order
    })),
    chapterCards: workspace.plot.chapterCards.map(
      ({ id, volumeId, primaryArcId, title, narrativeOrder }) => ({
        id,
        volumeId,
        primaryArcId,
        title,
        narrativeOrder,
        bodyStatus: chapterByCardId.get(id)?.bodyStatus ?? "empty"
      })
    ),
    committedThroughChapterId: workspace.ledger.committedThroughChapterId
  });
}
