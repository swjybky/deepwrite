import { z } from "zod";
import { EnvelopeBaseSchema } from "../envelope";
import { LongBookAnalysisSourceSchema } from "../long-book-analysis-sources";
import { DecompositionSubmissionDataSchema } from "./assets";
import {
  ConfirmLongBookSourceInputSchema,
  DecompositionSourceConfirmationSchema,
  SaveLongBookSourceInputSchema
} from "./source-confirmation";
import {
  DecompositionModelSelectionSchema,
  DecompositionResolvedModelsSchema,
  DecompositionTaskInputSchema,
  LongBookDecompositionJobSchema,
  validateDecompositionModelChains
} from "./job";
import {
  DECOMPOSITION_DEFAULT_CONCURRENCY,
  DECOMPOSITION_MAX_FALLBACK_MODELS,
  DecompositionConcurrencySchema,
  DecompositionIdSchema
} from "./limits";
import { DecompositionQuerySchema } from "./query";
import { DecompositionRegistryDataSchema } from "./registry";
import { DecompositionTargetSelectionSchema } from "./target";
import { DecompositionUsageSchema } from "./usage-schema";

export const DecompositionModelsInputSchema = z
  .object({
    reading: DecompositionModelSelectionSchema,
    integration: DecompositionModelSelectionSchema,
    readingFallbacks: z
      .array(DecompositionModelSelectionSchema)
      .max(DECOMPOSITION_MAX_FALLBACK_MODELS)
      .optional(),
    integrationFallbacks: z
      .array(DecompositionModelSelectionSchema)
      .max(DECOMPOSITION_MAX_FALLBACK_MODELS)
      .optional()
  })
  .superRefine(validateDecompositionModelChains);
export type DecompositionModelsInput = z.infer<
  typeof DecompositionModelsInputSchema
>;

export const CreateDecompositionJobInputSchema = z
  .object({
    confirmation: DecompositionSourceConfirmationSchema,
    profileId: DecompositionIdSchema,
    mode: z.enum(["continuation", "materials"]),
    targetSelection: DecompositionTargetSelectionSchema,
    models: DecompositionModelsInputSchema,
    autoContinue: z.boolean().default(false),
    maxConcurrency: DecompositionConcurrencySchema.default(
      DECOMPOSITION_DEFAULT_CONCURRENCY
    ),
    reuseJobId: DecompositionIdSchema.optional()
  })
  .refine(
    (input) =>
      input.targetSelection.kind ===
      (input.mode === "continuation" ? "long" : "material-group"),
    "目标类型与模式不一致。"
  );
export type CreateDecompositionJobInput = z.infer<
  typeof CreateDecompositionJobInputSchema
>;
export const UpdateDecompositionModelsInputSchema = z.object({
  jobId: DecompositionIdSchema,
  models: DecompositionModelsInputSchema
});
export type UpdateDecompositionModelsInput = z.infer<
  typeof UpdateDecompositionModelsInputSchema
>;
export const DecompositionJobActionSchema = z.object({
  jobId: DecompositionIdSchema
});
/** A failed creation can still have a durable task that the UI must reconnect. */
export const DecompositionCommandRecoverySchema = z.object({
  jobId: DecompositionIdSchema
});
export const DecompositionUnitActionSchema = z.object({
  jobId: DecompositionIdSchema,
  unitId: DecompositionIdSchema
});
export const DecompositionControlInputSchema = z.object({
  jobId: DecompositionIdSchema,
  action: z.enum([
    "advance",
    "stop",
    "resume",
    "finish-package",
    "skip",
    "retry",
    "delete",
    "resolve-conflict",
    "end"
  ]),
  unitId: DecompositionIdSchema.optional(),
  attemptId: DecompositionIdSchema.optional(),
  failed: z.boolean().optional(),
  error: z.string().max(2000).optional(),
  unitErrors: z.record(DecompositionIdSchema, z.string().max(2000)).optional(),
  conflictChoice: z.enum(["keep-user", "regenerate"]).optional()
});
export type DecompositionControlInput = z.infer<
  typeof DecompositionControlInputSchema
>;
export const DecompositionSubmitInputSchema = z
  .object({
    jobId: DecompositionIdSchema,
    outputVersion: z.number().int().positive(),
    attemptId: DecompositionIdSchema,
    unitId: DecompositionIdSchema,
    inputRevision: z.string().min(1).max(256),
    data: DecompositionSubmissionDataSchema
  })
  .strict();
export type DecompositionSubmitInput = z.infer<
  typeof DecompositionSubmitInputSchema
