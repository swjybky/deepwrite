<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS,
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS
} from "@deepwrite/contracts";
import { randomHex8 } from "@deepwrite/shared";
import type {
  EditorTextReference,
  EditorTextReferenceNavigation
} from "../types/conversation";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  createEditorTextReference,
  resolveEditorTextReferenceRange
} from "../utils/editorTextReferences";
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
import { parseSkillFrontmatter } from "../utils/skillFrontmatter";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import MarkdownContent from "./MarkdownContent.vue";

const props = defineProps<{
  document: WorkspaceDocument;
  resourceId: string;
  draftState: EditorDraftState | undefined;
  locateReference?: EditorTextReferenceNavigation | undefined;
  locked: boolean;
  lockedLabel?: string | undefined;
  saving?: boolean;
  autoSaveEnabled?: boolean;
  boundToCurrentBook?: boolean;
  sectionTabs?: readonly { id: string; title: string }[];
  activeSectionId?: string | undefined;
  sectionTabsLabel?: string | undefined;
  canCreateSection?: boolean;
  createSectionLabel?: string | undefined;
  showDeleteSection?: boolean;
  canDeleteSection?: boolean;
  deleteSectionLabel?: string | undefined;
}>();

const emit = defineEmits<{
  collapse: [];
  save: [payload: { id: string; title: string; content: string }];
  liveChange: [payload: { id: string; title: string; content: string }];
  insertSelection: [reference: EditorTextReference];
  selectSection: [sectionId: string];
  createSection: [];
  deleteSection: [];
  selectDraftFile: [fileKind: "body" | "character-state"];
}>();

const editorInput = ref<HTMLTextAreaElement>();
const documentPreview = ref<HTMLElement>();
const selectionMenuElement = ref<HTMLElement>();
const editorToolsElement = ref<HTMLElement>();
const findPanelElement = ref<HTMLElement>();
const findInput = ref<HTMLInputElement>();
const selectionAction = ref<{
  reference: EditorTextReference;
  left: number;
  top: number;
} | null>(null);
const title = ref(props.draftState?.title ?? props.document.title);
const content = ref(props.draftState?.content ?? props.document.content);
const nonWhitespaceCharacterCount = ref(
  countNonWhitespaceCharacters(content.value)
);
const dirty = ref(props.draftState?.dirty ?? false);
const viewMode = ref<EditorScrollView>("edit");
const findPanelOpen = ref(false);
const findPanelMode = ref<"find" | "replace">("find");
const searchQuery = ref("");
const replacementText = ref("");
const currentMatchIndex = ref(-1);
const searchAnchor = ref(0);

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
const activeScrollMemoryKey = computed(() => editorScrollMemoryKey(props.document));

watch(
  activeScrollMemoryKey,
  (nextScrollMemoryKey, previousScrollMemoryKey) => {
    rememberCurrentDocumentScroll(previousScrollMemoryKey);
    title.value = props.draftState?.title ?? props.document.title;
    content.value = props.draftState?.content ?? props.document.content;
    nonWhitespaceCharacterCount.value = countNonWhitespaceCharacters(
      content.value
    );
    dirty.value = props.draftState?.dirty ?? false;
    viewMode.value = "edit";
    selectionAction.value = null;
    findPanelOpen.value = false;
    searchQuery.value = "";
    replacementText.value = "";
    currentMatchIndex.value = -1;
    resetEditorHistory();
    void restoreDocumentScroll(nextScrollMemoryKey, "edit");
  }
);

