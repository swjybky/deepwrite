<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import type { ModelConfig } from "@deepwrite/contracts/renderer";
import AnalysisPageShell from "../analysis-ui/AnalysisPageShell.vue";
import AnalysisModelSettings from "../analysis-ui/AnalysisModelSettings.vue";
import { longMaterialPackLaunchBookId } from "../../stores/longMaterialPackActivity";
import PackAttention from "./PackAttention.vue";
import PackContentCard from "./PackContentCard.vue";
import PackEntryList from "./PackEntryList.vue";
import PackGuideCard from "./PackGuideCard.vue";
import PackPreviewCard from "./PackPreviewCard.vue";
import PackResultCard from "./PackResultCard.vue";
import PackSourceCard from "./PackSourceCard.vue";
import PackTargetCard from "./PackTargetCard.vue";
import { createScopedTranslator } from "../../i18n";
import { packT as t } from "./pack-labels";
import { useLongMaterialPackStore } from "./useLongMaterialPack";
import "./long-material-pack.css";

const props = defineProps<{
  models: readonly ModelConfig[];
  preferredModelId: string | null;
}>();
const emit = defineEmits<{
  openGroup: [groupId: string];
  openEntry: [entry: { libraryId: string; entryId: string }];
  openLongBook: [bookId: string];
  refreshCatalog: [];
}>();
const store = useLongMaterialPackStore();
const startupT = createScopedTranslator("extras.longMaterialPack");

const availableModels = computed(() =>
  props.models.filter((model) => model.enabled !== false)
);
const selectedModel = computed(() =>
  availableModels.value.find((model) => model.id === store.guideModelId)
);
// The store survives page visits; keep a valid manual choice on return.
let previousModelId = store.guideModelId;
watch(
  () => [availableModels.value, props.preferredModelId] as const,
  () => {
    if (store.guideBusy || selectedModel.value) return;
    store.guideModelId =
      availableModels.value.find((model) => model.id === props.preferredModelId)
        ?.id ??
      availableModels.value[0]?.id ??
      "";
  },
  { immediate: true }
);
watch(
  selectedModel,
  (model) => {
    if (!model?.reasoning) {
      store.guideThinkingLevel = "off";
    } else if (
      model.id !== previousModelId ||
      (store.guideThinkingLevel !== "off" &&
        !model.thinkingLevelOptions.includes(store.guideThinkingLevel))
    ) {
      store.guideThinkingLevel = model.defaultThinkingLevel;
    }
    previousModelId = model?.id ?? "";
  },
  { immediate: true, flush: "sync" }
);
const modelReady = computed(() => store.guideUsable(selectedModel.value));

onMounted(() => void store.loadBooks());
watch(longMaterialPackLaunchBookId, (bookId) => {
  if (!bookId) return;
  longMaterialPackLaunchBookId.value = null;
  void store.selectBook(bookId);
});
// New libraries and groups should appear in the sidebar tree right away.
watch(
  () => store.result,
  (result) => {
    if (result) emit("refreshCatalog");
  }
);

const progressText = computed(() => {
  const progress = store.progress;
  if (!progress)
    return store.converting || store.resolving ? t("converting") : "";
  if (progress.phase === "finished") return t("progressFinished");
  return t(
    progress.phase === "reading" ? "progressReading" : "progressWriting",
    {
      done: progress.done,
      total: progress.total
    }
  );
});
const canRun = computed(
  () => Boolean(store.stats) && store.sections.length > 0 && !store.busy
);
</script>

<template>
  <AnalysisPageShell
    class="long-material-pack-page"
    :title="startupT('title')"
    :description="t('description')"
  >
    <template #header-actions>
      <div class="analysis-header-actions">
        <AnalysisModelSettings
          v-model:model-id="store.guideModelId"
          v-model:thinking-level="store.guideThinkingLevel"
          :models="availableModels"
          :disabled="store.guideBusy"
        />
      </div>
    </template>
    <PackSourceCard />
    <PackContentCard />
    <PackTargetCard />
    <PackGuideCard :model-ready="modelReady" />
    <PackPreviewCard />
    <section class="analysis-run-bar pack-run-bar">
      <p class="pack-muted" aria-live="polite">{{ progressText }}</p>
      <div class="analysis-run-actions">
        <button
          type="button"
          :disabled="!canRun || store.previewing"
          @click="store.runPreview()"
        >
          {{ store.previewing ? t("previewing") : t("preview") }}
        </button>
        <button
          type="button"
          class="analysis-primary-button"
          :disabled="!canRun"
          @click="store.convert(selectedModel)"
        >
          {{
            store.converting
              ? t("converting")
              : store.targetMode === "update"
                ? t("update")
                : t("convert")
          }}
        </button>
      </div>
    </section>
    <PackResultCard
      :model="selectedModel"
      @open-group="emit('openGroup', $event)"
      @open-long-book="emit('openLongBook', $event)"
      @refresh-catalog="emit('refreshCatalog')"
    />
    <PackAttention />
    <PackEntryList @open-entry="emit('openEntry', $event)" />
  </AnalysisPageShell>
</template>
