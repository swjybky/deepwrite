<script setup lang="ts">
import { createScopedTranslator, t as translate } from "../i18n";
import {
  computed,
  defineAsyncComponent,
  inject,
  nextTick,
  onBeforeUnmount,
  onBeforeUpdate,
  onMounted,
  onUpdated,
  ref,
  watch
} from "vue";
import {
  CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS,
  CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS,
  type BodyTextKind,
  type TextViewMode
} from "@deepwrite/contracts";
import type {
  EditorTextReference,
  EditorTextReferenceNavigation
} from "../types/conversation";
import type {
  EditorEntrySearchSource,
  EditorEntrySearchResult
} from "../types/editorEntrySearch";
import type {
  DraftFileKind,
  EditorDraftState,
  WorkspaceDocument
} from "../types/workspace";
import { resolveEditorTextReferenceRange } from "../utils/editorTextReferences";
import {
  editorScrollMemoryKey,
  rememberEditorScrollPosition,
  type EditorScrollView
} from "../utils/editorScrollMemory";
import {
  countNonWhitespaceCharacters,
  createBoundedTextHistory,
  type TextHistoryRestoreResult,
  type TextSelectionRange
} from "../utils/boundedTextHistory";
import {
  resolveWorkspaceDocumentTitle,
  workspaceDocumentHasFixedTitle
} from "../utils/fixedWorkspaceDocumentTitle";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { handleHorizontalOverflowWheel } from "../utils/horizontalOverflow";
import { uiMessage } from "../ui-feedback";
import { useEditorSelectionInsertion } from "../composables/useEditorSelectionInsertion";
import { useEditorSaveViewport } from "../composables/useEditorSaveViewport";
import {
  useEditorComposition,
  type EditorCompositionChange
} from "../composables/useEditorComposition";
import { useLongEditorScrollMemory } from "../composables/useLongEditorScrollMemory";
import {
  searchLocalEditorEntries,
  useEditorEntrySearch
} from "../composables/useEditorEntrySearch";
import { useTextViewMode } from "../composables/useTextViewMode";
import { useEditorFindReplace } from "../composables/useEditorFindReplace";
import { revealTextareaOffset } from "../utils/textareaMirror";
import { richMarkdownEditorAt } from "../utils/richMarkdownBridge";
import AppIcon from "./AppIcon.vue";
import EditorTextTools from "./EditorTextTools.vue";
import {
  useEditorDocumentVersions,
  type EditorDocumentVersionPort
} from "../composables/useEditorDocumentVersions";
import { CATALOG_DOCUMENT_VERSION_PORT } from "../composables/catalogDocumentVersionPort";
import { useBodyTextFormatting } from "../composables/useBodyTextFormatting";
import { catalogBodyTextKind } from "../utils/bodyTextTarget";
import EditorPaneToggle from "./EditorPaneToggle.vue";
import CatalogEditorFooterMeta from "./CatalogEditorFooterMeta.vue";
import EditorDocumentMetadata from "./EditorDocumentMetadata.vue";
import EditorSearchHighlight from "./EditorSearchHighlight.vue";
import EditableMarkdownPreview from "./EditableMarkdownPreview.vue";
import { countDocumentCharacters } from "../utils/bookImageText";
import {
  applyMarkdownSourceEdit,
  type MarkdownSourceEdit
} from "../utils/bookImageInsertion";
import {
  useBookImageContext,
  useBookImageResolver
} from "../composables/bookImageContext";
import { useBookImageInsertion } from "../composables/useBookImageInsertion";
import PreviewOutlinePopover from "./PreviewOutlinePopover.vue";
import { AcademicReferenceCardBar } from "./lazyAppComponents";
import { academicTreeT } from "./academic/academicTreeLabels";

const t = createScopedTranslator("components.rightEditorPane");

const DocumentVersionDialog = defineAsyncComponent(
  () => import("./DocumentVersionDialog.vue")
);

const EditorFindReplacePanel = defineAsyncComponent(
  () => import("./EditorFindReplacePanel.vue")
);

