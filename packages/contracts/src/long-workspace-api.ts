import { z } from "zod";
import {
  LinkedMaterialIdsByKindInputSchema,
  LinkedSkillIdsByKindInputSchema
} from "./catalog";

import {
  LongWorkspaceImpactPreviewSchema,
  LongWorkspaceOperationBatchSchema,
  LongWorkspaceOperationResultSchema
} from "./long-workspace-operations";
import {
  LongBookIdSchema,
  LongBookSchema,
  LongBookSummarySchema,
  LongLinkedResourceStageScopesSchema,
  LongAgentIdSchema,
  LongArcIdSchema,
  LongCharacterGroupSchema,
  LongChapterCardIdSchema,
  LongFileIdSchema,
  LongForeshadowingBeatIdSchema,
  LongForeshadowingIdSchema,
  LongForeshadowingSpanSchema,
  LongForeshadowingStatusSchema,
  LongProjectRelativePathSchema,
  LongVolumeIdSchema,
  LongWorldbuildingCategoryIdSchema,
  LongWorldbuildingItemIdSchema,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceNavigationSnapshotSchema,
  LongWorkspaceRootSchema,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  longAgentsMdCharacterCount
} from "./long-workspace";

export const LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS = 20_000;
export const LONG_WORLDBUILDING_OVERVIEW_FOCUS_MAX_CHARACTERS = 8_000;
export const LONG_WORLDBUILDING_DIRECTORY_MAX_CATEGORIES = 500;
export const LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS = 2_000;
export const LONG_FORESHADOWING_DIRECTORY_MAX_ENTRIES = 100;

const LongWorldbuildingDirectoryItemSchema = z
  .object({
    itemId: LongWorldbuildingItemIdSchema,
    title: z.string().trim().min(1).max(256),
    order: z.number().int().positive()
  })
  .strict();

const LongWorldbuildingDirectoryCategorySchema = z.discriminatedUnion(
  "format",
  [
    z
      .object({
        categoryId: LongWorldbuildingCategoryIdSchema,
        title: z.string().trim().min(1).max(256),
        order: z.number().int().positive(),
        format: z.literal("text")
      })
      .strict(),
    z
      .object({
        categoryId: LongWorldbuildingCategoryIdSchema,
        title: z.string().trim().min(1).max(256),
        order: z.number().int().positive(),
        format: z.literal("list"),
        itemCount: z.number().int().nonnegative(),
        items: z
          .array(LongWorldbuildingDirectoryItemSchema)
          .max(LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS),
        omittedItemCount: z.number().int().nonnegative()
      })
      .strict()
      .superRefine((value, context) => {
        if (value.itemCount !== value.items.length + value.omittedItemCount) {
          context.addIssue({
            code: "custom",
            path: ["itemCount"],
            message:
              "Worldbuilding directory item count must include visible and omitted items."
          });
        }
      })
  ]
);

export const LongWorldbuildingDirectorySnapshotSchema = z
  .object({
    categories: z
      .array(LongWorldbuildingDirectoryCategorySchema)
      .max(LONG_WORLDBUILDING_DIRECTORY_MAX_CATEGORIES),
    omittedCategoryCount: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    const itemCount = value.categories.reduce(
      (total, category) =>
        total + (category.format === "list" ? category.items.length : 0),
      0
    );
    if (itemCount > LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS) {
      context.addIssue({
        code: "custom",
        path: ["categories"],
        message: "Worldbuilding directory includes too many visible items."
      });
    }
  });
export type LongWorldbuildingDirectorySnapshot = z.infer<
  typeof LongWorldbuildingDirectorySnapshotSchema
>;

const LongWorldbuildingFocusTextSnapshotSchema = z
  .object({
    content: z.string().max(LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS * 2),
    truncated: z.literal(true).optional(),
    originalLength: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const contentLength = Array.from(value.content).length;
    if (contentLength > LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message:
          "Long worldbuilding focus text exceeds the maximum character count."
      });
    }
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= contentLength)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "A truncated long worldbuilding focus text must report its original length."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "An untruncated long worldbuilding focus text must omit its original length."
      });
    }
  });

