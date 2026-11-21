import { onBeforeUnmount } from "vue";
import type {
  CatalogResourceNodeActionPayload,
  CreationTreeReorderPayload,
  ResourceDomain,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";

export interface SidebarOrderDragFacadeOptions {
  sections: () => readonly ResourceTreeSection[];
  pinnedNodes: () => readonly ResourceTreeNode[];
  domainForPinnedNode: (node: ResourceTreeNode) => ResourceDomain;
  longTreeActionsDisabled: () => boolean;
  onReorderLibrary: (payload: CatalogResourceNodeActionPayload) => void;
  onReorderCreationNode: (payload: CreationTreeReorderPayload) => void;
}

type SidebarOrderDragRuntimeModule = typeof import("./sidebarOrderDragRuntime");
type LoadedSidebarOrderDrag = ReturnType<
  SidebarOrderDragRuntimeModule["createSidebarOrderDrag"]
>;

let runtimeModulePromise: Promise<SidebarOrderDragRuntimeModule> | undefined;

function loadRuntime(): Promise<SidebarOrderDragRuntimeModule> {
  runtimeModulePromise ??= import("./sidebarOrderDragRuntime");
  return runtimeModulePromise;
}

export function useSidebarOrderDrag(options: SidebarOrderDragFacadeOptions) {
  let loaded: LoadedSidebarOrderDrag | undefined;
  let disposed = false;
  let pendingToken = 0;
  let cleanupPending: (() => void) | undefined;

  function start(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    if (loaded) {
      loaded.start(event);
      return;
    }
    const { pointerId, clientX, clientY, target, currentTarget } = event;
    if (
      !(target instanceof Element) ||
      !(currentTarget instanceof HTMLElement)
    ) {
      return;
    }

    cleanupPending?.();
    const token = ++pendingToken;
    const startedAt = Date.now();
    let aborted = false;

    const finishPending = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUpOrCancel);
      window.removeEventListener("pointercancel", onUpOrCancel);
      window.removeEventListener("blur", onAbort);
      if (cleanupPending === finishPending) cleanupPending = undefined;
    };
    const onAbort = () => {
      aborted = true;
      finishPending();
    };
    const onUpOrCancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) onAbort();
    };
    const onMove = (next: PointerEvent) => {
      if (
        next.pointerId === pointerId &&
        Math.hypot(next.clientX - clientX, next.clientY - clientY) > 7
      ) {
        onAbort();
      }
    };

    cleanupPending = finishPending;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUpOrCancel);
    window.addEventListener("pointercancel", onUpOrCancel);
    window.addEventListener("blur", onAbort);

    void loadRuntime().then(({ createSidebarOrderDrag }) => {
      if (disposed) return;
      loaded ??= createSidebarOrderDrag(options);
      if (token !== pendingToken) return;
      cleanupPending?.();
      cleanupPending = undefined;
      if (!aborted && target.isConnected && currentTarget.isConnected) {
        loaded.start(
          {
            button: 0,
            isPrimary: true,
            pointerId,
            clientX,
            clientY,
            currentTarget,
            target
          },
          Math.max(0, 350 - (Date.now() - startedAt))
        );
      }
    });
  }

  function click(event: MouseEvent): void {
    loaded?.click(event);
  }

  onBeforeUnmount(() => {
    disposed = true;
    cleanupPending?.();
    loaded?.stop();
  });

  return { start, click };
}
