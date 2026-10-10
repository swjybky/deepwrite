<script setup lang="ts">
import { computed } from "vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { packT as t, shortDate } from "./pack-labels";
import { useLongMaterialPackStore } from "./useLongMaterialPack";

const store = useLongMaterialPackStore();
const packs = computed(() => store.stats?.packs ?? []);
const packOptions = computed(() =>
  packs.value.map((pack) => ({
    value: pack.id,
    label: t("packOption", {
      group: pack.groupTitle ?? pack.bookTitle,
      date: shortDate(pack.convertedAt ?? pack.updatedAt)
    })
  }))
);
function choosePack(value: string | number) {
  store.packId = String(value);
  store.targetMode = "update";
}
</script>

<template>
  <section
    v-if="store.stats"
    class="analysis-card pack-card"
    :aria-label="t('targetTitle')"
  >
    <div class="analysis-card-heading pack-heading">
      <h2>{{ t("targetTitle") }}</h2>
    </div>
    <div class="pack-target-row">
      <label class="pack-radio">
        <input
          v-model="store.targetMode"
          type="radio"
          value="create"
          :disabled="store.busy"
        />
        {{ t("createGroup") }}
      </label>
      <input
        v-model="store.groupTitle"
        class="pack-input"
        type="text"
        maxlength="200"
        :aria-label="t('groupName')"
        :disabled="store.busy || store.targetMode !== 'create'"
      />
    </div>
    <div class="pack-target-row">
      <label class="pack-radio">
        <input
          v-model="store.targetMode"
          type="radio"
          value="update"
          :disabled="store.busy || !packs.length"
        />
        {{ t("updatePack") }}
      </label>
      <PopupSelect
        class="pack-target-select"
        :model-value="store.packId"
        :options="packOptions"
        :accessible-label="t('updatePack')"
        :placeholder="t('noPacks')"
        :disabled="store.busy || !packs.length"
        @update:model-value="choosePack"
      />
    </div>
    <p class="pack-muted">
      {{ store.targetMode === "create" ? t("targetHelp") : t("updateHelp") }}
    </p>
  </section>
</template>
