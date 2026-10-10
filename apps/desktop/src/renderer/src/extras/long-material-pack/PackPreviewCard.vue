<script setup lang="ts">
import { computed } from "vue";
import type { LongMaterialEntryStatus } from "@deepwrite/contracts/renderer";
import { compactCount, packT as t, statusLabel } from "./pack-labels";
import { useLongMaterialPackStore } from "./useLongMaterialPack";

const store = useLongMaterialPackStore();
const rows = computed(() =>
  (store.preview?.libraries ?? []).map((library) => {
    const split = library.entries.filter(({ title }) =>
      /（\d+\/\d+）$/u.test(title)
    ).length;
    const notable = (
      ["conflict", "stale", "deleted"] as LongMaterialEntryStatus[]
    )
      .map((status) => ({
        status,
        count: library.entries.filter((entry) => entry.status === status).length
      }))
      .filter(({ count }) => count);
    return {
      kind: library.kind,
      title: library.title,
      count: library.entries.length,
      characters: compactCount(library.characters),
      first: library.entries[0]?.title ?? "—",
      note: [
        ...(split ? [t("splitNote", { count: split })] : []),
        ...notable.map(({ status, count }) =>
          t("countLabel", { label: statusLabel(status), count })
        )
      ].join(" · ")
    };
  })
);
</script>

<template>
  <section class="analysis-card pack-card" :aria-label="t('previewTitle')">
    <div class="analysis-card-heading pack-heading">
      <h2>{{ t("previewTitle") }}</h2>
      <span v-if="store.preview" class="pack-muted">
        {{
          t("previewSummary", {
            entries: store.preview.totalEntries,
            characters: compactCount(store.preview.totalCharacters)
          })
        }}
      </span>
    </div>
    <p v-if="!store.preview" class="pack-muted">{{ t("previewEmpty") }}</p>
    <template v-else>
      <p v-if="store.previewStale" class="pack-note">{{ t("previewStale") }}</p>
      <div class="pack-table-wrap">
        <table class="pack-table">
          <thead>
            <tr>
              <th scope="col">{{ t("columnLibrary") }}</th>
              <th scope="col">{{ t("columnEntries") }}</th>
              <th scope="col">{{ t("columnCharacters") }}</th>
              <th scope="col">{{ t("columnFirst") }}</th>
              <th scope="col">{{ t("columnNote") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.kind">
              <td>{{ row.title }}</td>
              <td>{{ row.count }}</td>
              <td>{{ row.characters }}</td>
              <td class="pack-index">{{ row.first }}</td>
              <td class="pack-muted">{{ row.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul v-if="store.preview.warnings.length" class="pack-warnings">
        <li v-for="warning in store.preview.warnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
      <p v-else class="pack-ok">{{ t("capacityOk") }}</p>
      <p class="pack-muted">
        {{ t("chaptersPerEntry", { count: store.preview.chaptersPerEntry }) }}
      </p>
    </template>
  </section>
</template>
