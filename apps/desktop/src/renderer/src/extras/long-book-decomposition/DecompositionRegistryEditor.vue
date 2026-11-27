<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { createId, jsonClone } from "@deepwrite/shared";
import type {
  DecompositionRegistry,
  DecompositionRegistryData,
  LongBookDecompositionProfile
} from "@deepwrite/contracts/renderer";
import PopupSelect from "../../components/PopupSelect.vue";
import { createScopedTranslator } from "../../i18n";
const t = createScopedTranslator("extras.longBookDecomposition");
const props = defineProps<{
  registry: DecompositionRegistry;
  profile: LongBookDecompositionProfile;
  disabled: boolean;
}>();
const emit = defineEmits<{
  save: [data: DecompositionRegistryData, confirmed: boolean];
}>();
const draft = ref<DecompositionRegistryData>({ characters: [], terms: [] });
const tab = ref<"characters" | "terms">("characters");
const selected = ref<string[]>([]);
const newName = ref("");
const PAGE_SIZE = 100;
const page = ref(0);
watch(
  () => props.registry,
  (value) => {
    draft.value = jsonClone(value);
    selected.value = [];
  },
  { immediate: true }
);
watch(tab, () => {
  selected.value = [];
  page.value = 0;
});
const entries = computed(() => draft.value[tab.value]);
const visible = computed(() =>
  entries.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE)
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(entries.value.length / PAGE_SIZE))
);
const tiers = computed(() =>
  (
    ["protagonist", "major_supporting", "minor_supporting", "passerby"] as const
  ).map((value) => ({ value, label: t(value) }))
);
const categories = computed(() => [
  ...props.profile.worldCategories.map(({ id, title }) => ({
    value: id,
    label: title
  })),
  { value: "other", label: t("other") }
]);
function merge() {
  const choices = entries.value.filter(({ id }) => selected.value.includes(id));
  const first = choices[0];
  if (!first || choices.length < 2) return;
  first.aliases = [
    ...new Set([
      ...first.aliases,
      ...choices.slice(1).flatMap(({ name, aliases }) => [name, ...aliases])
    ])
  ].filter((name) => name !== first.name);
  if ("tier" in first) {
    const chars = choices.filter((item) => "tier" in item);
    first.firstChapterOrder = Math.min(
      ...chars.map((item) => item.firstChapterOrder)
    );
    first.chunkCount = Math.max(...chars.map((item) => item.chunkCount));
  }
  const keep = entries.value.filter(
    ({ id }) => id === first.id || !selected.value.includes(id)
  );
  if (tab.value === "characters")
    draft.value.characters = keep as DecompositionRegistryData["characters"];
  else draft.value.terms = keep as DecompositionRegistryData["terms"];
  selected.value = [];
}
function split() {
  const entry = entries.value.find(({ id }) => selected.value.includes(id));
  const name = newName.value.trim();
  if (!entry || !name) return;
  entry.aliases = entry.aliases.filter((alias) => alias !== name);
  const copy = {
    ...entry,
    id: createId(tab.value === "characters" ? "rc" : "rt"),
    name,
    aliases: []
  };
  if ("tier" in copy) draft.value.characters.push(copy);
  else draft.value.terms.push(copy);
  newName.value = "";
  selected.value = [];
}
</script>
<template>
  <section class="analysis-card decomposition-registry">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">{{ t("registryPhase") }}</p>
        <h2>{{ t("registry") }}</h2>
      </div>
      <div class="decomposition-segmented" role="group">
        <button
          type="button"
          :aria-pressed="tab === 'characters'"
          @click="tab = 'characters'"
        >
          {{ t("characters") }} {{ draft.characters.length }}
        </button>
        <button
          type="button"
          :aria-pressed="tab === 'terms'"
          @click="tab = 'terms'"
        >
          {{ t("terms") }} {{ draft.terms.length }}
        </button>
      </div>
    </header>
    <p class="analysis-help">{{ t("registryHelp") }}</p>
    <div class="decomposition-toolbar">
      <button
        type="button"
        :disabled="disabled || selected.length < 2"
        @click="merge"
      >
        {{ t("merge") }}
      </button>
      <input
        v-model="newName"
        :placeholder="t('newName')"
        :aria-label="t('newName')"
        :disabled="disabled"
      />
      <button
        type="button"
        :disabled="disabled || selected.length !== 1 || !newName.trim()"
        @click="split"
      >
        {{ t("split") }}
      </button>
    </div>
    <div class="decomposition-table-scroll">
      <table class="decomposition-registry-table">
        <thead>
          <tr>
            <th class="is-check"></th>
            <th>{{ t("name") }}</th>
            <th>{{ t("aliases") }}</th>
            <th class="is-select">
              {{ tab === "characters" ? t("tier") : t("category") }}
            </th>
            <th class="is-check">{{ t("ignore") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in visible"
            :key="entry.id"
            :class="{ 'is-ignored': entry.ignored }"
          >
            <td class="is-check">
              <input
                v-model="selected"
                type="checkbox"
                :value="entry.id"
                :disabled="disabled"
                :aria-label="entry.name"
              />
            </td>
            <td>
              <input
                v-model="entry.name"
                :aria-label="t('name')"
                :disabled="disabled"
              />
            </td>
            <td>
              <input
                :value="entry.aliases.join(', ')"
                :aria-label="t('aliases')"
                :disabled="disabled"
                @change="
                  entry.aliases = ($event.target as HTMLInputElement).value
                    .split(/[,，]/u)
                    .map((v) => v.trim())
                    .filter(Boolean)
                "
              />
            </td>
            <td class="is-select">
              <PopupSelect
                v-if="'tier' in entry"
                v-model="entry.tier"
                :options="tiers"
                :accessible-label="t('tier')"
                :disabled="disabled"
              />
              <PopupSelect
                v-else
                v-model="entry.categoryId"
                :options="categories"
                :accessible-label="t('category')"
                :disabled="disabled"
              />
            </td>
            <td class="is-check">
              <input
                v-model="entry.ignored"
                type="checkbox"
                :aria-label="t('ignore')"
                :disabled="disabled"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="pageCount > 1" class="decomposition-pager">
      <button type="button" :disabled="page === 0" @click="page--">
        {{ t("previous") }}
      </button>
      <span>{{ page + 1 }} / {{ pageCount }}</span>
      <button type="button" :disabled="page + 1 >= pageCount" @click="page++">
        {{ t("next") }}
      </button>
    </div>
    <div class="analysis-run-bar">
      <div class="analysis-run-actions">
        <button
          type="button"
          :disabled="disabled"
          @click="emit('save', draft, false)"
        >
          {{ t("saveRegistry") }}
        </button>
        <button
          type="button"
          class="analysis-primary-button"
          :disabled="disabled"
          @click="emit('save', draft, true)"
        >
          {{ t("confirmRegistry") }}
        </button>
      </div>
    </div>
  </section>
</template>