const props = defineProps<{
  document: WorkspaceDocument;
  resourceId: string;
  draftState: EditorDraftState | undefined;
  locateReference?: EditorTextReferenceNavigation | undefined;
  locked: boolean;
  lockedLabel?: string | undefined;
  saving?: boolean;
  manualSaving?: boolean;
  formatAllPending?: boolean;
  autoSaveEnabled?: boolean;
  defaultViewMode: TextViewMode;
  boundToCurrentBook?: boolean;
  sectionTabs?: readonly { id: string; title: string }[];
  activeSectionId?: string | undefined;
  sectionTabsLabel?: string | undefined;
  canCreateSection?: boolean;
  createSectionLabel?: string | undefined;
  showDeleteSection?: boolean;
  canDeleteSection?: boolean;
  deleteSectionLabel?: string | undefined;
  rightPane?: boolean;
  rightPaneCollapsed?: boolean;
  entrySearchItems?: readonly EditorEntrySearchSource[] | undefined;
  bodyFormatKind?: BodyTextKind | undefined;
  searchEntries?(query: string): Promise<readonly EditorEntrySearchResult[]>;
  versioning?: EditorDocumentVersionPort | undefined;
}>();

const emit = defineEmits<{
  collapse: [];
  toggleRight: [];
  save: [payload: { id: string; title: string; content: string }];
  liveChange: [payload: { id: string; title: string; content: string }];
  compositionChange: [change: EditorCompositionChange];
  formatAllBodies: [];
  insertSelection: [reference: EditorTextReference];
  selectSection: [sectionId: string];
  createSection: [];
  deleteSection: [];
  selectDraftFile: [fileKind: DraftFileKind];
  selectEntrySearchResult: [documentId: string];
  prepareEntrySearch: [];
}>();

const bookImageContext = useBookImageContext();
function countEditorCharacters(value: string): number {
  return bookImageContext.value
    ? countDocumentCharacters(value)
    : countNonWhitespaceCharacters(value);
}
const editorInput = ref<HTMLTextAreaElement>();
let composingDocumentId: string | undefined;
const editorComposition = useEditorComposition({
  onChange(composing) {
    if (composing) composingDocumentId = props.document.id;
    if (composingDocumentId) {
      emit("compositionChange", { id: composingDocumentId, composing });
    }
    if (!composing) composingDocumentId = undefined;
  }
});
const documentPreview = ref<HTMLElement | null>(null);
const title = ref(
  resolveWorkspaceDocumentTitle(props.document, props.draftState?.title)
);
const content = ref(props.draftState?.content ?? props.document.content);
const nonWhitespaceCharacterCount = ref(countEditorCharacters(content.value));
const dirty = ref(props.draftState?.dirty ?? false);
const {
  closeSelectionAction,
  handleEditorContextMenu: handleSelectionEditorContextMenu,
  handlePreviewContextMenu: handleSelectionPreviewContextMenu
} = useEditorSelectionInsertion({
  history: {
    canUndo: () => canUndo.value,
    canRedo: () => canRedo.value,
    undo: () => undo(),
    redo: () => redo()
  },
  source: () => ({
    resourceId: props.resourceId,
    document: {
      ...props.document,
      title: title.value,
      content: content.value
    }
  }),
  insert: (reference) => emit("insertSelection", reference)
});
const { resetToDefault, setViewMode, viewMode } = useTextViewMode({
  defaultMode: () => props.defaultViewMode
});
const {
  findPanelElement,
  findInput,
  findPanelOpen,
  findPanelMode,
  searchQuery,
  replacementText,
  currentMatchIndex,
  searchMatches,
  searchResultLabel,
  closeFindPanel,
  dismissFindPanel,
  toggleFindPanel,
  findMatch,
  handleFindInput,
  replaceCurrentMatch,
  replaceAllMatches,
  handleEditorKeydown
} = useEditorFindReplace({
  content: () => content.value,
  readOnly: () => editorReadOnly.value,
  editorInput: () => editorInput.value,
  preview: () => richMarkdownEditorAt(documentPreview.value),
  showEditor: () => setViewMode("edit"),
  onOpen: () => {
    closeSelectionAction();
    emit("prepareEntrySearch");
  },
  replaceContent: (nextContent, selectionAfter) =>
    updateContent(
      nextContent,
      recordProgrammaticChange(nextContent, selectionAfter)
    ),
  undo,
  redo,
  save: () => {
    if (dirty.value && !props.manualSaving) save();
  },
  isComposing: () => editorComposition.isComposing.value
});
const entrySearch = useEditorEntrySearch({
  search: (query) =>
    props.searchEntries?.(query) ??
    searchLocalEditorEntries(props.entrySearchItems ?? [], query),
  navigate: ({ id }) => emit("selectEntrySearchResult", id)
});
const {
  query: entrySearchQuery,
  results: entrySearchResults,
  activeIndex: activeEntrySearchIndex,
  pending: entrySearchPending,
  resultLabel: entrySearchResultLabel,
  handleInput: handleEntrySearchInput,
  moveActive: moveActiveEntrySearchResult,
  selectResult: selectEntrySearchResult,
  reset: resetEntrySearch
} = entrySearch;

