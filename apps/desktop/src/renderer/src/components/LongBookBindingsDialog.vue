<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  flattenMaterialIdsByKind,
  flattenSkillIdsByKind,
  materialIdsToByKind,
  skillIdsToByKind,
  type LinkedMaterialIdsByKind,
  type LinkedSkillIdsByKind,
  type LongLinkedResourceStageScopes,
  type MaterialKind,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type SkillKind,
  type SkillLibrary,
  type SkillLibraryGroup
} from "@deepwrite/contracts/renderer";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";
import {
  formatMaterialTagBadge,
  formatSkillTagBadge,
  sharingT
} from "./librarySharingLabels";

const t = createScopedTranslator("components.longBookBindingsDialog");

type LongBindingDomain = "skill" | "material";

const props = withDefaults(
  defineProps<{
    mode: LongBindingDomain | null;
    bookTitle: string;
    materials?: readonly MaterialLibrary[];
    skills?: readonly SkillLibrary[];
    materialGroups?: readonly MaterialLibraryGroup[];
    skillGroups?: readonly SkillLibraryGroup[];
    linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
    linkedSkillIdsByKind: LinkedSkillIdsByKind;
    linkedResourceStageScopes: LongLinkedResourceStageScopes;
    submitting?: boolean;
  }>(),
  {
    materials: () => [],
    skills: () => [],
    materialGroups: () => [],
    skillGroups: () => [],
    submitting: false
  }
);

const emit = defineEmits<{
  close: [];
  submit: [
    payload: {
      linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
      linkedSkillIdsByKind: LinkedSkillIdsByKind;
      linkedResourceStageScopes: LongLinkedResourceStageScopes;
    }
  ];
}>();

const selectedMaterialIds = ref<string[]>([]);
const selectedSkillIds = ref<string[]>([]);
const searchQuery = ref("");
const tagFilter = ref("");
const dialog = ref<HTMLElement | null>(null);

const title = computed(() =>
  props.mode === "skill" ? t("skillLibraryLinks") : t("materialLibraryLinks")
);
const heading = computed(() =>
  props.mode === "skill" ? t("linkSkillLibraries") : t("linkMaterialLibraries")
);
const description = computed(() =>
  props.mode === "skill"
    ? t("linkedSkillsCanBeLoadedAtAnyStageLink")
    : t("linkedMaterialsCanBeLoadedAtAnyStageLink")
);

const availableMaterials = computed(() =>
  props.materials.filter((library) => !library.isUnbound)
);
const availableSkills = computed(() =>
  props.skills.filter((library) => !library.isUnbound)
);
const materialById = computed(
  () =>
    new Map(availableMaterials.value.map((item) => [item.id, item] as const))
);
const skillById = computed(
  () => new Map(availableSkills.value.map((item) => [item.id, item] as const))
);

const activeItems = computed(() => {
  if (props.mode === "skill") {
    return availableSkills.value.map((library) => ({
      id: library.id,
      title: library.isBuiltin
        ? t("valueOfficial", { arg0: library.title })
        : library.title,
      tag: formatSkillTagBadge(library),
      entryCount: library.entries.length
    }));
  }
  return availableMaterials.value.map((library) => ({
    id: library.id,
    title: library.title,
    tag: formatMaterialTagBadge(library),
    entryCount: library.entries.length
  }));
});

const tagFilterOptions = computed(() => {
  const tags = [...new Set(activeItems.value.map((item) => item.tag))];
  return [
    { value: "", label: sharingT("allTags") },
    ...tags.map((tag) => ({ value: tag, label: tag }))
  ];
});

const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  const tag = tagFilter.value;
  return activeItems.value.filter(
    (item) =>
      (!tag || item.tag === tag) &&
      (!query ||
        item.title.toLocaleLowerCase().includes(query) ||
        item.tag.toLocaleLowerCase().includes(query))
  );
});