export const LongWorldbuildingFocusSnapshotSchema = z
  .object({
    categoryTitle: z.string().trim().min(1).max(256),
    format: z.enum(["list", "text"]),
    currentStage: z
      .object({
        kind: z.enum(["item", "overview", "text"]),
        title: z.string().trim().min(1).max(256),
        text: LongWorldbuildingFocusTextSnapshotSchema
      })
      .strict(),
    overview: LongWorldbuildingFocusTextSnapshotSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.format === "text" && value.currentStage.kind !== "text") ||
      (value.format === "list" && value.currentStage.kind === "text")
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentStage", "kind"],
        message:
          "Long worldbuilding focus stage kind must match its category format."
      });
    }
    if (value.currentStage.kind === "item" && value.overview === undefined) {
      context.addIssue({
        code: "custom",
        path: ["overview"],
        message:
          "A focused worldbuilding item must include its category overview."
      });
    }
    if (value.format === "text" && value.overview !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["overview"],
        message:
          "A text worldbuilding category must not include an overview snapshot."
      });
    }
    const totalCharacters =
      Array.from(value.currentStage.text.content).length +
      Array.from(value.overview?.content ?? "").length;
    if (totalCharacters > LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["currentStage", "text", "content"],
        message:
          "Combined long worldbuilding focus text exceeds the maximum character count."
      });
    }
  });
export type LongWorldbuildingFocusSnapshot = z.infer<
  typeof LongWorldbuildingFocusSnapshotSchema
>;

export const LONG_CHARACTER_FOCUS_MAX_CHARACTERS = 20_000;
export const LONG_CHARACTER_CORE_FOCUS_MAX_CHARACTERS = 8_000;
export const LONG_CHARACTER_OVERVIEW_FOCUS_MAX_CHARACTERS = 8_000;

const LongCharacterFocusTextSnapshotSchema = z
  .object({
    content: z.string().max(LONG_CHARACTER_FOCUS_MAX_CHARACTERS * 2),
    truncated: z.literal(true).optional(),
    originalLength: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const contentLength = Array.from(value.content).length;
    if (contentLength > LONG_CHARACTER_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message:
          "Long character focus text exceeds the maximum character count."
      });
    }
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= contentLength)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "A truncated long character focus text must report its original length."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "An untruncated long character focus text must omit its original length."
      });
    }
  });

export const LongCharacterFocusSnapshotSchema = z
  .object({
    characterName: z.string().trim().min(1).max(256).optional(),
    group: LongCharacterGroupSchema.optional(),
    currentDocument: z
      .object({
        kind: z.enum([
          "overview",
          "core_profile",
          "relationships",
          "current_state",
          "history"
        ]),
        title: z.string().trim().min(1).max(256),
        text: LongCharacterFocusTextSnapshotSchema
      })
      .strict(),
    overview: LongCharacterFocusTextSnapshotSchema.optional(),
    coreProfile: LongCharacterFocusTextSnapshotSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.currentDocument.kind === "overview") {
      if (value.characterName !== undefined || value.group !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["characterName"],
          message:
            "A focused character overview must not include a character name or group."
        });
      }
      if (value.overview !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["overview"],
          message:
            "A focused character overview must not duplicate the overview snapshot."
        });
      }
      if (value.coreProfile !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused character overview must not include a core profile snapshot."
        });
      }
    } else {
      if (!value.characterName || !value.group) {
        context.addIssue({
          code: "custom",
          path: ["characterName"],
          message:
            "A focused character document must include the character name and group."
        });
      }
      if (value.overview === undefined) {
        context.addIssue({
          code: "custom",
          path: ["overview"],
          message:
            "A focused character document must include the stage overview."
        });
      }
      if (
        value.currentDocument.kind !== "core_profile" &&
        value.coreProfile === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused secondary character document must include the core profile."
        });
      }
      if (
        value.currentDocument.kind === "core_profile" &&
        value.coreProfile !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused core profile must not duplicate the core profile snapshot."
        });
      }
    }
    const totalCharacters =
      Array.from(value.currentDocument.text.content).length +
      Array.from(value.overview?.content ?? "").length +
      Array.from(value.coreProfile?.content ?? "").length;
    if (totalCharacters > LONG_CHARACTER_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["currentDocument", "text", "content"],
        message:
          "Combined long character focus text exceeds the maximum character count."
      });
    }
  });
export type LongCharacterFocusSnapshot = z.infer<
  typeof LongCharacterFocusSnapshotSchema
>;

export const LONG_PLOT_FOCUS_SECTIONS = [
  "book_line",
  "plot_point",
  "chapter_card",
  "foreshadowing"
] as const;

export const LongForeshadowingDirectoryEntrySchema = z
  .object({
    foreshadowingId: LongForeshadowingIdSchema,
    title: z.string().trim().min(1).max(256),
    status: LongForeshadowingStatusSchema,
    plannedSpan: LongForeshadowingSpanSchema.optional(),
    beatCount: z.number().int().nonnegative().max(10_000)
  })
  .strict();

export const LongForeshadowingDirectorySnapshotSchema = z
  .object({
    totalCount: z.number().int().nonnegative().max(100_000),
    omittedCount: z.number().int().nonnegative().max(100_000),
    entries: z
      .array(LongForeshadowingDirectoryEntrySchema)
      .max(LONG_FORESHADOWING_DIRECTORY_MAX_ENTRIES)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.totalCount !== value.entries.length + value.omittedCount) {
      context.addIssue({
        code: "custom",
        path: ["omittedCount"],
        message:
          "Foreshadowing directory total must equal visible and omitted entries."
      });
    }
  });

