<script setup lang="ts">
import { createScopedTranslator, locale } from "../i18n";
import { computed } from "vue";
import type {
  ContextCompactionSettings,
  ModelSettings
} from "@deepwrite/contracts";
import {
  buildModelSelectOptions,
  type ModelSelectOption
} from "../utils/modelSelectOptions";
import ConversationModelConfigSelect from "./ConversationModelConfigSelect.vue";
import PopupSelect from "./PopupSelect.vue";

const t = createScopedTranslator("components.contextCompactionSettingsCard");

const props = defineProps<{
  settings: ContextCompactionSettings;
  modelSettings: ModelSettings | null;
}>();

const emit = defineEmits<{
  update: [settings: ContextCompactionSettings];
}>();

const FOLLOW_RUN_MODEL = "";

const budgetOptions = [
  {
    value: 64_000,
    get label() {
      return t("text64KTokensLowerCostForShortConversations");
    }
  },
  {
    value: 128_000,
    get label() {
      return t("text128KTokens");
    }
  },
  {
    value: 160_000,
    get label() {
      return t("text160KTokensRecommended");
    }
  },
  {
    value: 256_000,
    get label() {
      return t("text256KTokens");
    }
  },
  {
    value: 400_000,
    get label() {
      return t("text400KTokens");
    }
  },
  {
    value: 1_000_000,
    get label() {
      return t("text1MTokensSubjectToModelLimit");
    }
  }
];

const budgetSelectOptions = computed(() =>
  budgetOptions.some((option) => option.value === props.settings.budgetTokens)
    ? budgetOptions
    : [
        ...budgetOptions,
        {
          value: props.settings.budgetTokens,
          label: `${props.settings.budgetTokens.toLocaleString(locale.value)} tokens`
        }
      ]
);

const modelOptions = computed<ModelSelectOption[]>(() => {
  const settings = props.modelSettings;
  const enabledFree = new Set(settings?.deepwriteFreeEnabledModelIds ?? []);
  const models = [
    ...(settings?.models ?? []),
    ...(settings?.deepwriteFreeModels ?? []).filter((model) =>
      enabledFree.has(model.id)
    )
  ];
  const defaultGroup = { key: "default", label: t("useConversationModel") };
  const options: ModelSelectOption[] = [
    {
      value: FOLLOW_RUN_MODEL,
      label: t("useConversationModel"),
      group: defaultGroup
    },
    ...buildModelSelectOptions(models)
  ];
  const selected = props.settings.modelId;
  return selected && !options.some((option) => option.value === selected)
    ? [
        ...options,
        {
          value: selected,
          label: t("deletedModelWillUseConversationModel"),
          group: defaultGroup
        }
      ]
    : options;
});

function update(patch: Partial<ContextCompactionSettings>): void {
  const next: ContextCompactionSettings = { ...props.settings, ...patch };
  if (!next.modelId) delete next.modelId;
  emit("update", next);
}
</script>

<template>
  <h2 class="settings-group-title">
    {{ t("contextCompaction") }}
  </h2>
  <div class="settings-card">
    <label class="settings-item">
      <span class="settings-item-text"
        ><strong>{{ t("automaticallyCompactContext") }}</strong
        ><small>{{
          t("asLongConversationsApproachTheWorkingBudgetFirstTrim")
        }}</small></span
      >
      <span class="settings-toggle"
        ><input
          type="checkbox"
          :checked="settings.enabled"
          :aria-label="t('automaticallyCompactContext')"
          @change="
            update({ enabled: ($event.target as HTMLInputElement).checked })
          "
      /></span>
    </label>
    <label class="settings-item">
      <span class="settings-item-text"
        ><strong>{{ t("showManualCompactionButton") }}</strong
        ><small>{{
          t("showTheCompactContextButtonInWorkspaceAndChat")
        }}</small></span
      >
      <span class="settings-toggle"
        ><input
          type="checkbox"
          :checked="settings.showManualButton"
          :aria-label="t('showManualCompactionButton')"
          @change="
            update({
              showManualButton: ($event.target as HTMLInputElement).checked
            })
          "
      /></span>
    </label>
    <div class="settings-item settings-select-item">
      <span class="settings-item-text"
        ><strong>{{ t("workingBudget") }}</strong
        ><small>{{
          t("keepContextWithinThisLimitEvenIfTheModel")
        }}</small></span
      >
      <PopupSelect
        class="general-select-control"
        :model-value="settings.budgetTokens"
        :options="budgetSelectOptions"
        :accessible-label="t('selectContextWorkingBudget')"
        align="end"
        :menu-min-width="260"
        @update:model-value="update({ budgetTokens: Number($event) })"
      />
    </div>
    <div class="settings-item settings-select-item">
      <span class="settings-item-text"
        ><strong>{{ t("summaryModel") }}</strong
        ><small>{{
          t("modelUsedToGenerateCompactionCheckpointsALessExpensive")
        }}</small></span
      >
      <ConversationModelConfigSelect
        class="general-select-control"
        variant="field"
        hides-web-search
        align="end"
        close-on-model-select
        :selected-model-id="settings.modelId ?? FOLLOW_RUN_MODEL"
        :model-options="modelOptions"
        :thinking-options="[]"
        :accessible-label="t('selectContextSummaryModel')"
        @select-model="update({ modelId: $event })"
      />
    </div>
  </div>
</template>

<style scoped src="./settings-page.css"></style>
<style scoped>
.settings-select-item {
  flex-wrap: wrap;
}

.settings-select-item .settings-item-text {
  min-width: min(240px, 100%);
}

.settings-select-item .general-select-control {
  width: 210px;
  min-width: 160px;
  max-width: 210px;
  flex: 0 1 210px;
}
</style>
