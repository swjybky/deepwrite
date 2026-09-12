export type IconName =
  | "archive"
  | "arrow-left"
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
  | "download"
  | "edit"
  | "file"
  | "folder"
  | "globe"
  | "history"
  | "image"
  | "italic"
  | "keyboard"
  | "ledger"
  | "library"
  | "list"
  | "logo"
  | "mic"
  | "message"
  | "model"
  | "minus"
  | "more"
  | "panel-left"
  | "panel-right"
  | "panel-top"
  | "pin"
  | "plus"
  | "quote"
  | "redo"
  | "replace"
  | "save"
  | "search"
  | "settings"
  | "sparkles"
  | "stop"
  | "terminal"
  | "temperature"
  | "trash"
  | "undo"
  | "user"
  | "wand";

import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  LongCharacterGroup,
  MaterialKind,
  MaterialLibraryKind,
  WorkspaceAgentId,
  ShortWorkspaceStageId,
  SkillKind
} from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "./longWorkspace";

export type ResourceDomain = "creation" | "skill" | "material";

export type ResourceSectionAction =
  | "create"
  | "choose-open-book"
  | "choose-import-book"
  | "create-group"
  | "import"
  | "open-long-book"
  | "refresh-long-books"
  | "import-portable-long-book"
  | "import-continuation-long-book"
  | "import-legacy-library"
  | "import-external-library";

export interface ResourceSectionActionPayload {
  domain: ResourceDomain;
  action: ResourceSectionAction;
}

export type CatalogResourceNodeAction =
  | "create-entry"
  | "import-external-skills"
  | "rename-library"
  | "duplicate-library"
  | "rename-entry"
  | "copy-entry"
  | "paste-entry"
  | "remove-entry"
  | "unregister-library"
  | "delete-library"
  | "edit-group-bindings"
  | "duplicate-group"
  | "dissolve-group";

export interface CatalogResourceNodeActionPayload {
  domain: "skill" | "material";
  action: CatalogResourceNodeAction;
  node: ResourceTreeNode;
}

export interface CatalogLibraryEntryDragPayload {
  domain: "skill" | "material";
  sourceLibraryId: string;
  entryId: string;
  targetLibraryId: string;
  beforeEntryId?: string;
  targetStageId?: import("@deepwrite/contracts").MaterialStageId;
}

export interface CreationBookDragPayload {
  sourceId: string;
  targetId: string;
  position: "before" | "after";
}

export type {
  LongBookResourceNodeAction,
  LongBookResourceNodeActionPayload
} from "./longBookAction";

export type LongTreeCollectionKind =
  "worldbuilding-item" | "character" | "volume" | "plot-point" | "chapter-card";

export interface LongTreeCollectionTarget {
  kind: LongTreeCollectionKind;
  parentId?: string;
}

export interface LongTreeItemTarget {
  kind: LongTreeCollectionKind;
  id: string;
  parentId?: string;
}

export type LongTreeItemAction = "move-up" | "move-down" | "delete";

export type BookResourceDialogMode =
  | "manage-structure"
  | "rename"
  | "duplicate"
  | "remove"
  | "delete"
  | "bind-skill"
  | "bind-material";

export interface ResourceTreeNode {
  id: string;
  label: string;
  icon?: IconName;
  /** Allows a node with children to remain a selectable workspace context. */
  selectableBranch?: boolean;
  /** The real editor document represented by a synthetic navigation node. */
  targetDocumentId?: string;
  /** Overrides the stage-default short workspace agent for this navigation node. */
  shortAgentId?: WorkspaceAgentId;
  /** Identifies the expert-draft section selected by this navigation node. */
  expertSectionId?: string;
  /** Identifies a short/script character item represented by this node. */
  characterItemId?: string;
  /** Marks the selectable character directory in list mode. */
  characterDirectory?: boolean;
  /** Identifies the virtual draft directory represented by this navigation node. */
  draftDirectoryId?: string;
  /** The paired character-state editor document for a draft section node. */
  characterStateDocumentId?: string;
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
  /** Explicitly carries the owning creative workspace type for type-specific UI. */
  workspaceType?: "short" | "script" | "long";
  /** Long books use a separate store and intentionally do not inherit short-book actions. */
  longBookId?: string;
  /** Long-form navigation nodes reuse the standard resource tree styling. */
  longWorkspaceSelection?: LongWorkspaceSelection;
  /** Identifies one of the fixed long-form character folders. */
  longCharacterGroup?: LongCharacterGroup;
  /** Identifies a long-form draft volume folder that can add a manuscript section. */
  longDraftVolumeId?: string;
  /** Identifies a left-tree collection whose parent row can create an item. */
  longTreeCollection?: LongTreeCollectionTarget;
  /** Identifies a mutable long-form item rendered inside a left-tree collection. */
  longTreeItem?: LongTreeItemTarget;
  /** Identifies a continuity ledger row and whether it is the current tail. */
  longLedgerCommit?: {
    id: string;
    deletable: boolean;
  };
  catalogNodeType?:
    "book" | "long-book" | "library" | "group" | "category" | "document";
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
  workspaceType?: "short" | "script";
  workspaceTitle?: string;
  workspaceCategories?: string[];
  stageId?: ShortWorkspaceStageId;
  plotStageDescription?: string;
  plotStageOrder?: number;
  shortAgentId?: WorkspaceAgentId;
  expertSectionId?: string;
  characterItemId?: string;
  characterItemOrder?: number;
  characterFileKind?: "overview" | "item";
  expertSectionOrder?: number;
  expertWordCountRequirement?: string;
  draftDirectoryId?: string;
  draftFileKind?: "body" | "character-state";
  catalogDocumentId?: string;
  catalogEntryId?: string;
  /** Identifies a fixed library manifest field projected as an editor document. */
  catalogLibraryField?: "overview";
  catalogProjectRevision?: number;
  /** UTF-8 size from a metadata-only Catalog index. */
  catalogContentBytes?: number;
  /** Metadata revision used to invalidate the on-demand body LRU. */
  catalogContentStamp?: string;
  /** False until the body has been fetched through catalog.readDocument. */
  catalogContentLoaded?: boolean;
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

export type DialogMode =
  | "directory"
  | "models"
  | "imitation"
  | "long-book-analysis"
  | "style-comparison";
