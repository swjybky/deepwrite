import { z } from "zod";
import { DecompositionIdSchema } from "./limits";

export const DecompositionTargetSelectionSchema = z.union([
  z.object({
    action: z.literal("create"),
    kind: z.enum(["long", "material-group"]),
    title: z.string().trim().min(1).max(120)
  }),
  z.object({
    action: z.literal("select"),
    kind: z.literal("long"),
    bookId: DecompositionIdSchema
  }),
  z.object({
    action: z.literal("select"),
    kind: z.literal("material-group"),
    groupId: DecompositionIdSchema
  })
]);
export type DecompositionTargetSelection = z.infer<
  typeof DecompositionTargetSelectionSchema
>;
const state = z.enum(["ready", "writing", "completed", "missing", "conflict"]);
export const DecompositionTargetSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("long"),
      bookId: DecompositionIdSchema,
      baseRevision: z.number().int().nonnegative(),
      state
    }),
    z.object({
      kind: z.literal("material-group"),
      groupId: DecompositionIdSchema,
      libraryIds: z.object({
        character: DecompositionIdSchema,
        plot: DecompositionIdSchema,
        draft: DecompositionIdSchema,
        other: DecompositionIdSchema,
        gimmick: DecompositionIdSchema
      }),
      baseRevisions: z.record(z.string(), z.number().int().nonnegative()),
      state
    })
  ])
  .refine(
    (target) =>
      target.kind !== "material-group" ||
      new Set(Object.values(target.libraryIds)).size === 5,
    "五个素材库必须具有不同标识。"
  );
export type DecompositionTarget = z.infer<typeof DecompositionTargetSchema>;
export const DecompositionContentRefSchema = z.object({
  projectId: DecompositionIdSchema,
  resourceId: DecompositionIdSchema,
  fileId: DecompositionIdSchema.optional(),
  revision: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  /** Set when the user kept their own edit; later writes must ask again. */
  userOwned: z.literal(true).optional()
});
export type DecompositionContentRef = z.infer<
  typeof DecompositionContentRefSchema
>;
export const DECOMPOSITION_RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export const DecompositionReceiptSchema = z
  .object({
    id: DecompositionIdSchema,
    jobId: DecompositionIdSchema,
    outputVersion: z.number().int().positive(),
    unitId: DecompositionIdSchema,
    inputRevision: z.string().min(1).max(256),
    /** Empty for units whose only output is the task-local record. */
    refs: z.array(DecompositionContentRefSchema).max(10_000),
    savedAt: z.string().datetime(),
    /** Entries staged so far by a partial submission; the unit is not done. */
    staged: z.number().int().nonnegative().optional()
  })
  .superRefine((value, context) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      DECOMPOSITION_RECEIPT_MAX_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "拆解回执超过 4 MiB UTF-8 安全上限。"
      });
    }
  });
export type DecompositionReceipt = z.infer<typeof DecompositionReceiptSchema>;
