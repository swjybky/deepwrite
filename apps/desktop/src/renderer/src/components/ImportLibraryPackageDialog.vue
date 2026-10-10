<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type {
  LibraryPackageImportChoices,
  LibraryPackagePreview,
  LibraryPackageSourceKind
} from "@deepwrite/contracts";
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useLibraryPackageImportForm } from "../composables/useLibraryPackageImportForm";
import ImportLibraryPackageRow from "./ImportLibraryPackageRow.vue";
import ImportLibraryPackageSkipped from "./ImportLibraryPackageSkipped.vue";
import ImportLibraryPackageSourceStep from "./ImportLibraryPackageSourceStep.vue";

const t = createScopedTranslator("components.importLibraryPackageDialog");

const props = defineProps<{
  open: boolean;
  /** The section the import started from. */
  domain: "material" | "skill";
  preview?: LibraryPackagePreview | undefined;
  /** Library titles already in the package's domain. */
  existingTitles: readonly string[];
  choosing: boolean;
  importing: boolean;
}>();

const emit = defineEmits<{
  close: [];
  choose: [sourceKind: LibraryPackageSourceKind];
  restart: [];
  submit: [choices: LibraryPackageImportChoices];
}>();

const {
  rows,
  createGroup,
  groupTitle,
  libraries,
  included,
  groupProblem,
  groupEnabled,
  plannedTitles,
  ready,
  updateRow,
  choices
} = useLibraryPackageImportForm({
  preview: () => props.preview,
  existingTitles: () => props.existingTitles
});

const recognitionLines = computed(() => {
  const preview = props.preview;
  if (!preview) return [];
  const lines = [
    t("sourceLine", {
      source: preview.sourceName,
      recognition:
        preview.recognition === "package"
          ? t("recognizedPackage")
          : preview.notes.includes("manifestUnreadable")
            ? t("manifestUnreadable")
            : t("recognizedFolder")
    })
  ];
  if (preview.notes.includes("libraryLimitExceeded"))
    lines.push(t("libraryLimitExceeded"));
  if (preview.domain !== props.domain) {
    lines.push(
      preview.domain === "skill"
        ? t("crossDomainSkill")
        : t("crossDomainMaterial")
    );
  }
  return lines;
});

function submit(): void {
  if (!props.importing && ready.value) emit("submit", choices());
}

function requestClose(): void {
  if (!props.importing) emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog import-library-package-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-library-package-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{
              domain === "skill" ? t("skillLibrary") : t("materialLibrary")
            }}</span>
            <h2 id="import-library-package-title">
              {{ domain === "skill" ? t("titleSkill") : t("titleMaterial") }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="importing"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <div class="dialog-content">
          <template v-if="!preview">
            <ImportLibraryPackageSourceStep
              :choosing="choosing"
              @choose="emit('choose', $event)"
            />
          </template>

          <template v-else>
            <p
              v-for="line in recognitionLines"
              :key="line"
              class="package-recognition"
            >
              {{ line }}
            </p>
            <div v-if="preview.group" class="package-group">
              <label class="package-group-toggle">
                <input
                  type="checkbox"
                  :checked="groupEnabled"
                  :disabled="importing || groupProblem !== null"
                  @change="
                    createGroup = ($event.target as HTMLInputElement).checked
                  "
                />
                <span>{{ t("createGroup") }}</span>
              </label>
              <small v-if="groupProblem" class="package-group-reason">{{
                groupProblem === "duplicateKind"
                  ? t("groupDuplicateKind")
                  : groupProblem === "tooMany"
                    ? t("groupTooMany")
                    : t("groupEmpty")
              }}</small>
              <input
                v-else
                v-model="groupTitle"
                class="package-group-title"
                type="text"
                maxlength="256"
                :disabled="importing || !groupEnabled"
                :aria-label="t('groupTitle')"
              />
            </div>
            <div class="package-library-list">
              <ImportLibraryPackageRow
                v-for="row in rows"
                :key="row.key"
                :domain="preview.domain"
                :library="libraries.get(row.key)!"
                :include="row.include"
                :title="row.title"
                :kind="row.kind"
                :planned-title="plannedTitles.get(row.key)!"
                :disabled="importing"
                @update:include="updateRow(row.key, { include: $event })"
                @update:title="updateRow(row.key, { title: $event })"
                @update:kind="updateRow(row.key, { kind: $event })"
              />
            </div>
            <ImportLibraryPackageSkipped
              :skipped="preview.skipped"
              :files="preview.skippedFiles"
            />
          </template>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="importing"
              @click="preview ? emit('restart') : requestClose()"
            >
              {{ preview ? t("reselect") : t("cancel") }}
            </button>
            <button
              v-if="preview"
              class="dialog-primary-button"
              type="button"
              :disabled="importing || !ready"
              @click="submit"
            >
              {{
                importing
                  ? t("importing")
                  : t("importLibraries", { count: included.length })
              }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.import-library-package-dialog {
  width: min(680px, calc(100vw - 32px));
}

.package-recognition,
.package-group-reason {
  color: var(--text-secondary);
  font-size: 0.714286rem;
  line-height: 1.5;
}

.package-recognition {
  margin: 0 0 6px;
}

.package-group {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 30px;
  margin: 12px 0;
}

.package-group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
  font-size: 0.785714rem;
}

.package-group-title {
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  color: var(--text-primary);
  background: var(--surface-raised);
  font: inherit;
  font-size: 0.785714rem;
}

.package-library-list {
  max-height: min(46vh, 420px);
  overflow: auto;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  background: var(--surface-main);
}
</style>
