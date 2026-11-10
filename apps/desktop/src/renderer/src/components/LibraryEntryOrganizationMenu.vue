<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  MATERIAL_STAGE_KINDS,
  type LibraryStructureOperation
} from "@deepwrite/contracts/renderer";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import { createScopedTranslator } from "../i18n";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";
const t = createScopedTranslator("components.libraryProjectDialog");
const props = defineProps<{
  domain: "material" | "skill";
  libraryId: string;
  entryId: string;
}>();
const emit = defineEmits<{
  organize: [operation: LibraryStructureOperation];
  openChange: [open: boolean];
}>();
const catalog = useCatalogIndexStore();
const open = ref(false);
watch(open, (value) => emit("openChange", value), { flush: "sync" });
const selected = ref<string[]>([]);
const destination = ref("");
const libraries = computed(() =>
  props.domain === "material"
    ? (catalog.snapshot?.materials ?? [])
    : (catalog.snapshot?.skills ?? [])
);
const source = computed(() =>
  libraries.value.find((library) => library.id === props.libraryId)
);
const targets = computed(() =>
  libraries.value.filter((library) => {
    if (
      !source.value ||
      library.id === props.libraryId ||
      library.isUnbound ||
      ("isBuiltin" in library && library.isBuiltin)
    )
      return false;
    return (
      !("materialKind" in library) ||
      library.materialKind === "mixed" ||
      source.value.entries
        .filter((entry) => selected.value.includes(entry.id))
        .every(
          (entry) =>
            MATERIAL_STAGE_KINDS[
              entry.stageId as keyof typeof MATERIAL_STAGE_KINDS
            ] === library.materialKind
        )
    );
  })
);
const options = computed(() => [
  { value: "", label: t("chooseDestination") },
  ...(!source.value?.isUnbound
    ? [{ value: "@unbound", label: t("unboundDestination") }]
    : []),
  ...targets.value.map((library) => ({
    value: library.id,
    label: library.title
  }))
]);
function show() {
  selected.value = [props.entryId];
  destination.value = "";
  open.value = true;
}
function submit() {
  if (
    !selected.value.length ||
    selected.value.length > 128 ||
    !destination.value ||
    !options.value.some((option) => option.value === destination.value)
  )
    return;
  emit("organize", {
    action: "move-entries",
    libraryId: props.libraryId,
    entryIds: selected.value,
    target:
      destination.value === "@unbound"
        ? { kind: "unbound" }
        : { kind: "library", libraryId: destination.value }
  });
  open.value = false;
}
</script>

<template>
  <button
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    @click.stop="show"
  >
    <AppIcon name="folder" :size="16" />
    <span>{{ t("organizeEntries") }}</span>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop"
      @pointerdown.stop
      @mousedown.self="open = false"
      @keydown.esc.stop="open = false"
    >
      <section
        class="workspace-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('organizeEntries')"
        @click.stop
      >
        <header>
          <h2>{{ t("organizeEntries") }}</h2>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            @click="open = false"
          >
            ×
          </button>
        </header>
        <form class="dialog-content" @submit.prevent="submit">
          <div class="entry-organization-list">
            <label v-for="entry in source?.entries ?? []" :key="entry.id"
              ><input v-model="selected" type="checkbox" :value="entry.id" />{{
                entry.title
              }}</label
            >
          </div>
          <label class="book-resource-name-field"
            ><span>{{ t("destinationLibrary") }}</span
            ><PopupSelect
              v-model="destination"
              :options="options"
              :accessible-label="t('destinationLibrary')"
          /></label>
          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              @click="open = false"
            >
              {{ t("cancel") }}</button
            ><button
              class="dialog-primary-button"
              type="submit"
              :disabled="
                !selected.length ||
                selected.length > 128 ||
                !destination ||
                !options.some((option) => option.value === destination)
              "
            >
              {{ t("organizeEntries") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.entry-organization-list {
  display: grid;
  gap: 8px;
  max-height: min(40vh, 320px);
  overflow: auto;
  margin-bottom: 16px;
}
.entry-organization-list label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}
</style>
