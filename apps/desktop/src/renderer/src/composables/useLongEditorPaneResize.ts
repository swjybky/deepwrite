import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComputedRef,
  type Ref
} from "vue";
import {
  LONG_EDITOR_LIST_MAX_WIDTH,
  LONG_EDITOR_LIST_MIN_WIDTH,
  loadLongEditorPanePreferences,
  saveLongEditorPanePreferences
} from "../utils/longEditorPanePreferences";

const LONG_EDITOR_DIVIDER_WIDTH = 7;
const LONG_EDITOR_DEFAULT_LIST_RATIO = 0.38;
const LONG_EDITOR_ENTRY_CONTENT_MIN_WIDTH = 240;
const LONG_EDITOR_STORY_DETAIL_MIN_WIDTH = 320;

export type LongEditorResizablePane = "entry-list" | "story-plot-list";

export function useLongEditorPaneResize(options: {
  currentUsesAnyRightEntryList: ComputedRef<boolean>;
  currentIsPlotPointStoryline: ComputedRef<boolean>;
}): {
  longEditorDocumentElement: Ref<HTMLElement | null>;
  storyPlotLayoutElement: Ref<HTMLElement | null>;
  preferredEntryListWidth: Ref<number | undefined>;
  preferredStoryPlotListWidth: Ref<number | undefined>;
  entryListWidth: Ref<number | undefined>;
  storyPlotListWidth: Ref<number | undefined>;
  entryListMaxWidth: Ref<number>;
  storyPlotListMaxWidth: Ref<number>;
  resizingLongEditorPane: Ref<LongEditorResizablePane | null>;
  entryListGridStyle: ComputedRef<Record<string, string> | undefined>;
  storyPlotListGridStyle: ComputedRef<Record<string, string> | undefined>;
  setDisplayedLongEditorPaneWidth: (
    pane: LongEditorResizablePane,
    requestedWidth?: number
  ) => void;
  reconcileLongEditorPaneWidths: () => void;
  startLongEditorPaneResize: (
    pane: LongEditorResizablePane,
    event: PointerEvent
  ) => void;
  handleLongEditorPaneResizeKeydown: (
    pane: LongEditorResizablePane,
    event: KeyboardEvent
  ) => void;
  stopLongEditorPaneResize: () => void;
} {
  const { currentUsesAnyRightEntryList, currentIsPlotPointStoryline } = options;
  const longEditorDocumentElement = ref<HTMLElement | null>(null);
  const storyPlotLayoutElement = ref<HTMLElement | null>(null);
  const longEditorPanePreferences = loadLongEditorPanePreferences(
    window.localStorage
  );
  const preferredEntryListWidth = ref(longEditorPanePreferences.entryListWidth);
  const preferredStoryPlotListWidth = ref(
    longEditorPanePreferences.storyPlotListWidth
  );
  const entryListWidth = ref<number>();
  const storyPlotListWidth = ref<number>();
  const entryListMaxWidth = ref(LONG_EDITOR_LIST_MAX_WIDTH);
  const storyPlotListMaxWidth = ref(LONG_EDITOR_LIST_MAX_WIDTH);
  const resizingLongEditorPane = ref<LongEditorResizablePane | null>(null);
  let entryListResizeObserver: ResizeObserver | undefined;
  let storyPlotListResizeObserver: ResizeObserver | undefined;

  const entryListGridStyle = computed(() =>
    !currentUsesAnyRightEntryList.value || entryListWidth.value === undefined
      ? undefined
      : { "--long-entry-list-width": `${entryListWidth.value}px` }
  );
  const storyPlotListGridStyle = computed(() =>
    !currentIsPlotPointStoryline.value || storyPlotListWidth.value === undefined
      ? undefined
      : { "--long-story-plot-list-width": `${storyPlotListWidth.value}px` }
  );

  function longEditorPaneContainer(
    pane: LongEditorResizablePane
  ): HTMLElement | null {
    return pane === "entry-list"
      ? longEditorDocumentElement.value
      : storyPlotLayoutElement.value;
  }

  function longEditorPaneActive(pane: LongEditorResizablePane): boolean {
    return pane === "entry-list"
      ? currentUsesAnyRightEntryList.value
      : currentIsPlotPointStoryline.value;
  }

  function longEditorPaneContentMinWidth(
    pane: LongEditorResizablePane
  ): number {
    if (pane === "story-plot-list") {
      return LONG_EDITOR_STORY_DETAIL_MIN_WIDTH;
    }
    return currentIsPlotPointStoryline.value
      ? LONG_EDITOR_STORY_DETAIL_MIN_WIDTH +
          LONG_EDITOR_LIST_MIN_WIDTH +
          LONG_EDITOR_DIVIDER_WIDTH
      : LONG_EDITOR_ENTRY_CONTENT_MIN_WIDTH;
  }

  function preferredLongEditorPaneWidth(
    pane: LongEditorResizablePane
  ): number | undefined {
    return pane === "entry-list"
      ? preferredEntryListWidth.value
      : preferredStoryPlotListWidth.value;
  }

  function resolveLongEditorPaneWidth(
    pane: LongEditorResizablePane,
    containerWidth: number,
    requestedWidth?: number
  ): { width: number; max: number } | undefined {
    if (!Number.isFinite(containerWidth) || containerWidth <= 0)
      return undefined;
    const availableMax = Math.max(
      LONG_EDITOR_LIST_MIN_WIDTH,
      Math.floor(
        containerWidth -
          longEditorPaneContentMinWidth(pane) -
          LONG_EDITOR_DIVIDER_WIDTH
      )
    );
    const max = Math.min(LONG_EDITOR_LIST_MAX_WIDTH, availableMax);
    const target =
      requestedWidth ??
      preferredLongEditorPaneWidth(pane) ??
      Math.round(containerWidth * LONG_EDITOR_DEFAULT_LIST_RATIO);
    return {
      width: Math.round(
        Math.min(Math.max(target, LONG_EDITOR_LIST_MIN_WIDTH), max)
      ),
      max
    };
  }

  function setDisplayedLongEditorPaneWidth(
    pane: LongEditorResizablePane,
    requestedWidth?: number
  ): void {
    if (!longEditorPaneActive(pane)) return;
    const container = longEditorPaneContainer(pane);
    if (!container) return;
    applyLongEditorPaneWidth(
      pane,
      container.getBoundingClientRect().width,
      requestedWidth
    );
  }

  function applyLongEditorPaneWidth(
    pane: LongEditorResizablePane,
    containerWidth: number,
    requestedWidth?: number
  ): void {
    const resolved = resolveLongEditorPaneWidth(
      pane,
      containerWidth,
      requestedWidth
    );
    if (!resolved) return;
    if (pane === "entry-list") {
      entryListWidth.value = resolved.width;
      entryListMaxWidth.value = resolved.max;
      return;
    }
    storyPlotListWidth.value = resolved.width;
    storyPlotListMaxWidth.value = resolved.max;
  }

  function reconcileLongEditorPaneWidths(): void {
    if (currentUsesAnyRightEntryList.value) {
      setDisplayedLongEditorPaneWidth("entry-list");
    }
    if (currentIsPlotPointStoryline.value) {
      setDisplayedLongEditorPaneWidth("story-plot-list");
    }
  }

  function persistLongEditorPaneWidths(): void {
    saveLongEditorPanePreferences(window.localStorage, {
      ...(preferredEntryListWidth.value === undefined
        ? {}
        : { entryListWidth: preferredEntryListWidth.value }),
      ...(preferredStoryPlotListWidth.value === undefined
        ? {}
        : { storyPlotListWidth: preferredStoryPlotListWidth.value })
    });
  }

  function commitLongEditorPaneWidth(pane: LongEditorResizablePane): void {
    if (pane === "entry-list") {
      preferredEntryListWidth.value = entryListWidth.value;
    } else {
      preferredStoryPlotListWidth.value = storyPlotListWidth.value;
    }
    persistLongEditorPaneWidths();
  }

  function handleLongEditorPaneResizeMove(event: PointerEvent): void {
    const pane = resizingLongEditorPane.value;
    const container = pane ? longEditorPaneContainer(pane) : null;
    if (!pane || !container || !longEditorPaneActive(pane)) return;
    const bounds = container.getBoundingClientRect();
    applyLongEditorPaneWidth(pane, bounds.width, bounds.right - event.clientX);
  }

  function stopLongEditorPaneResize(): void {
    const pane = resizingLongEditorPane.value;
    resizingLongEditorPane.value = null;
    window.removeEventListener("pointermove", handleLongEditorPaneResizeMove);
    window.removeEventListener("pointerup", stopLongEditorPaneResize);
    window.removeEventListener("pointercancel", stopLongEditorPaneResize);
    document.documentElement.classList.remove("is-long-editor-pane-resizing");
    if (pane) commitLongEditorPaneWidth(pane);
  }

  function startLongEditorPaneResize(
    pane: LongEditorResizablePane,
    event: PointerEvent
  ): void {
    event.preventDefault();
    event.stopPropagation();
    resizingLongEditorPane.value = pane;
    document.documentElement.classList.add("is-long-editor-pane-resizing");
    window.addEventListener("pointermove", handleLongEditorPaneResizeMove);
    window.addEventListener("pointerup", stopLongEditorPaneResize);
    window.addEventListener("pointercancel", stopLongEditorPaneResize);
  }

  function handleLongEditorPaneResizeKeydown(
    pane: LongEditorResizablePane,
    event: KeyboardEvent
  ): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentWidth =
      pane === "entry-list" ? entryListWidth.value : storyPlotListWidth.value;
    if (currentWidth === undefined) return;
    setDisplayedLongEditorPaneWidth(
      pane,
      currentWidth + (event.key === "ArrowLeft" ? 12 : -12)
    );
    commitLongEditorPaneWidth(pane);
  }

  watch(
    [
      longEditorDocumentElement,
      currentUsesAnyRightEntryList,
      currentIsPlotPointStoryline
    ],
    ([current, active], [previous]) => {
      if (previous) entryListResizeObserver?.unobserve(previous);
      if (current && active) {
        entryListResizeObserver?.observe(current);
        void nextTick(() => setDisplayedLongEditorPaneWidth("entry-list"));
      }
    },
    { flush: "post" }
  );

  watch(
    [storyPlotLayoutElement, currentIsPlotPointStoryline],
    ([current, active], [previous]) => {
      if (previous) storyPlotListResizeObserver?.unobserve(previous);
      if (current && active) {
        storyPlotListResizeObserver?.observe(current);
        void nextTick(() => setDisplayedLongEditorPaneWidth("story-plot-list"));
      }
    },
    { flush: "post" }
  );

  function handleObservedResize(
    pane: LongEditorResizablePane,
    entries: ResizeObserverEntry[]
  ): void {
    if (!longEditorPaneActive(pane) || resizingLongEditorPane.value === pane)
      return;
    const entry = entries.find(
      ({ target }) => target === longEditorPaneContainer(pane)
    );
    if (entry) {
      applyLongEditorPaneWidth(
        pane,
        entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width
      );
    }
  }

  onMounted(() => {
    entryListResizeObserver = new ResizeObserver((entries) =>
      handleObservedResize("entry-list", entries)
    );
    storyPlotListResizeObserver = new ResizeObserver((entries) =>
      handleObservedResize("story-plot-list", entries)
    );
    if (longEditorDocumentElement.value && currentUsesAnyRightEntryList.value) {
      entryListResizeObserver.observe(longEditorDocumentElement.value);
    }
    if (storyPlotLayoutElement.value && currentIsPlotPointStoryline.value) {
      storyPlotListResizeObserver.observe(storyPlotLayoutElement.value);
    }
    reconcileLongEditorPaneWidths();
    window.addEventListener("resize", reconcileLongEditorPaneWidths);
  });
  onBeforeUnmount(() => {
    stopLongEditorPaneResize();
    entryListResizeObserver?.disconnect();
    storyPlotListResizeObserver?.disconnect();
    window.removeEventListener("resize", reconcileLongEditorPaneWidths);
  });

  return {
    longEditorDocumentElement,
    storyPlotLayoutElement,
    preferredEntryListWidth,
    preferredStoryPlotListWidth,
    entryListWidth,
    storyPlotListWidth,
    entryListMaxWidth,
    storyPlotListMaxWidth,
    resizingLongEditorPane,
    entryListGridStyle,
    storyPlotListGridStyle,
    setDisplayedLongEditorPaneWidth,
    reconcileLongEditorPaneWidths,
    startLongEditorPaneResize,
    handleLongEditorPaneResizeKeydown,
    stopLongEditorPaneResize
  };
}
