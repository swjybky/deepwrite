<script setup lang="ts">
import { computed } from "vue";
import {
  LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT,
  LONG_MATERIAL_SECTIONS,
  type LongMaterialSection
} from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { packT as t, sectionDetail, sectionLabel } from "./pack-labels";
import { useLongMaterialPackStore } from "./useLongMaterialPack";

const store = useLongMaterialPackStore();
const rows = computed(() =>
  store.stats
    ? LONG_MATERIAL_SECTIONS.map((section) => ({
        section,
        label: sectionLabel(section),
        ...sectionDetail(section, store.stats!, store.sampleChapterIds.length)
      }))
    : []
);
function toggle(section: LongMaterialSection, checked: boolean) {
  store.sections = checked
    ? LONG_MATERIAL_SECTIONS.filter(
        (value) => value === section || store.sections.includes(value)
      )
    : store.sections.filter((value) => value !== section);
}
const allSelected = computed(
  () => store.sections.length === LONG_MATERIAL_SECTIONS.length
);
function toggleAll() {
  store.sections = allSelected.value ? [] : [...LONG_MATERIAL_SECTIONS];
}
const scopeOptions = computed(() => [
  { value: "grouped", label: t("characterScopeGrouped") },
  { value: "individual", label: t("characterScopeIndividual") }
]);
const groupingOptions = computed(() => [
  { value: "auto", label: t("chapterGroupingAuto") },
  { value: "20", label: t("chapterGrouping20") },
  { value: "50", label: t("chapterGrouping50") }
]);
const chapterById = computed(
  () => new Map((store.stats?.chapters ?? []).map((c) => [c.id, c]))
);
const sampleOptions = computed(() =>
  (store.stats?.chapters ?? [])
    .filter(
      ({ id, written }) => written && !store.sampleChapterIds.includes(id)
    )
    .map(({ id, number, title }) => ({
      value: id,
      label: t("chapterOption", { number, title })
    }))
);
function addSample(value: string | number) {
  if (store.sampleChapterIds.length >= LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT)
    return;
  const id = String(value);
  const order = (chapterId: string) =>
    chapterById.value.get(chapterId)?.number ?? 0;
  store.sampleChapterIds = [...store.sampleChapterIds, id].sort(
    (a, b) => order(a) - order(b)
  );
}
function removeSample(id: string) {
  store.sampleChapterIds = store.sampleChapterIds.filter(
    (value) => value !== id
  );
}
</script>

<template>
  <section
    v-if="store.stats"
    class="analysis-card pack-card"
    :aria-label="t('contentTitle')"
  >
    <div class="analysis-card-heading pack-heading">
      <h2>{{ t("contentTitle") }}</h2>
      <button
        type="button"
        class="pack-link"
        :disabled="store.busy"
        @click="toggleAll"
      >
        {{ allSelected ? t("clearAll") : t("selectAll") }}
      </button>
    </div>
    <div class="pack-sections">
      <label
        v-for="row in rows"
        :key="row.section"
        class="pack-section"
        :class="{ 'is-empty': row.empty }"
      >
        <input
          type="checkbox"
          :checked="store.sections.includes(row.section)"
          :disabled="store.busy"
          @change="
            toggle(row.section, ($event.target as HTMLInputElement).checked)
          "
        />
        <span class="pack-section-label">{{ row.label }}</span>
        <span class="pack-muted">{{
          row.empty ? t("emptySection") : row.text
        }}</span>
      </label>
    </div>
    <div class="pack-fields">
      <label class="setup-field">
        <span class="setup-field-label">{{ t("characterScope") }}</span>
        <PopupSelect
          v-model="store.characterScope"
          :options="scopeOptions"
          :accessible-label="t('characterScope')"
          :disabled="store.busy"
        />
      </label>
      <label class="setup-field">
        <span class="setup-field-label">{{ t("chapterGrouping") }}</span>
        <PopupSelect
          v-model="store.chapterGrouping"
          :options="groupingOptions"
          :accessible-label="t('chapterGrouping')"
          :disabled="store.busy"
        />
      </label>
    </div>
    <div class="pack-samples">
      <span class="setup-field-label">{{ t("sampleChapters") }}</span>
      <ul class="pack-chips">
        <li v-for="id in store.sampleChapterIds" :key="id">
          {{ t("chapterLabel", { number: chapterById.get(id)?.number ?? 0 }) }}
          <button
            type="button"
            class="pack-chip-remove"
            :aria-label="
              t('removeSampleChapter', {
                number: chapterById.get(id)?.number ?? 0
              })
            "
            :disabled="store.busy"
            @click="removeSample(id)"
          >
            <AppIcon name="close" :size="12" />
          </button>
        </li>
      </ul>
      <PopupSelect
        v-if="
          store.sampleChapterIds.length < LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT &&
          sampleOptions.length
        "
        class="pack-sample-add"
        model-value=""
        variant="compact"
        :options="sampleOptions"
        :accessible-label="
          t('addSampleChapter', { limit: LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT })
        "
        :placeholder="
          t('addSampleChapter', { limit: LONG_MATERIAL_SAMPLE_CHAPTER_LIMIT })
        "
        :disabled="store.busy"
        @update:model-value="addSample"
      />
    </div>
  </section>
</template>
