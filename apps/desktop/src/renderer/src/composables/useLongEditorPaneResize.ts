import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type ComputedRef
} from "vue";
import {
  LONG_EDITOR_LIST_MAX_WIDTH,
  LONG_EDITOR_LIST_MIN_WIDTH,
  loadLongEditorPanePreferences,
  saveLongEditorPanePreferences
} from "../utils/longEditorPanePreferences";
import { uiStorage } from "../utils/uiStorage";

const LONG_EDITOR_DIVIDER_WIDTH = 7;
const LONG_EDITOR_DEFAULT_LIST_RATIO = 0.38;
const LONG_EDITOR_ENTRY_CONTENT_MIN_WIDTH = 240;
const LONG_EDITOR_STORY_DETAIL_MIN_WIDTH = 320;

type LongEditorResizablePane = "entry-list" | "story-plot-list";

export function useLongEditorPaneResize(options: {
  currentUsesAnyRightEntryList: ComputedRef<boolean>;
  currentIsPlotPointStoryline: ComputedRef<boolean>;
}) {
  const { currentUsesAnyRightEntryList, currentIsPlotPointStoryline } = options;
  const longEditorDocumentElement = ref<HTMLElement | null>(null);
  const storyPlotLayoutElement = ref<HTMLElement | null>(null);
  const preferences = loadLongEditorPanePreferences(uiStorage());
  const preferredEntryListWidth = ref(preferences.entryListWidth);
  const preferredStoryPlotListWidth = ref(preferences.storyPlotListWidth);
  const initialRange = {
    width: LONG_EDITOR_LIST_MIN_WIDTH,
    max: LONG_EDITOR_LIST_MAX_WIDTH
  };
  const entryListRange = shallowRef(initialRange);
  const storyPlotListRange = shallowRef(initialRange);
  const resizingLongEditorPane = ref<LongEditorResizablePane | null>(null);
  const draggedWidth = ref<number>();

  const entryListGridStyle = computed(() => {
    const width =
      (resizingLongEditorPane.value === "entry-list"
        ? draggedWidth.value
        : undefined) ?? preferredEntryListWidth.value;
    return width === undefined
      ? undefined
      : { "--long-entry-list-width": `${width}px` };
  });
  const storyPlotListGridStyle = computed(() => {
    const width =
      (resizingLongEditorPane.value === "story-plot-list"
        ? draggedWidth.value
        : undefined) ?? preferredStoryPlotListWidth.value;
    return width === undefined
      ? undefined
      : { "--long-story-plot-list-width": `${width}px` };
  });

  function paneBounds(pane: LongEditorResizablePane): DOMRect | undefined {
    const entry = pane === "entry-list";
    if (
      !(entry
        ? currentUsesAnyRightEntryList.value
        : currentIsPlotPointStoryline.value)
    )
      return;
    const container = entry
      ? longEditorDocumentElement.value
      : storyPlotLayoutElement.value;
    const bounds = container?.getBoundingClientRect();
    return bounds && bounds.width > 0 ? bounds : undefined;
  }

  function resolveRange(
    pane: LongEditorResizablePane,
    containerWidth: number,
    requestedWidth?: number
  ) {
    const entry = pane === "entry-list";
    const contentMin = entry
      ? currentIsPlotPointStoryline.value
        ? LONG_EDITOR_STORY_DETAIL_MIN_WIDTH +
          LONG_EDITOR_LIST_MIN_WIDTH +
          LONG_EDITOR_DIVIDER_WIDTH
        : LONG_EDITOR_ENTRY_CONTENT_MIN_WIDTH
      : LONG_EDITOR_STORY_DETAIL_MIN_WIDTH;
    const max = Math.min(
      LONG_EDITOR_LIST_MAX_WIDTH,
      Math.max(
        LONG_EDITOR_LIST_MIN_WIDTH,
        Math.floor(containerWidth - contentMin - LONG_EDITOR_DIVIDER_WIDTH)
      )
    );
    const preferred = entry
      ? preferredEntryListWidth.value
      : preferredStoryPlotListWidth.value;
    const target =
      requestedWidth ??
      preferred ??
      Math.round(containerWidth * LONG_EDITOR_DEFAULT_LIST_RATIO);
    return {
      width: Math.round(
        Math.min(Math.max(target, LONG_EDITOR_LIST_MIN_WIDTH), max)
      ),
      max
    };
  }

  function updateRange(
    pane: LongEditorResizablePane,
    range: ReturnType<typeof resolveRange>
  ): void {
    const target = pane === "entry-list" ? entryListRange : storyPlotListRange;
    if (target.value.width !== range.width || target.value.max !== range.max) {
      target.value = range;
    }
  }

  function refreshLongEditorPaneRange(pane: LongEditorResizablePane): void {
    const bounds = paneBounds(pane);
    if (bounds) updateRange(pane, resolveRange(pane, bounds.width));
  }

  function commitLongEditorPaneWidth(
    pane: LongEditorResizablePane,
    width: number
  ): void {
    if (pane === "entry-list") preferredEntryListWidth.value = width;
    else preferredStoryPlotListWidth.value = width;
    saveLongEditorPanePreferences(uiStorage(), {
      ...(preferredEntryListWidth.value !== undefined && {
        entryListWidth: preferredEntryListWidth.value
      }),
      ...(preferredStoryPlotListWidth.value !== undefined && {
        storyPlotListWidth: preferredStoryPlotListWidth.value
      })
    });
  }

  function handleLongEditorPaneResizeMove(event: PointerEvent): void {
    const pane = resizingLongEditorPane.value;
    if (!pane) return;
    const bounds = paneBounds(pane);
    if (!bounds) return;
    const range = resolveRange(
      pane,
      bounds.width,
      bounds.right - event.clientX
    );
    draggedWidth.value = range.width;
    updateRange(pane, range);
  }

  function stopLongEditorPaneResize(): void {
    const pane = resizingLongEditorPane.value;
    if (!pane) return;
    if (draggedWidth.value !== undefined)
      commitLongEditorPaneWidth(pane, draggedWidth.value);
    draggedWidth.value = undefined;
    resizingLongEditorPane.value = null;
    window.removeEventListener("pointermove", handleLongEditorPaneResizeMove);
    window.removeEventListener("pointerup", stopLongEditorPaneResize);
    window.removeEventListener("pointercancel", stopLongEditorPaneResize);
    document.documentElement.classList.remove("is-long-editor-pane-resizing");
  }

  function startLongEditorPaneResize(
    pane: LongEditorResizablePane,
    event: PointerEvent
  ): void {
    event.preventDefault();
    event.stopPropagation();
    refreshLongEditorPaneRange(pane);
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
    const bounds = paneBounds(pane);
    if (!bounds) return;
    const current = resolveRange(pane, bounds.width);
    const range = resolveRange(
      pane,
      bounds.width,
      current.width + (event.key === "ArrowLeft" ? 12 : -12)
    );
    updateRange(pane, range);
    commitLongEditorPaneWidth(pane, range.width);
  }

  watch(
    [
      longEditorDocumentElement,
      currentUsesAnyRightEntryList,
      currentIsPlotPointStoryline
    ],
    () => refreshLongEditorPaneRange("entry-list"),
    { flush: "post" }
  );
  watch(
    [storyPlotLayoutElement, currentIsPlotPointStoryline],
    () => refreshLongEditorPaneRange("story-plot-list"),
    { flush: "post" }
  );
  onBeforeUnmount(stopLongEditorPaneResize);

  return {
    longEditorDocumentElement,
    storyPlotLayoutElement,
    entryListRange,
    storyPlotListRange,
    resizingLongEditorPane,
    entryListGridStyle,
    storyPlotListGridStyle,
    refreshLongEditorPaneRange,
    startLongEditorPaneResize,
    handleLongEditorPaneResizeKeydown
  };
}
