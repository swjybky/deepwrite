import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type { ConversationTurn } from "./useConversationTurnNavigator";

interface ConversationTurnRailOptions {
  turns: () => readonly ConversationTurn[];
  activeTurnId: () => string | null;
  dismissPreview: () => void;
  onScroll: () => void;
}

const MARKER_HEIGHT = 12;
const MAX_VISIBLE_TURNS = 12;
const CONTROLS_HEIGHT = 76;

export function useConversationTurnRail(options: ConversationTurnRailOptions) {
  const navigator = ref<HTMLElement>();
  const markerList = ref<HTMLOListElement>();
  const availableHeight = ref(
    MAX_VISIBLE_TURNS * MARKER_HEIGHT + CONTROLS_HEIGHT
  );
  const canScrollUp = ref(false);
  const canScrollDown = ref(false);
  const hasOverflow = computed(
    () =>
      options.turns().length > MAX_VISIBLE_TURNS ||
      options.turns().length * MARKER_HEIGHT > availableHeight.value
  );
  const railStyle = computed(() => ({
    "--conversation-turn-count": options.turns().length,
    "--conversation-turn-marker-height": `${MARKER_HEIGHT}px`,
    "--conversation-turn-max-visible": MAX_VISIBLE_TURNS,
    "--conversation-turn-controls-height": hasOverflow.value
      ? `${CONTROLS_HEIGHT}px`
      : "0px",
    "--conversation-turn-preview-max-height": `${availableHeight.value}px`
  }));
  let resizeObserver: ResizeObserver | undefined;

  function updateScrollState(): void {
    const list = markerList.value;
    if (!list) return;
    canScrollUp.value = list.scrollTop > 1;
    canScrollDown.value =
      list.scrollTop + list.clientHeight < list.scrollHeight - 1;
  }

  function revealActiveTurn(): void {
    const list = markerList.value;
    const index = options
      .turns()
      .findIndex((turn) => turn.id === options.activeTurnId());
    const marker = list?.children[index] as HTMLElement | undefined;
    if (!list || !marker) return;
    if (
      marker.offsetTop < list.scrollTop ||
      marker.offsetTop + marker.offsetHeight >
        list.scrollTop + list.clientHeight
    ) {
      list.scrollTop =
        Math.round(
          (marker.offsetTop - (list.clientHeight - marker.offsetHeight) / 2) /
            MARKER_HEIGHT
        ) * MARKER_HEIGHT;
    }
    updateScrollState();
  }

  function handleMarkerScroll(): void {
    options.onScroll();
    updateScrollState();
  }

  function scrollPage(direction: -1 | 1): void {
    const list = markerList.value;
    if (!list) return;
    options.dismissPreview();
    list.scrollBy({
      top:
        direction *
        Math.max(MARKER_HEIGHT, list.clientHeight - MARKER_HEIGHT * 2),
      behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches
        ? "auto"
        : "smooth"
    });
  }

  function scrollMarkers(event: WheelEvent): void {
    const list = markerList.value;
    if (!list || !hasOverflow.value) return;
    event.preventDefault();
    options.dismissPreview();
    const scale =
      event.deltaMode === 1
        ? MARKER_HEIGHT
        : event.deltaMode === 2
          ? list.clientHeight
          : 1;
    list.scrollTop += event.deltaY * scale;
    updateScrollState();
  }

  async function updateRailLayout(): Promise<void> {
    const parent = navigator.value?.parentElement;
    if (parent) availableHeight.value = Math.max(0, parent.clientHeight - 32);
    await nextTick();
    revealActiveTurn();
    updateScrollState();
  }

  watch(
    () => [options.activeTurnId(), options.turns()[0]?.id],
    () => {
      options.dismissPreview();
      if (markerList.value && !options.activeTurnId())
        markerList.value.scrollTop = 0;
      revealActiveTurn();
    },
    { flush: "post" }
  );
  // Appending a turn must not pull a manually browsed rail back to the active turn.
  watch(() => options.turns().length, updateScrollState, { flush: "post" });

  onMounted(() => {
    resizeObserver = new ResizeObserver(() => void updateRailLayout());
    if (navigator.value?.parentElement)
      resizeObserver.observe(navigator.value.parentElement);
    if (markerList.value) resizeObserver.observe(markerList.value);
    void updateRailLayout();
  });
  onBeforeUnmount(() => resizeObserver?.disconnect());

  return {
    navigator,
    markerList,
    railStyle,
    availableHeight,
    hasOverflow,
    canScrollUp,
    canScrollDown,
    handleMarkerScroll,
    scrollPage,
    scrollMarkers
  };
}
