import {
  BookProjectManifestSchema,
  CatalogProjectManifestSchema,
  CurrentBookProjectManifestSchema,
  LegacyBookProjectManifestSchema,
  MaterialGroupProjectManifestSchema,
  MaterialLibraryProjectManifestSchema,
  SkillGroupProjectManifestSchema,
  SkillLibraryProjectManifestSchema,
  type Book,
  type BookProjectManifest,
  type CatalogLegacyImport,
  type CatalogProjectManifest,
  type CatalogSnapshot,
  type CreateLibraryGroupInput,
  type CreateLibraryInput,
  type CreateScriptBookInput,
  type CreateShortBookInput,
  type DeleteCatalogProjectInput,
  type DeleteCatalogProjectResult,
  type CreativePlotStage,
  type CurrentBookProjectManifest,
  type LegacyBookProjectManifest,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type MaterialLibraryProjectManifest,
  type MaterialStageId,
  type SaveDocumentInput,
  type SkillLibrary,
  type SkillLibraryGroup,
  type SkillLibraryProjectManifest,
  type SkillStageId,
  type UpdateBookInput
} from "@deepwrite/contracts";

export const MANIFEST_FILE = "deepwrite.json";
export const REGISTRY_FILE = "catalog-registry.json";
export const REGISTRY_BACKUP_FILE = "catalog-registry.json.bak";
export const DRAFT_RECOVERY_FILE = "draft-recovery.json";
export const DEFAULT_MAX_MANIFEST_BYTES = 1024 * 1024;
export const DEFAULT_MAX_MARKDOWN_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_PROJECT_CONTENT_BYTES = 128 * 1024 * 1024;
export const DEFAULT_MAX_SNAPSHOT_CONTENT_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_DRAFT_RECOVERY_BYTES = 128 * 1024 * 1024;

export const FolderBookProjectManifestSchema = BookProjectManifestSchema;
export const FolderCurrentBookProjectManifestSchema =
  CurrentBookProjectManifestSchema;
export const FolderLegacyBookProjectManifestSchema =
  LegacyBookProjectManifestSchema;
export const FolderMaterialProjectManifestSchema =
  MaterialLibraryProjectManifestSchema;
export const FolderSkillProjectManifestSchema =
  SkillLibraryProjectManifestSchema;
export const FolderMaterialGroupProjectManifestSchema =
  MaterialGroupProjectManifestSchema;
export const FolderSkillGroupProjectManifestSchema =
  SkillGroupProjectManifestSchema;
export const FolderCatalogProjectManifestSchema = CatalogProjectManifestSchema;

export type FolderBookProjectManifest = BookProjectManifest;
export type FolderCurrentBookProjectManifest = CurrentBookProjectManifest;
export type FolderLegacyBookProjectManifest = LegacyBookProjectManifest;
export type FolderMaterialProjectManifest = MaterialLibraryProjectManifest;
export type FolderSkillProjectManifest = SkillLibraryProjectManifest;
export type FolderCatalogProjectManifest = CatalogProjectManifest;

export const CATALOG_PROJECT_DOMAINS = [
  "book",
  "material-library",
  "material-group",
  "skill-library",
  "skill-group"
] as const;
export type FolderCatalogProjectDomain =
  (typeof CATALOG_PROJECT_DOMAINS)[number];

export interface RegistryProject {
  id: string;
  domain: FolderCatalogProjectDomain;
  projectDirectory: string;
  registeredAt: string;
}

export interface FolderCatalogRegistry {
  schemaVersion: 1;
  libraryOrganization?: import("@deepwrite/contracts").LibraryOrganization;
  revision: number;
  updatedAt: string;
  legacyImport?: CatalogLegacyImport;
  sourceCatalogMigrated: boolean;
  creativePlotStages: CreativePlotStage[];
  projects: RegistryProject[];
}

export interface WriteMissingSnapshotProjectsResult {
  registry: FolderCatalogRegistry;
  createdProjectDirectories: string[];
}

export type FolderCatalogResource =
  | Book
  | MaterialLibrary
  | MaterialLibraryGroup
  | SkillLibrary
  | SkillLibraryGroup;

export interface CatalogContentMetadata {
  contentBytes: number;
  contentStamp: string;
}

