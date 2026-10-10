import {
  BookIdentityFieldSchema,
  BookIdentityIdSchema
} from "../book-identity/limits";
import { z } from "zod";
import { DecompositionReceiptSchema } from "../long-book-decomposition/target";
import { DecompositionIdSchema } from "../long-book-decomposition/limits";
import { LongMaterialGuideSubmissionSchema } from "../long-material-pack/guide";
import { LongMaterialPackIdSchema } from "../long-material-pack/limits";
import { EnvelopeBaseSchema, type Envelope } from "../envelope";
import {
  LongBookAnalysisNoteWriteSchema,
  LongBookAnalysisResultSchema
} from "../long-book-analysis";
import { RevisionAnalysisResultSchema } from "../revision-analysis";
import { validateAgentEventContext } from "../session/envelopes";
import { AgentRuntimeRefSchema } from "../session/agent-event-identity";
import { StyleComparisonResultSchema } from "../style-comparison";
import { ExtrasAgentIdSchema } from "./ids";

const UnitIdSchema = z.string().trim().min(1).max(120);

/** A structured result an extras agent hands back for the user to review. */
export const ExtrasAgentOutputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("book-identity-round"),
      field: BookIdentityFieldSchema,
      roundId: BookIdentityIdSchema,
      bookKey: z.string().min(1).max(600),
      candidateCount: z.number().int().min(1).max(20),
      revision: z.number().int().positive()
    })
    .strict(),
  z.object({
    kind: z.enum([
      "decomposition-card",
      "decomposition-registry",
      "decomposition-asset",
      "decomposition-review"
    ]),
    outputVersion: z.number().int().positive(),
    unitId: DecompositionIdSchema,
    receipt: DecompositionReceiptSchema,
    summary: z.string().max(1000).optional()
  }),
  z.object({
    kind: z.literal("revision-analysis-result"),
    result: RevisionAnalysisResultSchema
  }),
  z.object({
    kind: z.literal("book-analysis-result"),
    unitId: UnitIdSchema.optional(),
    result: LongBookAnalysisResultSchema
  }),
  z.object({
    kind: z.literal("book-analysis-note"),
    unitId: UnitIdSchema,
    note: LongBookAnalysisNoteWriteSchema
  }),
  z.object({
    kind: z.literal("style-comparison-result"),
    result: StyleComparisonResultSchema
  }),
  z.object({
    kind: z.literal("long-material-guide"),
    packId: LongMaterialPackIdSchema,
    submission: LongMaterialGuideSubmissionSchema
  })
]);
export type ExtrasAgentOutput = z.infer<typeof ExtrasAgentOutputSchema>;

export const ExtrasAgentOutputUpdatedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  agentId: ExtrasAgentIdSchema,
  jobId: z.string().trim().min(1).max(120),
  /** Absent when the output was parsed from the final assistant message. */
  toolCallId: z.string().min(1).optional(),
  output: ExtrasAgentOutputSchema,
  runtime: AgentRuntimeRefSchema
});
export type ExtrasAgentOutputUpdatedPayload = z.infer<
  typeof ExtrasAgentOutputUpdatedPayloadSchema
>;

export const ExtrasAgentOutputUpdatedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("extras_agent.output_updated"),
    payload: ExtrasAgentOutputUpdatedPayloadSchema
  }).superRefine(validateAgentEventContext);
export type ExtrasAgentOutputUpdatedEventEnvelope = Envelope<
  ExtrasAgentOutputUpdatedPayload,
  "extras_agent.output_updated"
>;
