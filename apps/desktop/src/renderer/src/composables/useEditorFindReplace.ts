import { createScopedTranslator } from "../i18n";
import { computed, nextTick, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import type { TextSelectionRange } from "../utils/boundedTextHistory";
import { revealTextareaOffset } from "../utils/textareaMirror";

const t = createScopedTranslator("workspace.editorFindReplace");

export type EditorFindPanelMode = "find" | "replace";

export interface EditorSearchMatch {
  start: number;
  end: number;
}

export interface EditorFindReplaceOptions {
  content: () => string;
  readOnly: () => boolean;
  /** Text tools can be unavailable while a document is loading. */
  canOpen?: () => boolean;
  editorInput: () => HTMLTextAreaElement | null | undefined;
  showEditor: () => void;
  onOpen?: () => void;
  replaceContent: (
    nextContent: string,
    selectionAfter: TextSelectionRange
  ) => void;
  undo: () => void;
  redo: () => void;
  isComposing?: () => boolean;
}

export function findEditorSearchMatches(
  content: string,
  query: string
): EditorSearchMatch[] {
  if (!query) return [];
  const matches: EditorSearchMatch[] = [];
  let start = 0;
  while (start <= content.length - query.length) {
    const index = content.indexOf(query, start);
    if (index < 0) break;
    matches.push({ start: index, end: index + query.length });
    start = index + query.length;
  }
  return matches;
}

/**
 * Find and replace for a textarea editor. Focus stays in the find panel while
 * searching: moving it would commit an IME composition as raw pinyin. The panel
 * closes only on an explicit request, so returning to the window and clicking
 * the text keeps the search.
 */
export function useEditorFindReplace(options: EditorFindReplaceOptions) {
  const findPanelElement = ref<HTMLElement | null>(null);
  const findInput = ref<HTMLInputElement | null>(null);
  const findPanelOpen = ref(false);
  const findPanelMode = ref<EditorFindPanelMode>("find");
  const searchQuery = ref("");
  const replacementText = ref("");
  const currentMatchIndex = ref(-1);
  let searchAnchor = 0;

  const searchMatches = computed(() =>
    findEditorSearchMatches(options.content(), searchQuery.value)
  );
  const searchResultLabel = computed(() => {
    if (!searchQuery.value) return "0/0";
    const total = searchMatches.value.length;
    if (!total) return t("noResults");
    const index = currentMatchIndex.value;
    return `${index >= 0 && index < total ? index + 1 : 0}/${total}`;
  });

  // A new query or edited text invalidates the active match. Edits typed in the
  // editor move the anchor, so the next search continues from the caret.
  watch(
    searchQuery,
    () => {
      currentMatchIndex.value = -1;
    },
    { flush: "sync" }
  );
  watch(
    options.content,
    () => {
      currentMatchIndex.value = -1;
      const input = options.editorInput();
      if (input && input.ownerDocument.activeElement === input) {
        searchAnchor = input.selectionStart;
      }
    },
    { flush: "sync" }
  );

  function closeFindPanel(): void {
    findPanelOpen.value = false;
    currentMatchIndex.value = -1;
  }

  /** Closes on user request and returns focus to the text, keeping the match selected. */
  function dismissFindPanel(): void {
    const panel = findPanelElement.value;
    const focusInPanel = Boolean(
      panel?.contains(panel.ownerDocument.activeElement)
    );
    closeFindPanel();
    if (focusInPanel) options.editorInput()?.focus({ preventScroll: true });
  }

  async function openFindPanel(mode: EditorFindPanelMode): Promise<void> {
    if (options.canOpen && !options.canOpen()) return;
    options.showEditor();
    options.onOpen?.();
    findPanelMode.value = mode;
    if (!findPanelOpen.value) {
      findPanelOpen.value = true;
      searchAnchor = options.editorInput()?.selectionStart ?? 0;
      currentMatchIndex.value = -1;
    }
    await nextTick();
    findInput.value?.focus({ preventScroll: true });
    findInput.value?.select();
  }

  async function toggleFindPanel(mode: EditorFindPanelMode): Promise<void> {
    if (findPanelOpen.value && findPanelMode.value === mode) {
      dismissFindPanel();
      return;
    }
    await openFindPanel(mode);
  }

  function resolveInitialMatchIndex(direction: 1 | -1): number {
    const matches = searchMatches.value;
    if (!matches.length) return -1;
    if (direction === 1) {
      const index = matches.findIndex((match) => match.start >= searchAnchor);
      return index >= 0 ? index : 0;
    }
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (matches[index]!.end <= searchAnchor) return index;
    }
    return matches.length - 1;
  }

  function findPanelInset(input: HTMLTextAreaElement): number {
    const panel = findPanelElement.value;
    if (!panel) return 0;
    return (
      panel.getBoundingClientRect().bottom - input.getBoundingClientRect().top
    );
  }

  async function selectSearchMatch(index: number): Promise<void> {
    const match = searchMatches.value[index];
    if (!match) return;
    currentMatchIndex.value = index;
    options.showEditor();
    await nextTick();
    const input = options.editorInput();
    if (!input) return;
    // The selection is kept without focusing the editor; it shows once the
    // panel closes and focus returns to the text.
    input.setSelectionRange(match.start, match.end, "forward");
    revealTextareaOffset(input, match.start, findPanelInset(input));
  }

  function findMatch(direction: 1 | -1, quiet = false): void {
    if (!searchQuery.value) {
      if (!quiet) uiMessage.info(t("enterTextToFind"));
      return;
    }
    const total = searchMatches.value.length;
    if (!total) {
      currentMatchIndex.value = -1;
      if (!quiet) uiMessage.info(t("noMatchingTextFound"));
      return;
    }
    const nextIndex =
      currentMatchIndex.value < 0
        ? resolveInitialMatchIndex(direction)
        : (currentMatchIndex.value + direction + total) % total;
    void selectSearchMatch(nextIndex);
  }

  function handleFindInput(): void {
    if (searchQuery.value) findMatch(1, true);
  }

  function replaceCurrentMatch(): void {
    if (options.readOnly()) return;
    const index =
      currentMatchIndex.value >= 0
        ? currentMatchIndex.value
        : resolveInitialMatchIndex(1);
    const match = searchMatches.value[index];
    if (!match) {
      uiMessage.info(
        searchQuery.value ? t("noTextToReplace") : t("enterTextToReplace")
      );
      return;
    }
    const content = options.content();
    const replacement = replacementText.value;
    const nextContent =
      content.slice(0, match.start) + replacement + content.slice(match.end);
    if (nextContent === content) {
      findMatch(1);
      return;
    }
    const caret = match.start + replacement.length;
    options.replaceContent(nextContent, { start: caret, end: caret });
    searchAnchor = caret;
    void nextTick(() => findMatch(1, true));
  }

  function replaceAllMatches(): void {
    if (options.readOnly()) return;
    const matches = searchMatches.value;
    if (!searchQuery.value || !matches.length) {
      uiMessage.info(
        searchQuery.value ? t("noTextToReplace") : t("enterTextToReplace")
      );
      return;
    }
    const content = options.content();
    let cursor = 0;
    let nextContent = "";
    for (const match of matches) {
      nextContent += content.slice(cursor, match.start) + replacementText.value;
      cursor = match.end;
    }
    nextContent += content.slice(cursor);
    if (nextContent === content) {
      uiMessage.info(t("findAndReplacementTextAreTheSame"));
      return;
    }
    options.replaceContent(nextContent, { start: 0, end: 0 });
    searchAnchor = 0;
    uiMessage.success(t("replacedMatches", { length: matches.length }));
  }

  function handleEditorKeydown(event: KeyboardEvent): void {
    if (event.isComposing || options.isComposing?.()) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (key === "escape" && findPanelOpen.value) {
      event.preventDefault();
      closeFindPanel();
      return;
    }
    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) options.redo();
      else options.undo();
      return;
    }
    if (event.ctrlKey && !event.metaKey && key === "y") {
      event.preventDefault();
      options.redo();
      return;
    }
    if (modifier && key === "f" && !(event.metaKey && event.altKey)) {
      event.preventDefault();
      void openFindPanel("find");
      return;
    }
    if (
      (event.ctrlKey && !event.metaKey && key === "h") ||
      (event.metaKey && event.altKey && key === "f")
    ) {
      event.preventDefault();
      void openFindPanel("replace");
    }
  }

  return {
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
  };
}
