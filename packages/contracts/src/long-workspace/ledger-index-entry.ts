import { z } from "zod";

import {
  LongChapterCardIdSchema,
  LongForeshadowingBeatIdSchema,
  LongJsonFileReferenceSchema,
  LongLedgerCommitIdSchema,
  LongNarrativePlacementIdSchema,
  longLedgerCommitFileId
} from "./ids";
import { LongTimestampSchema } from "./primitives";

function uniqueIdList<T extends z.ZodType<string>>(schema: T, label: string) {
  return z
    .array(schema)
    .max(100_000)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label}: ${value}`
          });
        }
        seen.add(value);
      });
    });
}

export const LongLedgerCommitIndexEntrySchema = z
  .object({
    id: LongLedgerCommitIdSchema,
    mode: z
      .enum([
        "structured",
        "text_files",
        "text_files_batch",
        "import_checkpoint"
      ])
      .default("structured"),
    sequence: z.number().int().positive(),
    chapterCardId: LongChapterCardIdSchema,
    chapterCardIds: z.array(LongChapterCardIdSchema).max(100_000).optional(),
    checkpointChapterCardId: LongChapterCardIdSchema.optional(),
    committedAt: LongTimestampSchema,
    bodyEvidence: z
      .array(
        z
          .object({
            chapterCardId: LongChapterCardIdSchema,
            sha256: z.string().regex(/^[a-f0-9]{64}$/u)
          })
          .strict()
      )
      .min(1)
      .max(100_000)
      .optional(),
    changedChapterIds: uniqueIdList(
      LongChapterCardIdSchema,
      "changed chapter"
    ).optional(),
    placementIds: uniqueIdList(
      LongNarrativePlacementIdSchema,
      "placement decision"
    ),
    foreshadowingBeatIds: uniqueIdList(
      LongForeshadowingBeatIdSchema,
      "foreshadowing-beat decision"
    ),
    recordFile: LongJsonFileReferenceSchema
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.recordFile.id !== longLedgerCommitFileId(entry.id)) {
      context.addIssue({
        code: "custom",
        path: ["recordFile", "id"],
        message: "Ledger record file id must match its stable commit id."
      });
    }
    if (entry.mode !== "text_files_batch") return;

    const chapterCardIds = entry.chapterCardIds ?? [];
    if (chapterCardIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["chapterCardIds"],
        message: "A batch ledger index entry requires at least one chapter."
      });
    }
    if (new Set(chapterCardIds).size !== chapterCardIds.length) {
      context.addIssue({
        code: "custom",
        path: ["chapterCardIds"],
        message: "A batch ledger index entry cannot contain a chapter twice."
      });
    }
    if (
      entry.checkpointChapterCardId === undefined ||
      chapterCardIds.at(-1) !== entry.checkpointChapterCardId ||
      entry.chapterCardId !== entry.checkpointChapterCardId
    ) {
      context.addIssue({
        code: "custom",
        path: ["checkpointChapterCardId"],
        message:
          "The batch checkpoint and compatibility chapter must be the final batch chapter."
      });
    }
  });
export type LongLedgerCommitIndexEntry = z.infer<
  typeof LongLedgerCommitIndexEntrySchema
>;

export function longLedgerCommitChapterIds(
  entry: Pick<
    LongLedgerCommitIndexEntry,
    "mode" | "chapterCardId" | "chapterCardIds"
  >
): string[] {
  return entry.mode === "text_files_batch" && entry.chapterCardIds
    ? [...entry.chapterCardIds]
    : [entry.chapterCardId];
}

export function longLedgerCommitCheckpointChapterId(
  entry: Pick<
    LongLedgerCommitIndexEntry,
    "mode" | "chapterCardId" | "checkpointChapterCardId"
  >
): string {
  return entry.mode === "text_files_batch"
    ? (entry.checkpointChapterCardId ?? entry.chapterCardId)
    : entry.chapterCardId;
}

export function longLedgerCommitContainsChapter(
  entry: Pick<
    LongLedgerCommitIndexEntry,
    "mode" | "chapterCardId" | "chapterCardIds"
  >,
  chapterCardId: string
): boolean {
  return longLedgerCommitChapterIds(entry).includes(chapterCardId);
}