const textHistory = createBoundedTextHistory();
const historyVersion = ref(0);
let pendingEditorInput: {
  selectionBefore: TextSelectionRange;
  inputType: string;
  timestamp: number;
} | null = null;
const activeScrollMemoryKey = computed(() =>
  editorScrollMemoryKey(props.document)
);
const {
  handleScroll: rememberDocumentScrollEvent,
  rememberScroll: rememberCurrentDocumentScroll,
  restoreScroll: restoreDocumentScroll
} = useLongEditorScrollMemory({
  documentKey: () => activeScrollMemoryKey.value,
  viewMode,
  editorInput,
  documentPreview,
  // This pane remembers the previous section, resets its view mode, then
  // restores the next section. The shared watcher would run in between and
  // store the previous offset on the next document.
  bindIdentityWatch: false
});
const documentScrollbar = createTransientScrollbarController();
const {
  captureBeforeRender: captureEditorViewportBeforeRender,
  preserveForDispatchedSave: preserveEditorViewportForSave,
  restoreAfterRender: restoreEditorViewportAfterRender
} = useEditorSaveViewport({
  editorInput,
  documentKey: activeScrollMemoryKey,
  isEditView: () => viewMode.value === "edit",
  isSaving: () => Boolean(props.saving),
  isComposing: () => editorComposition.isComposing.value,
  isTransientlyReadOnly: () => props.locked,
  rememberScroll: (documentKey, scrollTop) =>
    rememberEditorScrollPosition(documentKey, "edit", scrollTop)
});

onBeforeUpdate(captureEditorViewportBeforeRender);
onUpdated(restoreEditorViewportAfterRender);

watch(activeScrollMemoryKey, (nextScrollMemoryKey, previousScrollMemoryKey) => {
  editorComposition.reset();
  rememberCurrentDocumentScroll(previousScrollMemoryKey);
  title.value = resolveWorkspaceDocumentTitle(
    props.document,
    props.draftState?.title
  );
  content.value = props.draftState?.content ?? props.document.content;
  nonWhitespaceCharacterCount.value = countEditorCharacters(content.value);
  dirty.value = props.draftState?.dirty ?? false;
  const nextViewMode = resetToDefault();
  closeSelectionAction();
  closeFindPanel();
  searchQuery.value = "";
  replacementText.value = "";
  resetEntrySearch();
  resetEditorHistory();
  void restoreDocumentScroll(nextScrollMemoryKey, nextViewMode);
});

watch(
  () =>
    [
      props.draftState?.title,
      props.draftState?.content,
      props.draftState?.dirty,
      props.document.title,
      props.document.content
    ] as const,
  ([nextTitle, nextContent, nextDirty, documentTitle, documentContent]) => {
    const resolvedTitle = resolveWorkspaceDocumentTitle(
      props.document,
      nextTitle ?? documentTitle
    );
    const resolvedContent = nextContent ?? documentContent;
    if (title.value !== resolvedTitle) title.value = resolvedTitle;
    if (content.value !== resolvedContent) {
      content.value = resolvedContent;
      nonWhitespaceCharacterCount.value =
        countEditorCharacters(resolvedContent);
      resetEditorHistory();
    }
    dirty.value = nextDirty ?? false;
  }
);