const selectedIds = computed(() =>
  props.mode === "skill" ? selectedSkillIds.value : selectedMaterialIds.value
);
const selectedSet = computed(() => new Set(selectedIds.value));

const missingIds = computed(() =>
  props.mode === "skill"
    ? selectedSkillIds.value.filter((id) => !skillById.value.has(id))
    : selectedMaterialIds.value.filter((id) => !materialById.value.has(id))
);

function validGroupMemberIds(
  group: MaterialLibraryGroup | SkillLibraryGroup
): string[] {
  return props.mode === "skill"
    ? group.memberIds.filter((id) => skillById.value.has(id))
    : group.memberIds.filter((id) => materialById.value.has(id));
}

const availableGroups = computed(() => {
  const groups =
    props.mode === "skill" ? props.skillGroups : props.materialGroups;
  return groups.filter((group) => validGroupMemberIds(group).length > 0);
});

function isGroupSelected(
  group: MaterialLibraryGroup | SkillLibraryGroup
): boolean {
  const ids = validGroupMemberIds(group);
  return ids.length > 0 && ids.every((id) => selectedSet.value.has(id));
}

function toggleGroup(groupId: string): void {
  const group = availableGroups.value.find((item) => item.id === groupId);
  if (!group) return;
  const ids = validGroupMemberIds(group);
  if (!ids.length) return;
  const target =
    props.mode === "skill" ? selectedSkillIds : selectedMaterialIds;
  if (isGroupSelected(group)) {
    const remove = new Set(ids);
    target.value = target.value.filter((id) => !remove.has(id));
  } else {
    target.value = [...new Set([...target.value, ...ids])];
  }
}

function toggleLibrary(id: string): void {
  const target =
    props.mode === "skill" ? selectedSkillIds : selectedMaterialIds;
  if (target.value.includes(id)) {
    target.value = target.value.filter((candidate) => candidate !== id);
  } else {
    target.value = [...target.value, id];
  }
}

function reset(): void {
  searchQuery.value = "";
  tagFilter.value = "";
  selectedMaterialIds.value = flattenMaterialIdsByKind(
    props.linkedMaterialIdsByKind
  );
  selectedSkillIds.value = flattenSkillIdsByKind(props.linkedSkillIdsByKind);
}

function selectedMaterialLinks(): LinkedMaterialIdsByKind {
  const validIds = selectedMaterialIds.value.filter((id) =>
    materialById.value.has(id)
  );
  const links = materialIdsToByKind(validIds, availableMaterials.value);
  for (const id of selectedMaterialIds.value) {
    if (materialById.value.has(id)) continue;
    const originKind = (
      ["character", "gimmick", "plot", "draft", "other"] as MaterialKind[]
    ).find((kind) => props.linkedMaterialIdsByKind[kind].includes(id));
    const bucket = originKind ?? "other";
    if (!links[bucket].includes(id)) links[bucket].push(id);
  }
  return links;
}

function selectedSkillLinks(): LinkedSkillIdsByKind {
  const validIds = selectedSkillIds.value.filter((id) =>
    skillById.value.has(id)
  );
  const links = skillIdsToByKind(validIds, availableSkills.value);
  for (const id of selectedSkillIds.value) {
    if (skillById.value.has(id)) continue;
    const originKind = (
      ["general", "plot", "style", "other"] as SkillKind[]
    ).find((kind) => props.linkedSkillIdsByKind[kind].includes(id));
    const bucket = originKind ?? "other";
    if (!links[bucket].includes(id)) links[bucket].push(id);
  }
  return links;
}

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  emit("submit", {
    linkedMaterialIdsByKind: selectedMaterialLinks(),
    linkedSkillIdsByKind: selectedSkillLinks(),
    linkedResourceStageScopes: { materials: {}, skills: {} }
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.mode && event.key === "Escape") requestClose();
}

