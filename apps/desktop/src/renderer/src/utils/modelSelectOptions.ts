import {
  isDeepWriteSiteOfficialModel,
  type ModelConfig,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { MODEL_PROVIDER_OPTIONS } from "../components/modelProviderPresets";
import { createScopedTranslator } from "../i18n";
import type { PopupSelectOption } from "../types/popupSelect";

const t = createScopedTranslator("workspace.conversationModelOptions");

export function modelThinkingLevels(
  model: Pick<ModelConfig, "thinkingLevelOptions"> | null | undefined
): ThinkingLevel[] {
  return ["off", ...(model?.thinkingLevelOptions ?? [])];
}

const MODEL_PICKER_BASE_FONT_PX = 14;
const MODEL_PICKER_MAX_FONT_SCALE = 1.15;

export function resolveModelPickerFontScale(): number {
  if (
    typeof document === "undefined" ||
    !document.documentElement ||
    typeof getComputedStyle !== "function"
  ) {
    return 1;
  }
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(
    MODEL_PICKER_MAX_FONT_SCALE,
    Math.max(1, parsed / MODEL_PICKER_BASE_FONT_PX)
  );
}

export function resolveModelPickerSize(options: {
  hasRightPane: boolean;
  hasFooter?: boolean;
}): { width: number; height: number } {
  const scale = resolveModelPickerFontScale();
  const baseWidth = options.hasRightPane ? 500 : 362;
  const baseHeight = options.hasFooter ? 336 : 302;
  return {
    width: Math.round(baseWidth * scale),
    height: Math.round(baseHeight * scale)
  };
}

export interface ModelSelectOption extends PopupSelectOption {
  value: string;
  provider?: string;
  modelId?: string;
  group: { key: string; label: string };
}

/** Shared provider ordering and labels for every text-model selector. */
export function buildModelSelectOptions(
  models: readonly (Pick<
    ModelConfig,
    "id" | "label" | "provider" | "managedBy"
  > & { modelId?: string })[]
): ModelSelectOption[] {
  const official: ModelSelectOption[] = [];
  const custom = new Map<string, ModelSelectOption[]>();
  const free: ModelSelectOption[] = [];
  for (const model of models) {
    const metadata = {
      provider: model.provider,
      ...(model.modelId ? { modelId: model.modelId } : {})
    };
    if (isDeepWriteSiteOfficialModel(model)) {
      official.push({
        value: model.id,
        label: model.label,
        ...metadata,
        group: { key: "official", label: t("officialSite") }
      });
    } else if (model.managedBy === "deepwrite-free") {
      free.push({
        value: model.id,
        label: model.label,
        ...metadata,
        group: { key: "free", label: t("freeModels") }
      });
    } else {
      let options = custom.get(model.provider);
      if (!options) {
        options = [];
        custom.set(model.provider, options);
      }
      options.push({
        value: model.id,
        label: model.label,
        ...metadata,
        group: {
          key: `custom:${model.provider}`,
          label:
            MODEL_PROVIDER_OPTIONS.find(
              (option) => option.value === model.provider
            )?.label ?? model.provider
        }
      });
    }
  }
  return [...official, ...[...custom.values()].flat(), ...free];
}
