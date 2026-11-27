import { createScopedTranslator } from "../../i18n";
import { computed, ref, shallowRef } from "vue";
import {
  LongBookAnalysisSourceSchema,
  type DeepWriteApi,
  type LongBookAnalysisChapter,
  type LongBookAnalysisSavedSourceSummary,
  type LongBookAnalysisSource,
  type LongBookAnalysisSourceKind
} from "@deepwrite/contracts/renderer";

const t = createScopedTranslator("extras.longBookAnalysis");
const MAX_CHAPTER_UNDO_STEPS = 50;

export interface ReplaceAnalysisChaptersOptions {
  beforeSelectedChapterId?: string;
  afterSelectedChapterId?: string;
}

interface ChapterUndoEntry {
  chapters: readonly LongBookAnalysisChapter[];
  selectedChapterId: string;
  dirty: boolean;
}

function resolveFallbackSelectedId(
  chapters: readonly LongBookAnalysisChapter[],
  previousChapters: readonly LongBookAnalysisChapter[],
  previousSelectedId: string
): string {
  if (chapters.some((chapter) => chapter.id === previousSelectedId)) {
    return previousSelectedId;
  }
  const previousIndex = Math.max(
    0,
    previousChapters.findIndex((chapter) => chapter.id === previousSelectedId)
  );
  return chapters[Math.min(previousIndex, chapters.length - 1)]?.id ?? "";
}