const catalogVersions = inject(CATALOG_DOCUMENT_VERSION_PORT, null);
const {
  visible: versionVisible,
  open: versionOpen,
  dialogProps: versionDialogProps
} = useEditorDocumentVersions({
  target: () =>
    props.versioning
      ? props.versioning.target
      : props.document.domain === "creation" &&
          props.document.workspaceId &&
          props.document.catalogDocumentId
        ? {
            workspace: "catalog",
            bookId: props.document.workspaceId,
            documentId: props.document.catalogDocumentId
          }
        : null,
  content: () => content.value,
  title: () => title.value,
  unsaved: () => dirty.value || Boolean(props.saving),
  autoSave: () => Boolean(props.autoSaveEnabled),
  locked: () => props.locked || Boolean(props.versioning?.busy),
  restoreDisabledReason: () =>
    props.document.readOnly
      ? translate("components.longWorkspaceEditor.readOnlyContent")
      : "",
  prepareRestore: () =>
    props.versioning
      ? props.versioning.prepareRestore()
      : (catalogVersions?.prepare({
          id: props.document.id,
          title: title.value,
          content: content.value
        }) ?? Promise.resolve(false)),
  async applyRestore(result) {
    if (props.versioning) {
      await props.versioning.applyRestore(result);
      resetEditorHistory();
      return;
    }
    if (result.workspace !== "catalog") return;
    await catalogVersions?.apply(props.document.id, result.document);
    content.value = result.document.content;
    title.value = result.document.title;
    nonWhitespaceCharacterCount.value = countEditorCharacters(content.value);
    dirty.value = false;
    resetEditorHistory();
  }
});

const isLibraryEntry = computed(
  () =>
    (props.document.domain === "material" ||
      props.document.domain === "skill") &&
    Boolean(props.document.catalogEntryId)
);
const isLibraryOverview = computed(
  () => props.document.catalogLibraryField === "overview"
);
const isTitleReadOnly = computed(
  () =>
    props.document.readOnly ||
    props.locked ||
    workspaceDocumentHasFixedTitle(props.document)
);
const isLibraryDocument = computed(
  () => isLibraryEntry.value || isLibraryOverview.value
);
const recommendedContentLength = computed(() =>
  isLibraryOverview.value
    ? CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS
    : isLibraryEntry.value
      ? CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS
      : undefined
);
const contentExceedsRecommendedLength = computed(
  () =>
    recommendedContentLength.value !== undefined &&
    content.value.length > recommendedContentLength.value
);
const characterCount = computed(() =>
  isLibraryDocument.value
    ? content.value.length
    : nonWhitespaceCharacterCount.value
);
const showDraftFileTabs = computed(() => Boolean(props.document.draftFileKind));
const editorReadOnly = computed(() => props.document.readOnly || props.locked);
const resolveImage = useBookImageResolver();
const imageInsertion = useBookImageInsertion({
  documentKey: () => activeScrollMemoryKey.value,
  content: () => content.value,
  editable: () => !editorReadOnly.value,
  history: {
    canUndo: () => canUndo.value,
    canRedo: () => canRedo.value,
    undo,
    redo
  },
  applyEdit: applyPreviewEdit
});
function handleEditorContextMenu(event: MouseEvent): void {
  handleSelectionEditorContextMenu(event);
  imageInsertion.handleContextMenu(event);
}
function handlePreviewContextMenu(event: MouseEvent): void {
  handleSelectionPreviewContextMenu(event);
  imageInsertion.handleContextMenu(event);
}
function applyPreviewEdit(edit: MarkdownSourceEdit): void {
  if (editorReadOnly.value) return;
  const nextContent = applyMarkdownSourceEdit(content.value, edit);
  updateContent(
    nextContent,
    recordProgrammaticChange(
      nextContent,
      {
        start: edit.start + edit.text.length,
        end: edit.start + edit.text.length
      },
      edit.input
    )
  );
}
function handlePreviewCompositionChange(composing: boolean): void {
  if (composing) editorComposition.start();
  else editorComposition.finish(() => {});
}

const canUndo = computed(() => {
  void historyVersion.value;
  return !editorReadOnly.value && textHistory.canUndo;
});
const canRedo = computed(() => {
  void historyVersion.value;
  return !editorReadOnly.value && textHistory.canRedo;
});
const draftUnitLabel = computed(() =>
  props.document.workspaceType === "script" ? t("episode") : t("section")
);

