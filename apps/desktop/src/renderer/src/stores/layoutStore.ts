import {
  computed,
  nextTick,
  onScopeDispose,
  ref,
  shallowRef,
  watch
} from "vue";
import { defineStore } from "pinia";
import { createPanePointerCapture } from "../utils/panePointerCapture";
import {
  RIGHT_PANE_MAX_WIDTH,
  RIGHT_PANE_MIN_WIDTH,
  loadRightPanePreferences,
  saveRightPanePreferences,
  type RightPanePreferences
} from "../utils/rightPanePreferences";

export type {
  AppView,
  WorkspaceMainView,
  PrimaryFeature
} from "./layoutFeatureNavigation";
import {
  primaryFeatureForView,
  type AppView,
  type WorkspaceMainView
} from "./layoutFeatureNavigation";
export type PaneSide = "left" | "right";

export const LEFT_PANE_MIN = 220;
export const LEFT_PANE_MAX = 480;
export const RIGHT_PANE_MIN = RIGHT_PANE_MIN_WIDTH;
export const RIGHT_PANE_MAX = RIGHT_PANE_MAX_WIDTH;
export const CENTER_PANE_MIN_FALLBACK = 420;

function runtimeWindow(): Window | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function initialViewportWidth(): number {
  return runtimeWindow()?.innerWidth ?? 1440;
}

export function defaultLeftPaneWidth(viewportWidth: number): number {
  return viewportWidth <= 1220 ? 262 : 286;
}

export function defaultRightPaneWidth(viewportWidth: number): number {
  return viewportWidth <= 1220
    ? 395
    : Math.min(650, Math.max(410, viewportWidth * 0.34));
}

function initialRightPanePreferences(): RightPanePreferences {
  const currentWindow = runtimeWindow();
  if (!currentWindow) return { widths: {} };
  try {
    return loadRightPanePreferences(currentWindow.localStorage);
  } catch {
    return { widths: {} };
  }
}

