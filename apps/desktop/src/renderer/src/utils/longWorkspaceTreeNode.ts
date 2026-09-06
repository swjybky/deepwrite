import type { LongBookSummary, LongCharacterGroup } from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import {
  longBookResourceId,
  type LongWorkspaceSelection
} from "../types/longWorkspace";

export function createLongWorkspaceTreeNode(book: LongBookSummary) {
  return (
    selection: LongWorkspaceSelection,
    options: {
      icon: NonNullable<ResourceTreeNode["icon"]>;
      nodeKey?: string;
      label?: string;
      badge?: string;
      children?: ResourceTreeNode[];
      longCharacterGroup?: LongCharacterGroup;
      selectableBranch?: boolean;
      readOnly?: boolean;
      longTreeCollection?: ResourceTreeNode["longTreeCollection"];
      longTreeItem?: ResourceTreeNode["longTreeItem"];
      longLedgerCommit?: ResourceTreeNode["longLedgerCommit"];
    }
  ): ResourceTreeNode => ({
    id: `${longBookResourceId(book.id)}:${options.nodeKey ?? selection.key}`,
    label: options.label ?? selection.title,
    icon: options.icon,
    ...(options.badge ? { badge: options.badge } : {}),
    ...(options.children?.length ? { children: options.children } : {}),
    ...(options.longCharacterGroup
      ? { longCharacterGroup: options.longCharacterGroup }
      : {}),
    ...(options.longTreeCollection
      ? { longTreeCollection: options.longTreeCollection }
      : {}),
    ...(options.longTreeItem ? { longTreeItem: options.longTreeItem } : {}),
    ...(options.longLedgerCommit
      ? { longLedgerCommit: options.longLedgerCommit }
      : {}),
    ...(options.readOnly ? { readOnly: true } : {}),
    selectableBranch:
      options.selectableBranch ?? Boolean(options.children?.length),
    workspaceType: "long",
    longBookId: book.id,
    catalogNodeType: "category",
    longWorkspaceSelection: selection
  });
}
