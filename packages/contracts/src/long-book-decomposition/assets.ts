import { z } from "zod";
import {
  DecompositionBeatTypeSchema,
  DecompositionReadingCardSchema
} from "./cards";
import {
  DECOMPOSITION_MAX_CHAPTERS,
  DecompositionIdSchema,
  DecompositionTextSchema
} from "./limits";
import {
  DecompositionRegistryDataSchema,
  DecompositionRegistryPlanSchema
} from "./registry";

const chapterOrder = z.number().int().min(1).max(DECOMPOSITION_MAX_CHAPTERS);
const chroniclePoint = z.object({
  title: z.string().min(1).max(120),
  summary: DecompositionTextSchema,
  startOrder: chapterOrder,
  endOrder: chapterOrder
});
const foreshadowingLine = z.object({
  key: DecompositionIdSchema,
  title: z.string().min(1).max(120),
  coreQuestion: DecompositionTextSchema,
  hiddenTruth: DecompositionTextSchema.optional(),
  expectedReaderEffect: DecompositionTextSchema,
  beats: z
    .array(
      z.object({
        type: DecompositionBeatTypeSchema,
        chapterOrder,
        note: DecompositionTextSchema
      })
    )
    .max(10_000)
});
const bookVolume = z.object({
  title: z.string().min(1).max(256),
  summary: DecompositionTextSchema
});
const worldItem = z.object({
  title: z.string().min(1).max(120),
  content: DecompositionTextSchema
});
export const DecompositionAssetSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("chronicle"),
      summary: DecompositionTextSchema,
      points: z.array(chroniclePoint).max(200)
    }),
    z.object({
      kind: z.literal("book-line"),
      content: DecompositionTextSchema,
      volumes: z.array(bookVolume).max(10_000),
      gimmick: DecompositionTextSchema
    }),
    z.object({
      kind: z.literal("foreshadowing"),
      lines: z.array(foreshadowingLine).max(1000)
    }),
    z.object({ kind: z.literal("opening"), content: DecompositionTextSchema }),
    z.object({
      kind: z.literal("character-volume"),
      registryId: DecompositionIdSchema,
      volume: z.string().min(1).max(256),
      startOrder: chapterOrder,
      endOrder: chapterOrder,
      content: DecompositionTextSchema
    }),
    z.object({
      kind: z.literal("character"),
      registryId: DecompositionIdSchema,
      summary: DecompositionTextSchema,
      coreProfile: DecompositionTextSchema,
      relationships: DecompositionTextSchema,
      latestState: DecompositionTextSchema,
      history: DecompositionTextSchema
    }),
    z.object({
      kind: z.literal("world"),
      categoryId: DecompositionIdSchema,
      overview: DecompositionTextSchema,
      items: z.array(worldItem).max(1000)
    }),
    z.object({
      kind: z.literal("style"),
      content: DecompositionTextSchema,
      excerpts: z
        .array(
          z.object({
            chapterOrder,
            text: z.string().min(1).max(300),
            comment: DecompositionTextSchema
          })
        )
        .max(100)
    }),
    z.object({
      kind: z.literal("continuity"),
      characterState: DecompositionTextSchema,
      handoff: DecompositionTextSchema,
      foreshadowingChanges: DecompositionTextSchema,
      worldReveals: DecompositionTextSchema.optional()
    }),
    z.object({
      kind: z.literal("topic"),
      domain: z.enum(["world", "character", "plot", "style"]),
      title: z.string().min(1).max(120),
      content: DecompositionTextSchema
    })
  ])
  .refine(
    (value) => JSON.stringify(value).length <= 200_000,
    "单个成品超过 200,000 字。"
  );
export type DecompositionAsset = z.infer<typeof DecompositionAssetSchema>;
/**
 * One batch of an asset whose list grows with the book. Core stages batches
 * until the final, complete submission arrives, so no single call has to
 * carry the whole list; the text fields may come with any batch.
 */