/** The imported novel and the saved-source list of the long analysis page. */
export function createLongAnalysisSources(options: {
  api: () => DeepWriteApi;
  isBusy: () => boolean;
  isDisposed: () => boolean;
  /** Called before the source changes, so unfinished tasks are dropped. */
  onChange: () => void;
}) {
  const source = shallowRef<LongBookAnalysisSource | null>(null);
  const selectedChapterId = ref("");
  const undoStack = shallowRef<readonly ChapterUndoEntry[]>([]);
  const canUndoChapters = computed(() => undoStack.value.length > 0);
  const savedSources = ref<LongBookAnalysisSavedSourceSummary[]>([]);
  const sourcesLoading = ref(false);
  const sourceSaving = ref(false);
  const sourceDeleting = ref(false);
  const sourceDirty = ref(false);
  let sourceListSequence = 0;
  let activeSourceListRequests = 0;
  let sourceOperationSequence = 0;

  function selectChapter(chapterId: string): void {
    if (!source.value?.chapters.some((chapter) => chapter.id === chapterId)) {
      return;
    }
    selectedChapterId.value = chapterId;
  }

  function clearSource(): void {
    undoStack.value = [];
    selectedChapterId.value = "";
    sourceDirty.value = false;
    source.value = null;
  }

  async function loadSavedSources(): Promise<void> {
    const sequence = ++sourceListSequence;
    activeSourceListRequests += 1;
    sourcesLoading.value = true;
    try {
      const catalog = await options.api().longBookAnalysis.sources.list();
      if (!options.isDisposed() && sequence === sourceListSequence) {
        savedSources.value = catalog.sources;
      }
    } finally {
      activeSourceListRequests -= 1;
      if (!options.isDisposed())
        sourcesLoading.value = activeSourceListRequests > 0;
    }
  }

  async function loadSavedSource(sourceId: string): Promise<boolean> {
    if (options.isBusy() || sourceSaving.value || sourceDeleting.value)
      throw new Error(t("sourceLockedWhileRunning"));
    if (source.value?.id === sourceId) return false;
    const sequence = ++sourceOperationSequence;
    const selected = await options
      .api()
      .longBookAnalysis.sources.load(sourceId);
    if (
      options.isDisposed() ||
      sequence !== sourceOperationSequence ||
      options.isBusy()
    )
      return false;
    options.onChange();
    undoStack.value = [];
    source.value = selected;
    selectedChapterId.value = selected.chapters[0]?.id ?? "";
    sourceDirty.value = false;
    return true;
  }

  async function chooseSource(
    kind: LongBookAnalysisSourceKind
  ): Promise<boolean> {
    if (options.isBusy() || sourceSaving.value || sourceDeleting.value)
      throw new Error(t("sourceLockedWhileRunning"));
    const sequence = ++sourceOperationSequence;
    const selected = await options.api().longBookAnalysis.chooseSource(kind);
    if (
      !selected ||
      options.isDisposed() ||
      sequence !== sourceOperationSequence ||
      options.isBusy()
    )
      return false;
    options.onChange();
    undoStack.value = [];
    source.value = selected;
    selectedChapterId.value = selected.chapters[0]?.id ?? "";
    sourceDirty.value = false;
    await loadSavedSources();
    return true;
  }

  function replaceChapters(
    chapters: readonly LongBookAnalysisChapter[],
    editOptions?: ReplaceAnalysisChaptersOptions
  ): boolean {
    const current = source.value;
    if (!current) return false;
    if (options.isBusy() || sourceSaving.value || sourceDeleting.value)
      throw new Error(t("sourceLockedWhileRunning"));
    const nextSource = LongBookAnalysisSourceSchema.parse({
      ...current,
      chapters: chapters.map((chapter, index) => ({
        ...chapter,
        order: index + 1
      }))
    });
    const beforeSelectedId =
      editOptions?.beforeSelectedChapterId &&
      current.chapters.some(
        (chapter) => chapter.id === editOptions.beforeSelectedChapterId
      )
        ? editOptions.beforeSelectedChapterId
        : current.chapters.some(
              (chapter) => chapter.id === selectedChapterId.value
            )
          ? selectedChapterId.value
          : (current.chapters[0]?.id ?? "");
    const nextSelectedId =
      editOptions?.afterSelectedChapterId &&
      nextSource.chapters.some(
        (chapter) => chapter.id === editOptions.afterSelectedChapterId
      )
        ? editOptions.afterSelectedChapterId
        : resolveFallbackSelectedId(
            nextSource.chapters,
            current.chapters,
            beforeSelectedId
          );
    sourceOperationSequence++;
    options.onChange();
    undoStack.value = [
      ...undoStack.value.slice(-(MAX_CHAPTER_UNDO_STEPS - 1)),
      {
        chapters: current.chapters,
        selectedChapterId: beforeSelectedId,
        dirty: sourceDirty.value
      }
    ];
    source.value = nextSource;
    selectedChapterId.value = nextSelectedId;
    sourceDirty.value = true;
    return true;
  }

  function undoChapters(): boolean {
    const current = source.value;
    const entry = undoStack.value.at(-1);
    if (!current || !entry) return false;
    if (options.isBusy() || sourceSaving.value || sourceDeleting.value)
      throw new Error(t("sourceLockedWhileRunning"));
    const restored = LongBookAnalysisSourceSchema.parse({
      ...current,
      chapters: entry.chapters.map((chapter, index) => ({
        ...chapter,
        order: index + 1
      }))
    });
    sourceOperationSequence++;
    options.onChange();
    undoStack.value = undoStack.value.slice(0, -1);
    source.value = restored;
    selectedChapterId.value = restored.chapters.some(
      (chapter) => chapter.id === entry.selectedChapterId
    )
      ? entry.selectedChapterId
      : (restored.chapters[0]?.id ?? "");
    sourceDirty.value = entry.dirty;
    return true;
  }

  async function saveSource(): Promise<void> {
    if (!source.value || (!sourceDirty.value && source.value.revision)) return;
    if (sourceSaving.value || sourceDeleting.value || options.isBusy())
      throw new Error(t("sourceLockedWhileRunning"));
    sourceSaving.value = true;
    sourceOperationSequence++;
    try {
      const current = source.value;
      const saved = await options.api().longBookAnalysis.sources.save({
        sourceId: current.id,
        baseRevision: current.revision ?? 0,
        chapters: current.chapters
      });
      source.value = saved;
      if (
        !saved.chapters.some(
          (chapter) => chapter.id === selectedChapterId.value
        )
      ) {
        selectedChapterId.value = saved.chapters[0]?.id ?? "";
      }
      undoStack.value = [];
      sourceDirty.value = false;
      await loadSavedSources();
    } finally {
      sourceSaving.value = false;
    }
  }

  async function deleteSavedSource(sourceId: string): Promise<void> {
    if (options.isBusy() || sourceSaving.value || sourceDeleting.value)
      throw new Error(t("sourceLockedWhileRunning"));
    sourceDeleting.value = true;
    sourceOperationSequence++;
    sourceListSequence++;
    try {
      await options.api().longBookAnalysis.sources.delete(sourceId);
      if (options.isDisposed()) return;
      sourceListSequence++;
      savedSources.value = savedSources.value.filter(
        (saved) => saved.id !== sourceId
      );
      if (source.value?.id === sourceId) {
        options.onChange();
        clearSource();
      }
    } finally {
      sourceDeleting.value = false;
    }
  }

  return {
    source,
    selectedChapterId,
    canUndoChapters,
    savedSources,
    sourcesLoading,
    sourceSaving,
    sourceDeleting,
    sourceDirty,
    selectChapter,
    clearSource,
    saveSource,
    loadSavedSources,
    loadSavedSource,
    deleteSavedSource,
    chooseSource,
    replaceChapters,
    undoChapters
  };
}
