import { z } from "zod";
import {
  CONSERVATIVE_TEXT_TOKEN_WEIGHTS,
  estimateTextTokens
} from "../token-estimate";
import {
  LONG_MATERIAL_EVIDENCE_MAX_CHARACTERS,
  LONG_MATERIAL_EVIDENCE_RATIO,
  LONG_MATERIAL_GUIDE_TEXT_MAX_CHARACTERS,
  LongMaterialPackIdSchema
} from "./limits";
import { LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW } from "./constants";

interface ModelCapacity {
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
}

/** Evidence tokens one guide run may carry: a share of the usable window. */
export function longMaterialGuideEvidenceTokens(model: ModelCapacity): number {
  const window = model.contextWindow ?? LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW;
  const outputReserve = Math.min(model.maxTokens ?? 4096, 32_768);
  return Math.max(
    3000,
    Math.floor((window - outputReserve - 6000) * LONG_MATERIAL_EVIDENCE_RATIO)
  );
}

export function longMaterialEvidenceTokens(text: string): number {
  return estimateTextTokens(text, CONSERVATIVE_TEXT_TOKEN_WEIGHTS);
}

const GuideTextSchema = z
  .string()
  .trim()
  .min(20)
  .max(LONG_MATERIAL_GUIDE_TEXT_MAX_CHARACTERS);

/** What the imitation-guide agent submits once; Core turns it into entries. */
export const LongMaterialGuideSubmissionSchema = z
  .object({
    guide: GuideTextSchema,
    roles: GuideTextSchema,
    hooks: GuideTextSchema,
    opening: GuideTextSchema,
    gimmick: GuideTextSchema.optional(),
    style: z
      .object({
        profile: GuideTextSchema,
        excerpts: z
          .array(
            z
              .object({
                chapter: z.number().int().positive(),
                text: z.string().trim().min(1).max(600),
                comment: z.string().trim().min(1).max(1000)
              })
              .strict()
          )
          .max(12)
      })
      .strict()
      .optional()
  })
  .strict();
export type LongMaterialGuideSubmission = z.infer<
  typeof LongMaterialGuideSubmissionSchema
>;

/** The Renderer names a conversion; Main reads the evidence from Core. */
export const LongMaterialGuideTaskInputSchema = z
  .object({
    jobId: z.string().trim().min(1).max(120),
    packId: LongMaterialPackIdSchema
  })
  .strict();
export type LongMaterialGuideTaskInput = z.infer<
  typeof LongMaterialGuideTaskInputSchema
>;

export const LongMaterialGuideEvidenceSchema = z
  .object({
    bookTitle: z.string().min(1).max(256),
    evidence: z.string().min(1).max(LONG_MATERIAL_EVIDENCE_MAX_CHARACTERS),
    needs: z.object({ style: z.boolean(), gimmick: z.boolean() }).strict()
  })
  .strict();
export type LongMaterialGuideEvidence = z.infer<
  typeof LongMaterialGuideEvidenceSchema
>;

export const LongMaterialGuideResolvedInputSchema =
  LongMaterialGuideTaskInputSchema.extend(
    LongMaterialGuideEvidenceSchema.shape
  );
export type LongMaterialGuideResolvedInput = z.infer<
  typeof LongMaterialGuideResolvedInputSchema
>;
