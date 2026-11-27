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
  const isGroup = (node: ResourceTreeNode) => node.catalogNodeType === "group";
  const ordered = order.map((id) => byId.get(id)!);
  // 分组固定在库上面，用户自定义顺序只在同类之间生效。
  const sorted = [
    ...ordered.filter(isGroup),
    ...ordered.filter((n) => !isGroup(n))
  ];
  return sorted.map((node, index) => {
    const sameKind = (other?: ResourceTreeNode) =>
      !!other && isGroup(other) === isGroup(node);
    return {
      ...node,
      canMoveLibraryUp: sameKind(sorted[index - 1]),
      canMoveLibraryDown: sameKind(sorted[index + 1]),
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
