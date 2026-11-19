import { computed, ref, watch, type Ref } from "vue";
import type { ResourceTreeNode } from "../types/workspace";
import {
  isWorkspaceBookNode,
  resourceTreeContainsResource
} from "../utils/resourceTreeLookup";

export function useTreeNodeDisclosure(
  node: () => ResourceTreeNode,
  selectedId: () => string,
  options: {
    initialOpen?: boolean;
    selectionActive?: Readonly<Ref<boolean>>;
  } = {}
) {
  const disclosed = ref(options.initialOpen ?? false);
  let openedBySelection = false;
  const open = computed({
    get: () => disclosed.value,
    set(value: boolean) {
      openedBySelection = false;
      disclosed.value = value;
    }
  });
  const containsSelection = computed(() => {
    const current = node();
    const selection = selectedId();
    return Boolean(
      selection &&
      current.children?.length &&
      ((current.selectableBranch && current.id === selection) ||
        resourceTreeContainsResource(current.children, selection))
    );
  });
  let selectionWasContained = false;

  watch(
    [
      selectedId,
      containsSelection,
      () => options.selectionActive?.value ?? true
    ],
    ([selection, contains, active], [previousSelection, , wasActive]) => {
      const current = node();
      if (
        !contains &&
        selection !== previousSelection &&
        openedBySelection &&
        isWorkspaceBookNode(current)
      ) {
        disclosed.value = false;
        openedBySelection = false;
      }
      const replacingRemovedSelection = Boolean(
        wasActive &&
        selectionWasContained &&
        previousSelection &&
        selection !== previousSelection &&
        previousSelection !== current.id &&
        !resourceTreeContainsResource(current.children ?? [], previousSelection)
      );
      const collapsingSelectedBranch = Boolean(
        wasActive &&
        !open.value &&
        current.selectableBranch &&
        selection === current.id &&
        previousSelection &&
        resourceTreeContainsResource(current.children ?? [], previousSelection)
      );
      // The refreshed tree can publish before its fallback selection. Remember
      // membership until the selection changes so a manual collapse survives.
      selectionWasContained =
        selection !== previousSelection
          ? contains
          : selectionWasContained || contains;
      if (
        !contains ||
        !active ||
        replacingRemovedSelection ||
        collapsingSelectedBranch
      )
        return;
      if (!disclosed.value) {
        openedBySelection = true;
        disclosed.value = true;
      }
    },
    { immediate: true }
  );

  return { open };
}
