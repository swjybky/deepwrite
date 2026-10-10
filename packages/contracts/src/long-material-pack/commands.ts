import { z } from "zod";
import { EnvelopeBaseSchema } from "../envelope";
import { LongBookIdSchema } from "../long-workspace";
import { LongMaterialGuideSubmissionSchema } from "./guide";
import { LongMaterialEntryKeySchema, LongMaterialPackIdSchema } from "./limits";
import { LongMaterialPackRequestSchema } from "./options";
import { LongMaterialProgressPayloadSchema } from "./results";

export const LongMaterialInspectInputSchema = z
  .object({ bookId: LongBookIdSchema })
  .strict();
export const LongMaterialConvertInputSchema =
  LongMaterialPackRequestSchema.extend({
    /** Correlates `long_material_pack.progress` events with this request. */
    operationId: z.string().trim().min(1).max(120)
  });
export type LongMaterialConvertInput = z.infer<
  typeof LongMaterialConvertInputSchema
>;

/** Conflicts keep the user's edit unless they choose to overwrite it. */
export const LongMaterialResolveActionSchema = z.enum([
  /** Replace the user's edit with the newly generated content. */
  "overwrite",
  /** Delete an entry whose source object no longer exists. */
  "remove",
  /** Write an entry the user deleted again. */
  "regenerate"
]);
export const LongMaterialResolveInputSchema = z
  .object({
    packId: LongMaterialPackIdSchema,
    decisions: z
      .array(
        z
          .object({
            key: LongMaterialEntryKeySchema,
            action: LongMaterialResolveActionSchema
          })
          .strict()
      )
      .min(1)
      .max(4096)
  })
  .strict();
export type LongMaterialResolveInput = z.infer<
  typeof LongMaterialResolveInputSchema
>;

export const LongMaterialPackRefInputSchema = z
  .object({ packId: LongMaterialPackIdSchema })
  .strict();
export const LongMaterialListInputSchema = z
  .object({ bookId: LongBookIdSchema.optional() })
  .strict();
export const LongMaterialApplyGuideInputSchema = z
  .object({
    packId: LongMaterialPackIdSchema,
    submission: LongMaterialGuideSubmissionSchema,
    modelLabel: z.string().trim().max(200).optional()
  })
  .strict();
export type LongMaterialApplyGuideInput = z.infer<
  typeof LongMaterialApplyGuideInputSchema
>;

/** Main → Core: the public request plus paths only Main may resolve. */
export const LongMaterialCoreOperationSchema = z.discriminatedUnion(
  "operation",
  [
    LongMaterialInspectInputSchema.extend({ operation: z.literal("inspect") }),
    LongMaterialPackRequestSchema.extend({ operation: z.literal("preview") }),
    LongMaterialConvertInputSchema.extend({ operation: z.literal("convert") }),
    LongMaterialResolveInputSchema.extend({ operation: z.literal("resolve") }),
    LongMaterialListInputSchema.extend({ operation: z.literal("list") }),
    LongMaterialPackRefInputSchema.extend({
      operation: z.literal("deleteRecord")
    }),
    LongMaterialApplyGuideInputSchema.extend({
      operation: z.literal("applyGuide")
    }),
    LongMaterialPackRefInputSchema.extend({
      operation: z.literal("evidence"),
      /** Main sizes the evidence to the resolved model. */
      evidenceTokens: z.number().int().positive().max(2_000_000)
    })
  ]
);
export type LongMaterialCoreOperation = z.infer<
  typeof LongMaterialCoreOperationSchema
>;
export const LongMaterialCoreInputSchema = z
  .object({
    workspaceDirectory: z.string().min(1).max(4096),
    paths: z
      .object({
        materials: z.string().min(1).max(4096),
        groups: z.string().min(1).max(4096)
      })
      .strict(),
    request: LongMaterialCoreOperationSchema
  })
  .strict();
export type LongMaterialCoreInput = z.infer<typeof LongMaterialCoreInputSchema>;

const envelope = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  EnvelopeBaseSchema.extend({ type: z.literal(type), payload });

export const LongMaterialPublicCommandSchemas = [
  envelope("longMaterialPack.inspect", LongMaterialInspectInputSchema),
  envelope("longMaterialPack.preview", LongMaterialPackRequestSchema),
  envelope("longMaterialPack.convert", LongMaterialConvertInputSchema),
  envelope("longMaterialPack.resolve", LongMaterialResolveInputSchema),
  envelope("longMaterialPack.list", LongMaterialListInputSchema),
  envelope("longMaterialPack.deleteRecord", LongMaterialPackRefInputSchema),
  envelope("longMaterialPack.applyGuide", LongMaterialApplyGuideInputSchema)
] as const;
export const LongMaterialCommandSchemas = [
  ...LongMaterialPublicCommandSchemas,
  envelope("longMaterialPack.core", LongMaterialCoreInputSchema)
] as const;

export const LongMaterialProgressEventEnvelopeSchema = envelope(
  "long_material_pack.progress",
  LongMaterialProgressPayloadSchema
);
export type LongMaterialProgressEventEnvelope = z.infer<
  typeof LongMaterialProgressEventEnvelopeSchema
>;
