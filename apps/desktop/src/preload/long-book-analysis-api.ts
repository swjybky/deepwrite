import {
  type LongBookAnalysisPlan,
  LongBookAnalysisPlanSchema,
  type LongBookAnalysisSavedSourceCatalog,
  LongBookAnalysisSavedSourceCatalogSchema,
  LongBookAnalysisSavedSourceIdSchema,
  type LongBookAnalysisSettings,
  type LongBookAnalysisSettingsInput,
  LongBookAnalysisSettingsInputSchema,
  LongBookAnalysisSettingsSchema,
  type LongBookAnalysisSource,
  type LongBookAnalysisSourceKind,
  LongBookAnalysisSourceKindSchema,
  LongBookAnalysisSourceSchema,
  createEnvelope
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
export async function chooseLongBookAnalysisSource(
  rawKind: LongBookAnalysisSourceKind
): Promise<LongBookAnalysisSource | null> {
  const kind = LongBookAnalysisSourceKindSchema.parse(rawKind);
  const id = browserId("cmd_long_book_analysis_choose_source");
  return LongBookAnalysisSourceSchema.nullable().parse(
    await invokeCommand<LongBookAnalysisSource | null>(
      createEnvelope(
        "longBookAnalysis.chooseSource",
        { kind },
        { id, correlationId: id }
      )
    )
  );
}

export async function listLongBookAnalysisSources(): Promise<LongBookAnalysisSavedSourceCatalog> {
  const id = browserId("cmd_long_book_analysis_sources_list");
  return LongBookAnalysisSavedSourceCatalogSchema.parse(
    await invokeCommand<LongBookAnalysisSavedSourceCatalog>(
      createEnvelope(
        "longBookAnalysis.listSources",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function loadLongBookAnalysisSource(
  rawSourceId: string
): Promise<LongBookAnalysisSource> {
  const sourceId = LongBookAnalysisSavedSourceIdSchema.parse(rawSourceId);
  const id = browserId("cmd_long_book_analysis_source_load");
  return LongBookAnalysisSourceSchema.parse(
    await invokeCommand<LongBookAnalysisSource>(
      createEnvelope(
        "longBookAnalysis.loadSource",
        { sourceId },
        { id, correlationId: id }
      )
    )
  );
}

export async function listLongBookAnalysisPresets(): Promise<LongBookAnalysisSettings> {
  const id = browserId("cmd_long_book_analysis_presets_list");
  return LongBookAnalysisSettingsSchema.parse(
    await invokeCommand<LongBookAnalysisSettings>(
      createEnvelope(
        "longBookAnalysisSettings.list",
        {},
        { id, correlationId: id }
      )
    )
  );
}

export async function saveLongBookAnalysisPresets(
  rawSettings: LongBookAnalysisSettingsInput
): Promise<LongBookAnalysisSettings> {
  const settings = LongBookAnalysisSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_long_book_analysis_presets_save");
  return LongBookAnalysisSettingsSchema.parse(
    await invokeCommand<LongBookAnalysisSettings>(
      createEnvelope("longBookAnalysisSettings.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

export async function resetLongBookAnalysisPresets(
  presetId?: string
): Promise<LongBookAnalysisSettings> {
  const id = browserId("cmd_long_book_analysis_presets_reset");
  return LongBookAnalysisSettingsSchema.parse(
    await invokeCommand<LongBookAnalysisSettings>(
      createEnvelope(
        "longBookAnalysisSettings.reset",
        { ...(presetId ? { presetId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

// --- batch plans ---------------------------------------------------------------
// A plan is written by the renderer, not the main process: the renderer owns the
// scheduler, so it pushes the whole snapshot down after every round settles.
// `list` returns every stored plan, newest first, and is what resume-on-launch
// reads to find an interrupted batch.

export async function listLongBookAnalysisPlans(): Promise<
  LongBookAnalysisPlan[]
> {
  const id = browserId("cmd_long_book_analysis_plans_list");
  const result = await invokeCommand<{ plans: LongBookAnalysisPlan[] }>(
    createEnvelope("longBookAnalysisPlan.list", {}, { id, correlationId: id })
  );
  return LongBookAnalysisPlanSchema.array().parse(result.plans);
}

export async function saveLongBookAnalysisPlan(
  plan: LongBookAnalysisPlan
): Promise<LongBookAnalysisPlan> {
  const id = browserId("cmd_long_book_analysis_plans_save");
  const result = await invokeCommand<{ plan: LongBookAnalysisPlan }>(
    createEnvelope(
      "longBookAnalysisPlan.save",
      { plan },
      { id, correlationId: id }
    )
  );
  return LongBookAnalysisPlanSchema.parse(result.plan);
}

export async function removeLongBookAnalysisPlan(
  planId: string
): Promise<boolean> {
  const id = browserId("cmd_long_book_analysis_plans_remove");
  const result = await invokeCommand<{ removed: boolean }>(
    createEnvelope(
      "longBookAnalysisPlan.remove",
      { planId },
      { id, correlationId: id }
    )
  );
  return result.removed;
}
