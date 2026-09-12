import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  LongBookIdSchema,
  LongBookSchema,
  LongBookSummarySchema
} from "./long-workspace";

export const LongResolveConflictsInputSchema = z
  .object({ bookId: LongBookIdSchema })
  .strict();
export type LongResolveConflictsInput = z.infer<
  typeof LongResolveConflictsInputSchema
>;

export const LongResolveConflictsResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    resolvedPaths: z.array(z.string().min(1).max(4_000)).max(20_000),
    backupPath: z.string().min(1).max(4_000).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message: "Recovered book and summary must share the same id."
      });
    }
  });
export type LongResolveConflictsResult = z.infer<
  typeof LongResolveConflictsResultSchema
>;

export const LongResolveConflictsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.resolveConflicts"),
    payload: LongResolveConflictsInputSchema
  });
