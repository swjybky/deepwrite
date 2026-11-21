import { computed, shallowRef, type ComputedRef } from "vue";
import type {
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { previewLongWorkspaceOperations } from "@deepwrite/contracts/renderer";
import type {
  LongStructureMutationCompletion,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import {
  longEntryReorderOperation,
  type LongEntryGroup
} from "../utils/longEntryReorder";
import type { LongPressReorderOptions } from "../utils/longPressReorder";

export function useLongEntryReorder(options: {
  props: {
    bookId: string;
    selection: LongWorkspaceSelection | null;
    workspaceIndex: LongWorkspaceIndexSnapshot | null;
    locked?: boolean;
  };
  readOnly: ComputedRef<boolean>;
  worldbuildingItems: ComputedRef<Array<{ id: string }>>;
  volumes: ComputedRef<Array<{ id: string }>>;
  storyPlots: ComputedRef<Array<{ id: string }>>;
  mutate: (
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ) => void;
}) {
  const pending = shallowRef<{
    scope: string;
    group: string;
    ids: string[];
  } | null>(null);
  const binding = computed<LongPressReorderOptions>(() => {
    const { bookId, selection, workspaceIndex, locked } = options.props;
    const disabled =
      options.readOnly.value ||
      Boolean(locked) ||
      Boolean(pending.value) ||
      !workspaceIndex;
    const lists: Record<LongEntryGroup, readonly { id: string }[]> = {
      worldbuilding: options.worldbuildingItems.value,
      character: selection?.characterTabs ?? [],
      volume: options.volumes.value,
      plotPoint: selection?.plotPointTabs ?? [],
      storyPlot: options.storyPlots.value
    };
    function batch(
      group: LongEntryGroup,
      ids: string[]
    ): LongWorkspaceOperationBatch | undefined {
      if (!selection) return;
      const operation = longEntryReorderOperation(group, selection, ids);
      if (operation)
        return {
          updatedAt: new Date().toISOString(),
          operations: [operation],
          documentWrites: []
        };
      return;
    }
    function canReorder(group: string, ids: string[]): boolean {
      if (group !== "volume") return true;
      const next = batch(group, ids);
      if (!next || !workspaceIndex) return false;
      try {
        previewLongWorkspaceOperations(workspaceIndex, next);
        return true;
      } catch {
        return false;
      }
    }
    return {
      scope: `${bookId}:${selection?.key}`,
      disabled,
      groups: Object.fromEntries(
        Object.entries(lists).map(([group, items]) => [
          group,
          {
            ids: items.map(({ id }) => id),
            canReorder: (ids: string[]) => canReorder(group, ids)
          }
        ])
      ),
      reorder(group, ids) {
        if (disabled || pending.value || !(group in lists)) return;
        const currentIds = lists[group as LongEntryGroup].map(({ id }) => id);
        if (
          ids.length !== currentIds.length ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !currentIds.includes(id)) ||
          ids.every((id, index) => id === currentIds[index]) ||
          !canReorder(group, ids)
        )
          return;
        const next = batch(group as LongEntryGroup, ids);
        if (!next) return;
        const request = { scope: `${bookId}:${selection?.key}`, group, ids };
        pending.value = request;
        const finish = () => {
          if (pending.value?.ids === request.ids) pending.value = null;
        };
        options.mutate(next, {
          succeed: finish,
          fail: finish,
          appliedButRefreshFailed: finish
        });
      }
    };
  });
  function preview<T extends { id: string }>(
    group: LongEntryGroup,
    items: readonly T[]
  ): T[] {
    const request = pending.value;
    if (
      !request ||
      request.group !== group ||
      request.scope !==
        `${options.props.bookId}:${options.props.selection?.key}`
    )
      return [...items];
    const byId = new Map(items.map((item) => [item.id, item]));
    if (
      items.length !== request.ids.length ||
      request.ids.some((id) => !byId.has(id))
    )
      return [...items];
    return request.ids.map((id) => byId.get(id)!);
  }
  return { binding, preview };
}