>;
export const DecompositionTopicPlanInputSchema = z
  .object({
    jobId: DecompositionIdSchema,
    outputVersion: z.number().int().positive(),
    attemptId: DecompositionIdSchema,
    topicNumber: z.number().int().min(1).max(5),
    domain: z.enum(["world", "character", "plot", "style"]),
    title: z.string().trim().min(1).max(120),
    dependencies: z.array(DecompositionIdSchema).max(20)
  })
  .strict();
export type DecompositionTopicPlanInput = z.infer<
  typeof DecompositionTopicPlanInputSchema
>;
export const DecompositionSaveRegistryInputSchema = z.object({
  jobId: DecompositionIdSchema,
  baseRevision: z.number().int().positive(),
  registry: DecompositionRegistryDataSchema,
  confirm: z.boolean().default(false)
});
export type DecompositionSaveRegistryInput = z.infer<
  typeof DecompositionSaveRegistryInputSchema
>;
const workspace = z.string().min(1).max(4096);
const paths = z.object({
  book: workspace,
  materials: workspace,
  groups: workspace
});
const envelope = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  EnvelopeBaseSchema.extend({ type: z.literal(type), payload });
export const LongBookSourceCommandSchemas = [
  envelope("longBookAnalysis.saveSource", SaveLongBookSourceInputSchema),
  envelope("longBookAnalysis.confirmSource", ConfirmLongBookSourceInputSchema),
  envelope(
    "longBookAnalysis.coreSource",
    z.object({
      workspaceDirectory: workspace,
      operation: z.enum([
        "import",
        "load",
        "list",
        "delete",
        "save",
        "confirm",
        "confirmed"
      ]),
      source: LongBookAnalysisSourceSchema.optional(),
      sourceId: DecompositionIdSchema.optional(),
      confirmationId: DecompositionIdSchema.optional(),
      sourceRevision: z.number().int().positive().optional(),
      save: SaveLongBookSourceInputSchema.optional(),
      confirm: ConfirmLongBookSourceInputSchema.optional()
    })
  )
] as const;
export const DecompositionPublicCommandSchemas = [
  envelope(
    "longBookDecomposition.createJob",
    CreateDecompositionJobInputSchema
  ),
  envelope("longBookDecomposition.listJobs", z.object({})),
  envelope("longBookDecomposition.getJob", DecompositionJobActionSchema),
  envelope("longBookDecomposition.control", DecompositionControlInputSchema),
  envelope(
    "longBookDecomposition.updateModels",
    UpdateDecompositionModelsInputSchema
  ),
  envelope("longBookDecomposition.getRegistry", DecompositionJobActionSchema),
  envelope(
    "longBookDecomposition.saveRegistry",
    DecompositionSaveRegistryInputSchema
  ),
  envelope("longBookDecomposition.listResults", DecompositionJobActionSchema),
  envelope("longBookDecomposition.readUnit", DecompositionUnitActionSchema)
] as const;
export const DecompositionInternalCommandSchemas = [
  envelope(
    "longBookDecomposition.coreCreate",
    z.object({
      workspaceDirectory: workspace,
      paths,
      job: LongBookDecompositionJobSchema
    })
  ),
  envelope(
    "longBookDecomposition.coreAccess",
    z.object({
      workspaceDirectory: workspace,
      operation: z.enum([
        "list",
        "get",
        "control",
        "update-models",
        "registry",
        "save-registry",
        "results",
        "unit",
        "open"
      ]),
      jobId: DecompositionIdSchema.optional(),
      unitId: DecompositionIdSchema.optional(),
      control: DecompositionControlInputSchema.optional(),
      models: DecompositionResolvedModelsSchema.optional(),
      registry: DecompositionSaveRegistryInputSchema.optional(),
      recover: z.boolean().optional(),
      task: DecompositionTaskInputSchema.optional(),
      profileId: DecompositionIdSchema.optional(),
      attemptId: DecompositionIdSchema.optional(),
      /** Main-observed usage since the last control call; never from Renderer. */
      usage: DecompositionUsageSchema.optional()
    })
  ),
  envelope(
    "longBookDecomposition.query",
    z.object({
      jobId: DecompositionIdSchema,
      request: DecompositionQuerySchema
    })
  ),
  envelope("longBookDecomposition.submitUnit", DecompositionSubmitInputSchema),
  envelope("longBookDecomposition.planTopic", DecompositionTopicPlanInputSchema)
] as const;
export const DecompositionCommandSchemas = [
  ...DecompositionPublicCommandSchemas,
  ...DecompositionInternalCommandSchemas
] as const;