export type LongForeshadowingDirectorySnapshot = z.infer<
  typeof LongForeshadowingDirectorySnapshotSchema
>;

export const LongPlotFocusSnapshotSchema = z
  .object({
    section: z.enum(LONG_PLOT_FOCUS_SECTIONS),
    volumeId: LongVolumeIdSchema.optional(),
    volumeTitle: z.string().trim().min(1).max(256).optional(),
    arcId: LongArcIdSchema.optional(),
    arcTitle: z.string().trim().min(1).max(256).optional(),
    chapterCardId: LongChapterCardIdSchema.optional(),
    chapterCardTitle: z.string().trim().min(1).max(256).optional(),
    foreshadowingDirectory: LongForeshadowingDirectorySnapshotSchema.optional(),
    foreshadowingThreadId: LongForeshadowingIdSchema.optional(),
    foreshadowingBeatId: LongForeshadowingBeatIdSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.volumeId) !== Boolean(value.volumeTitle)) {
      context.addIssue({
        code: "custom",
        path: ["volumeTitle"],
        message:
          "Long plot focus volume id and title must be provided together."
      });
    }
    if (Boolean(value.arcId) !== Boolean(value.arcTitle)) {
      context.addIssue({
        code: "custom",
        path: ["arcTitle"],
        message: "Long plot focus arc id and title must be provided together."
      });
    }
    if (Boolean(value.chapterCardId) !== Boolean(value.chapterCardTitle)) {
      context.addIssue({
        code: "custom",
        path: ["chapterCardTitle"],
        message:
          "Long plot focus chapter card id and title must be provided together."
      });
    }
    if (
      (value.section === "plot_point" || value.section === "chapter_card") &&
      value.volumeId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["volumeId"],
        message: "A volume-scoped long plot focus must name its volume."
      });
    }
    if (value.section !== "plot_point" && value.arcId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["arcId"],
        message: "Only a plot-point long plot focus may name an arc."
      });
    }
    if (value.section !== "chapter_card" && value.chapterCardId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["chapterCardId"],
        message: "Only a chapter-card long plot focus may name a chapter card."
      });
    }
    if (
      (value.section === "book_line" || value.section === "foreshadowing") &&
      value.volumeId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["volumeId"],
        message: "A book-scoped long plot focus must not name a volume."
      });
    }
    const isForeshadowing = value.section === "foreshadowing";
    if (isForeshadowing !== Boolean(value.foreshadowingDirectory)) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingDirectory"],
        message:
          "Only a foreshadowing focus must include its lightweight directory."
      });
    }
    if (
      !isForeshadowing &&
      (value.foreshadowingThreadId !== undefined ||
        value.foreshadowingBeatId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingThreadId"],
        message: "Foreshadowing ids are only valid in a foreshadowing focus."
      });
    }
    if (value.foreshadowingBeatId && !value.foreshadowingThreadId) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingBeatId"],
        message: "A focused foreshadowing beat requires its thread id."
      });
    }
    if (
      value.foreshadowingThreadId &&
      !value.foreshadowingDirectory?.entries.some(
        (entry) => entry.foreshadowingId === value.foreshadowingThreadId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingThreadId"],
        message:
          "The focused foreshadowing thread must remain in the directory."
      });
    }
  });
export type LongPlotFocusSnapshot = z.infer<typeof LongPlotFocusSnapshotSchema>;