function markDirty(): void {
  if (
    props.document.readOnly ||
    props.locked ||
    editorComposition.isComposing.value
  )
    return;
  dirty.value = true;
  emit("liveChange", {
    id: props.document.id,
    title: title.value,
    content: content.value
  });
}

const {
  visible: bodyFormatVisible,
  disabled: bodyFormatDisabled,
  format: formatBody
} = useBodyTextFormatting({
  kind: () => props.bodyFormatKind ?? catalogBodyTextKind(props.document),
  content: () => content.value,
  disabled: () =>
    editorReadOnly.value ||
    Boolean(props.saving || props.manualSaving) ||
    props.document.catalogContentLoaded === false,
  documentKey: () => activeScrollMemoryKey.value,
  editorInput: () => editorInput.value,
  recordChange: recordProgrammaticChange,
  updateContent
});

function handleFormatBody(): void {
  if (bodyFormatDisabled.value || props.formatAllPending) return;
  if (catalogBodyTextKind(props.document)) {
    emit("formatAllBodies");
    return;
  }
  void formatBody();
}

function applyLibraryMetadata(nextContent: string): void {
  if (editorReadOnly.value) return;
  const delta = recordProgrammaticChange(nextContent, { start: 0, end: 0 });
  updateContent(nextContent, delta);
}

function getEditorSelection(
  fallback = content.value.length
): TextSelectionRange {
  const preview = richMarkdownEditorAt(documentPreview.value);
  if (preview) return preview.selection();
  const input = editorInput.value;
  return {
    start: input?.selectionStart ?? fallback,
    end: input?.selectionEnd ?? fallback
  };
}

function notifyHistoryChanged(): void {
  historyVersion.value += 1;
}

function resetEditorHistory(): void {
  pendingEditorInput = null;
  textHistory.clear();
  notifyHistoryChanged();
}

function handleEditorBeforeInput(event: InputEvent): void {
  if (editorReadOnly.value || editorComposition.isComposingInput(event)) return;
  if (event.inputType === "historyUndo") {
    event.preventDefault();
    pendingEditorInput = null;
    undo();
    return;
  }
  if (event.inputType === "historyRedo") {
    event.preventDefault();
    pendingEditorInput = null;
    redo();
    return;
  }
  const input = event.currentTarget as HTMLTextAreaElement;
  pendingEditorInput = {
    selectionBefore: {
      start: input.selectionStart ?? content.value.length,
      end: input.selectionEnd ?? content.value.length
    },
    inputType: event.inputType,
    timestamp: event.timeStamp
  };
}

function handleEditorInput(event: Event): void {
  if (editorReadOnly.value || editorComposition.isComposingInput(event)) return;
  const input = event.currentTarget as HTMLTextAreaElement;
  const beforeContent = content.value;
  const afterContent = input.value;
  const selectionAfter = {
    start: input.selectionStart ?? afterContent.length,
    end: input.selectionEnd ?? afterContent.length
  };
  const pending = pendingEditorInput;
  pendingEditorInput = null;
  const historyResult = textHistory.recordInput({
    beforeContent,
    afterContent,
    selectionBefore: pending?.selectionBefore ?? selectionAfter,
    selectionAfter,
    inputType:
      pending?.inputType ??
      (event instanceof InputEvent ? event.inputType : ""),
    timestamp: pending?.timestamp ?? event.timeStamp
  });
  if (historyResult) {
    notifyHistoryChanged();
  }
  updateContent(afterContent, historyResult?.nonWhitespaceDelta);
}

function handleEditorCompositionStart(event: CompositionEvent): void {
  if (editorReadOnly.value) return;
  const input = event.currentTarget as HTMLTextAreaElement;
  pendingEditorInput = {
    selectionBefore: { start: input.selectionStart, end: input.selectionEnd },
    inputType: "",
    timestamp: event.timeStamp
  };
  editorComposition.start();
}

function handleEditorCompositionEnd(event: CompositionEvent): void {
  editorComposition.finish(() => handleEditorInput(event));
}

function handleTitleCompositionEnd(event: CompositionEvent): void {
  editorComposition.finish(() => {
    title.value = (event.currentTarget as HTMLInputElement).value;
    markDirty();
  });
}

