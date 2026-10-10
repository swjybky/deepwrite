import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import type {
  EditorEntrySearchResult,
  EditorEntrySearchSource
} from "../types/editorEntrySearch";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("workspace");

const SEARCH_DELAY_MS = 180;
const MAX_LOCAL_RESULTS = 30;

function compactSnippet(content: string, matchIndex: number): string {
  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(content.length, matchIndex + 112);
  const snippet = content.slice(start, end).replace(/\s+/gu, " ").trim();
  if (!snippet) return "";
  return `${start > 0 ? "…" : ""}${snippet}${end < content.length ? "…" : ""}`;
}

export function searchLocalEditorEntries(
  sources: readonly EditorEntrySearchSource[],
  rawQuery: string
): EditorEntrySearchResult[] {
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN");
  if (!query) return [];

  return sources
    .flatMap<EditorEntrySearchResult>((source) => {
      const titleIndex = source.title.toLocaleLowerCase("zh-CN").indexOf(query);
      const contentIndex = source.content
        .toLocaleLowerCase("zh-CN")
        .indexOf(query);
      if (titleIndex < 0 && contentIndex < 0) return [];
      return [
        {
          id: source.id,
          title: source.title,
          ...(contentIndex >= 0
            ? { detail: compactSnippet(source.content, contentIndex) }
            : {})
        }
      ];
    })
    .sort((left, right) => {
      const leftTitleMatch = left.title
        .toLocaleLowerCase("zh-CN")
        .includes(query);
      const rightTitleMatch = right.title
        .toLocaleLowerCase("zh-CN")
        .includes(query);
      return Number(rightTitleMatch) - Number(leftTitleMatch);
    })
    .slice(0, MAX_LOCAL_RESULTS);
}

export function useEditorEntrySearch(options: {
  search: (
    query: string
  ) =>
    | readonly EditorEntrySearchResult[]
    | Promise<readonly EditorEntrySearchResult[]>;
  navigate: (result: EditorEntrySearchResult) => void | Promise<void>;
}): {
  query: Ref<string>;
  results: Ref<EditorEntrySearchResult[]>;
  activeIndex: Ref<number>;
  pending: Ref<boolean>;
  resultLabel: Readonly<Ref<string>>;
  handleInput: () => void;
  moveActive: (direction: 1 | -1) => void;
  selectResult: (index?: number) => Promise<void>;
  reset: () => void;
} {
  const query = ref("");
  const results = ref<EditorEntrySearchResult[]>([]);
  const activeIndex = ref(-1);
  const pending = ref(false);
  let timer: number | undefined;
  let requestEpoch = 0;

  const resultLabel = computed(() => {
    if (pending.value) return t("editorEntrySearch.searching");
    if (!query.value.trim()) return "0/0";
    if (!results.value.length) return t("editorFindReplace.noResults");
    return `${activeIndex.value + 1}/${results.value.length}`;
  });

  function clearTimer(): void {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
  }

  function resetResults(): void {
    results.value = [];
    activeIndex.value = -1;
  }

  async function runSearch(rawQuery: string, epoch: number): Promise<void> {
    try {
      const nextResults = await options.search(rawQuery);
      if (epoch !== requestEpoch) return;
      results.value = [...nextResults];
      activeIndex.value = nextResults.length ? 0 : -1;
    } catch (error) {
      if (epoch !== requestEpoch) return;
      resetResults();
      uiMessage.error(
        formatError(error, t("editorEntrySearch.failedToSearchAllEntries"))
      );
    } finally {
      if (epoch === requestEpoch) pending.value = false;
    }
  }

  function handleInput(): void {
    clearTimer();
    const rawQuery = query.value;
    const epoch = ++requestEpoch;
    resetResults();
    if (!rawQuery.trim()) {
      pending.value = false;
      return;
    }
    pending.value = true;
    timer = window.setTimeout(() => {
      timer = undefined;
      void runSearch(rawQuery, epoch);
    }, SEARCH_DELAY_MS);
  }

  function moveActive(direction: 1 | -1): void {
    if (!results.value.length) return;
    activeIndex.value =
      (activeIndex.value + direction + results.value.length) %
      results.value.length;
  }

  async function selectResult(index = activeIndex.value): Promise<void> {
    const result = results.value[index];
    if (!result) {
      uiMessage.info(
        query.value.trim()
          ? t("editorEntrySearch.noMatchingEntriesFound")
          : t("editorEntrySearch.enterASearchTerm")
      );
      return;
    }
    activeIndex.value = index;
    await options.navigate(result);
  }

  function reset(): void {
    clearTimer();
    requestEpoch += 1;
    query.value = "";
    pending.value = false;
    resetResults();
  }

  onBeforeUnmount(() => {
    clearTimer();
    requestEpoch += 1;
  });

  return {
    query,
    results,
    activeIndex,
    pending,
    resultLabel,
    handleInput,
    moveActive,
    selectResult,
    reset
  };
}