export const LongWorkspaceRuntimeContextSchema = z
  .object({
    bookId: LongBookIdSchema,
    title: z.string().trim().min(1).max(256),
    activeRoot: LongWorkspaceRootSchema,
    activeAgentId: LongAgentIdSchema,
    activeFileId: LongFileIdSchema.optional(),
    activeChapterCardId: LongChapterCardIdSchema.optional(),
    navigation: LongWorkspaceNavigationSnapshotSchema,
    worldbuildingDirectory: LongWorldbuildingDirectorySnapshotSchema.optional(),
    worldbuildingFocus: LongWorldbuildingFocusSnapshotSchema.optional(),
    characterFocus: LongCharacterFocusSnapshotSchema.optional(),
    plotFocus: LongPlotFocusSnapshotSchema.optional(),
    agentsMd: z
      .string()
      .max(LONG_AGENTS_MD_MAX_CHARACTERS * 2)
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.navigation.bookId !== value.bookId) {
      context.addIssue({
        code: "custom",
        path: ["navigation", "bookId"],
        message: "Long runtime navigation must belong to the active book."
      });
    }
    if (
      value.activeChapterCardId !== undefined &&
      !value.navigation.chapterCards.some(
        ({ id }) => id === value.activeChapterCardId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeChapterCardId"],
        message:
          "Long runtime active chapter must exist in the navigation snapshot."
      });
    }
    if (
      value.worldbuildingFocus !== undefined &&
      value.activeRoot !== "worldbuilding"
    ) {
      context.addIssue({
        code: "custom",
        path: ["worldbuildingFocus"],
        message:
          "Long worldbuilding focus may only be provided on the worldbuilding root."
      });
    }
    if (
      value.worldbuildingFocus !== undefined &&
      value.activeFileId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeFileId"],
        message:
          "Long worldbuilding focus requires the active worldbuilding file."
      });
    }
    if (
      value.characterFocus !== undefined &&
      value.activeRoot !== "character_design"
    ) {
      context.addIssue({
        code: "custom",
        path: ["characterFocus"],
        message:
          "Long character focus may only be provided on the character-design root."
      });
    }
    if (
      value.characterFocus !== undefined &&
      value.activeFileId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeFileId"],
        message: "Long character focus requires the active character file."
      });
    }
    if (value.plotFocus !== undefined && value.activeRoot !== "plot_design") {
      context.addIssue({
        code: "custom",
        path: ["plotFocus"],
        message: "Long plot focus may only be provided on the plot-design root."
      });
    }
    if (
      value.plotFocus?.volumeId !== undefined &&
      !value.navigation.volumes.some(
        ({ id }) => id === value.plotFocus!.volumeId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["plotFocus", "volumeId"],
        message: "Long plot focus volume must exist in the navigation snapshot."
      });
    }
    if (value.plotFocus?.arcId !== undefined) {
      const focusedArc = value.navigation.arcs.find(
        ({ id }) => id === value.plotFocus!.arcId
      );
      if (!focusedArc) {
        context.addIssue({
          code: "custom",
          path: ["plotFocus", "arcId"],
          message: "Long plot focus arc must exist in the navigation snapshot."
        });
      } else if (focusedArc.volumeId !== value.plotFocus.volumeId) {
        context.addIssue({
          code: "custom",
          path: ["plotFocus", "arcId"],
          message: "Long plot focus arc must belong to the focused volume."
        });
      }
    }
    if (
      value.agentsMd !== undefined &&
      longAgentsMdCharacterCount(value.agentsMd) > LONG_AGENTS_MD_MAX_CHARACTERS
    ) {
      context.addIssue({
        code: "custom",
        path: ["agentsMd"],
        message:
          "Long runtime AGENTS.md context exceeds the maximum character count."
      });
    }
    if (value.plotFocus?.chapterCardId !== undefined) {
      const focusedChapterCard = value.navigation.chapterCards.find(
        ({ id }) => id === value.plotFocus!.chapterCardId
      );
      if (!focusedChapterCard) {
        context.addIssue({
          code: "custom",
          path: ["plotFocus", "chapterCardId"],
          message:
            "Long plot focus chapter card must exist in the navigation snapshot."
        });
      } else if (focusedChapterCard.volumeId !== value.plotFocus.volumeId) {
        context.addIssue({
          code: "custom",
          path: ["plotFocus", "chapterCardId"],
          message:
            "Long plot focus chapter card must belong to the focused volume."
        });
      }
    }
  });
export type LongWorkspaceRuntimeContext = z.infer<
  typeof LongWorkspaceRuntimeContextSchema
>;

export const LONG_BOOK_GENRES = [
  "玄幻",
  "奇幻",
  "武侠",
  "仙侠",
  "都市",
  "现实",
  "历史",
  "军事",
  "科幻",
  "悬疑",
  "言情",
  "其他"
] as const;

/**
 * The enum is primarily a UI suggestion list. Imported projects may preserve
 * a custom genre, so the wire contract deliberately accepts any short label.
 */
export const LongBookGenreSchema = z.string().trim().min(1).max(120);
export type LongBookGenre = z.infer<typeof LongBookGenreSchema>;

const MAX_LONG_BINDING_IDS_PER_KIND = 1_000;

const LongLinkedMaterialIdsByKindInputSchema =
  LinkedMaterialIdsByKindInputSchema.superRefine((groups, context) => {
    for (const [kind, ids] of Object.entries(groups)) {
      if (ids && ids.length > MAX_LONG_BINDING_IDS_PER_KIND) {
        context.addIssue({
          code: "custom",
          path: [kind],
          message: `Long-form binding lists cannot exceed ${MAX_LONG_BINDING_IDS_PER_KIND} ids per kind.`
        });
      }
    }
  });

