<script setup lang="ts">
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { computed, reactive, ref } from "vue";
import type {
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch,
  LongWorldbuildingFormat,
  LongWorldbuildingItemLayout
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  useLongStructureDeleteConfirmation,
  type LongStructureDeleteRow
} from "../composables/useLongStructureDeleteConfirmation";
import { useLongStructureFormImpact } from "../composables/useLongStructureFormImpact";
import {
  createLongStructureMutationBuilder,
  type LongOrderDirection,
  type LongStructureMutationBuilder
} from "../types/longStructureMutations";
import {
  isLongMigrationEvidenceCategoryId,
  type LongStructureMutationCompletion,
  type LongWorldbuildingSyncCompletion,
  type LongWorldbuildingSyncPreparedChange,
  type LongWorldbuildingSyncRequest
} from "../types/longWorkspace";
import type { LongWorldbuildingSyncBookOption } from "../utils/longWorldbuildingSync";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";
import LongImpactConfirmationDetails from "./LongImpactConfirmationDetails.vue";
import LongStructureDeleteDialog from "./LongStructureDeleteDialog.vue";
import LongWorldbuildingSyncDialog from "./LongWorldbuildingSyncDialog.vue";

import BookManagementRowActions from "./book-management/BookManagementRowActions.vue";
import BookManagementChildDialog from "./book-management/BookManagementChildDialog.vue";
import BookManagementDialog, {
  type BookManagementSection
} from "./book-management/BookManagementDialog.vue";
import WritingContextPanel, {
  type WritingContextSaveCompletion
} from "./WritingContextPanel.vue";

const t = createScopedTranslator("components.longStructureManager");
const actionT = createScopedTranslator("components.longBookActionMenu");
const contextT = createScopedTranslator("components.writingContextPanel");
const bookT = createScopedTranslator("components.createBookDialog");

type BookManagementAction = "rename" | "sync-legacy" | "resolve-conflicts";

type StructurePanel =
  "worldbuilding" | "characterTypes" | "features" | "agents";

type ManagerRow = LongStructureDeleteRow;

interface StructureDraft {
  id: string | null;
  title: string;
  format: LongWorldbuildingFormat;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    bookTitle: string;
    bookId?: string | null;
    snapshot: LongWorkspaceIndexSnapshot | null;
    showBookActions?: boolean;
    childOpen?: boolean;
    agentsMd?: string | null | undefined;
    agentsMdPending?: boolean;
    syncBookOptions?: readonly LongWorldbuildingSyncBookOption[] | undefined;
    pending?: boolean;
  }>(),
  {
    bookId: null,
    agentsMd: null,
    agentsMdPending: false,
    syncBookOptions: () => [],
    pending: false
  }
);

const emit = defineEmits<{
  mutation: [
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ];
  syncWorldbuilding: [
    payload: LongWorldbuildingSyncRequest,
    completion: LongWorldbuildingSyncCompletion
  ];
  saveAgentsMd: [content: string, completion: LongStructureMutationCompletion];
  close: [];
  bookAction: [action: BookManagementAction];
}>();
const formatOptions: readonly PopupSelectOption[] = [
  {
    value: "list",
    get label() {
      return t("entryList");
    }
  },
  {
    value: "text",
    get label() {
      return t("continuousText");
    }
  }
];
const worldbuildingItemLayoutOptions: readonly PopupSelectOption[] = [
  {
    value: "top-tabs",
    get label() {
      return t("horizontalTabsAbove");
    }
  },
  {
    value: "right-list",
    get label() {
      return t("verticalListOnTheRight");
    }
  },
  {
    value: "left-tree",
    get label() {
      return t("treeOnTheLeft");
    }
  }
];

