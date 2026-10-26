import {
  isDeepWriteSiteOfficialModel,
  type ModelConfig
} from "@deepwrite/contracts/renderer";
import { MODEL_PROVIDER_OPTIONS } from "../components/modelProviderPresets";
import { createScopedTranslator } from "../i18n";
import type { PopupSelectOption } from "../types/popupSelect";

const t = createScopedTranslator("workspace.conversationModelOptions");

export interface ModelSelectOption extends PopupSelectOption {
  value: string;
  group: { key: string; label: string };
}

/** Shared provider ordering and labels for every text-model selector. */
export function buildModelSelectOptions(
  models: readonly Pick<
    ModelConfig,
    "id" | "label" | "provider" | "managedBy"
  >[]
): ModelSelectOption[] {
  const official: ModelSelectOption[] = [];
  const custom = new Map<string, ModelSelectOption[]>();
  const free: ModelSelectOption[] = [];
  for (const model of models) {
    if (isDeepWriteSiteOfficialModel(model)) {
      official.push({
        value: model.id,
        label: model.label,
        group: { key: "official", label: t("officialSite") }
      });
    } else if (model.managedBy === "deepwrite-free") {
      free.push({
        value: model.id,
        label: model.label,
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