export const DecompositionAssetPartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chronicle"),
    summary: DecompositionTextSchema.optional(),
    points: z.array(chroniclePoint).max(200)
  }),
  z.object({
    kind: z.literal("book-line"),
    content: DecompositionTextSchema.optional(),
    volumes: z.array(bookVolume).max(10_000),
    gimmick: DecompositionTextSchema.optional()
  }),
  z.object({
    kind: z.literal("foreshadowing"),
    lines: z.array(foreshadowingLine).max(1000)
  }),
  z.object({
    kind: z.literal("world"),
    categoryId: DecompositionIdSchema,
    overview: DecompositionTextSchema.optional(),
    items: z.array(worldItem).max(1000)
  })
]);
export type DecompositionAssetPart = z.infer<
  typeof DecompositionAssetPartSchema
>;
export const DecompositionReviewSchema = z.object({
  domain: z.enum(["character", "world", "plot", "continuity", "style"]),
  issues: z
    .array(
      z.object({
        id: DecompositionIdSchema,
        unitId: DecompositionIdSchema.optional(),
        description: DecompositionTextSchema,
        chapterOrders: z.array(chapterOrder).max(100),
        suggestion: DecompositionTextSchema,
        resolution: z.enum(["repair", "reminder", "fixed"])
      })
    )
    .max(1000)
});
export type DecompositionReview = z.infer<typeof DecompositionReviewSchema>;
export const DecompositionSubmissionDataSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reading"),
    card: DecompositionReadingCardSchema
  }),
  z.object({ kind: z.literal("finish-card") }),
  z.object({
    kind: z.literal("registry"),
    registry: DecompositionRegistryDataSchema
  }),
  /** Core turns a plan into the registry before any check. */
  z.object({
    kind: z.literal("registry-plan"),
    plan: DecompositionRegistryPlanSchema
  }),
  z.object({ kind: z.literal("asset"), asset: DecompositionAssetSchema }),
  /** Staged by Core; the unit finishes with its final `asset` submission. */
  z.object({
    kind: z.literal("asset-part"),
    asset: DecompositionAssetPartSchema
  }),
  z.object({ kind: z.literal("review"), review: DecompositionReviewSchema })
]);
export type DecompositionSubmissionData = z.infer<
  typeof DecompositionSubmissionDataSchema
>;

export const DecompositionSubmissionJsonSchema = z.toJSONSchema(
  DecompositionSubmissionDataSchema
);

/** PI result tools use equivalent enums for literals at every schema depth. */
function toolJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    override: ({ jsonSchema }) => {
      if ("const" in jsonSchema) {
        jsonSchema.enum = [jsonSchema.const];
        delete jsonSchema.const;
      }
    }
  });
}

/** Narrow role tools avoid carrying every asset schema in a small model window. */
export const DecompositionToolJsonSchemas = {
  reading: toolJsonSchema(
    z.object({
      kind: z.literal("reading"),
      card: DecompositionReadingCardSchema
    })
  ),
  "finish-card": toolJsonSchema(z.object({ kind: z.literal("finish-card") })),
  registry: toolJsonSchema(
    z.object({
      kind: z.literal("registry"),
      registry: DecompositionRegistryDataSchema
    })
  ),
  "registry-plan": toolJsonSchema(
    z.object({
      kind: z.literal("registry-plan"),
      plan: DecompositionRegistryPlanSchema
    })
  ),
  review: toolJsonSchema(
    z.object({ kind: z.literal("review"), review: DecompositionReviewSchema })
  ),
  ...Object.fromEntries(
    DecompositionAssetSchema.options.map((asset) => [
      asset.shape.kind.value,
      toolJsonSchema(z.object({ kind: z.literal("asset"), asset }))
    ])
  ),
  // Batches of these may leave out the text fields until the final one.
  ...Object.fromEntries(
    DecompositionAssetPartSchema.options.map((asset) => [
      asset.shape.kind.value,
      toolJsonSchema(z.object({ kind: z.literal("asset"), asset }))
    ])
  )
};
