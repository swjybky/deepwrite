import type {
  LongChapterCardId,
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { nextTick, ref, shallowRef, type ComputedRef } from "vue";
import { longDeletionDescription } from "../utils/longDeletionImpact";
import { longImpactConfirmationDescription } from "../utils/longImpactConfirmation";

export interface LongNavigationDeleteTarget {
  kind: "character" | "volume" | "plotPoint" | "chapterCard";
  id: string;
  title: string;
  label: string;
  description: string;
  previewPending?: boolean;
  expectedImpact?: LongWorkspaceImpactConfirmation;
}

interface Options {
  locked: () => boolean;
  workspaceIndex: () => LongWorkspaceIndexSnapshot | null;
  currentReadOnly: ComputedRef<boolean>;
  currentTarget: ComputedRef<LongNavigationDeleteTarget | null>;
  preview(
    input: {
      kind: LongNavigationDeleteTarget["kind"];
      id: string;
      title: string;
    },
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ): void;
  remove(
    input: {
      kind: LongNavigationDeleteTarget["kind"];
      id: string;
      title: string;
      expectedImpact: LongWorkspaceImpactConfirmation;
    },
    completion: (
      succeeded: boolean,
      changedImpact?: LongWorkspaceImpactConfirmation
    ) => void
  ): void;
}

export function useLongNavigationDeleteConfirmation(options: Options) {
  // Identity guards and IPC-bound confirmations must remain raw Vue values.
  const navigationDeleteTarget = shallowRef<LongNavigationDeleteTarget | null>(
    null
  );
  const navigationDeletePending = ref(false);
  const navigationDeleteDialog = ref<HTMLElement>();
  const navigationDeleteCancelButton = ref<HTMLButtonElement>();
  let previousFocus: HTMLElement | null = null;

  function showNavigationDelete(target: LongNavigationDeleteTarget): void {
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const pendingTarget: LongNavigationDeleteTarget = {
      ...target,
      previewPending: true
    };
    navigationDeleteTarget.value = pendingTarget;
    options.preview(
      { kind: target.kind, id: target.id, title: target.title },
      (expectedImpact) => {
        if (navigationDeleteTarget.value !== pendingTarget) return;
        navigationDeleteTarget.value = {
          ...pendingTarget,
          previewPending: false,
          ...(expectedImpact
            ? {
                description: longImpactConfirmationDescription(
                  expectedImpact,
                  pendingTarget.description
                )
              }
            : {}),
          ...(expectedImpact ? { expectedImpact } : {})
        };
      }
    );
    void nextTick(() => {
      navigationDeleteCancelButton.value?.focus({ preventScroll: true });
    });
  }

  function openNavigationDelete(): void {
    const target = options.currentTarget.value;
    if (!target || options.locked() || options.currentReadOnly.value) return;
    showNavigationDelete(target);
  }

  function closeNavigationDelete(): void {
    if (navigationDeletePending.value) return;
    navigationDeleteTarget.value = null;
    const target = previousFocus;
    previousFocus = null;
    void nextTick(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }

  function handleNavigationDeleteKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeNavigationDelete();
      return;
    }
    if (event.key !== "Tab" || !navigationDeleteDialog.value) return;
    const focusable = Array.from(
      navigationDeleteDialog.value.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) {
      event.preventDefault();
      navigationDeleteDialog.value.focus({ preventScroll: true });
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

  function confirmNavigationDelete(): void {
    const target = navigationDeleteTarget.value;
    if (
      !target ||
      target.previewPending ||
      !target.expectedImpact ||
      navigationDeletePending.value
    ) {
      return;
    }
    navigationDeletePending.value = true;
    options.remove(
      {
        kind: target.kind,
        id: target.id,
        title: target.title,
        expectedImpact: target.expectedImpact
      },
      (succeeded, changedImpact) => {
        navigationDeletePending.value = false;
        if (succeeded) {
          closeNavigationDelete();
          return;
        }
        if (changedImpact && navigationDeleteTarget.value === target) {
          const refreshed = options.currentTarget.value;
          navigationDeleteTarget.value = {
            ...(refreshed ?? target),
            description: longImpactConfirmationDescription(
              changedImpact,
              (refreshed ?? target).description
            ),
            expectedImpact: changedImpact,
            previewPending: false
          };
        }
      }
    );
  }

  function openChapterCardDelete(chapterCardId: LongChapterCardId): void {
    if (options.locked() || options.currentReadOnly.value) return;
    const index = options.workspaceIndex();
    const chapterCard = index?.plot.chapterCards.find(
      ({ id }) => id === chapterCardId
    );
    if (!index || !chapterCard) return;
    showNavigationDelete({
      kind: "chapterCard",
      id: chapterCard.id,
      title: chapterCard.title,
      label: "章卡",
      description: longDeletionDescription(index, "chapterCard", chapterCard.id)
    });
  }

  return {
    navigationDeleteTarget,
    navigationDeletePending,
    navigationDeleteDialog,
    navigationDeleteCancelButton,
    showNavigationDelete,
    openNavigationDelete,
    closeNavigationDelete,
    handleNavigationDeleteKeydown,
    confirmNavigationDelete,
    openChapterCardDelete
  };
}
