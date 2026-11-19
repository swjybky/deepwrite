<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  MysteryOperation,
  MysteryWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  MYSTERY_MAX_ACTS,
  MYSTERY_MAX_CLUE_ROUNDS,
  MYSTERY_MAX_ROLES,
  MYSTERY_MAX_TRUTH_DOCS,
  MysteryBoardSpecSchema
} from "@deepwrite/contracts/renderer";
import AgentTeamSegmented from "../../components/AgentTeamSegmented.vue";
import AppIcon from "../../components/AppIcon.vue";
import SaveConflictDialog from "../../components/SaveConflictDialog.vue";
import WritingContextPanel, {
  type WritingContextSaveCompletion
} from "../../components/WritingContextPanel.vue";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";
import { useMysteryWorkspaceStore } from "../../stores/mysteryWorkspaceStore";
import type { ResourceTreeNode } from "../../types/workspace";
import { uiMessage } from "../../ui-feedback";
import { mysteryStructureItems } from "../../utils/mysteryWorkspaceResourceTree";
import type { MysteryStructureItemDialog } from "./MysteryDialogs.vue";
import { mysteryT } from "./messages";
import { mysteryLabels } from "./mysterySharedLabels";
import { useMysteryDocument } from "./useMysteryDocument";

type Item = NonNullable<ResourceTreeNode["mysteryItem"]>;
type Panel = "board" | Item["kind"] | "context";

const props = defineProps<{
  index: MysteryWorkspaceIndexSnapshot;
  busy: boolean;
  initialPanel: "board" | "context";
}>();
const emit = defineEmits<{
  applyOperation: [operation: MysteryOperation];
  openItem: [dialog: MysteryStructureItemDialog];
  move: [item: Item & { move: "up" | "down" }];
  contextConflictChange: [open: boolean];
}>();

const t = createScopedTranslator("components.treeNodeItem");
const contextT = createScopedTranslator("components.writingContextPanel");
const panel = ref<Panel>(props.initialPanel);
const store = useMysteryWorkspaceStore();
const contextPanel = ref<InstanceType<typeof WritingContextPanel>>();
const contextDraftVersion = ref(0);
const {
  docContent,
  savedContent,
  docLoading,
  docReady,
  docSaving,
  conflict,
  loadDocument,
  handleContentUpdate,
  flushDocument,
  reloadConflict,
  overwriteConflict
} = useMysteryDocument({
  api: () => window.deepwrite?.mystery,
  bookId: () => props.index.bookId,
  target: () => ({ kind: "agents_md" }),
  autoSaveEnabled: () => false,
  refreshBook: (bookId) => store.refreshActiveBook(bookId),
  onLoadError: (error) =>
    uiMessage.error(formatError(error, mysteryT("actionFailed"))),
  onSaveError: (error) =>
    uiMessage.error(formatError(error, mysteryT("saveFailed")))
});
watch(
  panel,
  (current) => {
    if (current === "context") void loadDocument();
  },
  { immediate: true }
);
watch(
  () => Boolean(conflict.value),
  (open) => emit("contextConflictChange", open)
);

async function flushContextIfNeeded(): Promise<boolean> {
  return (await contextPanel.value?.flushIfNeeded()) ?? true;
}

async function switchPanel(next: Panel): Promise<void> {
  if (next === panel.value || !(await flushContextIfNeeded())) return;
  panel.value = next;
}

async function saveContext(
  content: string,
  completion: WritingContextSaveCompletion
): Promise<void> {
  handleContentUpdate(content);
  if (await flushDocument()) completion.succeed();
  else completion.fail();
}

