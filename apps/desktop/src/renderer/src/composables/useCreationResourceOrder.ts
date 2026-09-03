import { computed, ref, watch } from "vue";
import type {
  CreationBookDragPayload,
  ResourceTreeSection
} from "../types/workspace";
import {
  applyCreationResourceOrder,
  CREATION_RESOURCE_ORDER_STORAGE_KEY,
  creationResourceIds,
  moveCreationResource,
  parseCreationResourceOrder,
  reconcileCreationResourceOrder
} from "../utils/creationResourceOrder";

export interface CreationResourceOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CreationResourceOrderOptions {
  sections(): readonly ResourceTreeSection[];
  storage(): CreationResourceOrderStorage | undefined;
  warning(message: string): void;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function loadOrder(storage: CreationResourceOrderOptions["storage"]): string[] {
  try {
    return parseCreationResourceOrder(
      storage()?.getItem(CREATION_RESOURCE_ORDER_STORAGE_KEY) ?? null
    );
  } catch {
    return [];
  }
}

export function useCreationResourceOrder(
  options: CreationResourceOrderOptions
) {
  const order = ref<string[]>(loadOrder(options.storage));
  const seenIds = new Set<string>();
  let storageWarningActive = false;

  function persist(): void {
    try {
      const storage = options.storage();
      if (!storage) throw new Error("Creation order storage unavailable");
      storage.setItem(
        CREATION_RESOURCE_ORDER_STORAGE_KEY,
        JSON.stringify(order.value)
      );
      storageWarningActive = false;
    } catch {
      if (!storageWarningActive) {
        storageWarningActive = true;
        options.warning("作品顺序暂时无法保存，但本次操作仍然有效");
      }
    }
  }

  watch(
    () => creationResourceIds(options.sections()),
    (currentIds) => {
      const next = reconcileCreationResourceOrder(
        order.value,
        currentIds,
        seenIds
      );
      const currentSet = new Set(currentIds);
      for (const id of seenIds) {
        if (!currentSet.has(id)) seenIds.delete(id);
      }
      currentIds.forEach((id) => seenIds.add(id));
      if (sameIds(next, order.value)) return;
      order.value = next;
      persist();
    },
    { immediate: true }
  );

  const orderedSections = computed(() =>
    applyCreationResourceOrder(options.sections(), order.value)
  );

  function reorder(payload: CreationBookDragPayload): void {
    const next = moveCreationResource(order.value, payload);
    if (sameIds(next, order.value)) return;
    order.value = next;
    persist();
  }

  return { order, orderedSections, reorder };
}

export type CreationResourceOrderController = ReturnType<
  typeof useCreationResourceOrder
>;