const sections = computed<BookManagementSection<StructurePanel>[]>(() => [
  {
    id: "worldbuilding",
    group: "structure",
    label: t("worldbuildingCategory"),
    description: t(
      "reorderingChangesOnlyTheDisplayOrderOfWorldbuildingCategories"
    )
  },
  {
    id: "characterTypes",
    group: "structure",
    label: t("characterType"),
    description: t(
      "characterTypesManageCategoriesOnlyCharacterContentAlwaysUses"
    )
  },
  {
    id: "features",
    group: "settings",
    label: t("featureSettings"),
    description: t("featureSettingsDescription")
  },
  {
    id: "agents",
    group: "context",
    label: contextT("novelContext"),
    description: t(
      "describeTheRolesOfWorldbuildingCharactersPlotPointsManuscript"
    )
  }
]);
const activePanel = ref<StructurePanel>("worldbuilding");
const contextPanel = ref<InstanceType<typeof WritingContextPanel>>();
const formOpen = ref(false);
const formMode = ref<"create" | "edit">("create");
const syncOpen = ref(false);
const selectedSyncBookId = ref<string>("");
const syncPreparedChange = ref<LongWorldbuildingSyncPreparedChange | null>(
  null
);
type MutationSurface = "form" | "sync" | "background" | "agents";
const pendingMutation = ref<{
  id: number;
  surface: MutationSurface;
} | null>(null);
let mutationClock = 0;
const {
  pendingDelete,
  moveCharactersToTypeId,
  characterTypeDeleteMode,
  submitting: deleteSubmitting,
  deletingCharacterCount,
  deletingLastCharacterType,
  characterTypeMoveOptions,
  pendingWorldbuildingDeleteDescription,
  openDelete,
  closeDelete,
  setMoveCharactersToTypeId,
  setCharacterTypeDeleteMode,
  confirmDelete
} = useLongStructureDeleteConfirmation({
  snapshot: computed(() => props.snapshot),
  locked: () => props.pending || pendingMutation.value !== null,
  mutate: (batch, completion) => emit("mutation", batch, completion),
  notify: uiMessage
});
const mutationLocked = computed(
  () =>
    props.pending || pendingMutation.value !== null || deleteSubmitting.value
);
const activeModal = computed<"form" | "sync" | "delete" | null>(() =>
  formOpen.value
    ? "form"
    : syncOpen.value
      ? "sync"
      : pendingDelete.value
        ? "delete"
        : null
);

const selectedSyncBook = computed(
  () =>
    props.syncBookOptions.find(
      (book) => book.id === selectedSyncBookId.value
    ) ?? null
);
function emptyDraft(): StructureDraft {
  return {
    id: null,
    title: "",
    format: "text"
  };
}

const draft = reactive<StructureDraft>(emptyDraft());
const {
  pendingFormImpact,
  clearPendingFormImpact,
  capturePendingFormImpact,
  confirmedFormBatch
} = useLongStructureFormImpact({
  fields: () => [draft.title, draft.format] as const,
  mutationPending: () => pendingMutation.value !== null
});

const worldbuildingRows = computed<ManagerRow[]>(() =>
  [...(props.snapshot?.worldbuilding ?? [])]
    .sort((left, right) => left.order - right.order)
    .map((category) => ({
      kind: "worldbuilding" as const,
      id: category.id,
      title: category.title,
      detail: category.format === "list" ? t("entryList") : t("continuousText"),
      readOnly: isLongMigrationEvidenceCategoryId(category.id)
    }))
);

const characterTypeRows = computed<ManagerRow[]>(() =>
  [...(props.snapshot?.characterTypes ?? [])]
    .sort((left, right) => left.order - right.order)
    .map((characterType) => {
      const count =
        props.snapshot?.characters.filter(
          ({ group }) => group === characterType.id
        ).length ?? 0;
      return {
        kind: "characterType" as const,
        id: characterType.id,
        title: characterType.title,
        detail: t("continuousTextValueCharacters", { arg0: count })
      };
    })
);
const rows = computed(() =>
  activePanel.value === "worldbuilding"
    ? worldbuildingRows.value
    : characterTypeRows.value
);
const formTitle = computed(() =>
  activePanel.value === "characterTypes"
    ? formMode.value === "create"
      ? t("newCharacterType")
      : t("editCharacterType")
    : formMode.value === "create"
      ? t("newWorldbuildingCategory")
      : t("editWorldbuildingCategory")
);

async function setPanel(panel: StructurePanel): Promise<void> {
  if (
    panel === activePanel.value ||
    mutationLocked.value ||
    !(await flushContext())
  )
    return;
  activePanel.value = panel;
}

async function flushContext(): Promise<boolean> {
  return (await contextPanel.value?.flushIfNeeded()) ?? true;
}

async function close(): Promise<void> {
  if (!props.pending && (await flushContext())) emit("close");
}

async function activateBookAction(action: BookManagementAction): Promise<void> {
  if (
    props.pending ||
    (action !== "resolve-conflicts" && !(await flushContext()))
  )
    return;
  emit("bookAction", action);
}

