import { z } from "zod";
import {
  LongWorldbuildingCategoryIdSchema,
  LongWorldbuildingItemIdSchema
} from "../long-workspace";
import {
  LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS,
  LONG_WORLDBUILDING_DIRECTORY_MAX_CATEGORIES,
  LONG_WORLDBUILDING_DIRECTORY_MAX_ITEMS
} from "../long-workspace-limits";

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
    categoryId: LongWorldbuildingCategoryIdSchema.optional(),
    categoryTitle: z.string().trim().min(1).max(256),
    format: z.enum(["list", "text"]),
    currentStage: z
      .object({
        kind: z.enum(["item", "overview", "text"]),
        itemId: LongWorldbuildingItemIdSchema.optional(),
        title: z.string().trim().min(1).max(256),
        text: LongWorldbuildingFocusTextSnapshotSchema.optional()
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
    if (
      value.currentStage.kind === "item" &&
      value.currentStage.text !== undefined &&
      value.overview === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["overview"],
        message:
          "A focused worldbuilding item must include its category overview."
      });
    }
    if (
      value.currentStage.kind !== "item" &&
      value.currentStage.itemId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentStage", "itemId"],
        message: "Only a focused worldbuilding item may include an item id."
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
      Array.from(value.currentStage.text?.content ?? "").length +
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
