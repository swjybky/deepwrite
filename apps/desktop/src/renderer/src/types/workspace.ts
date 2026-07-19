export type IconName =
  | "archive"
  | "arrow-up"
  | "attach"
  | "bold"
  | "book"
  | "brain"
  | "check"
  | "chevron"
  | "close"
  | "copy"
  | "directory"
  | "edit"
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
  | "message"
  | "model"
  | "more"
  | "panel-left"
  | "panel-right"
  | "pin"
  | "plus"
  | "quote"
  | "save"
  | "search"
  | "settings"
  | "sparkles"
  | "stop"
  | "terminal"
  | "temperature"
  | "trash"
  | "user"
  | "wand";

import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialKind,
  MaterialLibraryKind,
  ShortWorkspaceAgentId,
  ShortWorkspaceStageId,
  SkillKind
} from "@deepwrite/contracts";

export type ResourceDomain = "creation" | "skill" | "material";

export type ResourceSectionAction = "create" | "import" | "import-legacy-book";

export interface ResourceSectionActionPayload {
  domain: ResourceDomain;
  action: ResourceSectionAction;
}

export type CatalogResourceNodeAction =
  | "create-entry"
  | "remove-entry"
  | "unregister-library";

export interface CatalogResourceNodeActionPayload {
  domain: "skill" | "material";
  action: CatalogResourceNodeAction;
  node: ResourceTreeNode;
}

export type BookResourceDialogMode = "rename" | "remove" | "bind-skill" | "bind-material";

export interface ResourceTreeNode {
  id: string;
  label: string;
  icon?: IconName;
  /** Allows a node with children to remain a selectable workspace context. */
  selectableBranch?: boolean;
  /** The real editor document represented by a synthetic navigation node. */
  targetDocumentId?: string;
  /** Overrides the stage-default short workspace agent for this navigation node. */
  shortAgentId?: ShortWorkspaceAgentId;
  /** Identifies the expert-draft section selected by this navigation node. */
  expertSectionId?: string;
  categoryTag?: string;
  badge?: string;
  muted?: boolean;
  readOnly?: boolean;
  missing?: boolean;
  unavailable?: boolean;
  children?: ResourceTreeNode[];
  boundSkillLibraryIds?: string[];
  boundMaterialLibraryIds?: string[];
  boundSkillLibraryIdsByKind?: LinkedSkillIdsByKind;
  boundMaterialLibraryIdsByKind?: LinkedMaterialIdsByKind;
  projectRevision?: number;
  catalogNodeType?: "book" | "library" | "group" | "category" | "document";
  libraryId?: string;
  groupId?: string;
  materialKind?: MaterialLibraryKind;
  skillKind?: SkillKind;
  stageCategoryId?: string;
  catalogEntryId?: string;
  parentGenre?: string;
  subGenre?: string;
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
  workspaceId?: string;
  workspaceType?: "short" | "long";
  workspaceTitle?: string;
  workspaceCategories?: string[];
  stageId?: ShortWorkspaceStageId;
  shortAgentId?: ShortWorkspaceAgentId;
  expertSectionId?: string;
  catalogDocumentId?: string;
  catalogEntryId?: string;
  catalogProjectRevision?: number;
  libraryId?: string;
  materialKind?: MaterialKind;
  skillKind?: SkillKind;
  stageCategoryId?: string;
  parentGenre?: string;
  subGenre?: string;
}

export interface EditorDraftState {
  title: string;
  content: string;
  dirty: boolean;
  /** Orders Core recovery and the synchronous window-teardown fallback. */
  recoveryUpdatedAt?: string;
  /** Hash of the on-disk content from which this draft was first edited. */
  baseRevision?: string;
  /** Manifest revision captured when editing started. */
  baseProjectRevision?: number;
}

export type DialogMode = "directory" | "models" | "imitation";