function setFormat(value: PopupSelectValue): void {
  if (value === "list" || value === "text") {
    draft.format = value;
  }
}

function setWorldbuildingItemLayout(value: PopupSelectValue): void {
  if (
    (value !== "top-tabs" && value !== "right-list" && value !== "left-tree") ||
    value === props.snapshot?.featureSettings.worldbuildingItemLayout
  ) {
    return;
  }
  emitMutation((builder) =>
    builder.updateFeatureSettings({
      worldbuildingItemLayout: value as LongWorldbuildingItemLayout
    })
  );
}

function setCharacterAndContinuityItemLayout(value: PopupSelectValue): void {
  if (
    (value !== "top-tabs" && value !== "right-list" && value !== "left-tree") ||
    value === props.snapshot?.featureSettings.characterAndContinuityItemLayout
  ) {
    return;
  }
  emitMutation((builder) =>
    builder.updateFeatureSettings({
      characterAndContinuityItemLayout: value as LongWorldbuildingItemLayout
    })
  );
}

function setPlotItemLayout(value: PopupSelectValue): void {
  if (
    (value !== "top-tabs" && value !== "right-list" && value !== "left-tree") ||
    value === props.snapshot?.featureSettings.plotItemLayout
  ) {
    return;
  }
  emitMutation((builder) =>
    builder.updateFeatureSettings({
      plotItemLayout: value as LongWorldbuildingItemLayout
    })
  );
}

function resetDraft(): void {
  Object.assign(draft, emptyDraft());
}

function openCreate(): void {
  resetDraft();
  clearPendingFormImpact();
  formMode.value = "create";
  formOpen.value = true;
}

function openEdit(row: ManagerRow): void {
  if (row.readOnly) {
    uiMessage.info(t("migrationEvidenceIsReadOnlyItCannotBeRenamed"));
    return;
  }
  resetDraft();
  clearPendingFormImpact();
  formMode.value = "edit";
  if (row.kind === "characterType") {
    const characterType = props.snapshot?.characterTypes.find(
      (candidate) => candidate.id === row.id
    );
    if (!characterType) return;
    draft.id = characterType.id;
    draft.title = characterType.title;
    draft.format = "text";
  } else {
    const category = props.snapshot?.worldbuilding.find(
      (candidate) => candidate.id === row.id
    );
    if (!category) return;
    draft.id = category.id;
    draft.title = category.title;
    draft.format = category.format;
  }
  formOpen.value = true;
}

function closeForm(): void {
  if (mutationLocked.value) return;
  formOpen.value = false;
  clearPendingFormImpact();
}

function finishMutation(
  requestId: number,
  outcome: "succeeded" | "failed" | "applied-refresh-failed"
): void {
  const pending = pendingMutation.value;
  if (!pending || pending.id !== requestId) return;
  pendingMutation.value = null;
  if (outcome === "failed") return;
  if (pending.surface === "form") {
    formOpen.value = false;
    clearPendingFormImpact();
  } else if (pending.surface === "sync") {
    syncOpen.value = false;
    selectedSyncBookId.value = "";
    syncPreparedChange.value = null;
  }
}

function openSync(): void {
  if (mutationLocked.value) return;
  const source = props.syncBookOptions.find((book) => book.id !== props.bookId);
  if (!source) {
    uiMessage.warning(t("noOtherNovelsAreAvailableToSync"));
    return;
  }
  selectedSyncBookId.value = source.id;
  syncPreparedChange.value = null;
  syncOpen.value = true;
}

function closeSync(): void {
  if (mutationLocked.value) return;
  syncOpen.value = false;
  selectedSyncBookId.value = "";
  syncPreparedChange.value = null;
}

function setSyncBook(value: PopupSelectValue): void {
  selectedSyncBookId.value = typeof value === "string" ? value : "";
  syncPreparedChange.value = null;
}

