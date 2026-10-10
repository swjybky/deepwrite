<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import type {
  CatalogSnapshot,
  DecompositionContentRef,
  DecompositionTarget,
  DecompositionRegistryData,
  ModelConfig,
  CreateDecompositionJobInput,
  DecompositionControlInput
} from "@deepwrite/contracts/renderer";
import AnalysisPageShell from "../analysis-ui/AnalysisPageShell.vue";
import AnalysisSourceControls from "../long-book-analysis/AnalysisSourceControls.vue";
import LongAnalysisSourceSummary from "../long-book-analysis/LongAnalysisSourceSummary.vue";
import DecompositionSetup from "./DecompositionSetup.vue";
import DecompositionRangeCard from "./DecompositionRangeCard.vue";
import DecompositionRegistryEditor from "./DecompositionRegistryEditor.vue";
import DecompositionProfileManager from "./DecompositionProfileManager.vue";
import DecompositionProgress from "./DecompositionProgress.vue";
import DecompositionTaskBar from "./DecompositionTaskBar.vue";
import DecompositionDialog from "./DecompositionDialog.vue";
import DecompositionRecordDialog from "./DecompositionRecordDialog.vue";
import DecompositionRefreshButton from "./DecompositionRefreshButton.vue";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";
import { createScopedTranslator } from "../../i18n";
import { getErrorPayload } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import "../long-book-analysis/long-book-analysis.css";
import "./decomposition.css";
import "./decomposition-tables.css";
import "./decomposition-subtasks.css";
const t = createScopedTranslator("extras.longBookDecomposition");
const props = defineProps<{
  controller: LongBookDecompositionController;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{
  refreshCatalog: [];
  open: [ref: DecompositionContentRef];
  openTarget: [target: DecompositionTarget];
  openMaterialPack: [bookId: string];
}>();
const wholeBook = () => ({
  start: 1,
  end: props.controller.source.value?.chapters.length ?? 1
});
const range = ref(wholeBook());
const busy = ref(false);
const profilesOpen = ref(false);
const deleting = ref(false);
const viewing = ref<{ unitId: string; title: string } | null>(null);
watch(
  () => props.controller.source.value?.id,
  () => {
    range.value = wholeBook();
  }
);
watch(
  range,
  () => {
    props.controller.confirmation.value = null;
  },
  { deep: true }
);
async function action(operation: () => Promise<unknown>) {
  busy.value = true;
  try {
    await operation();
    emit("refreshCatalog");
  } catch (error) {
    uiMessage.error(
      getErrorPayload(error)?.message ??
        (error instanceof Error ? error.message : t("operationFailed"))
    );
  } finally {
    busy.value = false;
  }
}
async function create(
  input: Pick<
    CreateDecompositionJobInput,
    "mode" | "targetSelection" | "autoContinue" | "reuseJobId"
  >
) {
  await action(() => props.controller.create(input));
}
async function control(
  which: DecompositionControlInput["action"],
  unitId?: string,
  choice?: "keep-user" | "regenerate"
) {
  await action(async () => {
    await props.controller.control(which, unitId, choice);
    await props.controller.inspect();
  });
}
async function saveRegistry(data: DecompositionRegistryData, confirm: boolean) {
  await action(() => props.controller.saveRegistry(data, confirm));
  if (confirm && props.controller.job.value?.phase === "integrate")
    void props.controller.run();
}
function newTask() {
  props.controller.job.value = null;
  props.controller.registry.value = null;
}
/** With an open task refresh its progress; otherwise reload tasks and sources. */
function refresh() {
  return action(() =>
    props.controller.job.value
      ? props.controller.inspect()
      : props.controller.load()
  );
}
onMounted(() => {
  void action(() => props.controller.load());
});
</script>
<template>
  <AnalysisPageShell
    :title="t('title')"
    :description="t('description')"
    class="long-book-analysis-page long-book-decomposition-page"
  >
    <template #header-actions>
      <AnalysisSourceControls
        v-if="!controller.job.value"
        :controller="controller"
        :disabled="busy || controller.sourceSaving.value"
        :manage-label="t('profiles')"
        @manage-presets="profilesOpen = true"
      >
        <DecompositionRefreshButton
          :disabled="controller.isBusy.value || busy"
          @click="refresh"
        />
      </AnalysisSourceControls>
      <div v-else class="analysis-header-actions">
        <DecompositionRefreshButton
          :disabled="controller.isBusy.value || busy"
          @click="refresh"
        />
      </div>
    </template>
    <DecompositionTaskBar
      v-if="controller.jobs.value.length || controller.job.value"
      :controller="controller"
      :catalog="catalogSnapshot"
      :disabled="controller.isBusy.value || busy"
      @select="(id) => action(() => controller.selectJob(id))"
      @new-task="newTask"
      @remove="deleting = true"
    />
    <template v-if="!controller.job.value">
      <LongAnalysisSourceSummary
        :controller="controller"
        :empty-title="t('sourceEmptyTitle')"
        :empty-help="t('sourceEmptyHelp')"
        :empty-chips="['TXT / Markdown', t('sourceChips')]"
      />
      <DecompositionRangeCard
        v-if="controller.source.value"
        v-model:range="range"
        :controller="controller"
        :disabled="busy || controller.sourceDeleting.value"
        @save="action(() => controller.saveSource())"
        @confirm="action(() => controller.confirm(range))"
      />
      <DecompositionSetup
        :controller="controller"
        :models="models"
        :catalog="catalogSnapshot"
        :range="range"
        :disabled="busy || controller.sourceDeleting.value"
        @create="create"
      />
    </template>
    <template v-else>
      <DecompositionProgress
        :controller="controller"
        :disabled="busy || controller.isBusy.value"
        @control="control"
        @view="(unitId, title) => (viewing = { unitId, title })"
        @open-target="emit('openTarget', $event)"
        @open-material-pack="emit('openMaterialPack', $event)"
        @run="controller.run()"
        @stop="action(() => controller.stop())"
      />
      <DecompositionRegistryEditor
        v-if="
          controller.job.value.phase === 'registry_review' &&
          controller.registry.value
        "
        :registry="controller.registry.value"
        :profile="controller.job.value.profile"
        :disabled="busy"
        @save="saveRegistry"
      />
    </template>
    <DecompositionRecordDialog
      v-if="viewing"
      :controller="controller"
      :unit-id="viewing.unitId"
      :title="viewing.title"
      @close="viewing = null"
      @open="
        viewing = null;
        emit('open', $event);
      "
    />
    <DecompositionProfileManager
      :open="profilesOpen"
      :controller="controller"
      @close="profilesOpen = false"
    />
  </AnalysisPageShell>
  <DecompositionDialog
    v-if="deleting"
    danger
    :title="t('deleteJob')"
    :message="t('deleteHelp')"
    :confirm-label="t('remove')"
    :cancel-label="t('cancel')"
    @cancel="deleting = false"
    @confirm="
      deleting = false;
      control('delete');
    "
  />
</template>