async function reloadContext(): Promise<void> {
  await reloadConflict();
  if (!conflict.value) contextDraftVersion.value += 1;
}
const collectionPanels = computed(
  () =>
    [
      {
        id: "truth_doc",
        label: mysteryT("truthDocuments"),
        limit: MYSTERY_MAX_TRUTH_DOCS
      },
      { id: "role", label: mysteryT("roles"), limit: MYSTERY_MAX_ROLES },
      { id: "act", label: mysteryT("acts"), limit: MYSTERY_MAX_ACTS },
      {
        id: "clue_round",
        label: mysteryT("clueRounds"),
        limit: MYSTERY_MAX_CLUE_ROUNDS
      }
    ] as const
);
const panels = computed(() => [
  { id: "board" as const, label: mysteryT("boardSpecButton") },
  ...collectionPanels.value,
  { id: "context" as const, label: contextT("mysteryContext") }
]);
const collectionPanel = computed(() =>
  collectionPanels.value.find((entry) => entry.id === panel.value)
);
const collections = computed(() => mysteryStructureItems(props.index));
const board = ref({ ...props.index.boardSpec });
const savedBoard = computed(() => JSON.stringify(props.index.boardSpec));
const dirty = computed(() => JSON.stringify(board.value) !== savedBoard.value);
const boardInput = computed(() =>
  MysteryBoardSpecSchema.safeParse(board.value)
);
const narrativeOptions = computed(() => [
  { value: "second" as const, label: mysteryLabels("secondPerson") },
  { value: "first" as const, label: mysteryLabels("firstPerson") }
]);
watch(savedBoard, () => {
  board.value = { ...props.index.boardSpec };
});
defineExpose({ dirty, flushContextIfNeeded });

function saveBoard(): void {
  if (boardInput.value.success && dirty.value && !props.busy) {
    emit("applyOperation", {
      type: "boardSpec.update",
      boardSpec: boardInput.value.data
    });
  }
}

function editItem(
  kind: "renameStructure" | "deleteStructure",
  item: Item
): void {
  emit("openItem", {
    kind,
    targetKind: item.kind,
    id: item.id,
    title: item.title,
    tag: item.tag
  });
}
</script>