function updateContent(
  nextContent: string,
  nonWhitespaceDelta?: number
): boolean {
  if (content.value === nextContent) return true;
  const recount = content.value.includes("![") || nextContent.includes("![");
  content.value = nextContent;
  nonWhitespaceCharacterCount.value =
    recount || nonWhitespaceDelta === undefined
      ? countEditorCharacters(nextContent)
      : Math.max(0, nonWhitespaceCharacterCount.value + nonWhitespaceDelta);
  markDirty();
  return true;
}

function recordProgrammaticChange(
  nextContent: string,
  selectionAfter: TextSelectionRange,
  input?: MarkdownSourceEdit["input"]
): number | undefined {
  const change = { beforeContent: content.value, afterContent: nextContent };
  const result = input
    ? textHistory.recordInput({ ...change, ...input })
    : textHistory.recordChange({
        ...change,
        selectionBefore: getEditorSelection(),
        selectionAfter
      });
  if (result) {
    notifyHistoryChanged();
  }
  return result?.nonWhitespaceDelta;
}

async function restoreEditorHistory(
  result: TextHistoryRestoreResult
): Promise<void> {
  const inPreview = viewMode.value === "preview";
  updateContent(result.content, result.nonWhitespaceDelta);
  await nextTick();
  if (inPreview) {
    richMarkdownEditorAt(documentPreview.value)?.select(
      result.start,
      result.end
    );
    return;
  }
  const input = editorInput.value;
  if (!input) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(result.start, result.end, "forward");
  revealTextareaOffset(input, result.start);
}

function undo(): void {
  if (!canUndo.value) return;
  pendingEditorInput = null;
  const result = textHistory.undo(content.value);
  notifyHistoryChanged();
  if (result) void restoreEditorHistory(result);
}

function redo(): void {
  if (!canRedo.value) return;
  pendingEditorInput = null;
  const result = textHistory.redo(content.value);
  notifyHistoryChanged();
  if (result) void restoreEditorHistory(result);
}

function save(): void {
  if (
    props.document.readOnly ||
    props.locked ||
    props.saving ||
    editorComposition.isComposing.value
  ) {
    return;
  }
  const resolvedTitle = resolveWorkspaceDocumentTitle(
    props.document,
    title.value
  );
  if (!resolvedTitle.trim()) {
    uiMessage.warning(t("enterADocumentTitleBeforeSaving"));
    return;
  }
  preserveEditorViewportForSave();
  emit("save", {
    id: props.document.id,
    title: resolvedTitle,
    content: content.value
  });
}

function handleDocumentScroll(event: Event): void {
  const scroller = event.currentTarget;
  if (!(scroller instanceof HTMLElement)) return;
  documentScrollbar.reveal(scroller);
  rememberDocumentScrollEvent(event);
  closeSelectionAction();
}

function selectViewMode(view: EditorScrollView): void {
  if (view === viewMode.value) return;
  rememberCurrentDocumentScroll();
  setViewMode(view);
  closeSelectionAction();
  void restoreDocumentScroll(activeScrollMemoryKey.value, view);
}

watch(
  () => props.defaultViewMode,
  (mode) => selectViewMode(mode)
);

watch(
  () => props.entrySearchItems,
  () => {
    if (entrySearchQuery.value.trim()) handleEntrySearchInput();
  }
);

async function locateEditorReference(
  navigation: EditorTextReferenceNavigation | undefined
): Promise<void> {
  if (!navigation || navigation.reference.documentId !== props.document.id)
    return;
  setViewMode("edit");
  closeSelectionAction();
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  const range = resolveEditorTextReferenceRange(
    content.value,
    navigation.reference
  );
  input.focus();
  input.setSelectionRange(range.start, range.end, "forward");
  revealTextareaOffset(input, range.start);
}

watch(
  () => [props.locateReference?.requestId, props.document.id] as const,
  () => {
    void locateEditorReference(props.locateReference);
  },
  { flush: "post" }
);

onMounted(() => {
  void restoreDocumentScroll();
});

onBeforeUnmount(() => {
  editorComposition.reset();
  rememberCurrentDocumentScroll();
  documentScrollbar.dispose();
});
</script>

