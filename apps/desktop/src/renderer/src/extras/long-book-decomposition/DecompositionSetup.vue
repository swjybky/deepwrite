<script setup lang="ts">
import { computed, ref } from "vue";
import {
  DECOMPOSITION_DEFAULT_CONCURRENCY,
  DECOMPOSITION_MAX_CONCURRENCY,
  type CreateDecompositionJobInput,
  type ModelConfig
} from "@deepwrite/contracts/renderer";
import AnalysisModelSettings from "../analysis-ui/AnalysisModelSettings.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { createScopedTranslator } from "../../i18n";
import DecompositionEstimate from "./DecompositionEstimate.vue";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";
const t = createScopedTranslator("extras.longBookDecomposition");
const props = defineProps<{
  controller: LongBookDecompositionController;
  models: readonly ModelConfig[];
  range: { start: number; end: number };
  disabled: boolean;
}>();
const emit = defineEmits<{
  create: [
    input: Pick<
      CreateDecompositionJobInput,
      | "mode"
      | "targetSelection"
      | "autoContinue"
      | "maxConcurrency"
      | "reuseJobId"
    >
  ];
}>();
const targetAction = ref<"create" | "select">("create");
const targetId = ref("");
const title = ref("");
const reuseJobId = ref("");
const maxConcurrency = ref(DECOMPOSITION_DEFAULT_CONCURRENCY);
const concurrencyOptions = Array.from(
  { length: DECOMPOSITION_MAX_CONCURRENCY },
  (_, index) => ({ value: index + 1, label: String(index + 1) })
);
const targets = computed(() =>
  props.controller.books.value.map(({ id, title }) => ({
    value: id,
    label: title
  }))
);
const targetActions = computed(() => [
  { value: "create", label: t("createLong") },
  { value: "select", label: t("selectLong") }
]);
const estimate = computed(() => {
  try {
    return props.controller.estimate(props.range, maxConcurrency.value);
  } catch {
    return null;
  }
});
const reuseOptions = computed(() => [
  { value: "", label: t("noReuse") },
  ...props.controller.jobs.value
    .filter(
      (job) =>
        job.source.fingerprint ===
          props.controller.confirmation.value?.fingerprint &&
        job.source.range.start === props.range.start &&
        job.source.range.end === props.range.end &&
        job.units["registry:merge"]?.status === "done"
    )
    .map((job) => ({
      value: job.id,
      label: `${job.source.title} · ${job.createdAt.slice(0, 10)}`
    }))
]);
/** Why creating is not possible yet; a stable line instead of a toast. */
const blocker = computed(() => {
  const { source, sourceDirty, sourceSaving, confirmation } = props.controller;
  if (
    !source.value ||
    sourceDirty.value ||
    sourceSaving.value ||
    !confirmation.value
  )
    return t("sourceRequired");
  if (
    !props.controller.readingModelId.value ||
    !props.controller.integrationModelId.value
  )
    return t("modelRequired");
  if (targetAction.value === "select" && !targetId.value)
    return t("targetRequired");
  return "";
});
function create() {
  const targetSelection: CreateDecompositionJobInput["targetSelection"] =
    targetAction.value === "create"
      ? {
          kind: "long",
          action: "create",
          title:
            title.value.trim() ||
            props.controller.source.value?.name ||
            t("title")
        }
      : { kind: "long", action: "select", bookId: targetId.value };
  // Material output comes from the finished long via 长篇转素材库.
  emit("create", {
    mode: "continuation",
    targetSelection,
    // The registry no longer pauses for review; integration follows it.
    autoContinue: true,
    maxConcurrency: maxConcurrency.value,
    ...(reuseJobId.value ? { reuseJobId: reuseJobId.value } : {})
  });
}
</script>
<template>
  <section class="analysis-card setup-card decomposition-setup">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">{{ t("setupEyebrow") }}</p>
        <h2>{{ t("setup") }}</h2>
      </div>
    </header>
    <div class="setup-grid">
      <label class="setup-field">
        <span class="setup-field-label">{{ t("profile") }}</span>
        <PopupSelect
          v-model="controller.profileId.value"
          :options="
            controller.profiles.value.map(({ id, name }) => ({
              value: id,
              label: name
            }))
          "
          :accessible-label="t('profile')"
          :disabled="disabled"
        />
      </label>
      <label class="setup-field">
        <span class="setup-field-label">{{ t("target") }}</span>
        <PopupSelect
          v-model="targetAction"
          :options="targetActions"
          :accessible-label="t('target')"
          :disabled="disabled"
        />
      </label>
      <label v-if="targetAction === 'create'" class="setup-field">
        <span class="setup-field-label">{{ t("longTitle") }}</span>
        <input
          v-model="title"
          :placeholder="controller.source.value?.name"
          :disabled="disabled"
        />
      </label>
      <label v-else class="setup-field">
        <span class="setup-field-label">{{ t("existingLong") }}</span>
        <PopupSelect
          v-model="targetId"
          :options="targets"
          :placeholder="t('choose')"
          :accessible-label="t('existingLong')"
          :disabled="disabled"
        />
      </label>
      <div class="setup-field">
        <span class="setup-field-label">{{ t("readingModel") }}</span>
        <AnalysisModelSettings
          v-model:model-id="controller.readingModelId.value"
          v-model:thinking-level="controller.readingThinkingLevel.value"
          field
          :label="t('readingModel')"
          :models="models"
          :disabled="disabled"
        />
      </div>
      <div class="setup-field">
        <span class="setup-field-label">{{ t("integrationModel") }}</span>
        <AnalysisModelSettings
          v-model:model-id="controller.integrationModelId.value"
          v-model:thinking-level="controller.integrationThinkingLevel.value"
          field
          :label="t('integrationModel')"
          :models="models"
          :disabled="disabled"
        />
      </div>
      <label class="setup-field">
        <span class="setup-field-label">{{ t("concurrency") }}</span>
        <PopupSelect
          :model-value="maxConcurrency"
          :options="concurrencyOptions"
          :accessible-label="t('concurrency')"
          :disabled="disabled"
          @update:model-value="maxConcurrency = Number($event)"
        />
      </label>
      <label class="setup-field">
        <span class="setup-field-label">{{ t("reuse") }}</span>
        <PopupSelect
          v-model="reuseJobId"
          :options="reuseOptions"
          :accessible-label="t('reuse')"
          :disabled="disabled || reuseOptions.length < 2"
        />
      </label>
    </div>
    <DecompositionEstimate :estimate="estimate" />
    <div class="analysis-run-bar">
      <p class="analysis-help decomposition-run-hint">
        {{ blocker || t("readyHint") }}
      </p>
      <div class="analysis-run-actions">
        <button
          type="button"
          class="analysis-primary-button"
          :disabled="disabled || !!blocker"
          @click="create"
        >
          {{ t("prepare") }}
        </button>
      </div>
    </div>
  </section>
</template>