<template>
  <div class="mystery-structure-manager">
    <nav class="mystery-structure-tabs" :aria-label="t('manageStructure')">
      <button
        v-for="entry in panels"
        :key="entry.id"
        type="button"
        :aria-pressed="panel === entry.id"
        @click="switchPanel(entry.id)"
      >
        {{ entry.label }}
      </button>
    </nav>

    <form
      v-if="panel === 'board'"
      class="mystery-fields"
      @submit.prevent="saveBoard"
    >
      <div class="mystery-field-grid-2">
        <label class="mystery-field-row">
          <span class="mystery-field-label">{{
            mysteryT("playerCountLabel")
          }}</span>
          <input
            v-model.number="board.playerCount"
            class="mystery-input"
            type="number"
            min="1"
            max="16"
            required
          />
        </label>
        <label class="mystery-field-row">
          <span class="mystery-field-label">{{
            mysteryT("actCountTargetLabel")
          }}</span>
          <input
            v-model.number="board.actCountTarget"
            class="mystery-input"
            type="number"
            min="1"
            max="12"
            required
          />
        </label>
      </div>
      <div class="mystery-field-row">
        <span class="mystery-field-label">{{
          mysteryT("narrativePersonLabel")
        }}</span>
        <AgentTeamSegmented
          v-model="board.narrativePerson"
          name="mystery-narrative-person"
          :label="mysteryT('narrativePersonLabel')"
          :options="narrativeOptions"
          :disabled="busy"
        />
      </div>
      <label class="mystery-field-row">
        <span class="mystery-field-label">{{
          mysteryT("boardSummaryLabel")
        }}</span>
        <textarea
          v-model="board.summary"
          class="mystery-textarea"
          rows="3"
          maxlength="2000"
        />
      </label>
      <div class="dialog-actions">
        <button
          class="dialog-primary-button"
          type="submit"
          :disabled="busy || !dirty || !boardInput.success"
        >
          {{ mysteryT("saveBoardSpec") }}
        </button>
      </div>
    </form>

    <section
      v-else-if="collectionPanel"
      :key="collectionPanel.id"
      :aria-label="collectionPanel.label"
      class="mystery-structure-group"
    >
      <div class="mystery-structure-toolbar">
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="
            busy ||
            collections[collectionPanel.id].length >= collectionPanel.limit
          "
          @click="
            emit('openItem', {
              kind: 'createStructure',
              targetKind: collectionPanel.id
            })
          "
        >
          <AppIcon name="plus" :size="16" />{{ t("addEntry") }}
        </button>
      </div>
      <ul
        v-if="collections[collectionPanel.id].length"
        class="mystery-structure-list"
      >
        <li v-for="item in collections[collectionPanel.id]" :key="item.id">
          <div class="mystery-structure-label">
            <strong :title="item.title">{{ item.title }}</strong>
            <span v-if="item.tag" :title="item.tag">{{ item.tag }}</span>
          </div>
          <button
            class="icon-button"
            type="button"
            :aria-label="t('rename')"
            :title="t('rename')"
            :disabled="busy || item.renameDisabled"
            @click="editItem('renameStructure', item)"
          >
            <AppIcon name="edit" :size="16" />
          </button>
          <button
            class="icon-button"
            type="button"
            :aria-label="t('moveUp')"
            :title="t('moveUp')"
            :disabled="busy || item.moveUpDisabled"
            @click="emit('move', { ...item, move: 'up' })"
          >
            <AppIcon name="arrow-up" :size="16" />
          </button>
          <button
            class="icon-button"
            type="button"
            :aria-label="t('moveDown')"
            :title="t('moveDown')"
            :disabled="busy || item.moveDownDisabled"
            @click="emit('move', { ...item, move: 'down' })"
          >
            <span aria-hidden="true">↓</span>
          </button>
          <button
            class="icon-button mystery-structure-delete"
            type="button"
            :aria-label="t('delete')"
            :title="t('delete')"
            :disabled="busy || item.deleteDisabled"
            @click="editItem('deleteStructure', item)"
          >
            <AppIcon name="trash" :size="16" />
          </button>
        </li>
      </ul>
      <p v-else class="dialog-description">{{ mysteryT("noEntries") }}</p>
    </section>

    <template v-else>
      <WritingContextPanel
        v-if="docReady || docLoading"
        :key="contextDraftVersion"
        ref="contextPanel"
        class="mystery-context-panel"
        workspace-type="mystery"
        :content="savedContent"
        :loading="docLoading"
        :pending="busy || docSaving"
        @save="saveContext"
      />
      <button
        v-else
        type="button"
        class="dialog-secondary-button"
        @click="loadDocument()"
      >
        {{ contextT("retryReadingContext") }}
      </button>
    </template>

    <SaveConflictDialog
      v-if="conflict"
      open
      nested
      :title="contextT('mysteryContext')"
      :draft-content="docContent"
      :disk-content="conflict.content"
      :submitting="docLoading || docSaving"
      @keep="conflict = null"
      @reload="reloadContext"
      @overwrite="overwriteConflict"
    />
  </div>
</template>

<style scoped>
.mystery-structure-manager {
  display: grid;
  min-height: 0;
  gap: 16px;
  overflow: auto;
  padding: 16px;
  background: var(--surface-main);
}

.mystery-structure-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
}

.mystery-structure-tabs button {
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
}

.mystery-structure-tabs button:hover {
  background: var(--surface-hover);
}

.mystery-structure-tabs button[aria-pressed="true"] {
  border-color: var(--theme-line);
  background: var(--surface-raised);
  color: var(--accent);
}

.mystery-context-panel {
  height: auto;
  min-height: min-content;
  grid-template-rows: auto minmax(min(320px, 32vh), 1fr) auto;
}

.mystery-context-panel :deep(textarea) {
  min-height: 0;
}

.mystery-structure-group {
  min-width: 0;
}

.mystery-structure-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.mystery-structure-list {
  margin: 0;
  padding: 0;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
  list-style: none;
}

.mystery-structure-list li {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
}

.mystery-structure-list li + li {
  border-top: 1px solid var(--theme-line-soft);
}

.mystery-structure-label {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.mystery-structure-label > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mystery-structure-label span {
  color: var(--text-secondary);
  font-size: 0.857143rem;
}

.mystery-structure-delete:hover:not(:disabled) {
  color: var(--danger-text);
}
</style>