const LongLinkedSkillIdsByKindInputSchema =
  LinkedSkillIdsByKindInputSchema.superRefine((groups, context) => {
    for (const [kind, ids] of Object.entries(groups)) {
      if (ids && ids.length > MAX_LONG_BINDING_IDS_PER_KIND) {
        context.addIssue({
          code: "custom",
          path: [kind],
          message: `Long-form binding lists cannot exceed ${MAX_LONG_BINDING_IDS_PER_KIND} ids per kind.`
        });
      }
    }
  });

export const CreateLongBookInputSchema = z
  .object({
    title: z.string().trim().min(1).max(256),
    genre: LongBookGenreSchema,
    linkedMaterialIdsByKind: LongLinkedMaterialIdsByKindInputSchema.optional(),
    linkedSkillIdsByKind: LongLinkedSkillIdsByKindInputSchema.optional()
  })
  .strict();
export type CreateLongBookInput = z.infer<typeof CreateLongBookInputSchema>;

export const LongDuplicateBookInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongDuplicateBookInput = z.infer<
  typeof LongDuplicateBookInputSchema
>;

export const CreateLongBookAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    input: CreateLongBookInputSchema
  })
  .strict();
export type CreateLongBookAtPathInput = z.infer<
  typeof CreateLongBookAtPathInputSchema
>;

export const LongImportWriteClawAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1)
  })
  .strict();
export type LongImportWriteClawAtPathInput = z.infer<
  typeof LongImportWriteClawAtPathInputSchema
>;

export const LongImportWriteClawResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    sourceKind: z.enum(["write-claw-zip", "long-workspace-json", "book-json"]),
    legacySchemaVersion: z.number().int().nonnegative(),
    committedChapterPolicy: z.enum([
      "written-uncommitted",
      "legacy-checkpoints"
    ]),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message: "Imported long book and summary must share the same id."
      });
    }
  });
export type LongImportWriteClawResult = z.infer<
  typeof LongImportWriteClawResultSchema
>;

export const LongLegacySyncModuleSchema = z.enum([
  "worldbuilding",
  "characters",
  "plot"
]);
export type LongLegacySyncModule = z.infer<typeof LongLegacySyncModuleSchema>;

export const LongLegacySyncCountsSchema = z
  .object({
    worldbuilding: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    outline: z.number().int().nonnegative().max(1),
    volumes: z.number().int().nonnegative(),
    plotPoints: z.number().int().nonnegative(),
    storyEvents: z.number().int().nonnegative(),
    chapterCards: z.number().int().nonnegative()
  })
  .strict();
export type LongLegacySyncCounts = z.infer<typeof LongLegacySyncCountsSchema>;

const LongLegacySyncPreviewBaseSchema = z
  .object({
    sourceTitle: z.string().trim().min(1).max(256),
    sourceKind: z.enum(["write-claw-zip", "long-workspace-json", "book-json"]),
    legacySchemaVersion: z.number().int().nonnegative(),
    counts: LongLegacySyncCountsSchema,
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict();

export const LongChooseLegacySyncSourceResultSchema =
  LongLegacySyncPreviewBaseSchema.extend({
    previewId: z.string().trim().min(1).max(256),
    expiresAt: z.string().datetime()
  }).strict();
export type LongChooseLegacySyncSourceResult = z.infer<
  typeof LongChooseLegacySyncSourceResultSchema
>;

export const LongPreviewLegacySyncAtPathInputSchema = z
  .object({ sourcePath: z.string().trim().min(1) })
  .strict();
export const LongPreviewLegacySyncAtPathResultSchema =
  LongLegacySyncPreviewBaseSchema.extend({
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict();
export type LongPreviewLegacySyncAtPathResult = z.infer<
  typeof LongPreviewLegacySyncAtPathResultSchema
>;

export const LongApplyLegacySyncInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    previewId: z.string().trim().min(1).max(256),
    modules: z.array(LongLegacySyncModuleSchema).min(1).max(3)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.modules).size !== value.modules.length) {
      context.addIssue({
        code: "custom",
        path: ["modules"],
        message: "Legacy sync modules must be unique."
      });
    }
  });
export type LongApplyLegacySyncInput = z.infer<
  typeof LongApplyLegacySyncInputSchema
>;

export const LongApplyLegacySyncAtPathInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    modules: z.array(LongLegacySyncModuleSchema).min(1).max(3),
    sourcePath: z.string().trim().min(1),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.modules).size !== value.modules.length) {
      context.addIssue({
        code: "custom",
        path: ["modules"],
        message: "Legacy sync modules must be unique."
      });
    }
  });
export type LongApplyLegacySyncAtPathInput = z.infer<
  typeof LongApplyLegacySyncAtPathInputSchema
>;

