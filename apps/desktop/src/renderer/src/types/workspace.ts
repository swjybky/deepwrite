export type IconName =
  | "archive"
  | "arrow-up"
  | "attach"
  | "bold"
  | "book"
  | "brain"
  | "check"
  | "chevron"
  | "copy"
  | "directory"
  | "file"
  | "folder"
  | "globe"
  | "history"
  | "italic"
  | "keyboard"
  | "ledger"
  | "library"
  | "logo"
  | "mic"
  | "model"
  | "more"
  | "panel-left"
  | "panel-right"
  | "plus"
  | "quote"
  | "save"
  | "search"
  | "settings"
  | "sparkles"
  | "user"
  | "wand";

export type ResourceDomain = "creation" | "skill" | "material";

export interface ResourceTreeNode {
  id: string;
  label: string;
  icon?: IconName;
  badge?: string;
  muted?: boolean;
  defaultExpanded?: boolean;
  children?: ResourceTreeNode[];
}

export interface ResourceTreeSection {
  id: ResourceDomain;
  label: string;
  icon: IconName;
  nodes: ResourceTreeNode[];
}

export interface WorkspaceDocument {
  id: string;
  domain: ResourceDomain;
  title: string;
  eyebrow: string;
  path: string[];
  content: string;
  readOnly?: boolean;
  format?: "正文" | "设定" | "技能" | "素材" | "账本";
}

export interface EditorDraftState {
  title: string;
  content: string;
  dirty: boolean;
}

export type DialogMode = "directory" | "models" | "imitation";
