<script setup lang="ts">
import {
  computed,
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
  type TextViewMode
} from "@deepwrite/contracts";
import type {
  EditorTextReference,
  EditorTextReferenceNavigation
} from "../types/conversation";
import type { EditorEntrySearchSource } from "../types/editorEntrySearch";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import { resolveEditorTextReferenceRange } from "../utils/editorTextReferences";
import {
  editorScrollMemoryKey,
  recalledEditorScrollPosition,
  rememberEditorScrollPosition,
  type EditorScrollView
} from "../utils/editorScrollMemory";
import {
  countNonWhitespaceCharacters,
  createBoundedTextHistory,
  type TextHistoryRestoreResult,
  type TextSelectionRange
} from "../utils/boundedTextHistory";
import { handleHorizontalOverflowWheel } from "../utils/horizontalOverflow";
import {
  resolveWorkspaceDocumentTitle,
  workspaceDocumentHasFixedTitle
} from "../utils/fixedWorkspaceDocumentTitle";
import { parseSkillFrontmatter } from "../utils/skillFrontmatter";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { uiMessage } from "../ui-feedback";
import { useEditorSelectionInsertion } from "../composables/useEditorSelectionInsertion";
import { useEditorSaveViewport } from "../composables/useEditorSaveViewport";
import {
  searchLocalEditorEntries,
  useEditorEntrySearch
} from "../composables/useEditorEntrySearch";
import { useTextViewMode } from "../composables/useTextViewMode";
import AppIcon from "./AppIcon.vue";
import DocumentMetaRow from "./DocumentMetaRow.vue";
import EditorEntrySearchRow from "./EditorEntrySearchRow.vue";
import EditorSearchHighlight from "./EditorSearchHighlight.vue";
import EditorSelectionMenu from "./EditorSelectionMenu.vue";
import MarkdownContent from "./MarkdownContent.vue";

const props = defineProps<{
  document: WorkspaceDocument;
  resourceId: string;
  draftState: EditorDraftState | undefined;
  locateReference?: EditorTextReferenceNavigation | undefined;
  locked: boolean;
  lockedLabel?: string | undefined;
  saving?: boolean;
  manualSaving?: boolean;
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
  entrySearchItems: readonly EditorEntrySearchSource[];
}>();

const emit = defineEmits<{
  collapse: [];
  toggleRight: [];
  save: [payload: { id: string; title: string; content: string }];
  liveChange: [payload: { id: string; title: string; content: string }];
  insertSelection: [reference: EditorTextReference];
  selectSection: [sectionId: string];
  createSection: [];
  deleteSection: [];
  selectDraftFile: [fileKind: "body" | "character-state"];
  selectEntrySearchResult: [documentId: string];
  prepareEntrySearch: [];
}>();