export const LongApplyLegacySyncResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    summary: LongBookSummarySchema,
    imported: LongLegacySyncCountsSchema,
    skipped: LongLegacySyncCountsSchema,
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict();
export type LongApplyLegacySyncResult = z.infer<
  typeof LongApplyLegacySyncResultSchema
>;

export const LongImportPortableAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1)
  })
  .strict();
export type LongImportPortableAtPathInput = z.infer<
  typeof LongImportPortableAtPathInputSchema
>;

export const LongImportPortableResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    exportedAt: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message:
          "Imported portable long book and summary must share the same id."
      });
    }
  });
export type LongImportPortableResult = z.infer<
  typeof LongImportPortableResultSchema
>;

export const LongContinuationImportEncodingSchema = z.enum([
  "utf-8",
  "utf-16le",
  "utf-16be",
  "gb18030"
]);
export type LongContinuationImportEncoding = z.infer<
  typeof LongContinuationImportEncodingSchema
>;

export const LongContinuationImportChapterPreviewSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(1_024),
    title: z.string().trim().min(1).max(256),
    order: z.number().int().positive(),
    byteLength: z.number().int().positive(),
    encoding: LongContinuationImportEncodingSchema
  })
  .strict();
export type LongContinuationImportChapterPreview = z.infer<
  typeof LongContinuationImportChapterPreviewSchema
>;

export const LongContinuationImportVolumePreviewSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(1_024),
    title: z.string().trim().min(1).max(256),
    order: z.number().int().positive(),
    chapters: z
      .array(LongContinuationImportChapterPreviewSchema)
      .min(1)
      .max(100_000)
  })
  .strict();
export type LongContinuationImportVolumePreview = z.infer<
  typeof LongContinuationImportVolumePreviewSchema
>;

export const LongContinuationImportScanSchema = z
  .object({
    defaultTitle: z.string().trim().min(1).max(256),
    mode: z.enum(["flat", "volume_folders"]),
    volumeCount: z.number().int().positive(),
    chapterCount: z.number().int().positive(),
    checkpointCount: z.number().int().nonnegative(),
    pendingVolumeTitle: z.string().trim().min(1).max(256),
    pendingChapterTitle: z.string().trim().min(1).max(256),
    volumes: z
      .array(LongContinuationImportVolumePreviewSchema)
      .min(1)
      .max(10_000),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict()
  .superRefine((value, context) => {
    const chapterCount = value.volumes.reduce(
      (total, volume) => total + volume.chapters.length,
      0
    );
    if (
      value.volumeCount !== value.volumes.length ||
      value.chapterCount !== chapterCount ||
      value.checkpointCount !== Math.max(0, chapterCount - 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["chapterCount"],
        message: "Continuation import preview counts must match its volumes."
      });
    }
    const pendingVolume = value.volumes.at(-1);
    const pendingChapter = pendingVolume?.chapters.at(-1);
    if (
      pendingVolume?.title !== value.pendingVolumeTitle ||
      pendingChapter?.title !== value.pendingChapterTitle
    ) {
      context.addIssue({
        code: "custom",
        path: ["pendingChapterTitle"],
        message:
          "Continuation import pending chapter must be the final ordered chapter."
      });
    }
  });
export type LongContinuationImportScan = z.infer<
  typeof LongContinuationImportScanSchema
>;

export const LongChooseContinuationImportSourceResultSchema =
  LongContinuationImportScanSchema.extend({
    previewId: z.string().trim().min(1).max(256),
    expiresAt: z.string().datetime()
  }).strict();
export type LongChooseContinuationImportSourceResult = z.infer<
  typeof LongChooseContinuationImportSourceResultSchema
>;

export const LongPreviewContinuationImportAtPathInputSchema = z
  .object({ sourcePath: z.string().trim().min(1) })
  .strict();
export type LongPreviewContinuationImportAtPathInput = z.infer<
  typeof LongPreviewContinuationImportAtPathInputSchema
>;

export const LongPreviewContinuationImportAtPathResultSchema =
  LongContinuationImportScanSchema.extend({
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict();
export type LongPreviewContinuationImportAtPathResult = z.infer<
  typeof LongPreviewContinuationImportAtPathResultSchema
>;

export const LongImportContinuationInputSchema = z
  .object({
    previewId: z.string().trim().min(1).max(256),
    title: z.string().trim().min(1).max(256),
    genre: LongBookGenreSchema
  })
  .strict();
export type LongImportContinuationInput = z.infer<
  typeof LongImportContinuationInputSchema
>;

export const LongImportContinuationAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    title: z.string().trim().min(1).max(256),
    genre: LongBookGenreSchema
  })
  .strict();
export type LongImportContinuationAtPathInput = z.infer<
  typeof LongImportContinuationAtPathInputSchema
>;

export const LongImportContinuationResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    importedVolumeCount: z.number().int().positive(),
    importedChapterCount: z.number().int().positive(),
    checkpointCount: z.number().int().nonnegative(),
    pendingChapterCardId: LongChapterCardIdSchema,
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message:
          "Imported continuation book and summary must share the same id."
      });
    }
    if (value.checkpointCount !== Math.max(0, value.importedChapterCount - 1)) {
      context.addIssue({
        code: "custom",
        path: ["checkpointCount"],
        message:
          "Continuation checkpoint count must leave exactly one pending chapter."
      });
    }
  });
