import {
  reconcileLibraryOrder,
  type LibraryOrganization
} from "@deepwrite/contracts/renderer";
import type { ResourceTreeNode } from "../types/workspace";

export function orderLibraryNodes(
  nodes: ResourceTreeNode[],
  domain: "material" | "skill",
  organization?: LibraryOrganization,
  groupId?: string
): ResourceTreeNode[] {
  const key = (node: ResourceTreeNode) =>
    (node.catalogNodeType === "group" ? node.groupId : node.libraryId) ??
    node.id;
  const order = reconcileLibraryOrder(
    nodes.map(key),
    (groupId ? organization?.groups[groupId] : organization?.[domain]) ?? []
  );
  const byId = new Map(nodes.map((node) => [key(node), node]));
  return order.map((id, index) => {
    const node = byId.get(id)!;
    return {
      ...node,
      canMoveLibraryUp: index > 0,
      canMoveLibraryDown: index < order.length - 1,
      ...(node.catalogNodeType === "group" && node.children
        ? {
            children: orderLibraryNodes(
              node.children,
              domain,
              organization,
              node.groupId
            )
          }
        : {})
    };
  });
}
