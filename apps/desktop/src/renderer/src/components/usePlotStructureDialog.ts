import { createScopedTranslator } from "../i18n";
import { computed, reactive, ref, watch } from "vue";
import {
  isBuiltinCreativePlotStageId,
  type Book,
  type BookCharacterFormat,
  type CharacterStructureMutation,
  type PlotStructureMutation
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import type { PopupSelectValue } from "./PopupSelect.vue";

const t = createScopedTranslator("components.usePlotStructureDialog");

export interface PlotStructureMutationCompletion {
  succeed(): void;
  fail(): void;
}

export interface PlotStructureDialogProps {
  open: boolean;
  book: Book | null;
  pending: boolean;
  writingContext: string | null;
  writingContextLoading: boolean;
  writingContextPending: boolean;
}

export type PlotStructureDialogEmit = {
  (event: "close"): void;
  (event: "openRename", bookId: string): void;
  (
    event: "mutation",
    mutation: PlotStructureMutation,
    completion: PlotStructureMutationCompletion
  ): void;
  (
    event: "characterMutation",
    mutation: CharacterStructureMutation,
    completion: PlotStructureMutationCompletion
  ): void;
  (
    event: "saveWritingContext",
    content: string,
    completion: PlotStructureMutationCompletion
  ): void;
};

interface WritingContextPanelHandle {
  flushIfNeeded(): Promise<boolean>;
}

export function usePlotStructureDialog(
  props: Readonly<PlotStructureDialogProps>,
  emit: PlotStructureDialogEmit
) {
  const writingContextPanel = ref<WritingContextPanelHandle | null>(null);
  const formOpen = ref(false);
  const formMode = ref<"create" | "edit">("create");
  const editingStageId = ref<string | null>(null);
  const deletingStageId = ref<string | null>(null);
  const localPending = ref(false);
  const activeStructureTab = ref<"character" | "plot" | "context">("character");
  const requestedCharacterFormat = ref<BookCharacterFormat | null>(null);
  const form = reactive({ title: "", description: "" });

  const creativeBook = computed(() =>
    props.book && props.book.bookType !== "academic" ? props.book : null
  );
  const locked = computed(
    () => props.pending || props.writingContextPending || localPending.value
  );
  const rows = computed(() => creativeBook.value?.plotStages ?? []);
  const deletingStage = computed(() =>
    rows.value.find(({ id }) => id === deletingStageId.value)
  );
  const deletingDocument = computed(() =>
    creativeBook.value?.documents.find(({ id }) => id === deletingStageId.value)
  );
  const deletingHasContent = computed(() =>
    Boolean(deletingDocument.value?.content.trim())
  );
  const characterOverview = computed(() =>
    creativeBook.value?.documents.find(({ id }) => id === "character_design")
  );
  const orderedCharacterItems = computed(() =>
    creativeBook.value?.characterStructure.format === "list"
      ? [...creativeBook.value.characterStructure.items].sort(
          (left, right) => left.order - right.order
        )
      : []
  );
  const characterTextPreview = computed(() => {
    const text = characterOverview.value?.content.trim() ?? "";
    if (!text) return t("theCurrentCharacterTextIsEmptyAndWillBecome");
    return text.length > 500 ? `${text.slice(0, 500)}\n……` : text;
  });
  const activeSubdialog = computed<
    "character-format" | "form" | "delete" | null
  >(() =>
    requestedCharacterFormat.value
      ? "character-format"
      : formOpen.value
        ? "form"
        : deletingStage.value
          ? "delete"
          : null
  );

  function resetPanels(): void {
    formOpen.value = false;
    editingStageId.value = null;
    deletingStageId.value = null;
    form.title = "";
    form.description = "";
    requestedCharacterFormat.value = null;
  }

  async function flushWritingContext(): Promise<boolean> {
    if (activeStructureTab.value !== "context") return true;
    return (await writingContextPanel.value?.flushIfNeeded()) ?? true;
  }

  async function close(): Promise<void> {
    if (locked.value) return;
    if (formOpen.value || deletingStageId.value) {
      resetPanels();
      return;
    }
    if (!(await flushWritingContext())) return;
    emit("close");
  }

  async function setActiveStructureTab(
    tab: "character" | "plot" | "context"
  ): Promise<void> {
    if (tab === activeStructureTab.value || locked.value) return;
    if (!(await flushWritingContext())) return;
    activeStructureTab.value = tab;
  }

  function openCreate(): void {
    if (locked.value) return;
    deletingStageId.value = null;
    formMode.value = "create";
    editingStageId.value = null;
    form.title = "";
    form.description = "";
    formOpen.value = true;
  }

  function openEdit(stageId: string): void {
    if (locked.value) return;
    const stage = rows.value.find(({ id }) => id === stageId);
    if (!stage) return;
    deletingStageId.value = null;
    formMode.value = "edit";
    editingStageId.value = stage.id;
    form.title = stage.title;
    form.description = stage.description;
    formOpen.value = true;
  }

  function beginMutation(mutation: PlotStructureMutation): void {
    if (locked.value) return;
    localPending.value = true;
    emit("mutation", mutation, {
      succeed: () => {
        localPending.value = false;
        resetPanels();
      },
      fail: () => {
        localPending.value = false;
      }
    });
  }

  function selectCharacterFormat(value: PopupSelectValue): void {
    if ((value !== "text" && value !== "list") || locked.value) return;
    if (value === creativeBook.value?.characterStructure.format) return;
    requestedCharacterFormat.value = value;
  }

  function confirmCharacterFormat(): void {
    const format = requestedCharacterFormat.value;
    if (!format || locked.value) return;
    localPending.value = true;
    emit(
      "characterMutation",
      { type: "setFormat", format },
      {
        succeed: () => {
          localPending.value = false;
          requestedCharacterFormat.value = null;
        },
        fail: () => {
          localPending.value = false;
        }
      }
    );
  }

  function submitForm(): void {
    const title = form.title.trim();
    const description = form.description.trim();
    if (!title) {
      uiMessage.warning(t("enterAPlotStructureName"));
      return;
    }
    if (!description) {
      uiMessage.warning(t("enterStructureNotesToDefineTheAgentSStage"));
      return;
    }
    if (
      rows.value.some(
        (stage) =>
          stage.id !== editingStageId.value &&
          stage.title.toLocaleLowerCase() === title.toLocaleLowerCase()
      )
    ) {
      uiMessage.warning(
        t("plotStructureValueAlreadyExists", {
          arg0: title
        })
      );
      return;
    }
    if (formMode.value === "create") {
      beginMutation({ type: "create", title, description });
      return;
    }
    if (!editingStageId.value) return;
    beginMutation({
      type: "update",
      stageId: editingStageId.value,
      title,
      description
    });
  }

  function move(stageId: string, direction: "up" | "down"): void {
    beginMutation({ type: "move", stageId, direction });
  }

  function reorder(
    stageId: string,
    anchorId: string,
    position: "before" | "after"
  ): void {
    beginMutation({ type: "reorder", stageId, anchorId, position });
  }

  function toggleEnabled(stageId: string, enabled: boolean): void {
    if (locked.value) return;
    if (
      !enabled &&
      !rows.value.some((stage) => stage.id !== stageId && stage.enabled)
    ) {
      uiMessage.warning(t("keepAtLeastOneEnabledPlotStructureItem"));
      return;
    }
    beginMutation({ type: "setEnabled", stageId, enabled });
  }

  function openDelete(stageId: string): void {
    if (locked.value) return;
    if (isBuiltinCreativePlotStageId(stageId)) {
      uiMessage.warning(t("defaultPlotStructuresCannotBeDeletedDisableThemTo"));
      return;
    }
    if (rows.value.length <= 1) {
      uiMessage.warning(t("keepAtLeastOnePlotStructureItem"));
      return;
    }
    formOpen.value = false;
    deletingStageId.value = stageId;
  }

  function confirmDelete(): void {
    const stage = deletingStage.value;
    if (!stage) return;
    if (isBuiltinCreativePlotStageId(stage.id)) {
      uiMessage.warning(t("defaultPlotStructuresCannotBeDeleted"));
      return;
    }
    beginMutation({ type: "delete", stageId: stage.id, deleteContent: true });
  }

  watch(
    () => props.open,
    (open) => {
      if (!open) return;
      activeStructureTab.value = "character";
      resetPanels();
    }
  );

  function saveWritingContext(
    content: string,
    completion: PlotStructureMutationCompletion
  ): void {
    emit("saveWritingContext", content, completion);
  }

  return {
    activeStructureTab,
    activeSubdialog,
    characterOverview,
    characterTextPreview,
    close,
    confirmCharacterFormat,
    confirmDelete,
    deletingHasContent,
    deletingStage,
    form,
    formMode,
    flushWritingContext,
    isBuiltinCreativePlotStageId,
    locked,
    move,
    openCreate,
    openDelete,
    openEdit,
    orderedCharacterItems,
    reorder,
    requestedCharacterFormat,
    rows,
    saveWritingContext,
    selectCharacterFormat,
    setActiveStructureTab,
    submitForm,
    toggleEnabled,
    writingContextPanel
  };
}