export type LongImportContinuationResult = z.infer<
  typeof LongImportContinuationResultSchema
>;

export const LongOpenBookInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongOpenBookInput = z.infer<typeof LongOpenBookInputSchema>;

export const LongRenameBookInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    title: z.string().trim().min(1).max(256)
  })
  .strict();
export type LongRenameBookInput = z.infer<typeof LongRenameBookInputSchema>;

export const LongUpdateBindingsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    linkedMaterialIdsByKind: LongLinkedMaterialIdsByKindInputSchema,
    linkedSkillIdsByKind: LongLinkedSkillIdsByKindInputSchema,
    linkedResourceStageScopes: LongLinkedResourceStageScopesSchema.optional()
  })
  .strict();
export type LongUpdateBindingsInput = z.infer<
  typeof LongUpdateBindingsInputSchema
>;

export const LongListBooksResultSchema = z
  .object({
    updatedAt: z.string().datetime(),
    books: z.array(LongBookSummarySchema).max(100_000),
    diagnostics: z
      .array(
        z
          .object({
            bookId: LongBookIdSchema,
            code: z.enum(["unavailable", "invalid"]),
            message: z.string().trim().min(1).max(4_000)
          })
          .strict()
      )
      .max(100_000)
      .optional()
  })
  .strict();
export type LongListBooksResult = z.infer<typeof LongListBooksResultSchema>;

export const LongOpenBookAtPathInputSchema = z
  .object({
    projectDirectory: z.string().trim().min(1)
  })
  .strict();
export type LongOpenBookAtPathInput = z.infer<
  typeof LongOpenBookAtPathInputSchema
>;

export const LongRemoveBookInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongRemoveBookInput = z.infer<typeof LongRemoveBookInputSchema>;

export const LongRemoveBookResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    removed: z.boolean()
  })
  .strict();
export type LongRemoveBookResult = z.infer<typeof LongRemoveBookResultSchema>;

export const LongOpenBookResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema
  })
  .strict();
export type LongOpenBookResult = z.infer<typeof LongOpenBookResultSchema>;

export const LONG_DOCUMENT_PAGE_DEFAULT_CHARACTERS = 32_768;
export const LONG_DOCUMENT_PAGE_MAX_CHARACTERS = 256 * 1024;

export const LongReadDocumentInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    fileId: LongFileIdSchema,
    offset: z.number().int().nonnegative().default(0),
    maxCharacters: z
      .number()
      .int()
      .min(1)
      .max(LONG_DOCUMENT_PAGE_MAX_CHARACTERS)
      .default(LONG_DOCUMENT_PAGE_DEFAULT_CHARACTERS)
  })
  .strict();
export type LongReadDocumentInput = z.infer<typeof LongReadDocumentInputSchema>;

export const LongReadDocumentResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    file: LongWorkspaceFileReferenceSchema,
    // JavaScript string length counts UTF-16 code units. Reserve two units
    // per requested Unicode code point, then enforce the actual page limit
    // below with Array.from.
    content: z.string().max(LONG_DOCUMENT_PAGE_MAX_CHARACTERS * 2),
    offset: z.number().int().nonnegative(),
    totalCharacters: z.number().int().nonnegative(),
    nextOffset: z.number().int().positive().nullable()
  })
  .strict()
  .superRefine((value, context) => {
    // Document paging is defined in Unicode code points so an emoji or other
    // surrogate pair is never split between pages.
    const pageCharacters = Array.from(value.content).length;
    if (pageCharacters > LONG_DOCUMENT_PAGE_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Long document page exceeds the maximum character count."
      });
    }
    const endOffset = value.offset + pageCharacters;
    if (endOffset > value.totalCharacters) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Long document page exceeds its declared total length."
      });
    }
    if (
      value.nextOffset !== null &&
      (value.nextOffset !== endOffset ||
        value.nextOffset >= value.totalCharacters)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextOffset"],
        message:
          "Long document next offset must follow the page and leave unread content."
      });
    }
    if (value.nextOffset === null && endOffset < value.totalCharacters) {
      context.addIssue({
        code: "custom",
        path: ["nextOffset"],
        message: "A truncated long document page must expose its next offset."
      });
    }
  });
