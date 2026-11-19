<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
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
import BookManagementDialog, {
  type BookManagementSection
} from "../../components/book-management/BookManagementDialog.vue";
import AgentTeamSegmented from "../../components/AgentTeamSegmented.vue";
import BookManagementRowActions from "../../components/book-management/BookManagementRowActions.vue";
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
  open: boolean;
  bookTitle: string;
  childOpen?: boolean;
  index: MysteryWorkspaceIndexSnapshot;
  busy: boolean;
  initialPanel: "board" | "context";
}>();
const emit = defineEmits<{
  applyOperation: [operation: MysteryOperation];
  openItem: [dialog: MysteryStructureItemDialog];
  move: [item: Item & { move: "up" | "down" }];
  close: [];
  rename: [];
}>();

const t = createScopedTranslator("components.treeNodeItem");
const contextT = createScopedTranslator("components.writingContextPanel");
const boardFormId = useId();
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
        description: mysteryT("truthDocumentsDescription"),
        create: mysteryT("addTruthDoc"),
        limit: MYSTERY_MAX_TRUTH_DOCS
      },
      {
        id: "role",
        label: mysteryT("roles"),
        description: mysteryT("rolesDescription"),
        create: mysteryT("addRole"),
        limit: MYSTERY_MAX_ROLES
      },
      {
        id: "act",
        label: mysteryT("acts"),
        description: mysteryT("actsDescription"),
        create: mysteryT("addAct"),
        limit: MYSTERY_MAX_ACTS
      },
      {
        id: "clue_round",
        label: mysteryT("clueRounds"),
        description: mysteryT("clueRoundsDescription"),
        create: mysteryT("addClueRound"),
        limit: MYSTERY_MAX_CLUE_ROUNDS
      }
    ] as const
);
const sections = computed<BookManagementSection<Panel>[]>(() => [
  {
    id: "board",
    group: "structure",
    label: mysteryT("boardSpecButton"),
    description: mysteryT("boardDescription")
  },
  ...collectionPanels.value.map((entry) => ({
    ...entry,
    group: "structure" as const
  })),
  {
    id: "context",
    group: "context",
    label: contextT("mysteryContext"),
    description: contextT(
      "storeLastingCreativeMethodsAndConstraintsForThisWork"
    )
  }
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
  <BookManagementDialog
    :open="open"
    :book-title="bookTitle"
    :book-type="mysteryLabels('murderMystery')"
    :sections="sections"
    :active="panel"
    :pending="busy"
    :child-open="childOpen || Boolean(conflict)"
    @close="!busy && emit('close')"
    @rename="emit('rename')"
    @select="switchPanel"
  >
    <template #actions>
      <button
        v-if="panel === 'board'"
        class="dialog-primary-button"
        type="submit"
        :form="boardFormId"
        :disabled="busy || !dirty || !boardInput.success"
      >
        {{ mysteryT("saveBoardSpec") }}
      </button>
      <button
        v-else-if="collectionPanel"
        class="dialog-primary-button"
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
        {{ collectionPanel.create }}
      </button>
    </template>
    <form
      v-if="panel === 'board'"
      :id="boardFormId"
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
    </form>

    <template v-else-if="collectionPanel">
      <ul
        v-if="collections[collectionPanel.id].length"
        class="book-management-list"
      >
        <li
          v-for="item in collections[collectionPanel.id]"
          :key="item.id"
          class="book-management-row"
        >
          <div class="book-management-copy">
            <strong :title="item.title">{{ item.title }}</strong>
            <span v-if="item.tag" :title="item.tag">{{ item.tag }}</span>
          </div>
          <BookManagementRowActions
            :title="item.title"
            :pending="busy"
            :up-disabled="item.moveUpDisabled"
            :down-disabled="item.moveDownDisabled"
            :edit-disabled="item.renameDisabled"
            :delete-disabled="item.deleteDisabled"
            :edit-label="t('rename')"
            @move="emit('move', { ...item, move: $event })"
            @edit="editItem('renameStructure', item)"
            @delete="editItem('deleteStructure', item)"
          />
        </li>
      </ul>
      <p v-else class="dialog-description">{{ mysteryT("noEntries") }}</p>
    </template>

    <template v-else>
      <WritingContextPanel
        v-if="docReady || docLoading"
        :key="contextDraftVersion"
        ref="contextPanel"
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
  </BookManagementDialog>
</template>