export interface OpenFolderCatalogProjectResult<
  Resource extends FolderCatalogResource = FolderCatalogResource
> {
  domain: FolderCatalogProjectDomain;
  projectDirectory: string;
  revision: number;
  resource: Resource;
}

export interface FolderCatalogStoreOptions {
  userDataPath: string;
  initialSnapshot?: CatalogSnapshot;
  now?: () => string;
  maxManifestBytes?: number;
  maxMarkdownBytes?: number;
  maxProjectContentBytes?: number;
  maxSnapshotContentBytes?: number;
  maxDraftRecoveryBytes?: number;
}

export interface FolderCatalogStoreContext {
  readonly registryPath: string;
  readonly registryBackupPath: string;
  readonly projectsRoot: string;
  readonly draftRecoveryPath: string;
  readonly defaultProjectParents: Readonly<
    Record<FolderCatalogProjectDomain, string>
  >;
  readonly initialSnapshot: CatalogSnapshot | undefined;
  readonly now: () => string;
  readonly maxManifestBytes: number;
  readonly maxMarkdownBytes: number;
  readonly maxProjectContentBytes: number;
  readonly maxSnapshotContentBytes: number;
  readonly maxDraftRecoveryBytes: number;
  writeChain: Promise<void>;
  writeRegistry(registry: FolderCatalogRegistry): Promise<void>;
}

export interface CreateShortBookAtDirectoryInput {
  parentDirectory?: string;
  input: CreateShortBookInput;
}

export interface CreateScriptBookAtDirectoryInput {
  parentDirectory?: string;
  input: CreateScriptBookInput;
}

export type FolderCatalogLibraryDomain = "material" | "skill";

export type CreateFolderLibraryInput = CreateLibraryInput & {
  parentDirectory?: string | undefined;
};

export type CreateFolderLibraryGroupInput = CreateLibraryGroupInput & {
  parentDirectory?: string | undefined;
};

export interface CreateFolderLibraryEntryInputBase {
  libraryId: string;
  title: string;
  content: string;
  baseProjectRevision?: number | undefined;
  force?: boolean | undefined;
}

export type CreateFolderLibraryEntryInput =
  | (CreateFolderLibraryEntryInputBase & {
      domain: "material";
      stageId?: MaterialStageId | undefined;
    })
  | (CreateFolderLibraryEntryInputBase & {
      domain: "skill";
      stageId?: SkillStageId | undefined;
    });

export interface RemoveFolderLibraryEntryInput {
  domain: FolderCatalogLibraryDomain;
  libraryId: string;
  entryId: string;
  baseRevision?: string | undefined;
  baseProjectRevision?: number | undefined;
  force?: boolean | undefined;
}

export interface RemoveFolderLibraryEntryResult {
  libraryId: string;
  entryId: string;
  deleted: boolean;
}

export type FolderCatalogUnregisterDomain =
  | "book"
  | FolderCatalogLibraryDomain
  | "material-library"
  | "material-group"
  | "skill-library"
  | "skill-group";

export interface UnregisterFolderCatalogProjectInput {
  projectId: string;
  domain: FolderCatalogUnregisterDomain;
}

export interface UnregisterFolderCatalogProjectResult {
  projectId: string;
  domain: FolderCatalogUnregisterDomain;
  unregistered: boolean;
}

export type DeleteFolderCatalogProjectInput = DeleteCatalogProjectInput;
export type DeleteFolderCatalogProjectResult = DeleteCatalogProjectResult;

export interface DuplicateProjectWritePlan {
  domain: FolderCatalogProjectDomain;
  parentDirectory: string;
  resource: FolderCatalogResource;
  writingContext?: string;
}

export type SaveFolderDocumentInput = SaveDocumentInput;

export type UpdateFolderBookInput = UpdateBookInput;

export class FolderCatalogConflictError extends Error {
  readonly expectedRevision: string | number;
  readonly actualRevision: string | number;

  constructor(
    expectedRevision: string | number,
    actualRevision: string | number
  ) {
    super(
      `项目已在其他位置更新（期望版本 ${expectedRevision}，当前版本 ${actualRevision}）。`
    );
    this.name = "FolderCatalogConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}
