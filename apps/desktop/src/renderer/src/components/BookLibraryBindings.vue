<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { watch } from "vue";
import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";
import { sharingT } from "./librarySharingLabels";
import {
  useBookLibrarySelection,
  type BookLibrarySelectionProps
} from "../composables/useBookLibrarySelection";

const t = createScopedTranslator("components.bookLibraryBindings");
const props = defineProps<
  BookLibrarySelectionProps & {
    loading?: boolean;
    submitting?: boolean;
    domain?: "skill" | "material";
  }
>();
const emit = defineEmits<{
  change: [
    value: {
      linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
      linkedSkillIdsByKind: LinkedSkillIdsByKind;
      linkedMaterialIds: string[];
      linkedSkillIds: string[];
    }
  ];
}>();
const {
  selectedMaterialLibraryIds,
  selectedSkillLibraryIds,
  selectedMaterialSet,
  selectedSkillSet,
  materialSearchQuery,
  skillSearchQuery,
  materialTagFilter,
  skillTagFilter,
  materialItems,
  skillItems,
  filteredMaterialItems,
  filteredSkillItems,
  materialTagFilterOptions,
  skillTagFilterOptions,
  availableMaterialGroups,
  availableSkillGroups,
  missingMaterialIds,
  missingSkillIds,
  validMaterialGroupMemberIds,
  validSkillGroupMemberIds,
  isMaterialGroupSelected,
  isSkillGroupSelected,
  toggleMaterialGroup,
  toggleSkillGroup,
  toggleMaterialLibrary,
  toggleSkillLibrary,
  selectedMaterialLinks,
  selectedSkillLinks,
  selectedFlatMaterialIds,
  selectedFlatSkillIds
} = useBookLibrarySelection(props);

watch(
  () =>
    [
      selectedMaterialLinks(),
      selectedSkillLinks(),
      selectedFlatMaterialIds(),
      selectedFlatSkillIds()
    ] as const,
  ([
    linkedMaterialIdsByKind,
    linkedSkillIdsByKind,
    linkedMaterialIds,
    linkedSkillIds
  ]) =>
    emit("change", {
      linkedMaterialIdsByKind,
      linkedSkillIdsByKind,
      linkedMaterialIds,
      linkedSkillIds
    }),
  { immediate: true, deep: true }
);
</script>