<template>
  <DocumentVersionDialog
    v-if="versionOpen && versionVisible"
    v-bind="versionDialogProps"
    @close="versionOpen = false"
  />
  <aside
    class="editor-pane"
    :class="{
      'has-file-tabs': showDraftFileTabs || $slots['related-files']
    }"
    :data-workspace-type="document.workspaceType"
    :aria-label="t('textContent')"
  >
    <nav
      v-if="showDraftFileTabs || $slots['related-files']"
      class="editor-file-tabs-bar"
      @wheel="handleHorizontalOverflowWheel"
    >
      <div
        class="draft-file-tabs"
        role="tablist"
        :aria-label="
          $slots['related-files']
            ? document.title
            : t('valueFile', { arg0: draftUnitLabel })
        "
      >
        <slot v-if="$slots['related-files']" name="related-files" />
        <template v-else-if="document.workspaceType === 'academic'">
          <button
            type="button"
            role="tab"
            :title="academicTreeT('briefHint')"
            :aria-selected="document.draftFileKind === 'brief'"
            :class="{ 'is-active': document.draftFileKind === 'brief' }"
            @click="emit('selectDraftFile', 'brief')"
          >
            {{ academicTreeT("tabBrief") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="document.draftFileKind === 'body'"
            :class="{ 'is-active': document.draftFileKind === 'body' }"
            @click="emit('selectDraftFile', 'body')"
          >
            {{ academicTreeT("tabBody") }}
          </button>
          <button
            type="button"
            role="tab"
            :title="academicTreeT('stateHint')"
            :aria-selected="document.draftFileKind === 'state'"
            :class="{ 'is-active': document.draftFileKind === 'state' }"
            @click="emit('selectDraftFile', 'state')"
          >
            {{ academicTreeT("tabState") }}
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            role="tab"
            :aria-selected="document.draftFileKind === 'body'"
            :class="{ 'is-active': document.draftFileKind === 'body' }"
            @click="emit('selectDraftFile', 'body')"
          >
            {{ t("manuscript") }}
          </button>
          <button
            type="button"
            role="tab"
            :title="t('stateDescription')"
            :aria-selected="document.draftFileKind === 'character-state'"
            :class="{
              'is-active': document.draftFileKind === 'character-state'
            }"
            @click="emit('selectDraftFile', 'character-state')"
          >
            {{ t("characterState") }}
          </button>
        </template>
      </div>
    </nav>

    <div class="editor-toolbar">
      <div
        class="editor-toolbar-actions"
        @wheel="handleHorizontalOverflowWheel"
      >
        <slot name="toolbar-start" />
        <span
          v-if="showDraftFileTabs || $slots['related-files']"
          class="toolbar-separator"
        />
        <div class="view-tabs" role="tablist" :aria-label="t('textView')">
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'edit'"
            :class="{ 'is-active': viewMode === 'edit' }"
            @click="selectViewMode('edit')"
          >
            {{ t("edit") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'preview'"
            :class="{ 'is-active': viewMode === 'preview' }"
            @click="selectViewMode('preview')"
          >
            {{ t("preview") }}
          </button>
        </div>
        <span class="toolbar-separator" />
        <div
          class="editor-text-tools"
          role="group"
          :aria-label="t('textActions')"
        >
          <EditorTextTools
            :can-undo="canUndo"
            :can-redo="canRedo"
            :find-panel-open="findPanelOpen"
            :find-panel-mode="findPanelMode"
            :version-visible="versionVisible"
            :format-visible="bodyFormatVisible"
            :format-disabled="bodyFormatDisabled || formatAllPending"
            :format-label="
              document.workspaceType === 'short' ||
              document.workspaceType === 'script'
                ? t('formatAllManuscriptBodies')
                : undefined
            "
            @undo="undo"
            @redo="redo"
            @toggle-find="toggleFindPanel"
            @format="handleFormatBody"
            @versions="versionOpen = true"
          />
          <PreviewOutlinePopover
            v-if="viewMode === 'preview'"
            icon-only
            :content="content"
            :preview-element="documentPreview"
            :document-key="activeScrollMemoryKey"
          />
        </div>
      </div>
      <EditorPaneToggle
        :right-pane="rightPane"
        :right-pane-collapsed="rightPaneCollapsed"
        @collapse="emit('collapse')"
        @toggle-right="emit('toggleRight')"
      />

      <EditorFindReplacePanel
        v-if="findPanelOpen"
        v-model:find-panel-element="findPanelElement"
        v-model:find-input="findInput"
        v-model:search-query="searchQuery"
        v-model:replacement-text="replacementText"
        v-model:entry-search-query="entrySearchQuery"
        :find-panel-mode="findPanelMode"
        :search-result-label="searchResultLabel"
        :current-read-only="editorReadOnly"
        :entry-search-results="entrySearchResults"
        :active-entry-search-index="activeEntrySearchIndex"
        :entry-search-pending="entrySearchPending"
        :entry-search-result-label="entrySearchResultLabel"
        @find-input="handleFindInput"
        @find-match="findMatch"
        @close="dismissFindPanel"
        @replace-current="replaceCurrentMatch"
        @replace-all="replaceAllMatches"
        @entry-search-input="handleEntrySearchInput"
        @move-entry-search="moveActiveEntrySearchResult"
        @select-entry-search="selectEntrySearchResult"
      />
    </div>

    <AcademicReferenceCardBar
      v-if="document.academicDocKind === 'reference_card'"
      :document="document"
      :locked="locked"
    />

    <div
      class="editor-document"
      :class="{
        'is-readonly': document.readOnly,
        'without-metadata': document.domain === 'creation'
      }"
    >
      <EditorDocumentMetadata
        v-if="document.domain !== 'creation'"
        :document="document"
        :title="title"
        :content="content"
        :bound-to-current-book="boundToCurrentBook"
        :locked="locked"
        @change="applyLibraryMetadata"
      />

      <slot name="document-heading">
        <input
          v-model="title"
          class="document-title-input"
          :readonly="isTitleReadOnly"
          :aria-label="t('documentTitle')"
          @input="markDirty"
          @compositionstart="editorComposition.start"
          @compositionend="handleTitleCompositionEnd"
        />
      </slot>

      <EditorSearchHighlight
        v-if="viewMode === 'edit'"
        :content="content"
        :matches="searchMatches"
        :active-index="currentMatchIndex"
        :visible="findPanelOpen"
      >
        <textarea
          ref="editorInput"
          :value="editorComposition.valueForRender(content, editorInput)"
          class="document-editor transient-scrollbar"
          :readonly="document.readOnly || locked"
          :aria-label="t('textEditor')"
          spellcheck="false"
          @beforeinput="handleEditorBeforeInput"
          @input="handleEditorInput"
          @compositionstart="handleEditorCompositionStart"
          @compositionend="handleEditorCompositionEnd"
          @keydown="handleEditorKeydown"
          @contextmenu="handleEditorContextMenu"
          @scroll="handleDocumentScroll"
        />
      </EditorSearchHighlight>
      <article
        v-else
        ref="documentPreview"
        class="document-preview transient-scrollbar"
        @contextmenu="handlePreviewContextMenu"
        @scroll="handleDocumentScroll"
      >
        <EditableMarkdownPreview
          :content="content"
          :document-key="activeScrollMemoryKey"
          :editable="!editorReadOnly"
          :resolve-image="resolveImage"
          :empty-text="t('noContentYet')"
          annotate-headings
          @edit="applyPreviewEdit"
          @keydown="handleEditorKeydown"
          @composition-change="handlePreviewCompositionChange"
          @undo="undo"
          @redo="redo"
        />
      </article>
    </div>

    <footer
      class="editor-footer"
      :title="locked ? (lockedLabel ?? t('agentRunningReadOnly')) : undefined"
    >
      <CatalogEditorFooterMeta
        :document="document"
        :content="content"
        :character-count="characterCount"
        :recommended-content-length="recommendedContentLength"
        :is-library-document="isLibraryDocument"
        :is-library-overview="isLibraryOverview"
        :content-exceeds-recommended-length="contentExceedsRecommendedLength"
        :auto-save-enabled="autoSaveEnabled"
      />
      <button
        v-if="!autoSaveEnabled"
        class="save-button"
        type="button"
        :disabled="
          document.readOnly || locked || saving || manualSaving || !dirty
        "
        @mousedown.prevent
        @click="save"
      >
        <AppIcon name="save" :size="14" />
        {{ manualSaving ? t("saving") : t("saveNow") }}
      </button>
    </footer>
  </aside>
</template>