const editorInput = ref<HTMLTextAreaElement>();
const documentPreview = ref<HTMLElement | null>(null);
const editorToolsElement = ref<HTMLElement>();
const findPanelElement = ref<HTMLElement>();
const findInput = ref<HTMLInputElement>();
const title = ref(
  resolveWorkspaceDocumentTitle(props.document, props.draftState?.title)
);
const content = ref(props.draftState?.content ?? props.document.content);
const nonWhitespaceCharacterCount = ref(
  countNonWhitespaceCharacters(content.value)
);
const dirty = ref(props.draftState?.dirty ?? false);
const {
  selectionAction,
  closeSelectionAction,
  handleEditorContextMenu,
  handlePreviewContextMenu,
  insertSelectedText
} = useEditorSelectionInsertion({
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
const findPanelOpen = ref(false);
const findPanelMode = ref<"find" | "replace">("find");
const searchQuery = ref("");
const replacementText = ref("");
const currentMatchIndex = ref(-1);
const searchAnchor = ref(0);
const entrySearch = useEditorEntrySearch({
  search: (query) => searchLocalEditorEntries(props.entrySearchItems, query),
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

interface EditorSearchMatch {
  start: number;
  end: number;
}

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
  isTransientlyReadOnly: () => props.locked,
  rememberScroll: (documentKey, scrollTop) =>
    rememberEditorScrollPosition(documentKey, "edit", scrollTop)
});

onBeforeUpdate(captureEditorViewportBeforeRender);
onUpdated(restoreEditorViewportAfterRender);

watch(activeScrollMemoryKey, (nextScrollMemoryKey, previousScrollMemoryKey) => {
  rememberCurrentDocumentScroll(previousScrollMemoryKey);
  title.value = resolveWorkspaceDocumentTitle(
    props.document,
    props.draftState?.title
  );
  content.value = props.draftState?.content ?? props.document.content;
  nonWhitespaceCharacterCount.value = countNonWhitespaceCharacters(
    content.value
  );
  dirty.value = props.draftState?.dirty ?? false;
  const nextViewMode = resetToDefault();
  selectionAction.value = null;
  findPanelOpen.value = false;
  searchQuery.value = "";
  replacementText.value = "";
  currentMatchIndex.value = -1;
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
        countNonWhitespaceCharacters(resolvedContent);
      resetEditorHistory();
    }
    dirty.value = nextDirty ?? false;
  }
);

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
const skillFormatError = computed(() => {
  if (props.document.domain !== "skill" || !props.document.catalogEntryId) {
    return undefined;
  }
  const result = parseSkillFrontmatter(content.value);
  return result.valid ? undefined : result.message;
});
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
const showSectionTabs = computed(() => Boolean(props.sectionTabs?.length));
const showDraftFileTabs = computed(() => Boolean(props.document.draftFileKind));
const editorReadOnly = computed(() => props.document.readOnly || props.locked);
const canUndo = computed(() => {
  void historyVersion.value;
  return !editorReadOnly.value && textHistory.canUndo;
});
const canRedo = computed(() => {
  void historyVersion.value;
  return !editorReadOnly.value && textHistory.canRedo;
});
const searchMatches = computed<EditorSearchMatch[]>(() => {
  const query = searchQuery.value;
  if (!query) return [];

  const matches: EditorSearchMatch[] = [];
  let start = 0;
  while (start <= content.value.length - query.length) {
    const index = content.value.indexOf(query, start);
    if (index < 0) break;
    matches.push({ start: index, end: index + query.length });
    start = index + query.length;
  }
  return matches;
});
const searchResultLabel = computed(() => {
  if (!searchQuery.value) return "0/0";
  if (!searchMatches.value.length) return "无结果";
  const current =
    currentMatchIndex.value >= 0 ? currentMatchIndex.value + 1 : 0;
  return `${current}/${searchMatches.value.length}`;
});
const draftUnitLabel = computed(() =>
  props.document.workspaceType === "script" ? "剧集" : "小节"
);
const resolvedSectionTabsLabel = computed(
  () => props.sectionTabsLabel ?? `正文${draftUnitLabel.value}`
);
const resolvedCreateSectionLabel = computed(
  () => props.createSectionLabel ?? "在正文末尾新建小节"
);
const resolvedDeleteSectionLabel = computed(
  () => props.deleteSectionLabel ?? "删除当前条目"
);
const persistedDocument = computed(() =>
  Boolean(
    props.document.catalogDocumentId ||
    props.document.catalogEntryId ||
    props.document.catalogLibraryField ||
    props.document.catalogProjectRevision !== undefined
  )
);
const visibleDirtySaveState = computed(
  () => dirty.value && !props.autoSaveEnabled
);
const resolvedLockedLabel = computed(
  () => props.lockedLabel ?? "智能体运行中 · 只读"
);

function markDirty(): void {
  if (props.document.readOnly || props.locked) return;
  dirty.value = true;
  emit("liveChange", {
    id: props.document.id,
    title: title.value,
    content: content.value
  });
}

function getEditorSelection(
  fallback = content.value.length
): TextSelectionRange {
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
  if (editorReadOnly.value) return;
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
  if (editorReadOnly.value) return;
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

function updateContent(
  nextContent: string,
  nonWhitespaceDelta?: number
): boolean {
  if (content.value === nextContent) return true;
  content.value = nextContent;
  nonWhitespaceCharacterCount.value =
    nonWhitespaceDelta === undefined
      ? countNonWhitespaceCharacters(nextContent)
      : Math.max(0, nonWhitespaceCharacterCount.value + nonWhitespaceDelta);
  currentMatchIndex.value = -1;
  markDirty();
  return true;
}

function recordProgrammaticChange(
  nextContent: string,
  selectionAfter: TextSelectionRange
): number | undefined {
  const result = textHistory.recordChange({
    beforeContent: content.value,
    afterContent: nextContent,
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
  setViewMode("edit");
  updateContent(result.content, result.nonWhitespaceDelta);
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(result.start, result.end, "forward");
  scrollEditorToRange(input, result.start);
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

function handleEditorKeydown(event: KeyboardEvent): void {
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (modifier && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (event.ctrlKey && !event.metaKey && key === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (modifier && key === "f" && !(event.metaKey && event.altKey)) {
    event.preventDefault();
    toggleFindPanel("find");
    return;
  }
  if (
    (event.ctrlKey && !event.metaKey && key === "h") ||
    (event.metaKey && event.altKey && key === "f")
  ) {
    event.preventDefault();
    toggleFindPanel("replace");
  }
}

function save(): void {
  if (props.document.readOnly || props.locked || props.saving) {
    return;
  }
  const resolvedTitle = resolveWorkspaceDocumentTitle(
    props.document,
    title.value
  );
  if (!resolvedTitle.trim()) {
    uiMessage.warning("请输入文档标题后再保存");
    return;
  }
  preserveEditorViewportForSave();
  emit("save", {
    id: props.document.id,
    title: resolvedTitle,
    content: content.value
  });
}

function currentDocumentScroller(
  view: EditorScrollView
): HTMLElement | null | undefined {
  return view === "edit" ? editorInput.value : documentPreview.value;
}

function rememberCurrentDocumentScroll(
  key = activeScrollMemoryKey.value
): void {
  const scroller = currentDocumentScroller(viewMode.value);
  if (!scroller) return;
  rememberEditorScrollPosition(key, viewMode.value, scroller.scrollTop);
}

async function restoreDocumentScroll(
  key = activeScrollMemoryKey.value,
  view = viewMode.value
): Promise<void> {
  await nextTick();
  if (activeScrollMemoryKey.value !== key || viewMode.value !== view) return;
  const scroller = currentDocumentScroller(view);
  if (!scroller) return;
  scroller.scrollTop = recalledEditorScrollPosition(key, view);
}

function handleDocumentScroll(event: Event): void {
  const scroller = event.currentTarget;
  if (!(scroller instanceof HTMLElement)) return;
  documentScrollbar.reveal(scroller);
  rememberEditorScrollPosition(
    activeScrollMemoryKey.value,
    viewMode.value,
    scroller.scrollTop
  );
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

function closeFindPanel(): void {
  findPanelOpen.value = false;
  currentMatchIndex.value = -1;
}

async function toggleFindPanel(mode: "find" | "replace"): Promise<void> {
  if (findPanelOpen.value && findPanelMode.value === mode) {
    closeFindPanel();
    return;
  }

  setViewMode("edit");
  closeSelectionAction();
  findPanelMode.value = mode;
  findPanelOpen.value = true;
  emit("prepareEntrySearch");
  searchAnchor.value = editorInput.value?.selectionStart ?? 0;
  currentMatchIndex.value = -1;
  await nextTick();
  findInput.value?.focus({ preventScroll: true });
  findInput.value?.select();
}

function resolveInitialMatchIndex(direction: 1 | -1): number {
  const matches = searchMatches.value;
  if (!matches.length) return -1;

  if (direction === 1) {
    const index = matches.findIndex(
      (match) => match.start >= searchAnchor.value
    );
    return index >= 0 ? index : 0;
  }
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index]!.end <= searchAnchor.value) return index;
  }
  return matches.length - 1;
}

function scrollEditorToRange(input: HTMLTextAreaElement, start: number): void {
  const line = content.value.slice(0, start).split("\n").length;
  const computedStyle = globalThis.getComputedStyle(input);
  const lineHeight = Number.parseFloat(computedStyle.lineHeight);
  const resolvedLineHeight = Number.isFinite(lineHeight)
    ? lineHeight
    : Number.parseFloat(computedStyle.fontSize) * 1.95;
  input.scrollTop = Math.max(
    0,
    (line - 1) * resolvedLineHeight - input.clientHeight / 3
  );
}

async function selectSearchMatch(index: number): Promise<void> {
  const match = searchMatches.value[index];
  if (!match) return;
  currentMatchIndex.value = index;
  setViewMode("edit");
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(match.start, match.end, "forward");
  scrollEditorToRange(input, match.start);
  await nextTick();
  findInput.value?.focus({ preventScroll: true });
}

function findMatch(direction: 1 | -1, quiet = false): void {
  if (!searchQuery.value) {
    if (!quiet) uiMessage.info("请输入要查找的文字");
    return;
  }
  if (!searchMatches.value.length) {
    currentMatchIndex.value = -1;
    if (!quiet) uiMessage.info("未找到匹配文字");
    return;
  }

  const nextIndex =
    currentMatchIndex.value < 0
      ? resolveInitialMatchIndex(direction)
      : (currentMatchIndex.value + direction + searchMatches.value.length) %
        searchMatches.value.length;
  void selectSearchMatch(nextIndex);
}

function handleFindInput(): void {
  currentMatchIndex.value = -1;
  if (searchQuery.value) findMatch(1, true);
}

function replaceCurrentMatch(): void {
  if (editorReadOnly.value) return;
  const index =
    currentMatchIndex.value >= 0
      ? currentMatchIndex.value
      : resolveInitialMatchIndex(1);
  const match = searchMatches.value[index];
  if (!match) {
    uiMessage.info(
      searchQuery.value ? "未找到可替换的文字" : "请输入要替换的文字"
    );
    return;
  }

  const nextContent =
    content.value.slice(0, match.start) +
    replacementText.value +
    content.value.slice(match.end);
  if (nextContent === content.value) {
    findMatch(1);
    return;
  }

  const nonWhitespaceDelta = recordProgrammaticChange(nextContent, {
    start: match.start + replacementText.value.length,
    end: match.start + replacementText.value.length
  });
  updateContent(nextContent, nonWhitespaceDelta);
  searchAnchor.value = match.start + replacementText.value.length;
  void nextTick(() => findMatch(1, true));
}

function replaceAllMatches(): void {
  if (editorReadOnly.value) return;
  const matches = searchMatches.value;
  if (!searchQuery.value || !matches.length) {
    uiMessage.info(
      searchQuery.value ? "未找到可替换的文字" : "请输入要替换的文字"
    );
    return;
  }

  let cursor = 0;
  let nextContent = "";
  for (const match of matches) {
    nextContent +=
      content.value.slice(cursor, match.start) + replacementText.value;
    cursor = match.end;
  }
  nextContent += content.value.slice(cursor);

  if (nextContent === content.value) {
    uiMessage.info("查找文字与替换文字相同");
    return;
  }
  const nonWhitespaceDelta = recordProgrammaticChange(nextContent, {
    start: 0,
    end: 0
  });
  updateContent(nextContent, nonWhitespaceDelta);
  searchAnchor.value = 0;
  uiMessage.success(`已替换 ${matches.length} 处文字`);
}

function handleWindowPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (
    !editorToolsElement.value?.contains(target) &&
    !findPanelElement.value?.contains(target)
  ) {
    closeFindPanel();
  }
}

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
  scrollEditorToRange(input, range.start);
}

watch(
  () => [props.locateReference?.requestId, props.document.id] as const,
  () => {
    void locateEditorReference(props.locateReference);
  },
  { flush: "post" }
);

onMounted(() => {
  globalThis.addEventListener("pointerdown", handleWindowPointerDown, true);
  void restoreDocumentScroll();
});

onBeforeUnmount(() => {
  rememberCurrentDocumentScroll();
  documentScrollbar.dispose();
  globalThis.removeEventListener("pointerdown", handleWindowPointerDown, true);
});
</script>

<template>
  <aside
    class="editor-pane"
    :class="{
      'has-section-tabs': showSectionTabs,
      'is-script-workspace': document.workspaceType === 'script'
    }"
    :data-workspace-type="document.workspaceType"
    aria-label="文本内容"
  >
    <header class="editor-header">
      <div class="editor-breadcrumbs" :title="document.path.join(' / ')">
        <span v-for="(part, index) in document.path" :key="`${part}-${index}`">
          {{ part }}<i v-if="index < document.path.length - 1">/</i>
        </span>
      </div>
      <div class="editor-header-actions">
        <span class="save-state" :class="{ 'is-dirty': visibleDirtySaveState }">
          <AppIcon
            :name="visibleDirtySaveState ? 'save' : 'check'"
            :size="13"
          />
          {{
            document.readOnly
              ? "只读"
              : locked
                ? resolvedLockedLabel
                : manualSaving
                  ? "正在保存到本机"
                  : autoSaveEnabled
                    ? "自动保存已开启"
                    : dirty
                      ? "有未应用修改"
                      : persistedDocument
                        ? "已保存到本机"
                        : "本次运行已应用"
          }}
        </span>
        <button
          v-if="rightPane !== false"
          class="icon-button"
          type="button"
          aria-label="收起文本内容栏"
          @click="emit('collapse')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
        <button
          v-else-if="rightPaneCollapsed"
          class="icon-button"
          type="button"
          aria-label="展开智能体栏"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <nav
      v-if="showSectionTabs"
      class="section-tabs-bar"
      :aria-label="resolvedSectionTabsLabel"
    >
      <div
        class="section-tabs-scroll"
        role="tablist"
        @wheel="handleHorizontalOverflowWheel"
      >
        <button
          v-for="section in sectionTabs ?? []"
          :key="section.id"
          class="section-tab"
          :class="{ 'is-active': section.id === activeSectionId }"
          type="button"
          role="tab"
          :aria-selected="section.id === activeSectionId"
          :title="section.title"
          @click="emit('selectSection', section.id)"
        >
          {{ section.title }}
        </button>
      </div>
      <button
        v-if="canCreateSection"
        class="section-tabs-add"
        type="button"
        :aria-label="resolvedCreateSectionLabel"
        :title="resolvedCreateSectionLabel"
        :disabled="locked"
        @click="emit('createSection')"
      >
        <AppIcon name="plus" :size="16" />
      </button>
      <button
        v-if="showDeleteSection"
        class="section-tabs-remove"
        type="button"
        :aria-label="resolvedDeleteSectionLabel"
        :title="resolvedDeleteSectionLabel"
        :disabled="locked || !canDeleteSection"
        @click="emit('deleteSection')"
      >
        <AppIcon name="minus" :size="16" />
      </button>
    </nav>

    <div class="editor-toolbar">
      <div
        v-if="showDraftFileTabs"
        class="draft-file-tabs"
        role="tablist"
        :aria-label="`${draftUnitLabel}文件`"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="document.draftFileKind === 'body'"
          :class="{ 'is-active': document.draftFileKind === 'body' }"
          @click="emit('selectDraftFile', 'body')"
        >
          正文
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="document.draftFileKind === 'character-state'"
          :class="{ 'is-active': document.draftFileKind === 'character-state' }"
          @click="emit('selectDraftFile', 'character-state')"
        >
          人物状态
        </button>
      </div>
      <span v-if="showDraftFileTabs" class="toolbar-separator" />
      <div class="view-tabs" role="tablist" aria-label="文本视图">
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'edit'"
          :class="{ 'is-active': viewMode === 'edit' }"
          @click="selectViewMode('edit')"
        >
          编辑
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'preview'"
          :class="{ 'is-active': viewMode === 'preview' }"
          @click="selectViewMode('preview')"
        >
          预览
        </button>
      </div>
      <span class="toolbar-separator" />
      <div
        ref="editorToolsElement"
        class="editor-text-tools"
        role="group"
        aria-label="文本操作"
      >
        <button
          class="format-button"
          type="button"
          aria-label="撤销"
          title="撤销（⌘/Ctrl+Z）"
          :disabled="!canUndo"
          @mousedown.prevent
          @click="undo"
        >
          <AppIcon name="undo" :size="16" />
        </button>
        <button
          class="format-button"
          type="button"
          aria-label="还原"
          title="还原（⌘/Ctrl+Shift+Z）"
          :disabled="!canRedo"
          @mousedown.prevent
          @click="redo"
        >
          <AppIcon name="redo" :size="16" />
        </button>
        <button
          class="format-button"
          :class="{ 'is-active': findPanelOpen && findPanelMode === 'find' }"
          type="button"
          aria-label="查找"
          title="查找（⌘/Ctrl+F）"
          :aria-pressed="findPanelOpen && findPanelMode === 'find'"
          @mousedown.prevent
          @click="toggleFindPanel('find')"
        >
          <AppIcon name="search" :size="16" />
        </button>
        <button
          class="format-button"
          :class="{ 'is-active': findPanelOpen && findPanelMode === 'replace' }"
          type="button"
          aria-label="替换"
          title="替换（⌘⌥F / Ctrl+H）"
          :aria-pressed="findPanelOpen && findPanelMode === 'replace'"
          @mousedown.prevent
          @click="toggleFindPanel('replace')"
        >
          <AppIcon name="replace" :size="16" />
        </button>
      </div>

      <div
        v-if="findPanelOpen"
        ref="findPanelElement"
        class="editor-find-panel"
        role="dialog"
        :aria-label="findPanelMode === 'replace' ? '查找和替换' : '查找文字'"
        @keydown.esc.stop="closeFindPanel"
      >
        <div class="editor-find-row">
          <label class="editor-find-field">
            <AppIcon name="search" :size="14" />
            <input
              ref="findInput"
              v-model="searchQuery"
              type="text"
              aria-label="查找文字"
              placeholder="查找"
              @input="handleFindInput"
              @keydown.enter.prevent="findMatch($event.shiftKey ? -1 : 1)"
            />
            <span class="editor-find-count" aria-live="polite">{{
              searchResultLabel
            }}</span>
          </label>
          <button
            class="editor-find-icon-button is-previous"
            type="button"
            aria-label="查找上一个"
            title="查找上一个"
            @click="findMatch(-1)"
          >
            <AppIcon name="chevron" :size="14" />
          </button>
          <button
            class="editor-find-icon-button"
            type="button"
            aria-label="查找下一个"
            title="查找下一个"
            @click="findMatch(1)"
          >
            <AppIcon name="chevron" :size="14" />
          </button>
          <button
            class="editor-find-icon-button"
            type="button"
            aria-label="关闭查找"
            title="关闭"
            @click="closeFindPanel"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </div>
        <div v-if="findPanelMode === 'replace'" class="editor-replace-row">
          <label class="editor-find-field">
            <AppIcon name="replace" :size="14" />
            <input
              v-model="replacementText"
              type="text"
              aria-label="替换为"
              placeholder="替换为"
              :disabled="editorReadOnly"
              @keydown.enter.prevent="replaceCurrentMatch"
            />
          </label>
          <button
            class="editor-find-action"
            type="button"
            :disabled="editorReadOnly"
            @click="replaceCurrentMatch"
          >
            替换
          </button>
          <button
            class="editor-find-action"
            type="button"
            :disabled="editorReadOnly"
            @click="replaceAllMatches"
          >
            全部
          </button>
        </div>
        <EditorEntrySearchRow
          v-model:query="entrySearchQuery"
          :results="entrySearchResults"
          :active-index="activeEntrySearchIndex"
          :pending="entrySearchPending"
          :result-label="entrySearchResultLabel"
          @input="handleEntrySearchInput"
          @move="moveActiveEntrySearchResult"
          @select="selectEntrySearchResult"
        />
      </div>
    </div>

    <div class="editor-document" :class="{ 'is-readonly': document.readOnly }">
      <DocumentMetaRow
        :view-mode="viewMode"
        :content="content"
        :preview-element="documentPreview"
        :document-key="activeScrollMemoryKey"
      >
        <span>{{ document.eyebrow }}</span>
        <span v-if="document.format" class="document-format">{{
          document.format
        }}</span>
        <span v-if="document.readOnly" class="readonly-badge">只读内容</span>
        <span v-if="document.domain !== 'creation'" class="readonly-badge">
          {{ boundToCurrentBook ? "已绑定到当前书籍" : "仅浏览 · 未绑定" }}
        </span>
        <span
          v-if="skillFormatError"
          class="skill-format-error-badge"
          role="status"
          :title="skillFormatError"
          :aria-label="skillFormatError"
        >
          {{ skillFormatError }}
        </span>
      </DocumentMetaRow>

      <input
        v-model="title"
        class="document-title-input"
        :readonly="isTitleReadOnly"
        aria-label="文档标题"
        @input="markDirty"
      />

      <EditorSearchHighlight
        v-if="viewMode === 'edit'"
        :content="content"
        :matches="searchMatches"
        :active-index="currentMatchIndex"
        :visible="findPanelOpen"
      >
        <textarea
          ref="editorInput"
          :value="content"
          class="document-editor transient-scrollbar"
          :readonly="document.readOnly || locked"
          aria-label="文本内容编辑器"
          spellcheck="false"
          @beforeinput="handleEditorBeforeInput"
          @input="handleEditorInput"
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
        <MarkdownContent
          v-if="content.trim()"
          :content="content"
          annotate-headings
        />
        <p v-else class="document-preview-empty">暂无内容</p>
      </article>
    </div>

    <footer class="editor-footer">
      <div class="editor-footer-meta">
        <span>
          {{ characterCount.toLocaleString("zh-CN")
          }}<template v-if="recommendedContentLength">
            / {{ recommendedContentLength.toLocaleString("zh-CN") }}</template
          >
          字
        </span>
        <span
          v-if="isLibraryDocument"
          class="library-entry-limit-hint"
          :class="{ 'limit-warning': contentExceedsRecommendedLength }"
          :title="
            isLibraryOverview
              ? '素材库或技能库介绍建议不超过 40,000 字'
              : '每个素材库或技能库条目建议不超过 40,000 字，请勿上传过多内容'
          "
        >
          {{
            isLibraryOverview
              ? "建议库介绍不超过 40,000 字"
              : "建议每个条目不超过 40,000 字，请勿上传过多内容"
          }}
        </span>
        <span class="editor-save-status">{{
          locked
            ? resolvedLockedLabel
            : manualSaving
              ? "正在原子保存本机文稿"
              : persistedDocument
                ? autoSaveEnabled
                  ? "本机文稿 · 更改后自动保存"
                  : "本机文稿 · 应用后持久保存"
                : "内存草稿 · 重启后不保留"
        }}</span>
      </div>
      <button
        class="save-button"
        type="button"
        :disabled="
          document.readOnly ||
          locked ||
          manualSaving ||
          (!autoSaveEnabled && !dirty)
        "
        @mousedown.prevent
        @click="save"
      >
        <AppIcon name="save" :size="14" />
        {{ manualSaving ? "保存中…" : autoSaveEnabled ? "立即保存" : "应用" }}
      </button>
    </footer>
  </aside>

  <EditorSelectionMenu
    v-if="selectionAction"
    :left="selectionAction.left"
    :top="selectionAction.top"
    @insert="insertSelectedText"
  />
</template>
