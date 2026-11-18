<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from "vue";
import {
  ACADEMIC_CITE_KEY_MAX_LENGTH,
  ACADEMIC_REFERENCE_CARD_TYPES,
  AcademicCiteKeySchema,
  type AcademicReferenceCardType
} from "@deepwrite/contracts/renderer";
import AppIcon from "../AppIcon.vue";
import PopupSelect, { type PopupSelectValue } from "../PopupSelect.vue";
import { academicT } from "./academicLabels";
import { academicCardTypeBadge } from "./academicTreeLabels";
import {
  executeImportAcademicCardsFromMaterials,
  findAcademicIndexBook
} from "../../composables/useAcademicBookLifecycleCoordinator";
import { academicMutationPending } from "../../stores/academicWorkspaceDialog";
import { useCatalogIndexStore } from "../../stores/catalogIndexStore";
import { uiMessage } from "../../ui-feedback";

const props = defineProps<{
  bookId: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

interface CandidateEntry {
  key: string;
  libraryId: string;
  libraryTitle: string;
  entryId: string;
  title: string;
}

const catalogStore = useCatalogIndexStore();
const searchQuery = ref("");
const selectedKeys = ref<Set<string>>(new Set());
const draftByKey = reactive<
  Record<string, { citeKey: string; cardType: AcademicReferenceCardType }>
>({});

const book = computed(() => findAcademicIndexBook(props.bookId));
const locked = computed(() => academicMutationPending.value);

const cardTypeOptions = computed(() =>
  ACADEMIC_REFERENCE_CARD_TYPES.map((type) => ({
    value: type,
    label: academicCardTypeBadge(type)
  }))
);

function suggestCiteKey(
  rawTitle: string,
  fallbackIndex: number,
  usedLower: Set<string>
): string {
  const ascii = rawTitle
    .replace(/[^A-Za-z0-9_:-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  const stem = ascii.length >= 2 ? ascii : `ref_${fallbackIndex + 1}`;
  let candidate = stem;
  let suffix = 2;
  while (usedLower.has(candidate.toLowerCase())) {
    candidate = `${stem.slice(0, 40)}_${suffix}`;
    suffix += 1;
  }
  usedLower.add(candidate.toLowerCase());
  return candidate;
}

const candidateEntries = computed<CandidateEntry[]>(() => {
  const currentBook = book.value;
  const snapshot = catalogStore.snapshot;
  if (!currentBook || !snapshot) return [];
  const librariesById = new Map(
    snapshot.materials.map((library) => [library.id, library])
  );
  const items: CandidateEntry[] = [];
  for (const libraryId of currentBook.linkedMaterialIds) {
    const library = librariesById.get(libraryId);
    if (!library) continue;
    for (const entry of library.entries) {
      if (entry.contentBytes <= 0) continue;
      items.push({
        key: `${library.id}:${entry.id}`,
        libraryId: library.id,
        libraryTitle: library.title,
        entryId: entry.id,
        title: entry.title
      });
    }
  }
  return items;
});

watch(
  candidateEntries,
  (entries) => {
    const usedLower = new Set(
      (book.value?.foundation.cards ?? []).map((card) =>
        card.citeKey.toLowerCase()
      )
    );
    for (const key of Object.keys(draftByKey)) {
      const existing = draftByKey[key];
      if (existing?.citeKey) usedLower.add(existing.citeKey.toLowerCase());
    }
    entries.forEach((entry, index) => {
      if (!draftByKey[entry.key]) {
        draftByKey[entry.key] = {
          citeKey: suggestCiteKey(entry.title, index, usedLower),
          cardType: "literature"
        };
      }
    });
  },
  { immediate: true }
);

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLocaleLowerCase();
  if (!q) return candidateEntries.value;
  return candidateEntries.value.filter(
    (entry) =>
      entry.title.toLocaleLowerCase().includes(q) ||
      entry.libraryTitle.toLocaleLowerCase().includes(q)
  );
});

function toggleEntry(key: string): void {
  if (locked.value) return;
  const next = new Set(selectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedKeys.value = next;
}

function selectAllVisible(): void {
  if (locked.value) return;
  const next = new Set(selectedKeys.value);
  for (const entry of filteredEntries.value) {
    next.add(entry.key);
  }
  selectedKeys.value = next;
}

function clearSelection(): void {
  if (locked.value) return;
  selectedKeys.value = new Set();
}

function updateEntryCardType(key: string, value: PopupSelectValue): void {
  if (
    (value === "literature" || value === "evidence") &&
    draftByKey[key] &&
    !locked.value
  ) {
    draftByKey[key]!.cardType = value;
  }
}

function requestClose(): void {
  if (locked.value) return;
  emit("close");
}

async function submitImport(): Promise<void> {
  if (locked.value) return;
  const chosen = candidateEntries.value.filter((entry) =>
    selectedKeys.value.has(entry.key)
  );
  if (!chosen.length) return;

  const seenLower = new Set(
    (book.value?.foundation.cards ?? []).map((card) =>
      card.citeKey.toLowerCase()
    )
  );
  const payload: Array<{
    libraryId: string;
    entryId: string;
    title: string;
    citeKey: string;
    cardType: AcademicReferenceCardType;
  }> = [];

  for (const entry of chosen) {
    const draft = draftByKey[entry.key];
    const parsedKey = AcademicCiteKeySchema.safeParse(draft?.citeKey ?? "");
    if (!parsedKey.success) {
      uiMessage.warning(academicT("invalidCiteKeyError"));
      return;
    }
    const lower = parsedKey.data.toLowerCase();
    if (seenLower.has(lower)) {
      uiMessage.warning(
        academicT("duplicateCiteKeyError", { citeKey: parsedKey.data })
      );
      return;
    }
    seenLower.add(lower);
    payload.push({
      libraryId: entry.libraryId,
      entryId: entry.entryId,
      title: entry.title,
      citeKey: parsedKey.data,
      cardType: draft?.cardType ?? "literature"
    });
  }

  const ok = await executeImportAcademicCardsFromMaterials(
    props.bookId,
    payload
  );
  if (ok) {
    emit("close");
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    requestClose();
  }
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <div
    class="dialog-backdrop academic-dialog-backdrop"
    @mousedown.self="requestClose"
  >
    <section
      class="academic-import-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="academic-import-cards-title"
    >
      <header class="academic-import-header">
        <div>
          <span class="academic-dialog-eyebrow">
            {{ academicT("importCardsDialogEyebrow") }}
          </span>
          <h2 id="academic-import-cards-title">
            {{ academicT("importCardsDialogTitle") }}
          </h2>
          <p>{{ academicT("importCardsDialogDesc") }}</p>
        </div>
        <button
          type="button"
          class="academic-dialog-close"
          :aria-label="academicT('close')"
          :disabled="locked"
          @click="requestClose"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </header>

      <div class="academic-import-body">
        <p v-if="!book?.linkedMaterialIds.length" class="academic-import-empty">
          {{ academicT("noBoundMaterialLibraries") }}
        </p>
        <p v-else-if="!candidateEntries.length" class="academic-import-empty">
          {{ academicT("noImportableMaterialEntries") }}
        </p>
        <template v-else>
          <div class="academic-import-toolbar">
            <input
              v-model="searchQuery"
              type="search"
              class="academic-import-search"
              :placeholder="academicT('importCardsSearchPlaceholder')"
              :disabled="locked"
            />
            <div class="academic-import-toolbar-actions">
              <button
                type="button"
                class="academic-secondary-btn"
                :disabled="locked || !filteredEntries.length"
                @click="selectAllVisible"
              >
                {{ academicT("importCardsSelectAll") }}
              </button>
              <button
                type="button"
                class="academic-secondary-btn"
                :disabled="locked || selectedKeys.size === 0"
                @click="clearSelection"
              >
                {{ academicT("importCardsClearAll") }}
              </button>
            </div>
          </div>

          <ul class="academic-import-list">
            <li
              v-for="entry in filteredEntries"
              :key="entry.key"
              class="academic-import-row"
              :class="{ 'is-selected': selectedKeys.has(entry.key) }"
            >
              <label class="academic-import-check">
                <input
                  type="checkbox"
                  :checked="selectedKeys.has(entry.key)"
                  :disabled="locked"
                  @change="toggleEntry(entry.key)"
                />
                <span class="academic-import-entry-info">
                  <strong>{{ entry.title }}</strong>
                  <small>{{ entry.libraryTitle }}</small>
                </span>
              </label>

              <div
                v-if="selectedKeys.has(entry.key) && draftByKey[entry.key]"
                class="academic-import-row-fields"
              >
                <input
                  v-model="draftByKey[entry.key]!.citeKey"
                  class="academic-import-citekey"
                  :maxlength="ACADEMIC_CITE_KEY_MAX_LENGTH"
                  :aria-label="academicT('citeKeyLabel')"
                  :disabled="locked"
                  spellcheck="false"
                />
                <div class="academic-import-type-select">
                  <PopupSelect
                    :model-value="draftByKey[entry.key]!.cardType"
                    :options="cardTypeOptions"
                    :accessible-label="academicT('cardTypeLabel')"
                    :disabled="locked"
                    :menu-z-index="2300"
                    @update:model-value="updateEntryCardType(entry.key, $event)"
                  />
                </div>
              </div>
            </li>
          </ul>
        </template>
      </div>

      <footer class="academic-import-footer">
        <button
          type="button"
          class="academic-secondary-btn"
          :disabled="locked"
          @click="requestClose"
        >
          {{ academicT("cancel") }}
        </button>
        <button
          type="button"
          class="academic-primary-btn"
          :disabled="locked || selectedKeys.size === 0"
          @click="submitImport"
        >
          {{
            locked
              ? academicT("saving")
              : academicT("importSelectedCount", { count: selectedKeys.size })
          }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.academic-dialog-backdrop {
  z-index: 2100;
}

.academic-import-dialog {
  width: min(680px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg, 14px);
  background: var(--surface-main);
  border: 1px solid var(--theme-line);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.academic-import-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.academic-dialog-eyebrow {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.academic-import-header h2 {
  margin: 0 0 4px;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
}

.academic-import-header p {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.academic-dialog-close {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.academic-import-body {
  padding: 16px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.academic-import-empty {
  margin: 12px 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.academic-import-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.academic-import-search {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.academic-import-toolbar-actions {
  display: flex;
  gap: 6px;
}

.academic-import-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.academic-import-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.academic-import-row.is-selected {
  border-color: var(--accent);
  background: var(--surface-muted);
}

.academic-import-check {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.academic-import-entry-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.academic-import-entry-info strong {
  font-size: 0.875rem;
  color: var(--text-primary);
}

.academic-import-entry-info small {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.academic-import-row-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 8px;
  padding-left: 26px;
}

.academic-import-citekey {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: var(--code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.8125rem;
}

.academic-import-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px 18px;
  border-top: 1px solid var(--theme-line-soft);
}

.academic-secondary-btn,
.academic-primary-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 0.8125rem;
  cursor: pointer;
}

.academic-secondary-btn {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.academic-primary-btn {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-contrast, #ffffff);
  font-weight: 500;
}

.academic-secondary-btn:disabled,
.academic-primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
