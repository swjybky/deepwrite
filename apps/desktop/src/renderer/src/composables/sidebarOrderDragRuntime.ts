import { mysteryWorkspaceNavigation } from "../stores/mysteryWorkspaceNavigation";
import type {
  CatalogResourceNodeActionPayload,
  CreationTreeReorderPayload,
  ResourceDomain,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";
import { resolveSidebarOrderDrag } from "../utils/resolveSidebarOrderDrag";
import { useRowOrderDrag } from "./useRowOrderDrag";

export interface SidebarOrderDragOptions {
  sections: () => readonly ResourceTreeSection[];
  pinnedNodes: () => readonly ResourceTreeNode[];
  domainForPinnedNode: (node: ResourceTreeNode) => ResourceDomain;
  longTreeActionsDisabled: () => boolean;
  onReorderLibrary: (payload: CatalogResourceNodeActionPayload) => void;
  onReorderCreationNode: (payload: CreationTreeReorderPayload) => void;
}

export function createSidebarOrderDrag(options: SidebarOrderDragOptions) {
  return useRowOrderDrag<ResourceTreeNode>(
    "data-resource-id",
    ".tree-chevron, .tree-node-action-area",
    (id) =>
      resolveSidebarOrderDrag(id, {
        sections: options.sections(),
        pinnedNodes: options.pinnedNodes(),
        domainForPinnedNode: options.domainForPinnedNode,
        longTreeActionsDisabled: options.longTreeActionsDisabled(),
        canReorderMysteryBook: (bookId) => {
          const port = mysteryWorkspaceNavigation.value;
          return Boolean(port && port.bookId() === bookId && !port.busy());
        },
        onReorderLibrary: options.onReorderLibrary,
        onReorderCreationNode: options.onReorderCreationNode
      })
  );
}
