import {
  computed,
  nextTick,
  ref,
  shallowRef,
  type ComputedRef,
  type Ref
} from "vue";
import type {
  LongChapterCardId,
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type {
  LongStructureMutationCompletion,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import { longImpactConfirmationDescription } from "../utils/longImpactConfirmation";
import {
  useLongNavigationDeleteConfirmation,
  type LongNavigationDeleteTarget
} from "./useLongNavigationDeleteConfirmation";

export type { LongNavigationDeleteTarget } from "./useLongNavigationDeleteConfirmation";

export function useLongEditorDeleteDialogs(options: {
  props: {
    selection: LongWorkspaceSelection | null;
    workspaceIndex: LongWorkspaceIndexSnapshot | null;
    locked?: boolean;
  };
  currentReadOnly: ComputedRef<boolean>;
  currentNavigationDeleteTarget: ComputedRef<LongNavigationDeleteTarget | null>;
  currentWorldbuildingItems: ComputedRef<Array<{ id: string; title: string }>>;
  pendingWorldbuildingDeleteId: Ref<string | null>;
  emitPreviewMutation: (
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ) => void;
  emitMutation: (
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ) => void;
  selectWorldbuildingItem: (itemId: string) => Promise<void>;
  selectWorldbuildingOverview: () => Promise<void>;
  emitPreviewDeleteStructure: (
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ) => void;
  emitDeleteStructure: (
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
      expectedImpact: LongWorkspaceImpactConfirmation;
    },
    completion: (
      succeeded: boolean,
      changedImpact?: LongWorkspaceImpactConfirmation
    ) => void
  ) => void;
}): {
  worldbuildingDeleteDialog: Ref<HTMLElement | undefined>;
  worldbuildingDeleteCancelButton: Ref<HTMLButtonElement | undefined>;
  navigationDeleteTarget: Ref<LongNavigationDeleteTarget | null>;
  navigationDeletePending: Ref<boolean>;
  navigationDeleteDialog: Ref<HTMLElement | undefined>;
  navigationDeleteCancelButton: Ref<HTMLButtonElement | undefined>;
  pendingWorldbuildingDeleteItem: ComputedRef<{
    id: string;
    title: string;
    description: string;
    previewPending: boolean;
    pending: boolean;
    expectedImpact?: LongWorkspaceImpactConfirmation;
  } | null>;
  openWorldbuildingItemDelete: (itemId: string) => void;
  closeWorldbuildingItemDelete: () => void;
  handleWorldbuildingDeleteKeydown: (event: KeyboardEvent) => void;
  confirmWorldbuildingItemDelete: () => void;
  showNavigationDelete: (target: LongNavigationDeleteTarget) => void;
  openNavigationDelete: () => void;
  closeNavigationDelete: () => void;
  handleNavigationDeleteKeydown: (event: KeyboardEvent) => void;
  confirmNavigationDelete: () => void;
  openChapterCardDelete: (chapterCardId: LongChapterCardId) => void;
} {
  const { props } = options;
  const worldbuildingDeleteDialog = ref<HTMLElement>();
  const worldbuildingDeleteCancelButton = ref<HTMLButtonElement>();
  let worldbuildingDeletePreviousFocus: HTMLElement | null = null;
  const worldbuildingDeletePreviewPending = ref(false);
  const worldbuildingDeletePending = ref(false);
  const worldbuildingDeleteImpact =
    shallowRef<LongWorkspaceImpactConfirmation>();
  let worldbuildingDeleteRequest = 0;
  let worldbuildingDeleteUpdatedAt: string | undefined;
  const navigationDelete = useLongNavigationDeleteConfirmation({
    locked: () => Boolean(props.locked),
    workspaceIndex: () => props.workspaceIndex,
    currentReadOnly: options.currentReadOnly,
    currentTarget: options.currentNavigationDeleteTarget,
    preview: options.emitPreviewDeleteStructure,
    remove: options.emitDeleteStructure
  });

  const pendingWorldbuildingDeleteItem = computed(() => {
    const item = options.currentWorldbuildingItems.value.find(
      ({ id }) => id === options.pendingWorldbuildingDeleteId.value
    );
    if (!item) return null;
    const expectedImpact = worldbuildingDeleteImpact.value;
    return {
      ...item,
      description: expectedImpact
        ? longImpactConfirmationDescription(
            expectedImpact,
            "该条目及其正文文件将被删除，分类内容与连续性投影会同步更新。"
          )
        : "该条目及其正文文件将被删除，分类内容与连续性投影会同步更新。",
      previewPending: worldbuildingDeletePreviewPending.value,
      pending: worldbuildingDeletePending.value,
      ...(expectedImpact ? { expectedImpact } : {})
    };
  });

  function worldbuildingDeleteBatch(
    categoryId: string,
    itemId: string,
    updatedAt: string,
    expectedImpact?: LongWorkspaceImpactConfirmation
  ): LongWorkspaceOperationBatch {
    return {
      updatedAt,
      operations: [
        {
          type: "worldbuildingItem.delete",
          categoryId,
          id: itemId
        }
      ],
      documentWrites: [],
      ...(expectedImpact ? { expectedImpact } : {})
    };
  }

  function openWorldbuildingItemDelete(itemId: string): void {
    if (options.currentReadOnly.value) return;
    worldbuildingDeletePreviousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const categoryId = props.selection?.key.slice("worldbuilding:".length);
    if (!categoryId) return;
    const request = ++worldbuildingDeleteRequest;
    const updatedAt = new Date().toISOString();
    worldbuildingDeleteUpdatedAt = updatedAt;
    options.pendingWorldbuildingDeleteId.value = itemId;
    worldbuildingDeleteImpact.value = undefined;
    worldbuildingDeletePending.value = false;
    worldbuildingDeletePreviewPending.value = true;
    options.emitPreviewMutation(
      worldbuildingDeleteBatch(categoryId, itemId, updatedAt),
      (expectedImpact) => {
        if (
          request !== worldbuildingDeleteRequest ||
          options.pendingWorldbuildingDeleteId.value !== itemId
        ) {
          return;
        }
        worldbuildingDeletePreviewPending.value = false;
        worldbuildingDeleteImpact.value = expectedImpact;
      }
    );
    void nextTick(() => {
      worldbuildingDeleteCancelButton.value?.focus({ preventScroll: true });
    });
  }

  function closeWorldbuildingItemDelete(): void {
    if (worldbuildingDeletePending.value) return;
    worldbuildingDeleteRequest += 1;
    options.pendingWorldbuildingDeleteId.value = null;
    worldbuildingDeletePreviewPending.value = false;
    worldbuildingDeleteImpact.value = undefined;
    worldbuildingDeleteUpdatedAt = undefined;
    const previousFocus = worldbuildingDeletePreviousFocus;
    worldbuildingDeletePreviousFocus = null;
    void nextTick(() => {
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    });
  }

  function handleWorldbuildingDeleteKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeWorldbuildingItemDelete();
      return;
    }
    if (event.key !== "Tab" || !worldbuildingDeleteDialog.value) return;
    const focusable = Array.from(
      worldbuildingDeleteDialog.value.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) {
      event.preventDefault();
      worldbuildingDeleteDialog.value.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function confirmWorldbuildingItemDelete(): void {
    const target = pendingWorldbuildingDeleteItem.value;
    if (
      !target?.expectedImpact ||
      target.previewPending ||
      worldbuildingDeletePending.value
    ) {
      return;
    }
    const items = options.currentWorldbuildingItems.value;
    const targetIndex = items.findIndex(({ id }) => id === target.id);
    const nextItems = items.filter(({ id }) => id !== target.id);
    const categoryId = props.selection?.key.slice("worldbuilding:".length);
    const updatedAt = worldbuildingDeleteUpdatedAt;
    if (!categoryId || !updatedAt) return;
    worldbuildingDeletePending.value = true;
    options.emitMutation(
      worldbuildingDeleteBatch(
        categoryId,
        target.id,
        updatedAt,
        target.expectedImpact
      ),
      {
        succeed() {
          worldbuildingDeletePending.value = false;
          closeWorldbuildingItemDelete();
          const nextId =
            nextItems[Math.min(targetIndex, nextItems.length - 1)]?.id ?? null;
          if (nextId) {
            void options.selectWorldbuildingItem(nextId);
            return;
          }
          void options.selectWorldbuildingOverview();
        },
        fail(_message, changedImpact) {
          worldbuildingDeletePending.value = false;
          if (changedImpact) {
            worldbuildingDeleteImpact.value = changedImpact;
          }
        },
        appliedButRefreshFailed() {
          worldbuildingDeletePending.value = false;
          closeWorldbuildingItemDelete();
        }
      }
    );
  }

  return {
    worldbuildingDeleteDialog,
    worldbuildingDeleteCancelButton,
    pendingWorldbuildingDeleteItem,
    openWorldbuildingItemDelete,
    closeWorldbuildingItemDelete,
    handleWorldbuildingDeleteKeydown,
    confirmWorldbuildingItemDelete,
    ...navigationDelete
  };
}
