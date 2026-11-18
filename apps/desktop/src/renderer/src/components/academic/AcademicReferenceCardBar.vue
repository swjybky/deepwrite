<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceDocument } from "../../types/workspace";
import { academicCardTypeBadge, academicTreeT } from "./academicTreeLabels";
import { academicT } from "./academicLabels";
import {
  openEditAcademicCardDialog,
  openImportAcademicCardsDialog
} from "../../stores/academicWorkspaceDialog";
import { uiMessage } from "../../ui-feedback";

const props = defineProps<{
  document: WorkspaceDocument;
  locked?: boolean;
}>();

const citeKeyDisplay = computed(() =>
  props.document.academicCiteKey ? `[${props.document.academicCiteKey}]` : ""
);

const cardTypeLabel = computed(() =>
  props.document.academicCardType
    ? academicCardTypeBadge(props.document.academicCardType)
    : ""
);

async function copyCiteKey(): Promise<void> {
  const key = props.document.academicCiteKey;
  if (!key) return;
  const formatted = `[${key}]`;
  try {
    await navigator.clipboard.writeText(formatted);
    uiMessage.success(academicT("copiedCiteKey", { citeKey: formatted }));
  } catch {
    uiMessage.info(formatted);
  }
}

function editCardMetadata(): void {
  if (
    !props.document.workspaceId ||
    !props.document.academicCardId ||
    !props.document.academicCiteKey ||
    !props.document.academicCardType
  ) {
    return;
  }
  openEditAcademicCardDialog({
    bookId: props.document.workspaceId,
    cardId: props.document.academicCardId,
    citeKey: props.document.academicCiteKey,
    cardType: props.document.academicCardType,
    title: props.document.title
  });
}

function importFromMaterials(): void {
  if (!props.document.workspaceId) return;
  openImportAcademicCardsDialog(props.document.workspaceId);
}
</script>

<template>
  <div
    class="academic-card-bar"
    role="region"
    :aria-label="academicTreeT('referenceCards')"
  >
    <div class="academic-card-bar-meta">
      <span v-if="cardTypeLabel" class="academic-card-bar-type">
        {{ cardTypeLabel }}
      </span>
      <code v-if="citeKeyDisplay" class="academic-card-bar-citekey">
        {{ citeKeyDisplay }}
      </code>
      <button
        v-if="citeKeyDisplay"
        type="button"
        class="academic-card-bar-action"
        @click="copyCiteKey"
      >
        {{ academicTreeT("copyCiteKey") }}
      </button>
    </div>
    <div class="academic-card-bar-actions">
      <button
        type="button"
        class="academic-card-bar-action"
        :disabled="locked"
        @click="editCardMetadata"
      >
        {{ academicTreeT("editCard") }}
      </button>
      <button
        type="button"
        class="academic-card-bar-action"
        :disabled="locked"
        @click="importFromMaterials"
      >
        {{ academicTreeT("importCardFromMaterials") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.academic-card-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 18px;
  background: var(--surface-muted);
  border-bottom: 1px solid var(--theme-line-soft);
}

.academic-card-bar-meta,
.academic-card-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.academic-card-bar-type {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-soft);
}

.academic-card-bar-citekey {
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.75rem;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 1px solid var(--theme-line-soft);
}

.academic-card-bar-action {
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.academic-card-bar-action:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--theme-line);
  background: var(--surface-hover);
}

.academic-card-bar-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