function confirmSync(): void {
  if (mutationLocked.value) return;
  const source = selectedSyncBook.value;
  if (!source) {
    uiMessage.warning(t("selectANovelToSync"));
    return;
  }
  if (source.categoryCount <= 0) {
    uiMessage.warning(t("theSelectedNovelHasNoWorldbuildingCategoriesToSync"));
    return;
  }
  const prepared = syncPreparedChange.value;
  const requestId = ++mutationClock;
  pendingMutation.value = { id: requestId, surface: "sync" };
  emit(
    "syncWorldbuilding",
    {
      sourceBookId: source.id,
      sourceTitle: source.title,
      ...(prepared ? { prepared } : {})
    },
    {
      succeed: () => finishMutation(requestId, "succeeded"),
      fail: (_message, changedImpact) => {
        finishMutation(requestId, "failed");
        if (!changedImpact || !prepared) return;
        syncPreparedChange.value = {
          ...prepared,
          confirmation: changedImpact
        };
      },
      appliedButRefreshFailed: () =>
        finishMutation(requestId, "applied-refresh-failed"),
      review: (nextPrepared) => {
        const pending = pendingMutation.value;
        if (!pending || pending.id !== requestId) return;
        pendingMutation.value = null;
        syncPreparedChange.value = nextPrepared;
      }
    }
  );
}

function emitMutation(
  build: (builder: LongStructureMutationBuilder) => LongWorkspaceOperationBatch,
  surface: MutationSurface = "background"
): boolean {
  if (mutationLocked.value || !props.snapshot) return false;
  try {
    const batch = build(createLongStructureMutationBuilder(props.snapshot));
    return applyMutationBatch(batch, surface);
  } catch (error) {
    uiMessage.warning(
      formatError(error, t("couldNotGenerateNovelStructureChanges"))
    );
    return false;
  }
}

function applyMutationBatch(
  batch: LongWorkspaceOperationBatch,
  surface: MutationSurface
): boolean {
  if (mutationLocked.value) return false;
  const requestId = ++mutationClock;
  pendingMutation.value = { id: requestId, surface };
  emit("mutation", batch, {
    succeed: () => finishMutation(requestId, "succeeded"),
    fail: (_message, changedImpact) => {
      finishMutation(requestId, "failed");
      if (surface === "form" && changedImpact) {
        capturePendingFormImpact(batch, changedImpact);
      }
    },
    appliedButRefreshFailed: () =>
      finishMutation(requestId, "applied-refresh-failed")
  });
  return true;
}

function submitForm(): void {
  const title = draft.title.trim();
  if (!title) {
    uiMessage.warning(t("enterATitle"));
    return;
  }

  const confirmed = confirmedFormBatch();
  if (confirmed) {
    applyMutationBatch(confirmed, "form");
    return;
  }

  emitMutation((builder) => {
    if (activePanel.value === "characterTypes") {
      if (formMode.value === "create") {
        return builder.createCharacterType({ title });
      }
      if (!draft.id) throw new Error(t("theCharacterTypeSStableIDIsMissing"));
      return builder.updateCharacterType(draft.id, { title });
    }
    if (formMode.value === "create") {
      return builder.createWorldbuilding({
        title,
        format: draft.format
      });
    }
    if (!draft.id) {
      throw new Error(t("theEntrySStableIDIsMissing"));
    }
    return builder.updateWorldbuilding(draft.id, {
      title,
      format: draft.format
    });
  }, "form");
}

function canMove(row: ManagerRow, direction: LongOrderDirection): boolean {
  if (row.readOnly) return false;
  const index = rows.value.findIndex((candidate) => candidate.id === row.id);
  return direction === "up"
    ? index > 0
    : index >= 0 && index < rows.value.length - 1;
}

function reorder(row: ManagerRow, direction: LongOrderDirection): void {
  if (row.readOnly) {
    uiMessage.info(t("migrationEvidenceHasAFixedOrderAndCannotBe"));
    return;
  }
  emitMutation((builder) =>
    row.kind === "characterType"
      ? builder.reorderCharacterType(row.id, direction)
      : builder.reorderWorldbuilding(row.id, direction)
  );
}

function saveAgentsMd(
  content: string,
  completion: WritingContextSaveCompletion
): void {
  if (mutationLocked.value || props.agentsMdPending) {
    completion.fail();
    return;
  }
  const requestId = ++mutationClock;
  pendingMutation.value = { id: requestId, surface: "agents" };
  emit("saveAgentsMd", content, {
    succeed: () => {
      finishMutation(requestId, "succeeded");
      completion.succeed();
      uiMessage.success(t("novelContextSaved"));
    },
    fail: () => {
      finishMutation(requestId, "failed");
      completion.fail();
    },
    appliedButRefreshFailed: () => {
      finishMutation(requestId, "applied-refresh-failed");
      completion.succeed();
    }
  });
}
</script>

