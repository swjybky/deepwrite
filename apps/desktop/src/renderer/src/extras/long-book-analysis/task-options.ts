import { createScopedTranslator } from "../../i18n";
import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  MaterialLibrary,
  ModelConfig,
  SkillLibrary
} from "@deepwrite/contracts/renderer";
import {
  MATERIAL_KIND_LABELS,
  MATERIAL_STAGE_LABELS,
  SKILL_KIND_LABELS,
  SKILL_STAGE_LABELS
} from "../../data/catalogWorkspace";
import { modelThinkingLevels } from "../../utils/modelSelectOptions";

const t = createScopedTranslator("extras.longBookAnalysis");

export interface AnalysisTaskOption {
  value: string;
  label: string;
  description?: string;
}

export type AnalysisTargetLibrary = MaterialLibrary | SkillLibrary;

const THINKING_LABELS: Record<string, string> = {
  get off() {
    return t("thinkingOff");
  },
  get minimal() {
    return t("minimalThinking");
  },
  get low() {
    return t("lowThinking");
  },
  get medium() {
    return t("mediumThinking");
  },
  get high() {
    return t("highThinking");
  },
  get xhigh() {
    return t("extraHighThinking");
  },
  get max() {
    return t("maxThinking");
  }
};

export function analysisThinkingOptions(
  model: ModelConfig | null
): AnalysisTaskOption[] {
  return modelThinkingLevels(model).map((value) => ({
    value,
    label: THINKING_LABELS[value] ?? value
  }));
}

export function compatibleAnalysisLibraries(
  preset: LongBookAnalysisPreset | null,
  snapshot: CatalogSnapshot | null
): AnalysisTargetLibrary[] {
  const output = preset?.output;
  if (!output) return [];
  if (output.domain === "material") {
    return (snapshot?.materials ?? []).filter(
      (library) =>
        library.materialKind === output.kind || library.materialKind === "mixed"
    );
  }
  return (snapshot?.skills ?? []).filter(
    (library) => library.skillKind === output.kind && !library.isBuiltin
  );
}

export function analysisLibraryOption(
  library: AnalysisTargetLibrary
): AnalysisTaskOption {
  return {
    value: library.id,
    label: library.title,
    description:
      "materialKind" in library
        ? MATERIAL_KIND_LABELS[library.materialKind]
        : SKILL_KIND_LABELS[library.skillKind]
  };
}

export function analysisOutputTypeLabel(
  preset: LongBookAnalysisPreset | null
): string {
  const output = preset?.output;
  if (!output) return "";
  return output.domain === "material"
    ? MATERIAL_STAGE_LABELS[output.stageId]
    : SKILL_STAGE_LABELS[output.stageId];
}