export const useLayoutStore = defineStore("layout", () => {
  const viewportWidth = initialViewportWidth();
  const initialRightPaneWidth = defaultRightPaneWidth(viewportWidth);

  const currentView = ref<AppView>("workspace");
  const settingsInitialCategory = ref("general");
  const workspaceMainView = ref<WorkspaceMainView>("conversation");
  const leftCollapsed = ref(false);
  const rightCollapsed = ref(false);
  const desktopShell = shallowRef<HTMLElement | null>(null);
  const leftPaneWidth = ref(defaultLeftPaneWidth(viewportWidth));
  const rightPaneWidth = ref(initialRightPaneWidth);
  const rightPanePreferences = shallowRef<RightPanePreferences>(
    initialRightPanePreferences()
  );
  const activeRightPanePreferenceKey = ref<string>();
  const resizingPane = ref<PaneSide | null>(null);
  const paneTransitionSuppressed = ref(false);
  const pointerCapture = createPanePointerCapture(stopPaneResize);

  let resizeInitialPaneWidth: number | undefined;
  let paneTransitionSuppressionClock = 0;
  let paneTransitionReleaseFrame: number | undefined;

  const activePrimaryFeature = computed(() =>
    primaryFeatureForView(workspaceMainView.value)
  );

  const shellClasses = computed(() => ({
    "is-left-collapsed": leftCollapsed.value,
    "is-right-collapsed": rightCollapsed.value,
    "is-resizing": resizingPane.value !== null,
    "is-pane-transition-suppressed": paneTransitionSuppressed.value
  }));

  const shellStyle = computed(() => ({
    "--left-pane-width": `${leftPaneWidth.value}px`,
    "--right-pane-width": `${rightPaneWidth.value}px`
  }));

  const writingRightPaneViewModel = computed(() => ({
    collapsed: rightCollapsed.value,
    minWidth: RIGHT_PANE_MIN,
    maxWidth: RIGHT_PANE_MAX,
    width: rightPaneWidth.value
  }));

  function showSettings(initialCategory = "general"): void {
    settingsInitialCategory.value = initialCategory;
    currentView.value = "settings";
  }

  function showWorkspace(): void {
    currentView.value = "workspace";
  }

  function showWorkspaceFeature(view: WorkspaceMainView): void {
    workspaceMainView.value = view;
    currentView.value = "workspace";
  }

  function setPaneCollapsed(side: PaneSide, collapsed: boolean): void {
    if (side === "left") {
      leftCollapsed.value = collapsed;
    } else {
      rightCollapsed.value = collapsed;
    }
  }

  function togglePane(side: PaneSide): void {
    setPaneCollapsed(
      side,
      side === "left" ? !leftCollapsed.value : !rightCollapsed.value
    );
  }

  function centerPaneMinWidth(): number {
    const currentWindow = runtimeWindow();
    if (!desktopShell.value || !currentWindow) {
      return CENTER_PANE_MIN_FALLBACK;
    }
    const value = Number.parseFloat(
      currentWindow
        .getComputedStyle(desktopShell.value)
        .getPropertyValue("--center-pane-min")
    );
    return Number.isFinite(value) ? value : CENTER_PANE_MIN_FALLBACK;
  }

  function clampPaneWidth(side: PaneSide, width: number): number {
    const currentWindow = runtimeWindow();
    const shellWidth =
      desktopShell.value?.getBoundingClientRect().width ??
      currentWindow?.innerWidth ??
      1440;
    const otherWidth =
      side === "left"
        ? rightCollapsed.value
          ? 0
          : rightPaneWidth.value
        : leftCollapsed.value
          ? 0
          : leftPaneWidth.value;
    const paneMin = side === "left" ? LEFT_PANE_MIN : RIGHT_PANE_MIN;
    const paneMax = side === "left" ? LEFT_PANE_MAX : RIGHT_PANE_MAX;
    const availableMax = Math.max(
      paneMin,
      shellWidth - otherWidth - centerPaneMinWidth()
    );
    return Math.round(
      Math.min(Math.max(width, paneMin), paneMax, availableMax)
    );
  }

  function setPaneWidth(side: PaneSide, width: number): void {
    if (side === "left") {
      leftPaneWidth.value = clampPaneWidth(side, width);
    } else {
      rightPaneWidth.value = clampPaneWidth(side, width);
    }
  }

  function preferredRightPaneWidth(
    key = activeRightPanePreferenceKey.value
  ): number {
    return key
      ? (rightPanePreferences.value.widths[key] ?? initialRightPaneWidth)
      : initialRightPaneWidth;
  }

  function restoreRightPaneWidth(
    key = activeRightPanePreferenceKey.value
  ): void {
    setPaneWidth("right", preferredRightPaneWidth(key));
  }

  function releasePaneTransitionAfterPaint(requestId: number): void {
    const currentWindow = runtimeWindow();
    if (!currentWindow) {
      if (requestId === paneTransitionSuppressionClock) {
        paneTransitionSuppressed.value = false;
      }
      return;
    }
    if (paneTransitionReleaseFrame !== undefined) {
      currentWindow.cancelAnimationFrame(paneTransitionReleaseFrame);
    }
    paneTransitionReleaseFrame = currentWindow.requestAnimationFrame(() => {
      if (requestId !== paneTransitionSuppressionClock) return;
      paneTransitionReleaseFrame = currentWindow.requestAnimationFrame(() => {
        paneTransitionReleaseFrame = undefined;
        if (requestId === paneTransitionSuppressionClock) {
          paneTransitionSuppressed.value = false;
        }
      });
    });
  }

  function restoreRightPaneWidthForNavigation(
    key = activeRightPanePreferenceKey.value
  ): void {
    const requestId = ++paneTransitionSuppressionClock;
    paneTransitionSuppressed.value = true;
    restoreRightPaneWidth(key);
    void nextTick(() => releasePaneTransitionAfterPaint(requestId));
  }

  function setActiveRightPanePreferenceKey(
    key: string | undefined,
    restore = true
  ): void {
    const previousKey = activeRightPanePreferenceKey.value;
    activeRightPanePreferenceKey.value = key;
    if (restore && key && key !== previousKey) {
      restoreRightPaneWidthForNavigation(key);
    }
  }

  function persistActiveRightPaneWidth(width: number): boolean {
    const key = activeRightPanePreferenceKey.value;
    const currentWindow = runtimeWindow();
    if (!key || !currentWindow) return false;
    const nextPreferences: RightPanePreferences = {
      widths: { ...rightPanePreferences.value.widths, [key]: width }
    };
    rightPanePreferences.value = nextPreferences;
    return saveRightPanePreferences(
      currentWindow.localStorage,
      nextPreferences
    );
  }

  function reconcilePaneWidths(): void {
    if (!leftCollapsed.value) {
      setPaneWidth("left", leftPaneWidth.value);
    }
    if (!rightCollapsed.value) {
      restoreRightPaneWidth();
    }
  }

  function handleResizeMove(event: PointerEvent): void {
    if (!resizingPane.value || !desktopShell.value) return;
    const bounds = desktopShell.value.getBoundingClientRect();
    const width =
      resizingPane.value === "left"
        ? event.clientX - bounds.left
        : bounds.right - event.clientX;
    setPaneWidth(resizingPane.value, width);
  }

  function stopPaneResize(): void {
    pointerCapture.release();
    const resizedPane = resizingPane.value;
    const initialWidth = resizeInitialPaneWidth;
    resizingPane.value = null;
    resizeInitialPaneWidth = undefined;
    const currentWindow = runtimeWindow();
    currentWindow?.removeEventListener("pointermove", handleResizeMove);
    currentWindow?.removeEventListener("pointerup", stopPaneResize);
    currentWindow?.removeEventListener("pointercancel", stopPaneResize);
    if (resizedPane === "right" && rightPaneWidth.value !== initialWidth) {
      persistActiveRightPaneWidth(rightPaneWidth.value);
    }
  }

  function startPaneResize(side: PaneSide, event: PointerEvent): void {
    event.preventDefault();
    stopPaneResize();
    resizingPane.value = side;
    pointerCapture.start(event);
    resizeInitialPaneWidth =
      side === "left" ? leftPaneWidth.value : rightPaneWidth.value;
    const currentWindow = runtimeWindow();
    currentWindow?.addEventListener("pointermove", handleResizeMove);
    currentWindow?.addEventListener("pointerup", stopPaneResize);
    currentWindow?.addEventListener("pointercancel", stopPaneResize);
  }

  function handleResizeKeydown(side: PaneSide, event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const currentWidth =
      side === "left" ? leftPaneWidth.value : rightPaneWidth.value;
    const nextWidth = currentWidth + direction * (side === "left" ? 12 : -12);
    setPaneWidth(side, nextWidth);
    if (side === "right" && rightPaneWidth.value !== currentWidth) {
      persistActiveRightPaneWidth(rightPaneWidth.value);
    }
  }

  function disposeLayout(): void {
    stopPaneResize();
    paneTransitionSuppressionClock += 1;
    const currentWindow = runtimeWindow();
    if (paneTransitionReleaseFrame !== undefined) {
      currentWindow?.cancelAnimationFrame(paneTransitionReleaseFrame);
      paneTransitionReleaseFrame = undefined;
    }
    paneTransitionSuppressed.value = false;
    desktopShell.value = null;
  }

  watch([leftCollapsed, rightCollapsed, currentView], () => {
    void nextTick(reconcilePaneWidths);
  });

  onScopeDispose(disposeLayout);

  return {
    currentView,
    settingsInitialCategory,
    workspaceMainView,
    activePrimaryFeature,
    leftCollapsed,
    rightCollapsed,
    desktopShell,
    leftPaneWidth,
    rightPaneWidth,
    rightPanePreferences,
    activeRightPanePreferenceKey,
    resizingPane,
    paneTransitionSuppressed,
    shellClasses,
    shellStyle,
    writingRightPaneViewModel,
    showSettings,
    showWorkspace,
    showWorkspaceFeature,
    setPaneCollapsed,
    togglePane,
    clampPaneWidth,
    setPaneWidth,
    preferredRightPaneWidth,
    restoreRightPaneWidth,
    restoreRightPaneWidthForNavigation,
    setActiveRightPanePreferenceKey,
    persistActiveRightPaneWidth,
    reconcilePaneWidths,
    handleResizeMove,
    stopPaneResize,
    startPaneResize,
    handleResizeKeydown,
    disposeLayout
  };
});