<template>
  <section
    v-if="domain !== 'material'"
    class="create-short-binding-panel lib-picker-stack"
    aria-labelledby="create-short-skill-heading"
  >
    <div class="create-short-binding-heading">
      <span class="create-short-binding-icon"
        ><AppIcon name="library" :size="17"
      /></span>
      <div>
        <h3 id="create-short-skill-heading">
          {{ t("linkSkillLibraries") }}
        </h3>
        <p>
          {{ t("linkedSkillsCanBeLoadedAsNeededAtAny") }}
        </p>
      </div>
    </div>

    <div v-if="availableSkillGroups.length" class="lib-picker-groups">
      <span class="lib-picker-groups-label">{{
        sharingT("quickSelectGroups")
      }}</span>
      <div class="lib-picker-group-chips">
        <button
          v-for="group in availableSkillGroups"
          :key="group.id"
          class="lib-picker-group-chip"
          :class="{ 'is-active': isSkillGroupSelected(group) }"
          type="button"
          :disabled="loading || submitting"
          @click="toggleSkillGroup(group.id)"
        >
          <span>{{ group.title }}</span>
          <span class="lib-picker-group-count">{{
            sharingT("groupMemberCount", {
              count: validSkillGroupMemberIds(group).length
            })
          }}</span>
        </button>
      </div>
    </div>

    <div v-if="missingSkillIds.length" class="lib-picker-missing-list">
      <span
        v-for="id in missingSkillIds"
        :key="id"
        class="lib-picker-missing-chip"
      >
        {{ sharingT("missingLibraryLabel", { id }) }}
        <button
          type="button"
          :aria-label="sharingT('removeMissingBinding', { id })"
          :disabled="submitting"
          @click="toggleSkillLibrary(id)"
        >
          ×
        </button>
      </span>
    </div>

    <div class="lib-picker-toolbar">
      <input
        v-model="skillSearchQuery"
        class="lib-picker-search-input"
        type="search"
        autocomplete="off"
        :placeholder="sharingT('searchLibrariesPlaceholder')"
        :aria-label="sharingT('searchLibrariesPlaceholder')"
        :disabled="loading || submitting"
      />
      <PopupSelect
        :model-value="skillTagFilter"
        :options="skillTagFilterOptions"
        :accessible-label="sharingT('filterByTag')"
        size="large"
        :disabled="loading || submitting"
        :menu-min-width="160"
        @update:model-value="skillTagFilter = String($event)"
      />
    </div>

    <div
      v-if="filteredSkillItems.length"
      class="lib-picker-list"
      role="group"
      :aria-label="t('linkSkillLibraries')"
    >
      <label
        v-for="item in filteredSkillItems"
        :key="item.id"
        class="lib-picker-row"
        :class="{ 'is-checked': selectedSkillSet.has(item.id) }"
      >
        <span class="lib-picker-row-main">
          <input
            type="checkbox"
            :checked="selectedSkillSet.has(item.id)"
            :disabled="loading || submitting"
            @change="toggleSkillLibrary(item.id)"
          />
          <span class="lib-picker-row-title">{{ item.title }}</span>
        </span>
        <span class="lib-picker-row-meta">
          <span class="lib-picker-tag-badge">{{ item.tag }}</span>
          <span class="lib-picker-entry-count">{{
            sharingT("entryCount", { count: item.entryCount })
          }}</span>
        </span>
      </label>
    </div>
    <p v-else class="lib-picker-empty">
      {{
        skillItems.length === 0
          ? sharingT("noLibrariesAvailable")
          : sharingT("noMatchingLibraries")
      }}
    </p>
    <span class="lib-picker-count">
      {{ sharingT("selectedCount", { count: selectedSkillLibraryIds.length }) }}
    </span>
  </section>

  <section
    v-if="domain !== 'skill'"
    class="create-short-binding-panel lib-picker-stack"
    aria-labelledby="create-short-material-heading"
  >
    <div class="create-short-binding-heading">
      <span class="create-short-binding-icon"
        ><AppIcon name="archive" :size="17"
      /></span>
      <div>
        <h3 id="create-short-material-heading">
          {{ t("linkMaterialLibraries") }}
        </h3>
        <p>
          {{ t("chooseMaterialLibrariesByPurposeYouCanAddMissing") }}
        </p>
      </div>
    </div>

    <div v-if="availableMaterialGroups.length" class="lib-picker-groups">
      <span class="lib-picker-groups-label">{{
        sharingT("quickSelectGroups")
      }}</span>
      <div class="lib-picker-group-chips">
        <button
          v-for="group in availableMaterialGroups"
          :key="group.id"
          class="lib-picker-group-chip"
          :class="{ 'is-active': isMaterialGroupSelected(group) }"
          type="button"
          :disabled="loading || submitting"
          @click="toggleMaterialGroup(group.id)"
        >
          <span>{{ group.title }}</span>
          <span class="lib-picker-group-count">{{
            sharingT("groupMemberCount", {
              count: validMaterialGroupMemberIds(group).length
            })
          }}</span>
        </button>
      </div>
    </div>

    <div v-if="missingMaterialIds.length" class="lib-picker-missing-list">
      <span
        v-for="id in missingMaterialIds"
        :key="id"
        class="lib-picker-missing-chip"
      >
        {{ sharingT("missingLibraryLabel", { id }) }}
        <button
          type="button"
          :aria-label="sharingT('removeMissingBinding', { id })"
          :disabled="submitting"
          @click="toggleMaterialLibrary(id)"
        >
          ×
        </button>
      </span>
    </div>

    <div class="lib-picker-toolbar">
      <input
        v-model="materialSearchQuery"
        class="lib-picker-search-input"
        type="search"
        autocomplete="off"
        :placeholder="sharingT('searchLibrariesPlaceholder')"
        :aria-label="sharingT('searchLibrariesPlaceholder')"
        :disabled="loading || submitting"
      />
      <PopupSelect
        :model-value="materialTagFilter"
        :options="materialTagFilterOptions"
        :accessible-label="sharingT('filterByTag')"
        size="large"
        :disabled="loading || submitting"
        :menu-min-width="160"
        @update:model-value="materialTagFilter = String($event)"
      />
    </div>

    <div
      v-if="filteredMaterialItems.length"
      class="lib-picker-list"
      role="group"
      :aria-label="t('linkMaterialLibraries')"
    >
      <label
        v-for="item in filteredMaterialItems"
        :key="item.id"
        class="lib-picker-row"
        :class="{ 'is-checked': selectedMaterialSet.has(item.id) }"
      >
        <span class="lib-picker-row-main">
          <input
            type="checkbox"
            :checked="selectedMaterialSet.has(item.id)"
            :disabled="loading || submitting"
            @change="toggleMaterialLibrary(item.id)"
          />
          <span class="lib-picker-row-title">{{ item.title }}</span>
        </span>
        <span class="lib-picker-row-meta">
          <span class="lib-picker-tag-badge">{{ item.tag }}</span>
          <span class="lib-picker-entry-count">{{
            sharingT("entryCount", { count: item.entryCount })
          }}</span>
        </span>
      </label>
    </div>
    <p v-else class="lib-picker-empty">
      {{
        materialItems.length === 0
          ? sharingT("noLibrariesAvailable")
          : sharingT("noMatchingLibraries")
      }}
    </p>
    <span class="lib-picker-count">
      {{
        sharingT("selectedCount", { count: selectedMaterialLibraryIds.length })
      }}
    </span>
  </section>
</template>

<style scoped src="./library-sharing-picker.css"></style>
