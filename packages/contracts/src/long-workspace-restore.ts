import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { LongBookIdSchema, LongBookSummarySchema } from "./long-workspace";
import { LongTimestampSchema } from "./long-workspace/primitives";

/**
 * A restore point captures one destructive structure batch so an accepted
 * proposal can be undone later. Core owns the stored snapshot; callers only
 * hold its id.
 */
export const LongRestorePointIdSchema = z
  .string()
  .regex(/^restore_[0-9a-z]{8,64}$/u);
export type LongRestorePointId = z.infer<typeof LongRestorePointIdSchema>;

export const LongRestorePointSchema = z
  .object({
    id: LongRestorePointIdSchema,
    createdAt: LongTimestampSchema
  })
  .strict();
export type LongRestorePoint = z.infer<typeof LongRestorePointSchema>;

export const LongRestoreOperationsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    restorePointId: LongRestorePointIdSchema
  })
  .strict();
export type LongRestoreOperationsInput = z.infer<
  typeof LongRestoreOperationsInputSchema
>;

export const LongRestoreOperationsResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    summary: LongBookSummarySchema,
    restoredFileCount: z.number().int().nonnegative()
  })
  .strict();
export type LongRestoreOperationsResult = z.infer<
  typeof LongRestoreOperationsResultSchema
>;

export const LongRestoreOperationsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.restoreOperations"),
    payload: LongRestoreOperationsInputSchema
  });