export type LongReadDocumentResult = z.infer<
  typeof LongReadDocumentResultSchema
>;

export const LONG_SEARCH_SCOPES = [
  "all",
  "worldbuilding",
  "character_design",
  "plot_design",
  "draft",
  "continuity_ledger"
] as const;
export const LongSearchScopeSchema = z.enum(LONG_SEARCH_SCOPES);
export type LongSearchScope = z.infer<typeof LongSearchScopeSchema>;

export const LongSearchInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    query: z.string().trim().min(1).max(256),
    scope: LongSearchScopeSchema.default("all"),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    maxSnippetCharacters: z.number().int().min(40).max(2_000).default(320)
  })
  .strict();
export type LongSearchInput = z.infer<typeof LongSearchInputSchema>;

export const LongSearchHitSchema = z
  .object({
    fileId: LongFileIdSchema,
    path: LongProjectRelativePathSchema,
    root: LongWorkspaceRootSchema,
    title: z.string().trim().min(1).max(512),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    snippet: z.string().max(2_000)
  })
  .strict()
  .refine((hit) => hit.end > hit.start, {
    path: ["end"],
    message: "Long search hit end must be after start."
  });
export type LongSearchHit = z.infer<typeof LongSearchHitSchema>;

export const LongSearchResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    query: z.string().min(1).max(256),
    scope: LongSearchScopeSchema,
    hits: z.array(LongSearchHitSchema).max(100),
    nextCursor: z.string().min(1).max(2_048).nullable()
  })
  .strict();
export type LongSearchResult = z.infer<typeof LongSearchResultSchema>;

export const LongWriteDocumentInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    fileId: LongFileIdSchema,
    content: z.string().max(16 * 1024 * 1024)
  })
  .strict();
export type LongWriteDocumentInput = z.infer<
  typeof LongWriteDocumentInputSchema
>;

export const LongWriteDocumentResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    file: LongWorkspaceFileReferenceSchema,
    summary: LongBookSummarySchema
  })
  .strict();
export type LongWriteDocumentResult = z.infer<
  typeof LongWriteDocumentResultSchema
>;

function refineLongAgentsMdContent(
  content: string,
  context: z.RefinementCtx,
  path: Array<string | number> = ["content"]
): void {
  if (longAgentsMdCharacterCount(content) > LONG_AGENTS_MD_MAX_CHARACTERS) {
    context.addIssue({
      code: "custom",
      path,
      message: "Long AGENTS.md exceeds the maximum character count."
    });
  }
}

export const LongReadAgentsMdInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongReadAgentsMdInput = z.infer<typeof LongReadAgentsMdInputSchema>;

export const LongReadAgentsMdResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    content: z.string().max(LONG_AGENTS_MD_MAX_CHARACTERS * 2),
    truncated: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    refineLongAgentsMdContent(value.content, context);
  });
export type LongReadAgentsMdResult = z.infer<
  typeof LongReadAgentsMdResultSchema
>;

export const LongWriteAgentsMdInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    content: z.string().max(LONG_AGENTS_MD_MAX_CHARACTERS * 2)
  })
  .strict()
  .superRefine((value, context) => {
    refineLongAgentsMdContent(value.content, context);
  });
export type LongWriteAgentsMdInput = z.infer<
  typeof LongWriteAgentsMdInputSchema
>;

export const LongWriteAgentsMdResultSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongWriteAgentsMdResult = z.infer<
  typeof LongWriteAgentsMdResultSchema
>;

export const LongWorkspaceIndexResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    workspaceIndex: LongWorkspaceIndexSnapshotSchema
  })
  .strict();
export type LongWorkspaceIndexResult = z.infer<
  typeof LongWorkspaceIndexResultSchema
>;

export const LongPreviewOperationsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    batch: LongWorkspaceOperationBatchSchema
  })
  .strict();
export type LongPreviewOperationsInput = z.infer<
  typeof LongPreviewOperationsInputSchema
>;

export const LongPreviewOperationsResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    preview: LongWorkspaceImpactPreviewSchema
  })
  .strict();
export type LongPreviewOperationsResult = z.infer<
  typeof LongPreviewOperationsResultSchema
>;

export const LongApplyOperationsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    batch: LongWorkspaceOperationBatchSchema
  })
  .strict();
export type LongApplyOperationsInput = z.infer<
  typeof LongApplyOperationsInputSchema
>;

export const LongApplyOperationsResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    operationResult: LongWorkspaceOperationResultSchema,
    summary: LongBookSummarySchema
  })
  .strict();
export type LongApplyOperationsResult = z.infer<
  typeof LongApplyOperationsResultSchema
>;
