import { z } from "zod";
import { LongBookAnalysisIdSchema } from "./long-book-analysis-limits";
import {
  LongBookAnalysisSavedSourceIdSchema,
  LongBookAnalysisSourceKindSchema
} from "./long-book-analysis-sources";
import { LongBookAnalysisSettingsInputSchema } from "./long-book-analysis-presets";
import {
  LongBookAnalysisPlanIdSchema,
  LongBookAnalysisPlanSchema
} from "./long-book-analysis-plan";
import { EnvelopeBaseSchema } from "./envelope";
export const LongBookAnalysisChooseSourceCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysis.chooseSource"),
    payload: z.object({ kind: LongBookAnalysisSourceKindSchema })
  });

export const LongBookAnalysisListSourcesCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysis.listSources"),
    payload: z.object({})
  });

export const LongBookAnalysisLoadSourceCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysis.loadSource"),
    payload: z.object({ sourceId: LongBookAnalysisSavedSourceIdSchema })
  });

export const LongBookAnalysisSettingsListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisSettings.list"),
    payload: z.object({})
  });

export const LongBookAnalysisSettingsSaveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisSettings.save"),
    payload: LongBookAnalysisSettingsInputSchema
  });

export const LongBookAnalysisSettingsResetCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisSettings.reset"),
    payload: z.object({ presetId: LongBookAnalysisIdSchema.optional() })
  });

/**
 * Batch-plan commands. A plan is one file per plan under
 * `<userData>/config/long-book-analysis-plans/`, written by the renderer after
 * every round settles so an interrupted batch can resume where it stopped.
 */
export const LongBookAnalysisPlanListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisPlan.list"),
    payload: z.object({})
  });

export const LongBookAnalysisPlanSaveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisPlan.save"),
    payload: z.object({ plan: LongBookAnalysisPlanSchema })
  });

export const LongBookAnalysisPlanRemoveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisPlan.remove"),
    payload: z.object({ planId: LongBookAnalysisPlanIdSchema })
  });
