import {
  chooseLongBookAnalysisSource,
  listLongBookAnalysisSources,
  loadLongBookAnalysisSource,
  listLongBookAnalysisPresets,
  saveLongBookAnalysisPresets,
  resetLongBookAnalysisPresets,
  listLongBookAnalysisPlans,
  saveLongBookAnalysisPlan,
  removeLongBookAnalysisPlan
} from "./long-book-analysis-api";
import { shortBookAnalysisApi } from "./short-book-analysis-api";
import { revisionAnalysisApi } from "./revision-analysis-api";
export const analysisApis = {
  revisionAnalysis: revisionAnalysisApi,
  shortBookAnalysis: shortBookAnalysisApi,
  longBookAnalysis: {
    chooseSource: chooseLongBookAnalysisSource,
    sources: {
      list: listLongBookAnalysisSources,
      load: loadLongBookAnalysisSource
    },
    /** Batch-plan persistence; only the long-book feature plans. */
    plans: {
      list: listLongBookAnalysisPlans,
      save: saveLongBookAnalysisPlan,
      remove: removeLongBookAnalysisPlan
    },
    presets: {
      list: listLongBookAnalysisPresets,
      save: saveLongBookAnalysisPresets,
      reset: resetLongBookAnalysisPresets
    }
  }
};
