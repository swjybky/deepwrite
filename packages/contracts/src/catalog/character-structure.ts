import { z } from "zod";

import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  CatalogIdSchema,
  CatalogTitleSchema,
  uniqueIds
} from "./kinds";

export const BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID = "character_design" as const;
export const BOOK_CHARACTER_OVERVIEW_TITLE = "概览" as const;
export const LEGACY_BOOK_CHARACTER_OVERVIEW_TITLE = "人物概览" as const;

export const BookCharacterFormatSchema = z.enum(["text", "list"]);
export type BookCharacterFormat = z.infer<typeof BookCharacterFormatSchema>;

export const BookCharacterItemSchema = z
  .object({
    id: CatalogIdSchema.refine(
      (value) =>
        value !== BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID && value !== "draft",
      { message: "Character item ids cannot use reserved document ids." }
    ),
    title: CatalogTitleSchema,
    order: z.number().int().positive()
  })
  .strict();
export type BookCharacterItem = z.infer<typeof BookCharacterItemSchema>;

export const BookCharacterStructureSchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("text") }).strict(),
  z
    .object({
      format: z.literal("list"),
      items: z
        .array(BookCharacterItemSchema)
        .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
    })
    .strict()
    .superRefine((structure, context) => {
      if (!uniqueIds(structure.items.map(({ id }) => id))) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Character items cannot contain duplicate ids."
        });
      }
      if (!uniqueIds(structure.items.map(({ order }) => String(order)))) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Character items cannot contain duplicate order values."
        });
      }
      if (
        !uniqueIds(
          structure.items.map(({ title }) => title.toLocaleLowerCase())
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Character items cannot contain duplicate titles."
        });
      }
    })
]);
export type BookCharacterStructure = z.infer<
  typeof BookCharacterStructureSchema
>;

export function createDefaultBookCharacterStructure(): BookCharacterStructure {
  return { format: "text" };
}

export const CharacterStructureMutationSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("setFormat"), format: BookCharacterFormatSchema })
    .strict(),
  z
    .object({
      type: z.literal("createItem"),
      title: CatalogTitleSchema,
      itemId: CatalogIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("updateItem"),
      itemId: CatalogIdSchema,
      title: CatalogTitleSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("moveItem"),
      itemId: CatalogIdSchema,
      direction: z.enum(["up", "down"])
    })
    .strict(),
  z
    .object({
      type: z.literal("reorderItem"),
      itemId: CatalogIdSchema,
      anchorId: CatalogIdSchema,
      position: z.enum(["before", "after"])
    })
    .strict(),
  z.object({ type: z.literal("deleteItem"), itemId: CatalogIdSchema }).strict()
]);
export type CharacterStructureMutation = z.infer<
  typeof CharacterStructureMutationSchema
>;