watch(
  () => props.mode,
  (mode) => {
    if (!mode) return;
    reset();
    void nextTick(() => dialog.value?.focus());
  },
  { immediate: true }
);
onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="mode" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        ref="dialog"
        class="workspace-dialog book-binding-dialog long-binding-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`long-binding-title-${mode}`"
        tabindex="-1"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ bookTitle }}</span>
            <h2 :id="`long-binding-title-${mode}`">{{ title }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="submitting"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form
          class="dialog-content create-short-book-form"
          @submit.prevent="submit"
        >
          <section
            class="create-short-binding-panel lib-picker-stack"
            :aria-labelledby="`long-binding-heading-${mode}`"
          >
            <div class="create-short-binding-heading">
              <span class="create-short-binding-icon">
                <AppIcon
                  :name="mode === 'skill' ? 'library' : 'archive'"
                  :size="17"
                />
              </span>
              <div>
                <h3 :id="`long-binding-heading-${mode}`">{{ heading }}</h3>
                <p>{{ description }}</p>
              </div>
            </div>

            <div v-if="availableGroups.length" class="lib-picker-groups">
              <span class="lib-picker-groups-label">{{
                sharingT("quickSelectGroups")
              }}</span>
              <div class="lib-picker-group-chips">
                <button
                  v-for="group in availableGroups"
                  :key="group.id"
                  class="lib-picker-group-chip"
                  :class="{ 'is-active': isGroupSelected(group) }"
                  type="button"
                  :disabled="submitting"
                  @click="toggleGroup(group.id)"
                >
                  <span>{{ group.title }}</span>
                  <span class="lib-picker-group-count">{{
                    sharingT("groupMemberCount", {
                      count: validGroupMemberIds(group).length
                    })
                  }}</span>
                </button>
              </div>
            </div>

            <div v-if="missingIds.length" class="lib-picker-missing-list">
              <span
                v-for="id in missingIds"
                :key="id"
                class="lib-picker-missing-chip"
              >
                {{ t("valueMissingFromCatalog", { arg0: id }) }}
                <button
                  type="button"
                  :aria-label="sharingT('removeMissingBinding', { id })"
                  :disabled="submitting"
                  @click="toggleLibrary(id)"
                >
                  ×
                </button>
              </span>
            </div>

            <div class="lib-picker-toolbar">
              <input
                v-model="searchQuery"
                class="lib-picker-search-input"
                type="search"
                autocomplete="off"
                :placeholder="sharingT('searchLibrariesPlaceholder')"
                :aria-label="sharingT('searchLibrariesPlaceholder')"
                :disabled="submitting"
              />
              <PopupSelect
                :model-value="tagFilter"
                :options="tagFilterOptions"
                :accessible-label="sharingT('filterByTag')"
                size="large"
                :disabled="submitting"
                :menu-min-width="160"
                :menu-z-index="230"
                @update:model-value="tagFilter = String($event)"
              />
            </div>

            <div
              v-if="filteredItems.length"
              class="lib-picker-list"
              role="group"
              :aria-label="heading"
            >
              <label
                v-for="item in filteredItems"
                :key="item.id"
                class="lib-picker-row"
                :class="{ 'is-checked': selectedSet.has(item.id) }"
              >
                <span class="lib-picker-row-main">
                  <input
                    type="checkbox"
                    :checked="selectedSet.has(item.id)"
                    :disabled="submitting"
                    @change="toggleLibrary(item.id)"
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
                activeItems.length === 0
                  ? sharingT("noLibrariesAvailable")
                  : sharingT("noMatchingLibraries")
              }}
            </p>
            <span class="lib-picker-count">
              {{ sharingT("selectedCount", { count: selectedIds.length }) }}
            </span>
            <p class="create-short-stable-hint">
              {{
                t("existingLinksToLibrariesTemporarilyMissingFromTheCatalog")
              }}
            </p>
          </section>

          <div class="dialog-actions create-short-book-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              type="submit"
              :disabled="submitting"
            >
              {{ submitting ? t("saving") : t("saveLinks") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./long-book-bindings-dialog.css"></style>
<style scoped src="./library-sharing-picker.css"></style>
