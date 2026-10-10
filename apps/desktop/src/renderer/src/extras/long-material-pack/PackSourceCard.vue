<script setup lang="ts">
import { computed } from "vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { genreLabel } from "../../components/catalogLabels";
import { packT as t } from "./pack-labels";
import { useLongMaterialPackStore } from "./useLongMaterialPack";

const store = useLongMaterialPackStore();
const options = computed(() =>
  store.books.map((book) => ({
    value: book.id,
    label: t("bookOption", {
      title: book.title,
      genre: genreLabel(book.genre),
      chapters: book.navigation.counts.chapterCards
    })
  }))
);
const chips = computed(() => {
  const stats = store.stats;
  if (!stats) return [];
  const people = Object.values(stats.characters).reduce((a, b) => a + b, 0);
  return [
    t("statWorld", {
      categories: stats.worldCategories,
      items: stats.worldItems
    }),
    t("statCharacters", { count: people }),
    t("statPlot", {
      volumes: stats.volumes,
      arcs: stats.arcs,
      chapters: stats.chapterCards
    }),
    t("statForeshadowing", { count: stats.foreshadowing }),
    t("statWritten", { count: stats.writtenChapters })
  ];
});
function select(value: string | number) {
  void store.selectBook(String(value));
}
</script>

<template>
  <section class="analysis-card pack-card" :aria-label="t('sourceTitle')">
    <div class="analysis-card-heading pack-heading">
      <h2>{{ t("sourceTitle") }}</h2>
    </div>
    <p v-if="!store.books.length" class="pack-muted">{{ t("noBooks") }}</p>
    <div v-else class="pack-source-row">
      <PopupSelect
        class="pack-book-select"
        :model-value="store.bookId"
        :options="options"
        :accessible-label="t('chooseBook')"
        :placeholder="t('chooseBook')"
        :disabled="store.busy"
        @update:model-value="select"
      />
      <span
        v-if="store.stats?.decomposition"
        class="pack-badge"
        :class="{ 'is-warning': !store.stats.decomposition.completed }"
      >
        {{
          store.stats.decomposition.completed
            ? t("fromDecomposition")
            : t("fromDecompositionIncomplete")
        }}
      </span>
    </div>
    <p v-if="store.loadingSource" class="pack-muted">
      {{ t("loadingSource") }}
    </p>
    <ul v-else-if="chips.length" class="pack-chips">
      <li v-for="chip in chips" :key="chip">{{ chip }}</li>
    </ul>
  </section>
</template>
