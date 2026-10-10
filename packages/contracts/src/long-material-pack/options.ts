import { z } from "zod";
import { LongBookIdSchema, LongChapterCardIdSchema } from "../long-workspace";
import { LongMaterialPackIdSchema } from "./limits";
import {
  LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT,
  LONG_MATERIAL_SECTIONS
} from "./constants";

export const LongMaterialSectionSchema = z.enum(LONG_MATERIAL_SECTIONS);

export const LongMaterialPackOptionsSchema = z
  .object({
    sections: z
      .array(LongMaterialSectionSchema)
      .max(LONG_MATERIAL_SECTIONS.length)
      .refine(
        (values) => new Set(values).size === values.length,
        "转换内容不能重复。"
      ),
    /** `grouped`: minor characters share entries; `individual`: one each. */
    characterScope: z.enum(["grouped", "individual"]),
    chapterGrouping: z.enum(["auto", "20", "50"]),
    sampleChapterIds: z
      .array(LongChapterCardIdSchema)
      .max(LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT)
      .refine(
        (values) => new Set(values).size === values.length,
        "范文章节不能重复。"
      )
  })
  .strict();
export type LongMaterialPackOptions = z.infer<
  typeof LongMaterialPackOptionsSchema
>;

export const LongMaterialPackTargetSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      title: z.string().trim().min(1).max(200)
    })
    .strict(),
  z
    .object({ action: z.literal("update"), packId: LongMaterialPackIdSchema })
    .strict()
]);
export type LongMaterialPackTarget = z.infer<
  typeof LongMaterialPackTargetSchema
>;

export const LongMaterialPackRequestSchema = z
  .object({
    bookId: LongBookIdSchema,
    options: LongMaterialPackOptionsSchema,
    target: LongMaterialPackTargetSchema
  })
  .strict();
export type LongMaterialPackRequest = z.infer<
  typeof LongMaterialPackRequestSchema
>;