<template>
  <BookManagementDialog
    :open="open"
    :book-title="bookTitle"
    :book-type="bookT('novel')"
    :sections="sections"
    :active="activePanel"
    :pending="pending"
    :child-open="childOpen || Boolean(activeModal)"
    @close="close"
    @rename="activateBookAction('rename')"
    @select="setPanel"
  >
    <template #actions>
      <template
        v-if="
          snapshot &&
          (activePanel === 'worldbuilding' || activePanel === 'characterTypes')
        "
      >
        <button
          v-if="activePanel === 'worldbuilding'"
          class="dialog-secondary-button"
          type="button"
          :disabled="mutationLocked"
          @click="openSync"
        >
          {{ t("loadWorldbuildingFromAnotherBook") }}
        </button>
        <button
          class="dialog-primary-button"
          type="button"
          :disabled="mutationLocked"
          @click="openCreate"
        >
          {{
            activePanel === "characterTypes"
              ? t("newCharacterType")
              : t("newWorldbuildingCategory")
          }}
        </button>
      </template>
    </template>

    <p v-if="!snapshot" class="dialog-description" role="status">
      {{ t("readingStructure") }}
    </p>
    <template
      v-else-if="
        activePanel === 'worldbuilding' || activePanel === 'characterTypes'
      "
    >
      <div v-if="rows.length === 0" class="book-management-note">
        <p>
          {{
            activePanel === "characterTypes"
              ? t("noCharacterTypesYetCreateTheFirstOne")
              : t("noWorldbuildingCategoriesYetCreateTheFirstOne")
          }}
        </p>
        <p>
          {{
            activePanel === "characterTypes"
              ? t(
                  "characterTypesManageCategoriesOnlyCharacterContentAlwaysUses"
                )
              : t("creationGeneratesStableIDsAndAllMatchingEmptyFile")
          }}
        </p>
      </div>

      <ol v-else class="book-management-list">
        <li v-for="row in rows" :key="row.id" class="book-management-row">
          <div class="book-management-copy">
            <strong :title="row.title">{{ row.title }}</strong>
            <span>
              {{ row.detail
              }}{{ row.readOnly ? t("readOnlyMigrationEvidence") : "" }}
            </span>
            <code>{{ row.id }}</code>
          </div>
          <BookManagementRowActions
            :title="row.title"
            :pending="mutationLocked"
            :up-disabled="!canMove(row, 'up')"
            :down-disabled="!canMove(row, 'down')"
            :edit-disabled="row.readOnly"
            :delete-disabled="row.readOnly"
            @move="reorder(row, $event)"
            @edit="openEdit(row)"
            @delete="openDelete(row)"
          />
        </li>
      </ol>

      <p v-if="activePanel === 'characterTypes'" class="book-management-note">
        {{ t("reorderingChangesOnlyTheDisplayOrderOfCharacterTypes") }}
      </p>
    </template>
    <div
      v-else-if="activePanel === 'features'"
      class="book-management-settings"
    >
      <section class="book-management-setting">
        <div class="book-management-copy">
          <strong>{{ t("worldbuildingEntryLayout") }}</strong>
          <span>
            {{ t("chooseTheLayoutForOverviewsAndEntriesInList") }}
          </span>
        </div>
        <PopupSelect
          :model-value="snapshot.featureSettings.worldbuildingItemLayout"
          :options="worldbuildingItemLayoutOptions"
          :accessible-label="t('selectWorldbuildingEntryLayout')"
          :disabled="mutationLocked"
          :menu-z-index="2300"
          @update:model-value="setWorldbuildingItemLayout"
        />
      </section>
      <section class="book-management-setting">
        <div class="book-management-copy">
          <strong>{{ t("characterAndContinuityLayout") }}</strong>
          <span>
            {{ t("chooseASharedLayoutForCharacterCollectionsAndContinuity") }}
          </span>
        </div>
        <PopupSelect
          :model-value="
            snapshot.featureSettings.characterAndContinuityItemLayout
          "
          :options="worldbuildingItemLayoutOptions"
          :accessible-label="t('selectCharacterAndContinuityLayout')"
          :disabled="mutationLocked"
          :menu-z-index="2300"
          @update:model-value="setCharacterAndContinuityItemLayout"
        />
      </section>
      <section class="book-management-setting">
        <div class="book-management-copy">
          <strong>{{ t("plotDesignEntryLayout") }}</strong>
          <span>
            {{ t("chooseTheLayoutForTheOverallStorylinePlotPoints") }}
          </span>
        </div>
        <PopupSelect
          :model-value="snapshot.featureSettings.plotItemLayout"
          :options="worldbuildingItemLayoutOptions"
          :accessible-label="t('selectPlotDesignEntryLayout')"
          :disabled="mutationLocked"
          :menu-z-index="2300"
          @update:model-value="setPlotItemLayout"
        />
      </section>
    </div>
    <WritingContextPanel
      v-else
      ref="contextPanel"
      workspace-type="long"
      :content="agentsMd"
      :loading="agentsMdPending && agentsMd === null"
      :pending="agentsMdPending || pendingMutation?.surface === 'agents'"
      @save="saveAgentsMd"
    />

    <BookManagementChildDialog
      v-if="activeModal === 'form'"
      :title="formTitle"
      :pending="mutationLocked"
      @close="closeForm"
      @submit="submitForm"
    >
      <label class="book-management-field">
        <span>{{ t("title") }}</span>
        <input
          v-model="draft.title"
          maxlength="256"
          autocomplete="off"
          autofocus
          required
        />
      </label>
      <label
        v-if="activePanel === 'worldbuilding'"
        class="book-management-field"
      >
        <span>{{ t("contentFormat") }}</span>
        <PopupSelect
          :model-value="draft.format"
          :options="formatOptions"
          :accessible-label="t('selectWorldbuildingContentFormat')"
          :menu-z-index="2300"
          @update:model-value="setFormat"
        />
      </label>
      <LongImpactConfirmationDetails
        v-if="pendingFormImpact"
        :confirmation="pendingFormImpact.confirmation"
        :fallback="t('changingTheFormatPreservesExistingChildContent')"
      />
      <template #actions>
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="mutationLocked"
          @click="closeForm"
        >
          {{ t("cancel") }}
        </button>
        <button
          class="dialog-primary-button"
          type="submit"
          :disabled="mutationLocked"
        >
          {{
            pendingMutation?.surface === "form"
              ? t("saving")
              : pendingFormImpact
                ? t("convertAndSaveWithTheImpactShown")
                : formMode === "create"
                  ? t("create")
                  : t("saveChanges")
          }}
        </button>
      </template>
    </BookManagementChildDialog>
    <LongWorldbuildingSyncDialog
      :open="activeModal === 'sync'"
      :current-book-id="bookId"
      :selected-book-id="selectedSyncBookId"
      :book-options="syncBookOptions"
      :prepared="syncPreparedChange"
      :locked="mutationLocked"
      :pending="pendingMutation?.surface === 'sync'"
      @close="closeSync"
      @confirm="confirmSync"
      @update:selected-book-id="setSyncBook"
    />

    <LongStructureDeleteDialog
      :open="activeModal === 'delete'"
      :target="pendingDelete"
      :locked="mutationLocked"
      :pending="deleteSubmitting"
      :worldbuilding-fallback="pendingWorldbuildingDeleteDescription"
      :character-count="deletingCharacterCount"
      :last-character-type="deletingLastCharacterType"
      :character-delete-mode="characterTypeDeleteMode"
      :move-target-id="moveCharactersToTypeId"
      :move-options="characterTypeMoveOptions"
      @close="closeDelete"
      @confirm="confirmDelete"
      @update:character-delete-mode="setCharacterTypeDeleteMode"
      @update:move-target-id="setMoveCharactersToTypeId"
    />
    <slot name="child" />

    <template v-if="showBookActions" #footer>
      <button
        class="dialog-secondary-button"
        type="button"
        :disabled="pending"
        @click="activateBookAction('sync-legacy')"
      >
        {{ actionT("syncLegacyVersion") }}
      </button>
      <button
        class="dialog-secondary-button"
        type="button"
        :title="actionT('keepChangesOnDiskResolveFileConflictsAndRefresh')"
        :disabled="pending"
        @click="activateBookAction('resolve-conflicts')"
      >
        {{ actionT("resolveConflicts") }}
      </button>
    </template>
  </BookManagementDialog>
</template>
