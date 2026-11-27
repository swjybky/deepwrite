import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  type CSSProperties
} from "vue";
import { uiStorage } from "../../utils/uiStorage";
export function useChatAssistantWindow() {
  const SIZE_STORAGE_KEY = "deepwrite:chat-assistant-size:v2";
  const DESKTOP_BREAKPOINT = 760;
  const WINDOW_MARGIN = 20;
  const MIN_WIDTH = 480;
  const MIN_HEIGHT = 420;

  interface ChatAssistantSize {
    width: number;
    height: number;
  }

  type ResizeAxis = "width" | "height" | "both";

  interface ResizeSession extends ChatAssistantSize {
    pointerId: number;
    startX: number;
    startY: number;
    axis: ResizeAxis;
  }

  const viewportWidth = ref(
    typeof window === "undefined" ? 1440 : window.innerWidth
  );
  const viewportHeight = ref(
    typeof window === "undefined" ? 900 : window.innerHeight
  );
  const resizeSession = ref<ResizeSession | null>(null);
  let previousUserSelect = "";
  let previousCursor = "";

  function defaultSize(): ChatAssistantSize {
    return {
      width: Math.round(viewportWidth.value * 0.44),
      height: Math.round(viewportHeight.value * 0.88)
    };
  }

  function clampSize(size: ChatAssistantSize): ChatAssistantSize {
    const maxWidth = Math.max(1, viewportWidth.value - WINDOW_MARGIN * 2);
    const maxHeight = Math.max(1, viewportHeight.value - WINDOW_MARGIN * 2);
    const minWidth = Math.min(MIN_WIDTH, maxWidth);
    const minHeight = Math.min(MIN_HEIGHT, maxHeight);
    return {
      width: Math.round(Math.min(maxWidth, Math.max(minWidth, size.width))),
      height: Math.round(Math.min(maxHeight, Math.max(minHeight, size.height)))
    };
  }

  function readStoredSize(): ChatAssistantSize {
    if (typeof window === "undefined") return clampSize(defaultSize());
    try {
      const stored = JSON.parse(
        uiStorage().getItem(SIZE_STORAGE_KEY) ?? "null"
      ) as Partial<ChatAssistantSize> | null;
      if (Number.isFinite(stored?.width) && Number.isFinite(stored?.height)) {
        return clampSize({
          width: Number(stored?.width),
          height: Number(stored?.height)
        });
      }
    } catch {
      // Ignore malformed local UI preferences and fall back to the responsive default.
    }
    return clampSize(defaultSize());
  }

  const windowSize = ref<ChatAssistantSize>(readStoredSize());
  const windowStyle = computed<CSSProperties>(() =>
    viewportWidth.value <= DESKTOP_BREAKPOINT
      ? {}
      : {
          width: `${windowSize.value.width}px`,
          height: `${windowSize.value.height}px`
        }
  );
  function persistSize(): void {
    if (typeof window === "undefined") return;
    try {
      uiStorage().setItem(SIZE_STORAGE_KEY, JSON.stringify(windowSize.value));
    } catch {
      // A blocked storage API should not prevent resizing for the current session.
    }
  }

  function stopResize(): void {
    if (!resizeSession.value) return;
    resizeSession.value = null;
    window.removeEventListener("pointermove", handleResizeMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    document.body.style.userSelect = previousUserSelect;
    document.body.style.cursor = previousCursor;
    persistSize();
  }

  function handleResizeMove(event: PointerEvent): void {
    const session = resizeSession.value;
    if (!session || event.pointerId !== session.pointerId) return;
    windowSize.value = clampSize({
      width:
        session.axis === "height"
          ? session.width
          : session.width + session.startX - event.clientX,
      height:
        session.axis === "width"
          ? session.height
          : session.height + session.startY - event.clientY
    });
  }

  function startResize(event: PointerEvent, axis: ResizeAxis): void {
    if (viewportWidth.value <= DESKTOP_BREAKPOINT || event.button !== 0) return;
    event.preventDefault();
    resizeSession.value = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis,
      ...windowSize.value
    };
    previousUserSelect = document.body.style.userSelect;
    previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      axis === "width"
        ? "ew-resize"
        : axis === "height"
          ? "ns-resize"
          : "nwse-resize";
    window.addEventListener("pointermove", handleResizeMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function handleResizeKeydown(event: KeyboardEvent, axis: ResizeAxis): void {
    if (viewportWidth.value <= DESKTOP_BREAKPOINT) return;
    const step = event.shiftKey ? 32 : 16;
    let nextSize: ChatAssistantSize | null = null;
    if (event.key === "ArrowLeft" && axis !== "height") {
      nextSize = { ...windowSize.value, width: windowSize.value.width + step };
    } else if (event.key === "ArrowRight" && axis !== "height") {
      nextSize = { ...windowSize.value, width: windowSize.value.width - step };
    } else if (event.key === "ArrowUp" && axis !== "width") {
      nextSize = {
        ...windowSize.value,
        height: windowSize.value.height + step
      };
    } else if (event.key === "ArrowDown" && axis !== "width") {
      nextSize = {
        ...windowSize.value,
        height: windowSize.value.height - step
      };
    }
    if (!nextSize) return;
    event.preventDefault();
    windowSize.value = clampSize(nextSize);
    persistSize();
  }

  function handleViewportResize(): void {
    viewportWidth.value = window.innerWidth;
    viewportHeight.value = window.innerHeight;
    windowSize.value = clampSize(windowSize.value);
  }

  onMounted(() => {
    viewportWidth.value = window.innerWidth;
    viewportHeight.value = window.innerHeight;
    windowSize.value = readStoredSize();
    window.addEventListener("resize", handleViewportResize);
  });

  onBeforeUnmount(() => {
    stopResize();
    window.removeEventListener("resize", handleViewportResize);
  });

  return { windowStyle, startResize, handleResizeKeydown };
}
