import { z } from "zod";
import {
  DecompositionAssetPartSchema,
  DecompositionSubmissionDataSchema,
  type DecompositionSubmissionData
} from "./assets";
import { DecompositionIdSchema } from "./limits";

// Task records share the local document/transaction ceiling. Unlike one
// model submission, a Core-generated overview contains many valid assets.
export const DECOMPOSITION_RECORD_MAX_BYTES = 32 * 1024 * 1024;

const generatedCharacterOverview = z.object({
  unitId: z.literal("summary:characters"),
  data: z.object({
    kind: z.literal("asset"),
    asset: z.object({
      kind: z.literal("topic"),
      domain: z.literal("character"),
      title: z.literal("人物概览"),
      // The store also checks the serialized UTF-8 bytes, including escaping.
      content: z
        .string()
        .trim()
        .min(1)
        .superRefine((value, context) => {
          if (
            new TextEncoder().encode(value).byteLength >
            DECOMPOSITION_RECORD_MAX_BYTES
          ) {
            context.addIssue({
              code: "too_big",
              origin: "string",
              maximum: DECOMPOSITION_RECORD_MAX_BYTES,
              type: "string",
              inclusive: true,
              message: "人物概览超过 32 MiB UTF-8 安全上限。"
            });
          }
        })
    })
  })
});

export const DecompositionRecordSchema = z.union([
  generatedCharacterOverview,
  z.object({
    unitId: DecompositionIdSchema,
    data: DecompositionSubmissionDataSchema
  })
]);
export type DecompositionRecord = z.infer<typeof DecompositionRecordSchema>;

/**
 * Machine records live in the task directory, never in the user's books or
 * libraries. One immutable file per submitted unit revision.
 */
export const DecompositionRecordFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: DecompositionIdSchema,
    outputVersion: z.number().int().positive(),
    inputRevision: z.string().min(1).max(256),
    savedAt: z.string().datetime(),
    record: DecompositionRecordSchema
  })
  .strict();
export type DecompositionRecordFile = z.infer<
  typeof DecompositionRecordFileSchema
>;

/**
 * Batches of one unit revision staged before its final submission. A retry
 * of the unit continues from here instead of writing everything again.
 */
export const DecompositionDraftFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: DecompositionIdSchema,
    outputVersion: z.number().int().positive(),
    inputRevision: z.string().min(1).max(256),
    unitId: DecompositionIdSchema,
    savedAt: z.string().datetime(),
    asset: DecompositionAssetPartSchema
  })
  .strict();
export type DecompositionDraftFile = z.infer<
  typeof DecompositionDraftFileSchema
>;

type DecompositionAssetData = Extract<
  DecompositionSubmissionData,
  { kind: "asset" }
>["asset"];

/** Reader-facing prose for one finished asset; no machine markers. */
export function decompositionAssetProse(asset: DecompositionAssetData): string {
  switch (asset.kind) {
    case "chronicle":
      return (
        asset.summary +
        "\n\n" +
        asset.points
          .map(
            (p) =>
              `### ${p.title}（${p.startOrder}–${p.endOrder}）\n\n${p.summary}`
          )
          .join("\n\n")
      );
    case "book-line":
      return asset.content + "\n\n" + asset.gimmick;
    case "character":
      return [
        asset.summary,
        asset.coreProfile,
        asset.relationships,
        asset.latestState,
        asset.history
      ].join("\n\n");
    case "world":
      return (
        asset.overview +
        "\n\n" +
        asset.items.map((i) => `### ${i.title}\n\n${i.content}`).join("\n\n")
      );
    case "continuity":
      return [
        asset.characterState,
        asset.handoff,
        asset.foreshadowingChanges,
        asset.worldReveals
      ]
        .filter(Boolean)
        .join("\n\n");
    case "foreshadowing":
      return asset.lines
        .map(
          (line) =>
            `### ${line.title}\n\n${line.coreQuestion}\n\n${line.hiddenTruth ?? ""}\n\n${line.beats.map((beat) => `- 第 ${beat.chapterOrder} 章 ${beat.type}：${beat.note}`).join("\n")}`
        )
        .join("\n\n");
    case "style":
      return (
        asset.content +
        "\n\n" +
        asset.excerpts
          .map(
            ({ chapterOrder, text, comment }) =>
              `### 第 ${chapterOrder} 章典型片段\n\n${text}\n\n点评：${comment}`
          )
          .join("\n\n")
      );
    default:
      return asset.content;
  }
}
