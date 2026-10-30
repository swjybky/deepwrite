import { z } from "zod";
import { EnvelopeBaseSchema } from "../envelope";
import { DecompositionIdSchema } from "./limits";
export const DecompositionTargetUpdatedEventSchema = EnvelopeBaseSchema.extend({
  type: z.literal("decomposition.target_updated"),
  payload: z.object({
    jobId: DecompositionIdSchema,
    targetKind: z.enum(["long", "material-group"]),
    projectIds: z.array(DecompositionIdSchema).min(1).max(5),
    unitId: DecompositionIdSchema.optional()
  })
});
export type DecompositionTargetUpdatedEvent = z.infer<
  typeof DecompositionTargetUpdatedEventSchema
>;

/**
 * A task stopped without the user asking for it: it finished, failed, or was
 * paused by the usage limit or exhausted quota. Main turns it into a system
 * notification and does not forward it to the Renderer.
 */
export const DecompositionJobSettledEventSchema = EnvelopeBaseSchema.extend({
  type: z.literal("decomposition.job_settled"),
  payload: z.object({
    jobId: DecompositionIdSchema,
    outcome: z.enum(["completed", "failed", "paused"])
  })
});
export type DecompositionJobSettledEvent = z.infer<
  typeof DecompositionJobSettledEventSchema
>;