watch(
  () => [
    props.draftState?.title,
    props.draftState?.content,
    props.draftState?.dirty,
    props.document.title,
    props.document.content
  ] as const,
  ([nextTitle, nextContent, nextDirty, documentTitle, documentContent]) => {
    const resolvedTitle = nextTitle ?? documentTitle;
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
    (props.document.domain === "material" || props.document.domain === "skill") &&
    Boolean(props.document.catalogEntryId)
);
const isLibraryOverview = computed(
  () => props.document.catalogLibraryField === "overview"
);
const isCharacterOverview = computed(
  () => props.document.characterFileKind === "overview"
);
const isPlotStage = computed(
  () => props.document.plotStageOrder !== undefined
);
const isTitleReadOnly = computed(
  () =>
    props.document.readOnly ||
    props.locked ||
    props.document.draftFileKind === "character-state" ||
    isLibraryOverview.value ||
    isCharacterOverview.value ||
    isPlotStage.value
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
const contentMaxLength = computed(() =>
  isLibraryOverview.value
    ? CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS
    : isLibraryEntry.value
      ? LIBRARY_AGENT_ENTRY_MAX_CHARACTERS
      : undefined
);
const contentExceedsLimit = computed(
  () => contentMaxLength.value !== undefined && content.value.length > contentMaxLength.value
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
  const current = currentMatchIndex.value >= 0 ? currentMatchIndex.value + 1 : 0;
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
  if (
    contentMaxLength.value !== undefined &&
    afterContent.length > contentMaxLength.value
  ) {
    input.value = beforeContent;
    pendingEditorInput = null;
    updateContent(afterContent);
    return;
  }
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
  if (contentMaxLength.value !== undefined && nextContent.length > contentMaxLength.value) {
    uiMessage.warning(
      isLibraryOverview.value
        ? "素材库或技能库介绍最多 40,000 字，请精简内容后再编辑"
        : "每个素材库或技能库条目最多 40,000 字，请精简内容后再编辑"
    );
    return false;
  }
  if (content.value === nextContent) return true;
  content.value = nextContent;
  nonWhitespaceCharacterCount.value =
    nonWhitespaceDelta === undefined
      ? countNonWhitespaceCharacters(nextContent)
      : Math.max(
          0,
          nonWhitespaceCharacterCount.value + nonWhitespaceDelta
        );
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
  viewMode.value = "edit";
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
  if (contentExceedsLimit.value) {
    uiMessage.warning(
      isLibraryOverview.value
        ? "素材库或技能库介绍最多 40,000 字，请精简内容后再保存"
        : "每个素材库或技能库条目最多 40,000 字，请精简内容后再保存"
    );
    return;
  }
  if (!title.value.trim()) {
    uiMessage.warning("请输入文档标题后再保存");
    return;
  }
  emit("save", { id: props.document.id, title: title.value, content: content.value });
}

function closeSelectionAction(): void {
  selectionAction.value = null;
}

function currentDocumentScroller(view: EditorScrollView): HTMLElement | undefined {
  return view === "edit" ? editorInput.value : documentPreview.value;
}

function rememberCurrentDocumentScroll(key = activeScrollMemoryKey.value): void {
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
  viewMode.value = view;
  closeSelectionAction();
  void restoreDocumentScroll(activeScrollMemoryKey.value, view);
}

function closeFindPanel(): void {
  findPanelOpen.value = false;
  currentMatchIndex.value = -1;
}

async function toggleFindPanel(mode: "find" | "replace"): Promise<void> {
  if (findPanelOpen.value && findPanelMode.value === mode) {
    closeFindPanel();
    return;
  }

  viewMode.value = "edit";
  closeSelectionAction();
  findPanelMode.value = mode;
  findPanelOpen.value = true;
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
    const index = matches.findIndex((match) => match.start >= searchAnchor.value);
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
  input.scrollTop = Math.max(0, (line - 1) * resolvedLineHeight - input.clientHeight / 3);
}

async function selectSearchMatch(index: number): Promise<void> {
  const match = searchMatches.value[index];
  if (!match) return;
  currentMatchIndex.value = index;
  viewMode.value = "edit";
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
    uiMessage.info(searchQuery.value ? "未找到可替换的文字" : "请输入要替换的文字");
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
    uiMessage.info(searchQuery.value ? "未找到可替换的文字" : "请输入要替换的文字");
    return;
  }

  let cursor = 0;
  let nextContent = "";
  for (const match of matches) {
    nextContent += content.value.slice(cursor, match.start) + replacementText.value;
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

function captureEditorSelection(
  input: HTMLTextAreaElement,
  event?: MouseEvent
): boolean {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  const reference = createEditorTextReference({
    id: randomHex8(),
    resourceId: props.resourceId,
    document: {
      ...props.document,
      title: title.value,
      content: content.value
    },
    start,
    end
  });
  if (!reference) {
    closeSelectionAction();
    return false;
  }

  const editorRect = input.getBoundingClientRect();
  const menuWidth = 142;
  const menuHeight = 42;
  const anchorLeft = event?.clientX ?? editorRect.left + 24;
  const anchorTop = event?.clientY ?? editorRect.top + 24;
  selectionAction.value = {
    reference,
    left: Math.max(8, Math.min(globalThis.innerWidth - menuWidth - 8, anchorLeft + 8)),
    top: Math.max(8, Math.min(globalThis.innerHeight - menuHeight - 8, anchorTop + 8))
  };
  return true;
}

function handleEditorContextMenu(event: MouseEvent): void {
  if (captureEditorSelection(event.currentTarget as HTMLTextAreaElement, event)) {
    event.preventDefault();
  }
}

function insertSelectedText(): void {
  const reference = selectionAction.value?.reference;
  if (!reference) return;
  emit("insertSelection", reference);
  closeSelectionAction();
}

function handleWindowPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!selectionMenuElement.value?.contains(target)) closeSelectionAction();
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
  if (!navigation || navigation.reference.documentId !== props.document.id) return;
  viewMode.value = "edit";
  closeSelectionAction();
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  const range = resolveEditorTextReferenceRange(content.value, navigation.reference);
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
        <span class="save-state" :class="{ 'is-dirty': dirty }">
          <AppIcon :name="dirty ? 'save' : 'check'" :size="13" />
          {{ document.readOnly ? "只读" : locked ? (lockedLabel ?? "智能体运行中 · 暂停编辑") : saving ? "正在保存到本机" : dirty ? (autoSaveEnabled ? "等待自动保存" : "有未应用修改") : persistedDocument ? "已保存到本机" : "本次运行已应用" }}
        </span>
        <button
          class="icon-button"
          type="button"
          aria-label="收起文本内容栏"
          @click="emit('collapse')"
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
            <span class="editor-find-count" aria-live="polite">{{ searchResultLabel }}</span>
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
      </div>
    </div>

    <div class="editor-document" :class="{ 'is-readonly': document.readOnly || locked }">
      <div class="document-meta-row">
        <span>{{ document.eyebrow }}</span>
        <span v-if="document.format" class="document-format">{{ document.format }}</span>
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
      </div>

      <input
        v-model="title"
        class="document-title-input"
        :readonly="isTitleReadOnly"
        aria-label="文档标题"
        @input="markDirty"
      />

      <textarea
        v-if="viewMode === 'edit'"
        ref="editorInput"
        :value="content"
        class="document-editor"
        :readonly="document.readOnly || locked"
        :maxlength="contentMaxLength"
        aria-label="文本内容编辑器"
        spellcheck="false"
        @beforeinput="handleEditorBeforeInput"
        @input="handleEditorInput"
        @keydown="handleEditorKeydown"
        @contextmenu="handleEditorContextMenu"
        @scroll="handleDocumentScroll"
      />
      <article
        v-else
        ref="documentPreview"
        class="document-preview"
        @scroll="handleDocumentScroll"
      >
        <MarkdownContent v-if="content.trim()" :content="content" />
        <p v-else class="document-preview-empty">暂无内容</p>
      </article>
    </div>

    <footer class="editor-footer">
      <span>
        {{ characterCount.toLocaleString("zh-CN") }}<template v-if="contentMaxLength"> / {{ contentMaxLength.toLocaleString("zh-CN") }}</template> 字
      </span>
      <span
        v-if="isLibraryDocument"
        class="library-entry-limit-hint"
        :class="{ 'limit-warning': contentExceedsLimit }"
        :title="isLibraryOverview ? '素材库或技能库介绍最多 40,000 字' : '每个素材库或技能库条目最多 40,000 字，请勿上传过多内容'"
      >
        {{ isLibraryOverview ? "库介绍最多 40,000 字" : "每个条目最多 40,000 字，请勿上传过多内容" }}
      </span>
      <span class="editor-save-status">{{ locked ? (lockedLabel ?? "智能体运行中 · 防止版本冲突") : saving ? "正在原子保存本机文稿" : persistedDocument ? (autoSaveEnabled ? "本机文稿 · 更改后自动保存" : "本机文稿 · 应用后持久保存") : "内存草稿 · 重启后不保留" }}</span>
      <span class="footer-spacer" />
      <button
        class="save-button"
        type="button"
        :disabled="document.readOnly || locked || saving || !dirty || contentExceedsLimit"
        @click="save"
      >
        <AppIcon name="save" :size="14" />
        {{ saving ? "保存中…" : autoSaveEnabled ? "立即保存" : "应用" }}
      </button>
    </footer>
  </aside>

  <Teleport to="body">
    <div
      v-if="selectionAction"
      ref="selectionMenuElement"
      class="editor-selection-menu"
      role="menu"
      aria-label="正文选区操作"
      :style="{ left: `${selectionAction.left}px`, top: `${selectionAction.top}px` }"
    >
      <button
        type="button"
        role="menuitem"
        @mousedown.prevent
        @click="insertSelectedText"
      >
        <AppIcon name="message" :size="15" />
        插入输入框
      </button>
    </div>
  </Teleport>
</template>
