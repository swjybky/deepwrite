import type { ResourceTreeNode } from "./workspace";
export type LongBookResourceNodeAction =
  | "manage-structure"
  | "resolve-conflicts"
  | "sync-legacy"
  | "rename"
  | "duplicate"
  | "export"
  | "bind-skill"
  | "bind-material"
  | "unregister"
  | "delete";

export interface LongBookResourceNodeActionPayload {
  action: LongBookResourceNodeAction;
  node: ResourceTreeNode & {
    catalogNodeType: "long-book";
    longBookId: string;
    workspaceType: "long";
  };
}
