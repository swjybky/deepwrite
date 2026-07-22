import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import {
  BookProjectManifestSchema,
  CatalogDraftRecoverySchema,
  CatalogProjectContentPathSchema,
  CatalogProjectManifestSchema,
  CatalogLegacyImportSchema,
  CatalogSnapshotSchema,
  CreateLibraryInputSchema,
  CreateLibraryGroupInputSchema,
  CreateShortBookInputSchema,
  SaveDocumentInputSchema,
  MaterialGroupProjectManifestSchema,
  MaterialLibraryProjectManifestSchema,
  SaveLibraryEntryInputSchema,
  SkillGroupProjectManifestSchema,
  SkillLibraryProjectManifestSchema,
  ShortBookSchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  createShortWorkspaceContentRevision,
  type BookProjectDocumentManifest,
  type BookProjectManifest,
  type CatalogLegacyImport,
  type CatalogProjectManifest,
  type CatalogProjectDiagnostic,
  type CatalogDocument,
  type CatalogDraftRecovery,
  type CatalogSnapshot,
  type CreateLibraryInput,
  type CreateLibraryGroupInput,
  type CreateShortBookInput,
  type MaterialLibraryProjectManifest,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type MaterialEntry,
  type MaterialStageId,
  type SaveLibraryEntryInput,
  type SaveDocumentInput,
  type ShortBook,
  type SkillLibraryProjectManifest,
  type SkillLibrary,
  type SkillLibraryGroup,
  type SkillEntry,
  type SkillStageId,
  type UpdateBookInput,
  type UpdateLibraryGroupInput
} from "@deepwrite/contracts";
import type { ImportedLegacyBook } from "./legacy-book-import";
import type { ImportedLegacyLibrary } from "./legacy-library-import";

const MANIFEST_FILE = "deepwrite.json";
const REGISTRY_FILE = "catalog-registry.json";
const REGISTRY_BACKUP_FILE = "catalog-registry.json.bak";
const DRAFT_RECOVERY_FILE = "draft-recovery.json";
const DEFAULT_MAX_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_MARKDOWN_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_PROJECT_CONTENT_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_CONTENT_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_DRAFT_RECOVERY_BYTES = 128 * 1024 * 1024;

export const FolderBookProjectManifestSchema = BookProjectManifestSchema;
export const FolderMaterialProjectManifestSchema =
  MaterialLibraryProjectManifestSchema;
export const FolderSkillProjectManifestSchema = SkillLibraryProjectManifestSchema;
export const FolderMaterialGroupProjectManifestSchema =
  MaterialGroupProjectManifestSchema;
export const FolderSkillGroupProjectManifestSchema = SkillGroupProjectManifestSchema;
export const FolderCatalogProjectManifestSchema = CatalogProjectManifestSchema;

export type FolderBookProjectManifest = BookProjectManifest;
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

interface RegistryProject {
  id: string;
  domain: FolderCatalogProjectDomain;
  projectDirectory: string;
  registeredAt: string;
}

interface FolderCatalogRegistry {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  legacyImport?: CatalogLegacyImport;
  sourceCatalogMigrated: boolean;
  projects: RegistryProject[];
}

interface WriteMissingSnapshotProjectsResult {
  registry: FolderCatalogRegistry;
  createdProjectDirectories: string[];
}

export type FolderCatalogResource =
  | ShortBook
  | MaterialLibrary
  | MaterialLibraryGroup
  | SkillLibrary
  | SkillLibraryGroup;

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

export interface CreateShortBookAtDirectoryInput {
  parentDirectory?: string;
  input: CreateShortBookInput;
}

export type FolderCatalogLibraryDomain = "material" | "skill";

export type CreateFolderLibraryInput = CreateLibraryInput & {
  parentDirectory?: string | undefined;
};

export type CreateFolderLibraryGroupInput = CreateLibraryGroupInput & {
  parentDirectory?: string | undefined;
};

interface CreateFolderLibraryEntryInputBase {
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

export interface DeleteFolderCatalogProjectInput {
  projectId: string;
  domain: "book" | FolderCatalogLibraryDomain;
}

export interface DeleteFolderCatalogProjectResult {
  projectId: string;
  domain: "book" | FolderCatalogLibraryDomain;
  deleted: boolean;
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

export class FolderCatalogStore {
  readonly registryPath: string;
  readonly registryBackupPath: string;
  readonly projectsRoot: string;
  readonly draftRecoveryPath: string;
  readonly defaultProjectParents: Readonly<
    Record<FolderCatalogProjectDomain, string>
  >;

  private readonly initialSnapshot: CatalogSnapshot | undefined;
  private readonly now: () => string;
  private readonly maxManifestBytes: number;
  private readonly maxMarkdownBytes: number;
  private readonly maxProjectContentBytes: number;
  private readonly maxSnapshotContentBytes: number;
  private readonly maxDraftRecoveryBytes: number;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: FolderCatalogStoreOptions) {
    const userDataPath = options.userDataPath.trim();
    if (!userDataPath) {
      throw new Error("FolderCatalogStore requires a user data path.");
    }
    this.registryPath = join(userDataPath, REGISTRY_FILE);
    this.registryBackupPath = join(userDataPath, REGISTRY_BACKUP_FILE);
    this.draftRecoveryPath = join(userDataPath, DRAFT_RECOVERY_FILE);
    this.projectsRoot = join(userDataPath, "catalog-projects");
    this.defaultProjectParents = {
      book: join(this.projectsRoot, "books"),
      "material-library": join(this.projectsRoot, "materials"),
      "material-group": join(this.projectsRoot, "material-groups"),
      "skill-library": join(this.projectsRoot, "skills"),
      "skill-group": join(this.projectsRoot, "skill-groups")
    };
    this.initialSnapshot = options.initialSnapshot
      ? CatalogSnapshotSchema.parse(structuredClone(options.initialSnapshot))
      : undefined;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxManifestBytes = positiveByteLimit(
      options.maxManifestBytes,
      DEFAULT_MAX_MANIFEST_BYTES,
      "manifest"
    );
    this.maxMarkdownBytes = positiveByteLimit(
      options.maxMarkdownBytes,
      DEFAULT_MAX_MARKDOWN_BYTES,
      "Markdown"
    );
    this.maxProjectContentBytes = positiveByteLimit(
      options.maxProjectContentBytes,
      DEFAULT_MAX_PROJECT_CONTENT_BYTES,
      "project content"
    );
    this.maxSnapshotContentBytes = positiveByteLimit(
      options.maxSnapshotContentBytes,
      DEFAULT_MAX_SNAPSHOT_CONTENT_BYTES,
      "snapshot content"
    );
    this.maxDraftRecoveryBytes = positiveByteLimit(
      options.maxDraftRecoveryBytes,
      DEFAULT_MAX_DRAFT_RECOVERY_BYTES,
      "draft recovery"
    );
  }

  async snapshot(): Promise<CatalogSnapshot> {
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      return await this.aggregateSnapshot(registry);
    });
  }

  async loadDraftRecovery(): Promise<CatalogDraftRecovery> {
    return await this.readAfterWrites(async () => {
      const text = await readOptionalUtf8File(
        this.draftRecoveryPath,
        this.maxDraftRecoveryBytes,
        "draft recovery"
      );
      return text === undefined
        ? {}
        : CatalogDraftRecoverySchema.parse(
            parseJson(text, this.draftRecoveryPath)
          );
    });
  }

  async saveDraftRecovery(
    rawDrafts: CatalogDraftRecovery
  ): Promise<void> {
    const drafts = CatalogDraftRecoverySchema.parse(rawDrafts);
    await this.mutate(async () => {
      await atomicWriteJson(
        this.draftRecoveryPath,
        drafts,
        this.maxDraftRecoveryBytes
      );
    });
  }

  async migrateSnapshot(rawSnapshot: CatalogSnapshot): Promise<CatalogSnapshot> {
    const snapshot = CatalogSnapshotSchema.parse(structuredClone(rawSnapshot));
    return await this.mutate(async () => {
      const existing = await this.readRegistryOptional();
      if (existing?.sourceCatalogMigrated) {
        return await this.aggregateSnapshot(existing);
      }
      const base = existing ?? emptyRegistry(snapshot.updatedAt);
      const { registry: next, createdProjectDirectories } =
        await this.writeMissingSnapshotProjects(base, snapshot);
      next.revision = snapshot.revision;
      next.updatedAt = snapshot.updatedAt;
      setLegacyImport(next, snapshot.legacyImport);
      next.sourceCatalogMigrated = true;
      try {
        await this.writeRegistry(next);
      } catch (error: unknown) {
        await cleanupNewProjectDirectories(createdProjectDirectories);
        throw error;
      }
      return await this.aggregateSnapshot(next);
    });
  }

  async syncSnapshot(rawSnapshot: CatalogSnapshot): Promise<CatalogSnapshot> {
    const snapshot = CatalogSnapshotSchema.parse(structuredClone(rawSnapshot));
    return await this.mutate(async () => {
      const current = await this.ensureRegistry();
      const before = current.projects.length;
      const { registry: next, createdProjectDirectories } =
        await this.writeMissingSnapshotProjects(current, snapshot);
      const changed = next.projects.length !== before;
      if (changed || snapshot.legacyImport !== undefined) {
        next.revision = Math.max(current.revision + (changed ? 1 : 0), snapshot.revision);
        next.updatedAt = changed ? this.now() : current.updatedAt;
        setLegacyImport(next, snapshot.legacyImport ?? current.legacyImport);
        next.sourceCatalogMigrated = true;
        try {
          await this.writeRegistry(next);
        } catch (error: unknown) {
          await cleanupNewProjectDirectories(createdProjectDirectories);
          throw error;
        }
      }
      return await this.aggregateSnapshot(next);
    });
  }

  async createShortBook(
    rawInput: CreateShortBookInput,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<ShortBook>>;
  async createShortBook(
    rawInput: CreateShortBookAtDirectoryInput
  ): Promise<OpenFolderCatalogProjectResult<ShortBook>>;
  async createShortBook(
    rawInput: CreateShortBookInput | CreateShortBookAtDirectoryInput,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<ShortBook>> {
    const wrapped = isCreateAtDirectoryInput(rawInput);
    const input = CreateShortBookInputSchema.parse(wrapped ? rawInput.input : rawInput);
    const parent =
      (wrapped ? rawInput.parentDirectory : parentDirectory)?.trim() ||
      this.defaultProjectParents.book;
    return await this.mutate(async () => {
      const now = this.now();
      const book: ShortBook = {
        id: `book-${randomUUID()}`,
        title: input.title,
        bookType: "short",
        genre: input.genre,
        status: "editing",
        linkedMaterialIdsByKind: {
          character: [...(input.linkedMaterialIdsByKind?.character ?? [])],
          gimmick: [...(input.linkedMaterialIdsByKind?.gimmick ?? [])],
          plot: [...(input.linkedMaterialIdsByKind?.plot ?? [])],
          draft: [...(input.linkedMaterialIdsByKind?.draft ?? [])],
          other: [...(input.linkedMaterialIdsByKind?.other ?? [])]
        },
        linkedSkillIdsByKind: {
          general: [...(input.linkedSkillIdsByKind?.general ?? [])],
          plot: [...(input.linkedSkillIdsByKind?.plot ?? [])],
          style: [...(input.linkedSkillIdsByKind?.style ?? [])],
          other: [...(input.linkedSkillIdsByKind?.other ?? [])]
        },
        documents: DEFAULT_SHORT_DOCUMENTS.map(([id, title]) => ({
          id,
          title,
          content: "",
          createdAt: now,
          updatedAt: now
        })),
        createdAt: now,
        updatedAt: now
      };
      const projectDirectory = await this.writeNewResourceProject(
        "book",
        parent,
        book
      );
      try {
        const registry = await this.ensureRegistry();
        await this.registerProject(registry, {
          id: book.id,
          domain: "book",
          projectDirectory,
          registeredAt: now
        });
      } catch (error: unknown) {
        await cleanupNewProjectDirectories([projectDirectory]);
        throw error;
      }
      return (await this.readProject(
        projectDirectory,
        "book"
      )) as OpenFolderCatalogProjectResult<ShortBook>;
    });
  }

  async createLibrary(
    rawInput: CreateFolderLibraryInput & { domain: "material" }
  ): Promise<OpenFolderCatalogProjectResult<MaterialLibrary>>;
  async createLibrary(
    rawInput: CreateFolderLibraryInput & { domain: "skill" }
  ): Promise<OpenFolderCatalogProjectResult<SkillLibrary>>;
  async createLibrary(
    rawInput: CreateFolderLibraryInput
  ): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>>;
  async createLibrary(
    rawInput: CreateFolderLibraryInput
  ): Promise<
    OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>
  > {
    const input = CreateLibraryInputSchema.parse(rawInput);
    const parentDirectory =
      rawInput.parentDirectory?.trim() ||
      this.defaultProjectParents[
        input.domain === "material" ? "material-library" : "skill-library"
      ];
    return await this.mutate(async () => {
      const now = this.now();
      const resource: MaterialLibrary | SkillLibrary =
        input.domain === "material"
          ? {
              id: `material-${randomUUID()}`,
              title: input.name,
              materialType: "short",
              materialKind: input.materialKind,
              parentGenre: "",
              subGenre: "",
              overview: "",
              entries: [],
              createdAt: now,
              updatedAt: now
            }
          : {
              id: `skill-${randomUUID()}`,
              title: input.name,
              skillType: "short",
              skillKind: input.skillKind,
              overview: "",
              isBuiltin: false,
              entries: [],
              createdAt: now,
              updatedAt: now
            };
      const projectDomain = libraryProjectDomain(input.domain);
      const projectDirectory = await this.writeNewResourceProject(
        projectDomain,
        parentDirectory,
        resource
      );
      try {
        const registry = await this.ensureRegistry();
        await this.registerProject(registry, {
          id: resource.id,
          domain: projectDomain,
          projectDirectory,
          registeredAt: now
        });
      } catch (error: unknown) {
        await cleanupNewProjectDirectories([projectDirectory]);
        throw error;
      }
      return (await this.readProject(
        projectDirectory,
        projectDomain
      )) as OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>;
    });
  }

  async createLibraryGroup(
    rawInput: CreateFolderLibraryGroupInput
  ): Promise<OpenFolderCatalogProjectResult<MaterialLibraryGroup | SkillLibraryGroup>> {
    const input = CreateLibraryGroupInputSchema.parse(rawInput);
    const projectDomain =
      input.domain === "material" ? "material-group" : "skill-group";
    const parentDirectory =
      rawInput.parentDirectory?.trim() || this.defaultProjectParents[projectDomain];
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const snapshot = await this.aggregateSnapshot(registry);
      if (input.domain === "material") {
        assertUniqueGroupMembers(Object.values(input.members));
        const libraries = new Map(
          snapshot.materials.map((library) => [library.id, library])
        );
        for (const [kind, libraryId] of Object.entries(input.members)) {
          if (!libraryId) continue;
          const library = libraries.get(libraryId);
          if (!library) {
            throw new Error(`新建素材分组引用了不存在的素材库：${libraryId}`);
          }
          if (library.materialKind !== "mixed" && library.materialKind !== kind) {
            throw new Error(`素材库“${library.title}”不能放入${kind}分类。`);
          }
          assertLibraryNotInAnotherGroup(
            snapshot.materialGroups,
            libraryId,
            "素材"
          );
        }
      } else {
        assertUniqueGroupMembers(Object.values(input.members));
        const libraries = new Map(snapshot.skills.map((library) => [library.id, library]));
        for (const [kind, libraryId] of Object.entries(input.members)) {
          if (!libraryId) continue;
          const library = libraries.get(libraryId);
          if (!library) {
            throw new Error(`新建技能分组引用了不存在的技能库：${libraryId}`);
          }
          if (library.skillKind !== kind) {
            throw new Error(`技能库“${library.title}”不能放入${kind}分类。`);
          }
          assertLibraryNotInAnotherGroup(
            snapshot.skillGroups,
            libraryId,
            "技能"
          );
        }
      }

      const now = this.now();
      const resource: MaterialLibraryGroup | SkillLibraryGroup =
        input.domain === "material"
          ? {
              id: `material-group-${randomUUID()}`,
              title: input.name,
              members: { ...input.members },
              createdAt: now,
              updatedAt: now
            }
          : {
              id: `skill-group-${randomUUID()}`,
              title: input.name,
              members: { ...input.members },
              createdAt: now,
              updatedAt: now
            };
      const projectDirectory = await this.writeNewResourceProject(
        projectDomain,
        parentDirectory,
        resource
      );
      try {
        await this.registerProject(registry, {
          id: resource.id,
          domain: projectDomain,
          projectDirectory,
          registeredAt: now
        });
      } catch (error: unknown) {
        await cleanupNewProjectDirectories([projectDirectory]);
        throw error;
      }
      return (await this.readProject(
        projectDirectory,
        projectDomain
      )) as OpenFolderCatalogProjectResult<MaterialLibraryGroup | SkillLibraryGroup>;
    });
  }

  async importLegacyBook(
    input: ImportedLegacyBook,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<ShortBook>> {
    const parent = parentDirectory?.trim() || this.defaultProjectParents.book;
    return await this.mutate(async () => {
      const now = this.now();
      const book = ShortBookSchema.parse({
        id: `book-${randomUUID()}`,
        title: input.title,
        bookType: "short",
        genre: input.genre,
        status: input.status,
        linkedMaterialIdsByKind: structuredClone(input.linkedMaterialIdsByKind),
        linkedSkillIdsByKind: structuredClone(input.linkedSkillIdsByKind),
        documents: input.documents.map((document) => ({
          ...document,
          createdAt: now,
          updatedAt: now
        })),
        createdAt: now,
        updatedAt: now
      });
      const projectDirectory = await this.writeNewResourceProject(
        "book",
        parent,
        book
      );
      try {
        const registry = await this.ensureRegistry();
        await this.registerProject(registry, {
          id: book.id,
          domain: "book",
          projectDirectory,
          registeredAt: now
        });
      } catch (error: unknown) {
        await cleanupNewProjectDirectories([projectDirectory]);
        throw error;
      }
      return (await this.readProject(
        projectDirectory,
        "book"
      )) as OpenFolderCatalogProjectResult<ShortBook>;
    });
  }

  async importLegacyLibrary(
    input: Extract<ImportedLegacyLibrary, { domain: "material" }>,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<MaterialLibrary>>;
  async importLegacyLibrary(
    input: Extract<ImportedLegacyLibrary, { domain: "skill" }>,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<SkillLibrary>>;
  async importLegacyLibrary(
    input: ImportedLegacyLibrary,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>>;
  async importLegacyLibrary(
    input: ImportedLegacyLibrary,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>> {
    const projectDomain = libraryProjectDomain(input.domain);
    const parent =
      parentDirectory?.trim() || this.defaultProjectParents[projectDomain];
    return await this.mutate(async () => {
      const now = this.now();
      const resource: MaterialLibrary | SkillLibrary =
        input.domain === "material"
          ? {
              ...input.library,
              id: `material-${randomUUID()}`,
              entries: input.library.entries.map((entry) => ({
                ...entry,
                id: `material-entry-${randomUUID()}`,
                createdAt: now,
                updatedAt: now
              })),
              createdAt: now,
              updatedAt: now
            }
          : {
              ...input.library,
              id: `skill-${randomUUID()}`,
              isBuiltin: false,
              entries: input.library.entries.map((entry) => ({
                ...entry,
                id: `skill-entry-${randomUUID()}`,
                createdAt: now,
                updatedAt: now
              })),
              createdAt: now,
              updatedAt: now
            };
      const projectDirectory = await this.writeNewResourceProject(
        projectDomain,
        parent,
        resource
      );
      try {
        const registry = await this.ensureRegistry();
        await this.registerProject(registry, {
          id: resource.id,
          domain: projectDomain,
          projectDirectory,
          registeredAt: now
        });
      } catch (error: unknown) {
        await cleanupNewProjectDirectories([projectDirectory]);
        throw error;
      }
      return (await this.readProject(
        projectDirectory,
        projectDomain
      )) as OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>;
    });
  }

  async openCatalogProject(
    projectDirectory: string,
    expectedDomain?: FolderCatalogProjectDomain,
    register = true
  ): Promise<OpenFolderCatalogProjectResult> {
    if (!register) {
      return await this.readAfterWrites(() =>
        this.readProject(projectDirectory, expectedDomain)
      );
    }
    return await this.mutate(async () => {
      const opened = await this.readProject(projectDirectory, expectedDomain);
      const registry = await this.ensureRegistry();
      await this.registerProject(registry, {
        id: opened.resource.id,
        domain: opened.domain,
        projectDirectory: opened.projectDirectory,
        registeredAt: this.now()
      });
      return opened;
    });
  }

  async openBookProject(
    projectDirectory: string,
    register = true
  ): Promise<OpenFolderCatalogProjectResult<ShortBook>> {
    return (await this.openCatalogProject(
      projectDirectory,
      "book",
      register
    )) as OpenFolderCatalogProjectResult<ShortBook>;
  }

  async openMaterialProject(
    projectDirectory: string,
    register = true
  ): Promise<OpenFolderCatalogProjectResult<MaterialLibrary>> {
    return (await this.openCatalogProject(
      projectDirectory,
      "material-library",
      register
    )) as OpenFolderCatalogProjectResult<MaterialLibrary>;
  }

  async openSkillProject(
    projectDirectory: string,
    register = true
  ): Promise<OpenFolderCatalogProjectResult<SkillLibrary>> {
    return (await this.openCatalogProject(
      projectDirectory,
      "skill-library",
      register
    )) as OpenFolderCatalogProjectResult<SkillLibrary>;
  }

  async updateBook(rawInput: UpdateFolderBookInput): Promise<ShortBook> {
    const input = UpdateBookInputSchema.parse(rawInput);
    if (input.baseProjectRevision !== undefined) {
      assertProjectRevision(input.baseProjectRevision);
    }
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const opened = await this.readProject(
        registration.projectDirectory,
        "book",
        input.bookId
      );
      const manifest = await this.readManifest(
        opened.projectDirectory,
        "deepwrite.book",
        input.bookId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      const now = this.now();
      const next = {
        ...manifest,
        revision: manifest.revision + 1,
        title: input.title ?? manifest.title,
        genre: input.genre ?? manifest.genre,
        status: input.status ?? manifest.status,
        linkedMaterialIdsByKind:
          input.linkedMaterialIdsByKind === undefined
            ? manifest.linkedMaterialIdsByKind
            : {
                character: [...(input.linkedMaterialIdsByKind.character ?? [])],
                gimmick: [...(input.linkedMaterialIdsByKind.gimmick ?? [])],
                plot: [...(input.linkedMaterialIdsByKind.plot ?? [])],
                draft: [...(input.linkedMaterialIdsByKind.draft ?? [])],
                other: [...(input.linkedMaterialIdsByKind.other ?? [])]
              },
        linkedSkillIdsByKind:
          input.linkedSkillIdsByKind === undefined
            ? manifest.linkedSkillIdsByKind
            : {
                general: [...(input.linkedSkillIdsByKind.general ?? [])],
                plot: [...(input.linkedSkillIdsByKind.plot ?? [])],
                style: [...(input.linkedSkillIdsByKind.style ?? [])],
                other: [...(input.linkedSkillIdsByKind.other ?? [])]
              },
        updatedAt: now
      } satisfies FolderBookProjectManifest;
      const validated = FolderBookProjectManifestSchema.parse(next);
      await atomicWriteJson(
        join(opened.projectDirectory, MANIFEST_FILE),
        validated,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return (await this.readProject(opened.projectDirectory, "book")).resource as ShortBook;
    });
  }

  async updateLibraryGroup(
    rawInput: UpdateLibraryGroupInput
  ): Promise<MaterialLibraryGroup | SkillLibraryGroup> {
    const input = UpdateLibraryGroupInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const projectDomain =
        input.domain === "material" ? "material-group" : "skill-group";
      const registration = findRegistration(
        registry,
        input.groupId,
        projectDomain
      );
      const opened = await this.readProject(
        registration.projectDirectory,
        projectDomain,
        input.groupId
      );
      const manifest = await this.readManifest(
        opened.projectDirectory,
        input.domain === "material"
          ? "deepwrite.material-group"
          : "deepwrite.skill-group",
        input.groupId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }

      const snapshot = await this.aggregateSnapshot(registry);
      assertUniqueGroupMembers(Object.values(input.members));
      if (input.domain === "material") {
        const libraries = new Map(
          snapshot.materials.map((library) => [library.id, library])
        );
        for (const [kind, libraryId] of Object.entries(input.members)) {
          if (!libraryId) continue;
          const library = libraries.get(libraryId);
          if (!library) {
            throw new Error(`素材分组引用了不存在的素材库：${libraryId}`);
          }
          if (library.materialKind !== "mixed" && library.materialKind !== kind) {
            throw new Error(`素材库“${library.title}”不能放入${kind}分类。`);
          }
          assertLibraryNotInAnotherGroup(
            snapshot.materialGroups,
            libraryId,
            "素材",
            input.groupId
          );
        }
      } else {
        const libraries = new Map(snapshot.skills.map((library) => [library.id, library]));
        for (const [kind, libraryId] of Object.entries(input.members)) {
          if (!libraryId) continue;
          const library = libraries.get(libraryId);
          if (!library) {
            throw new Error(`技能分组引用了不存在的技能库：${libraryId}`);
          }
          if (library.skillKind !== kind) {
            throw new Error(`技能库“${library.title}”不能放入${kind}分类。`);
          }
          assertLibraryNotInAnotherGroup(
            snapshot.skillGroups,
            libraryId,
            "技能",
            input.groupId
          );
        }
      }

      const now = this.now();
      const next = {
        ...manifest,
        revision: manifest.revision + 1,
        members: { ...input.members },
        updatedAt: now
      };
      const validated =
        input.domain === "material"
          ? FolderMaterialGroupProjectManifestSchema.parse(next)
          : FolderSkillGroupProjectManifestSchema.parse(next);
      await atomicWriteJson(
        join(opened.projectDirectory, MANIFEST_FILE),
        validated,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return (await this.readProject(opened.projectDirectory, projectDomain))
        .resource as MaterialLibraryGroup | SkillLibraryGroup;
    });
  }

  async saveDocument(rawInput: SaveFolderDocumentInput): Promise<CatalogDocument> {
    const input = SaveDocumentInputSchema.parse(rawInput);
    assertTextByteLength(input.content, this.maxMarkdownBytes, "Markdown content");
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(registration.projectDirectory);
      const manifest = await this.readManifest(
        projectDirectory,
        "deepwrite.book",
        input.bookId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      const now = this.now();
      const existingIndex = manifest.documents.findIndex(
        ({ id }) => id === input.documentId
      );
      const documents = [...manifest.documents];
      let documentManifest: BookProjectDocumentManifest;
      let currentContent = "";
      if (existingIndex >= 0) {
        const existing = documents[existingIndex]!;
        currentContent = await readProjectMarkdown(
          projectDirectory,
          existing.path,
          this.maxMarkdownBytes
        );
        documentManifest = {
          ...existing,
          ...(input.title === undefined ? {} : { title: input.title }),
          updatedAt: now
        };
        documents[existingIndex] = documentManifest;
      } else {
        documentManifest = {
          id: input.documentId,
          title: input.title ?? defaultDocumentTitle(input.documentId),
          path: await uniqueRelativeMarkdownPath(
            projectDirectory,
            "stages",
            input.documentId,
            new Set(
              documents.map(({ path }) => portableContentPathKey(path))
            )
          ),
          createdAt: now,
          updatedAt: now
        };
        documents.push(documentManifest);
      }
      if (!input.force && input.baseRevision !== undefined) {
        const actualRevision = createShortWorkspaceContentRevision(currentContent);
        if (input.baseRevision !== actualRevision) {
          throw new FolderCatalogConflictError(input.baseRevision, actualRevision);
        }
      }
      const target = await secureWritableProjectPath(
        projectDirectory,
        documentManifest.path
      );
      const next = FolderBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        documents,
        updatedAt: now
      });
      await commitProjectMarkdownUpdate(
        target,
        input.content,
        existingIndex >= 0 ? currentContent : undefined,
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return {
        id: documentManifest.id,
        title: documentManifest.title,
        content: input.content,
        createdAt: documentManifest.createdAt,
        updatedAt: documentManifest.updatedAt
      };
    });
  }

  async saveLibraryEntry(
    rawInput: SaveLibraryEntryInput
  ): Promise<MaterialEntry | SkillEntry> {
    const input = SaveLibraryEntryInputSchema.parse(rawInput);
    assertTextByteLength(input.content, this.maxMarkdownBytes, "Markdown content");
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const resourceDomain =
        input.domain === "material" ? "material-library" : "skill-library";
      const registration = findRegistration(
        registry,
        input.libraryId,
        resourceDomain
      );
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const expectedKind =
        input.domain === "material"
          ? "deepwrite.material-library"
          : "deepwrite.skill-library";
      const manifest = await this.readManifest(
        projectDirectory,
        expectedKind,
        input.libraryId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      const entryIndex = manifest.entries.findIndex(
        ({ id }) => id === input.entryId
      );
      if (entryIndex < 0) {
        throw new Error("素材或技能条目不存在，无法保存。");
      }
      const existing = manifest.entries[entryIndex]!;
      const currentContent = await readProjectMarkdown(
        projectDirectory,
        existing.path,
        this.maxMarkdownBytes
      );
      if (!input.force && input.baseRevision !== undefined) {
        const actualRevision = createShortWorkspaceContentRevision(currentContent);
        if (input.baseRevision !== actualRevision) {
          throw new FolderCatalogConflictError(
            input.baseRevision,
            actualRevision
          );
        }
      }
      const now = this.now();
      const nextEntry = {
        ...existing,
        ...(input.title === undefined ? {} : { title: input.title }),
        updatedAt: now
      };
      const entries = [...manifest.entries];
      entries[entryIndex] = nextEntry;
      const target = await secureWritableProjectPath(
        projectDirectory,
        existing.path
      );
      if (manifest.kind === "deepwrite.material-library") {
        const next = FolderMaterialProjectManifestSchema.parse({
          ...manifest,
          revision: manifest.revision + 1,
          updatedAt: now,
          entries
        });
        await commitProjectMarkdownUpdate(
          target,
          input.content,
          currentContent,
          join(projectDirectory, MANIFEST_FILE),
          next,
          this.maxMarkdownBytes,
          this.maxManifestBytes
        );
        await this.bumpRegistry(registry, now);
        return {
          id: nextEntry.id,
          stageId: nextEntry.stageId,
          title: nextEntry.title,
          body: input.content,
          createdAt: nextEntry.createdAt,
          updatedAt: nextEntry.updatedAt
        };
      }
      const next = FolderSkillProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: now,
        entries
      });
      await commitProjectMarkdownUpdate(
        target,
        input.content,
        currentContent,
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      const skillEntry =
        nextEntry as SkillLibraryProjectManifest["entries"][number];
      return {
        id: skillEntry.id,
        stageId: skillEntry.stageId,
        title: skillEntry.title,
        body: input.content,
        createdAt: skillEntry.createdAt,
        updatedAt: skillEntry.updatedAt,
        ...(skillEntry.sourceCommonSkillId === undefined
          ? {}
          : { sourceCommonSkillId: skillEntry.sourceCommonSkillId }),
        ...(skillEntry.sourceSkillId === undefined
          ? {}
          : { sourceSkillId: skillEntry.sourceSkillId }),
        ...(skillEntry.sourceSkillEntryId === undefined
          ? {}
          : { sourceSkillEntryId: skillEntry.sourceSkillEntryId })
      };
    });
  }

  async createLibraryEntry(
    rawInput: CreateFolderLibraryEntryInput & { domain: "material" }
  ): Promise<MaterialEntry>;
  async createLibraryEntry(
    rawInput: CreateFolderLibraryEntryInput & { domain: "skill" }
  ): Promise<SkillEntry>;
  async createLibraryEntry(
    rawInput: CreateFolderLibraryEntryInput
  ): Promise<MaterialEntry | SkillEntry>;
  async createLibraryEntry(
    rawInput: CreateFolderLibraryEntryInput
  ): Promise<MaterialEntry | SkillEntry> {
    const domain = parseLibraryDomain(rawInput.domain);
    const libraryId = parseId(rawInput.libraryId);
    const title = parseNonBlankString(rawInput.title, "library entry title");
    if (typeof rawInput.content !== "string") {
      throw new Error("library entry content must be a string.");
    }
    assertTextByteLength(
      rawInput.content,
      this.maxMarkdownBytes,
      "Markdown content"
    );
    if (rawInput.baseProjectRevision !== undefined) {
      assertProjectRevision(rawInput.baseProjectRevision);
    }
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const projectDomain = libraryProjectDomain(domain);
      const registration = findRegistration(registry, libraryId, projectDomain);
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readManifest(
        projectDirectory,
        domain === "material"
          ? "deepwrite.material-library"
          : "deepwrite.skill-library",
        libraryId
      );
      if (!rawInput.force) {
        assertBaseRevision(rawInput.baseProjectRevision, manifest.revision);
      }
      const now = this.now();
      const id = `${domain}-entry-${randomUUID()}`;
      const path = await uniqueRelativeMarkdownPath(
        projectDirectory,
        "entries",
        id,
        new Set(
          manifest.entries.map((entry) => portableContentPathKey(entry.path))
        )
      );
      const target = await secureWritableProjectPath(projectDirectory, path);
      if (manifest.kind === "deepwrite.material-library") {
        const entry = {
          id,
          stageId:
            rawInput.domain === "material"
              ? (rawInput.stageId ?? "other")
              : "other",
          title,
          path,
          createdAt: now,
          updatedAt: now
        };
        const next = FolderMaterialProjectManifestSchema.parse({
          ...manifest,
          revision: manifest.revision + 1,
          updatedAt: now,
          entries: [...manifest.entries, entry]
        });
        await commitProjectMarkdownUpdate(
          target,
          rawInput.content,
          undefined,
          join(projectDirectory, MANIFEST_FILE),
          next,
          this.maxMarkdownBytes,
          this.maxManifestBytes
        );
        await this.bumpRegistry(registry, now);
        return {
          id: entry.id,
          stageId: entry.stageId,
          title: entry.title,
          body: rawInput.content,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt
        };
      }
      const entry = {
        id,
        stageId:
          rawInput.domain === "skill" ? (rawInput.stageId ?? "draft") : "draft",
        title,
        path,
        createdAt: now,
        updatedAt: now
      };
      const next = FolderSkillProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: now,
        entries: [...manifest.entries, entry]
      });
      await commitProjectMarkdownUpdate(
        target,
        rawInput.content,
        undefined,
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return {
        id: entry.id,
        stageId: entry.stageId,
        title: entry.title,
        body: rawInput.content,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      };
    });
  }

  async removeLibraryEntry(
    rawInput: RemoveFolderLibraryEntryInput
  ): Promise<RemoveFolderLibraryEntryResult> {
    const domain = parseLibraryDomain(rawInput.domain);
    const libraryId = parseId(rawInput.libraryId);
    const entryId = parseId(rawInput.entryId);
    if (rawInput.baseProjectRevision !== undefined) {
      assertProjectRevision(rawInput.baseProjectRevision);
    }
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const projectDomain = libraryProjectDomain(domain);
      const registration = findRegistration(registry, libraryId, projectDomain);
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readManifest(
        projectDirectory,
        domain === "material"
          ? "deepwrite.material-library"
          : "deepwrite.skill-library",
        libraryId
      );
      if (!rawInput.force) {
        assertBaseRevision(rawInput.baseProjectRevision, manifest.revision);
      }
      const entryIndex = manifest.entries.findIndex(({ id }) => id === entryId);
      if (entryIndex < 0) {
        return { libraryId, entryId, deleted: false };
      }
      const existing = manifest.entries[entryIndex]!;
      const target = await secureExistingProjectPath(
        projectDirectory,
        existing.path,
        true
      );
      const entries = manifest.entries.filter(({ id }) => id !== entryId);
      const now = this.now();
      const next =
        manifest.kind === "deepwrite.material-library"
          ? FolderMaterialProjectManifestSchema.parse({
              ...manifest,
              revision: manifest.revision + 1,
              updatedAt: now,
              entries
            })
          : FolderSkillProjectManifestSchema.parse({
              ...manifest,
              revision: manifest.revision + 1,
              updatedAt: now,
              entries
            });
      assertJsonByteLength(next, this.maxManifestBytes);
      const stagedDeletion = join(
        dirname(target),
        `.deepwrite-delete-${randomUUID()}.tmp`
      );
      await rename(target, stagedDeletion);
      try {
        if (!rawInput.force && rawInput.baseRevision !== undefined) {
          const stagedContent = await readRequiredUtf8File(
            stagedDeletion,
            this.maxMarkdownBytes,
            "Markdown content"
          );
          const actualRevision = createShortWorkspaceContentRevision(
            stagedContent
          );
          if (rawInput.baseRevision !== actualRevision) {
            throw new FolderCatalogConflictError(
              rawInput.baseRevision,
              actualRevision
            );
          }
        }
        await atomicWriteJson(
          join(projectDirectory, MANIFEST_FILE),
          next,
          this.maxManifestBytes
        );
      } catch (error: unknown) {
        await rename(stagedDeletion, target);
        throw error;
      }
      await this.bumpRegistry(registry, now);
      try {
        await unlinkOptional(stagedDeletion);
      } catch {
        // The manifest no longer references this hidden backup, so deletion is
        // already logically committed. A cleanup failure must not be reported
        // as if the user's entry were still present.
      }
      return { libraryId, entryId, deleted: true };
    });
  }

  async unregisterProject(
    rawInput: UnregisterFolderCatalogProjectInput
  ): Promise<UnregisterFolderCatalogProjectResult> {
    const projectId = parseId(rawInput.projectId);
    const domain = parseUnregisterDomain(rawInput.domain);
    const registryDomain = registryDomainForUnregister(domain);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const projects = registry.projects.filter(
        (project) =>
          !(project.id === projectId && project.domain === registryDomain)
      );
      const unregistered = projects.length !== registry.projects.length;
      if (unregistered) {
        const now = this.now();
        await this.writeRegistry({
          ...registry,
          revision: registry.revision + 1,
          updatedAt: now,
          projects
        });
      }
      return { projectId, domain, unregistered };
    });
  }

  async deleteProject(
    rawInput: DeleteFolderCatalogProjectInput
  ): Promise<DeleteFolderCatalogProjectResult> {
    const projectId = parseId(rawInput.projectId);
    const domain = parseDeletableProjectDomain(rawInput.domain);
    const registryDomain = registryDomainForUnregister(domain);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = registry.projects.find(
        (project) => project.id === projectId && project.domain === registryDomain
      );
      if (!registration) {
        return { projectId, domain, deleted: false };
      }

      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      await this.readProject(projectDirectory, registryDomain, projectId);

      const stagedDeletion = join(
        dirname(projectDirectory),
        `.deepwrite-deleting-${randomUUID()}`
      );
      await rename(projectDirectory, stagedDeletion);
      try {
        const now = this.now();
        await this.writeRegistry({
          ...registry,
          revision: registry.revision + 1,
          updatedAt: now,
          projects: registry.projects.filter(
            (project) =>
              !(project.id === projectId && project.domain === registryDomain)
          )
        });
      } catch (error: unknown) {
        await rename(stagedDeletion, projectDirectory);
        throw error;
      }

      await removeEmptyOrPartialProject(stagedDeletion);
      return { projectId, domain, deleted: true };
    });
  }

  async removeBook(bookId: string): Promise<{ bookId: string; deleted: boolean }> {
    const result = await this.unregisterProject({
      projectId: bookId,
      domain: "book"
    });
    return { bookId: result.projectId, deleted: result.unregistered };
  }

  async getProjectRevision(
    id: string,
    domain: FolderCatalogProjectDomain
  ): Promise<number> {
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      const resourceId = parseId(id);
      const registration = findRegistration(registry, resourceId, domain);
      return (
        await this.readProject(
          registration.projectDirectory,
          domain,
          resourceId
        )
      ).revision;
    });
  }

  private async ensureRegistry(): Promise<FolderCatalogRegistry> {
    const existing = await this.readRegistryOptional();
    if (existing) {
      return existing;
    }
    if (this.initialSnapshot) {
      const snapshot = this.initialSnapshot;
      const base = emptyRegistry(snapshot.updatedAt);
      const { registry: next, createdProjectDirectories } =
        await this.writeMissingSnapshotProjects(base, snapshot);
      next.revision = snapshot.revision;
      next.updatedAt = snapshot.updatedAt;
      setLegacyImport(next, snapshot.legacyImport);
      next.sourceCatalogMigrated = true;
      try {
        await this.writeRegistry(next);
      } catch (error: unknown) {
        await cleanupNewProjectDirectories(createdProjectDirectories);
        throw error;
      }
      return next;
    }
    const registry = emptyRegistry(this.now());
    await this.writeRegistry(registry);
    return registry;
  }

  private async readRegistryOptional(): Promise<FolderCatalogRegistry | undefined> {
    let primaryText: string | undefined;
    try {
      primaryText = await readOptionalUtf8File(
        this.registryPath,
        this.maxManifestBytes,
        "catalog registry"
      );
      if (primaryText !== undefined) {
        return parseRegistry(parseJson(primaryText, this.registryPath));
      }
    } catch {
      // Fall through to the last known-good backup. The registry is only an
      // index; project folders remain the source of truth.
    }
    try {
      const backupText = await readOptionalUtf8File(
        this.registryBackupPath,
        this.maxManifestBytes,
        "catalog registry backup"
      );
      if (backupText !== undefined) {
        const backup = parseRegistry(
          parseJson(backupText, this.registryBackupPath)
        );
        try {
          await atomicWriteJson(
            this.registryPath,
            backup,
            this.maxManifestBytes
          );
        } catch {
          // Reading can continue from the valid backup even when restoring
          // the primary index is temporarily impossible.
        }
        return backup;
      }
    } catch {
      // Preserve the broken primary below and rebuild an empty index so the
      // user can recover projects through “打开已存在…”.
    }
    if (primaryText !== undefined || (await pathExists(this.registryPath))) {
      const corruptPath = `${this.registryPath}.corrupt-${Date.now()}`;
      try {
        await rename(this.registryPath, corruptPath);
      } catch (error: unknown) {
        if (!isNodeError(error, "ENOENT")) {
          throw error;
        }
      }
    }
    return undefined;
  }

  private async writeRegistry(registry: FolderCatalogRegistry): Promise<void> {
    await atomicWriteJson(
      this.registryPath,
      registry,
      this.maxManifestBytes
    );
    try {
      await atomicWriteJson(
        this.registryBackupPath,
        registry,
        this.maxManifestBytes
      );
    } catch {
      // The primary registry is already committed. A stale backup is still
      // preferable to reporting a successful registration as failed.
    }
  }

  private async writeMissingSnapshotProjects(
    registry: FolderCatalogRegistry,
    snapshot: CatalogSnapshot
  ): Promise<WriteMissingSnapshotProjectsResult> {
    const next = structuredClone(registry);
    const createdProjectDirectories: string[] = [];
    const knownProjects = new Set(
      next.projects.map(({ id, domain }) => registryProjectKey(domain, id))
    );
    const collections: ReadonlyArray<
      readonly [FolderCatalogProjectDomain, readonly FolderCatalogResource[]]
    > = [
      ["material-library", snapshot.materials],
      ["material-group", snapshot.materialGroups],
      ["skill-library", snapshot.skills],
      ["skill-group", snapshot.skillGroups],
      ["book", snapshot.books]
    ];
    try {
      for (const [domain, resources] of collections) {
        for (const resource of resources) {
          const key = registryProjectKey(domain, resource.id);
          if (knownProjects.has(key)) {
            continue;
          }
          const projectDirectory = await this.writeNewResourceProject(
            domain,
            this.defaultProjectParents[domain],
            resource
          );
          createdProjectDirectories.push(projectDirectory);
          next.projects.push({
            id: resource.id,
            domain,
            projectDirectory,
            registeredAt: resource.createdAt
          });
          knownProjects.add(key);
        }
      }
      return {
        registry: parseRegistry(next),
        createdProjectDirectories
      };
    } catch (error: unknown) {
      await cleanupNewProjectDirectories(createdProjectDirectories);
      throw error;
    }
  }

  private async writeNewResourceProject(
    domain: FolderCatalogProjectDomain,
    parentDirectory: string,
    resource: FolderCatalogResource
  ): Promise<string> {
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
    const secureParent = await secureDirectory(parentDirectory, "project parent");
    const finalDirectory = await availableProjectDirectory(
      secureParent,
      resource.title
    );
    const stagingDirectory = join(
      secureParent,
      `.deepwrite-project-${process.pid}-${randomUUID()}.tmp`
    );
    await mkdir(stagingDirectory, { mode: 0o700 });
    let promoted = false;
    try {
      const manifest = await writeResourceContents(
        stagingDirectory,
        domain,
        resource,
        this.maxMarkdownBytes
      );
      await atomicWriteJson(
        join(stagingDirectory, MANIFEST_FILE),
        manifest,
        this.maxManifestBytes
      );
      await rename(stagingDirectory, finalDirectory);
      promoted = true;
      return await secureProjectRoot(finalDirectory);
    } catch (error: unknown) {
      await removeEmptyOrPartialProject(
        promoted ? finalDirectory : stagingDirectory
      );
      throw error;
    }
  }

  private async readManifest<Kind extends FolderCatalogProjectManifest["kind"]>(
    projectDirectory: string,
    expectedKind?: Kind,
    expectedResourceId?: string
  ): Promise<Extract<FolderCatalogProjectManifest, { kind: Kind }>> {
    const root = await secureProjectRoot(projectDirectory);
    const manifestPath = await secureExistingProjectPath(root, MANIFEST_FILE, false);
    const text = await readRequiredUtf8File(
      manifestPath,
      this.maxManifestBytes,
      "project manifest"
    );
    const manifest = FolderCatalogProjectManifestSchema.parse(
      parseJson(text, manifestPath)
    );
    assertManifestUniqueness(manifest);
    await assertManifestContentFilesUnique(root, manifest);
    if (expectedKind && manifest.kind !== expectedKind) {
      throw new Error(
        `项目类型不匹配：需要 ${expectedKind}，实际为 ${manifest.kind}。`
      );
    }
    if (expectedResourceId !== undefined && manifest.id !== expectedResourceId) {
      throw new Error("项目标识与注册信息不一致。");
    }
    return manifest as Extract<FolderCatalogProjectManifest, { kind: Kind }>;
  }

  private async readProject(
    rawDirectory: string,
    expectedDomain?: FolderCatalogProjectDomain,
    expectedResourceId?: string
  ): Promise<OpenFolderCatalogProjectResult> {
    const projectDirectory = await secureProjectRoot(rawDirectory);
    const manifest = await this.readManifest(
      projectDirectory,
      undefined,
      expectedResourceId
    );
    const domain = domainForKind(manifest.kind);
    if (expectedDomain && domain !== expectedDomain) {
      throw new Error(`项目类型不匹配：需要 ${expectedDomain}，实际为 ${domain}。`);
    }
    const manifestBytes = Buffer.byteLength(JSON.stringify(manifest), "utf8");
    if (manifestBytes >= this.maxProjectContentBytes) {
      throw new Error(
        `项目 manifest 超过 ${this.maxProjectContentBytes} 字节项目预算。`
      );
    }
    const resource = await hydrateResource(
      projectDirectory,
      manifest,
      this.maxMarkdownBytes,
      this.maxProjectContentBytes - manifestBytes
    );
    return {
      domain,
      projectDirectory,
      revision: manifest.revision,
      resource
    };
  }

  private async registerProject(
    registry: FolderCatalogRegistry,
    project: RegistryProject
  ): Promise<void> {
    const normalizedDirectory = await secureProjectRoot(project.projectDirectory);
    const current = registry.projects.find(
      ({ id, domain }) => id === project.id && domain === project.domain
    );
    const duplicateDirectory = registry.projects.find(
      ({ projectDirectory }) => resolve(projectDirectory) === normalizedDirectory
    );
    if (
      duplicateDirectory &&
      (duplicateDirectory.id !== project.id ||
        duplicateDirectory.domain !== project.domain)
    ) {
      throw new Error("该目录已经注册为另一个项目。");
    }
    if (
      current &&
      current.domain === project.domain &&
      resolve(current.projectDirectory) === normalizedDirectory
    ) {
      return;
    }
    if (
      current &&
      resolve(current.projectDirectory) !== normalizedDirectory &&
      (await pathExists(current.projectDirectory))
    ) {
      throw new Error(
        "相同项目 ID 已在另一个仍然存在的文件夹中注册。请修改副本的 deepwrite.json ID，或先移动原项目后再重新打开。"
      );
    }
    const projects = registry.projects.filter(
      ({ id, domain, projectDirectory }) =>
        !(id === project.id && domain === project.domain) &&
        resolve(projectDirectory) !== normalizedDirectory
    );
    projects.push({ ...project, projectDirectory: normalizedDirectory });
    const now = this.now();
    await this.writeRegistry({
      ...registry,
      revision: registry.revision + 1,
      updatedAt: now,
      projects
    });
  }

  private async bumpRegistry(
    registry: FolderCatalogRegistry,
    updatedAt: string
  ): Promise<void> {
    try {
      await this.writeRegistry({
        ...registry,
        revision: registry.revision + 1,
        updatedAt
      });
    } catch {
      // Project manifests and Markdown are the source of truth. Failing to
      // refresh this aggregate revision hint after they were committed must
      // not turn a successful user save into a reported failure.
    }
  }

  private async aggregateSnapshot(
    registry: FolderCatalogRegistry
  ): Promise<CatalogSnapshot> {
    const books: ShortBook[] = [];
    const materials: MaterialLibrary[] = [];
    const materialGroups: MaterialLibraryGroup[] = [];
    const skills: SkillLibrary[] = [];
    const skillGroups: SkillLibraryGroup[] = [];
    const projectDiagnostics: CatalogProjectDiagnostic[] = [];
    let snapshotContentBytes = 0;
    for (const project of registry.projects) {
      let opened: OpenFolderCatalogProjectResult;
      try {
        opened = await this.readProject(
          project.projectDirectory,
          project.domain,
          project.id
        );
      } catch (error: unknown) {
        projectDiagnostics.push({
          projectId: project.id,
          kind: kindForDomain(project.domain),
          code:
            isNodeError(error, "ENOENT") || isNodeError(error, "ENOTDIR")
              ? "unavailable"
              : "invalid",
          message:
            error instanceof Error
              ? error.message
              : "本地项目无法读取。"
        });
        continue;
      }
      const projectContentBytes = resourceContentByteLength(opened.resource);
      if (
        snapshotContentBytes + projectContentBytes >
        this.maxSnapshotContentBytes
      ) {
        projectDiagnostics.push({
          projectId: project.id,
          kind: kindForDomain(project.domain),
          code: "invalid",
          message: `聚合内容超过 ${this.maxSnapshotContentBytes} 字节安全上限。`
        });
        continue;
      }
      snapshotContentBytes += projectContentBytes;
      switch (opened.domain) {
        case "book":
          books.push(opened.resource as ShortBook);
          break;
        case "material-library":
          materials.push(opened.resource as MaterialLibrary);
          break;
        case "material-group":
          materialGroups.push(opened.resource as MaterialLibraryGroup);
          break;
        case "skill-library":
          skills.push(opened.resource as SkillLibrary);
          break;
        case "skill-group":
          skillGroups.push(opened.resource as SkillLibraryGroup);
          break;
      }
    }
    return CatalogSnapshotSchema.parse({
      schemaVersion: 1,
      revision: registry.revision,
      books,
      materials,
      materialGroups,
      skills,
      skillGroups,
      updatedAt: registry.updatedAt,
      ...(registry.legacyImport === undefined
        ? {}
        : { legacyImport: registry.legacyImport }),
      ...(projectDiagnostics.length ? { projectDiagnostics } : {})
    });
  }

  private async mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
    let result: Result | undefined;
    let failure: unknown;
    const pending = this.writeChain.then(async () => {
      try {
        result = await operation();
      } catch (error: unknown) {
        failure = error;
      }
    });
    this.writeChain = pending.then(
      () => undefined,
      () => undefined
    );
    await pending;
    if (failure !== undefined) {
      throw failure;
    }
    return result!;
  }

  private async readAfterWrites<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
    // Queue reads behind writes as well. Merely awaiting the current promise
    // leaves a gap in which another caller can start a multi-file commit and a
    // snapshot can observe Markdown and its manifest at different revisions.
    return await this.mutate(operation);
  }
}

const DEFAULT_SHORT_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["outline", "大纲"],
  ["draft", "正文编写"]
] as const;

function positiveByteLimit(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`${label} byte limit must be a positive safe integer.`);
  }
  return limit;
}

function emptyRegistry(updatedAt: string): FolderCatalogRegistry {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt,
    sourceCatalogMigrated: false,
    projects: []
  };
}

function setLegacyImport(
  registry: FolderCatalogRegistry,
  legacyImport: CatalogLegacyImport | undefined
): void {
  if (legacyImport === undefined) {
    delete registry.legacyImport;
  } else {
    registry.legacyImport = legacyImport;
  }
}

function parseRegistry(value: unknown): FolderCatalogRegistry {
  if (!isRecord(value)) {
    throw new Error("Catalog registry must be a JSON object.");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported catalog registry schema version.");
  }
  const revision = value.revision;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    throw new Error("Catalog registry revision must be a non-negative integer.");
  }
  const updatedAt = parseTimestamp(value.updatedAt, "registry updatedAt");
  if (typeof value.sourceCatalogMigrated !== "boolean") {
    throw new Error("Catalog registry migration flag must be a boolean.");
  }
  if (!Array.isArray(value.projects)) {
    throw new Error("Catalog registry projects must be an array.");
  }
  const projects = value.projects.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`Catalog registry project ${index} must be an object.`);
    }
    const domain = candidate.domain;
    if (!isFolderDomain(domain)) {
      throw new Error(`Catalog registry project ${index} has an invalid domain.`);
    }
    const projectDirectory = parseNonBlankString(
      candidate.projectDirectory,
      `registry project ${index} directory`
    );
    if (!isAbsolute(projectDirectory)) {
      throw new Error("Registered project directories must be absolute paths.");
    }
    return {
      id: parseId(candidate.id),
      domain,
      projectDirectory: resolve(projectDirectory),
      registeredAt: parseTimestamp(
        candidate.registeredAt,
        `registry project ${index} registeredAt`
      )
    } satisfies RegistryProject;
  });
  if (
    new Set(projects.map(({ id, domain }) => registryProjectKey(domain, id))).size !==
    projects.length
  ) {
    throw new Error("Registered projects must have unique domain/id pairs.");
  }
  const directories = projects.map(({ projectDirectory }) => projectDirectory);
  if (new Set(directories).size !== directories.length) {
    throw new Error("Registered project directories must be unique.");
  }
  const legacyImport =
    value.legacyImport === undefined
      ? undefined
      : CatalogLegacyImportSchema.parse(value.legacyImport);
  return {
    schemaVersion: 1,
    revision,
    updatedAt,
    sourceCatalogMigrated: value.sourceCatalogMigrated,
    projects,
    ...(legacyImport === undefined ? {} : { legacyImport })
  };
}

function parseId(value: unknown): string {
  return parseNonBlankString(value, "project id");
}

function parseLibraryDomain(value: unknown): FolderCatalogLibraryDomain {
  if (value !== "material" && value !== "skill") {
    throw new Error("library domain must be material or skill.");
  }
  return value;
}

function libraryProjectDomain(
  domain: FolderCatalogLibraryDomain
): "material-library" | "skill-library" {
  return domain === "material" ? "material-library" : "skill-library";
}

function parseUnregisterDomain(value: unknown): FolderCatalogUnregisterDomain {
  if (
    value !== "book" &&
    value !== "material" &&
    value !== "skill" &&
    value !== "material-library" &&
    value !== "material-group" &&
    value !== "skill-library" &&
    value !== "skill-group"
  ) {
    throw new Error("project domain is invalid.");
  }
  return value;
}

function parseDeletableProjectDomain(
  value: unknown
): "book" | FolderCatalogLibraryDomain {
  if (value !== "book" && value !== "material" && value !== "skill") {
    throw new Error("deletable project domain must be book, material, or skill.");
  }
  return value;
}

function registryDomainForUnregister(
  domain: FolderCatalogUnregisterDomain
): FolderCatalogProjectDomain {
  if (domain === "material") {
    return "material-library";
  }
  if (domain === "skill") {
    return "skill-library";
  }
  return domain;
}

function parseNonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function parseTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    !Number.isFinite(new Date(value).getTime())
  ) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFolderDomain(value: unknown): value is FolderCatalogProjectDomain {
  return (
    typeof value === "string" &&
    (CATALOG_PROJECT_DOMAINS as readonly string[]).includes(value)
  );
}

function registryProjectKey(
  domain: FolderCatalogProjectDomain,
  id: string
): string {
  return `${domain}\u0000${id}`;
}

function assertManifestUniqueness(manifest: FolderCatalogProjectManifest): void {
  const items =
    manifest.kind === "deepwrite.book"
      ? manifest.documents
      : manifest.kind === "deepwrite.material-library" ||
          manifest.kind === "deepwrite.skill-library"
        ? manifest.entries
        : [];
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    throw new Error("Project manifest content ids must be unique.");
  }
  if (new Set(items.map(({ path }) => path)).size !== items.length) {
    throw new Error("Project manifest content paths must be unique.");
  }
}

async function assertManifestContentFilesUnique(
  projectDirectory: string,
  manifest: FolderCatalogProjectManifest
): Promise<void> {
  const items =
    manifest.kind === "deepwrite.book"
      ? manifest.documents
      : manifest.kind === "deepwrite.material-library" ||
          manifest.kind === "deepwrite.skill-library"
        ? manifest.entries
        : [];
  const identities = new Set<string>();
  for (const item of items) {
    const actualPath = await secureExistingProjectPath(
      projectDirectory,
      item.path,
      true
    );
    const info = await stat(actualPath);
    const identity = `${info.dev}:${info.ino}`;
    if (identities.has(identity)) {
      throw new Error(
        "Project manifest content paths must resolve to distinct files."
      );
    }
    identities.add(identity);
  }
}

function isCreateAtDirectoryInput(
  value: CreateShortBookInput | CreateShortBookAtDirectoryInput
): value is CreateShortBookAtDirectoryInput {
  return "input" in value;
}

function assertBaseRevision(
  expected: number | undefined,
  actual: number
): void {
  if (expected !== undefined && expected !== actual) {
    throw new FolderCatalogConflictError(expected, actual);
  }
}

function assertUniqueGroupMembers(libraryIds: Array<string | undefined>): void {
  const selected = libraryIds.filter((libraryId): libraryId is string => Boolean(libraryId));
  if (new Set(selected).size !== selected.length) {
    throw new Error("同一个资料库不能在一个分组中绑定到多个分类。");
  }
}

function assertLibraryNotInAnotherGroup(
  groups: ReadonlyArray<{
    id: string;
    title: string;
    members: Record<string, string | undefined>;
  }>,
  libraryId: string,
  domainLabel: "素材" | "技能",
  currentGroupId?: string
): void {
  const existing = groups.find(
    (group) =>
      group.id !== currentGroupId && Object.values(group.members).includes(libraryId)
  );
  if (existing) {
    throw new Error(
      `${domainLabel}库已经属于分组“${existing.title}”，请先在原分组中切换绑定。`
    );
  }
}

function assertProjectRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Project revision must be a non-negative safe integer.");
  }
}

function domainForKind(
  kind: FolderCatalogProjectManifest["kind"]
): FolderCatalogProjectDomain {
  switch (kind) {
    case "deepwrite.book":
      return "book";
    case "deepwrite.material-library":
      return "material-library";
    case "deepwrite.material-group":
      return "material-group";
    case "deepwrite.skill-library":
      return "skill-library";
    case "deepwrite.skill-group":
      return "skill-group";
  }
}

function kindForDomain(
  domain: FolderCatalogProjectDomain
): FolderCatalogProjectManifest["kind"] {
  switch (domain) {
    case "book":
      return "deepwrite.book";
    case "material-library":
      return "deepwrite.material-library";
    case "material-group":
      return "deepwrite.material-group";
    case "skill-library":
      return "deepwrite.skill-library";
    case "skill-group":
      return "deepwrite.skill-group";
  }
}

async function writeResourceContents(
  projectDirectory: string,
  domain: FolderCatalogProjectDomain,
  resource: FolderCatalogResource,
  maxMarkdownBytes: number
): Promise<FolderCatalogProjectManifest> {
  const common = {
    schemaVersion: 1 as const,
    revision: 0,
    id: resource.id,
    title: resource.title,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt
  };
  switch (domain) {
    case "book": {
      const book = resource as ShortBook;
      const used = new Set<string>();
      const documents = [];
      for (const document of book.documents) {
        assertTextByteLength(document.content, maxMarkdownBytes, "Markdown content");
        const path = await uniqueRelativeMarkdownPath(
          projectDirectory,
          "stages",
          document.id,
          used
        );
        used.add(portableContentPathKey(path));
        await atomicWriteText(join(projectDirectory, path), document.content);
        documents.push({
          id: document.id,
          title: document.title,
          path,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt
        });
      }
      return FolderBookProjectManifestSchema.parse({
        ...common,
        kind: kindForDomain(domain),
        bookType: book.bookType,
        genre: book.genre,
        status: book.status,
        linkedMaterialIdsByKind: book.linkedMaterialIdsByKind,
        linkedSkillIdsByKind: book.linkedSkillIdsByKind,
        documents
      });
    }
    case "material-library": {
      const material = resource as MaterialLibrary;
      const used = new Set<string>();
      const entries = [];
      await mkdir(join(projectDirectory, "entries"), {
        recursive: true,
        mode: 0o700
      });
      for (const entry of material.entries) {
        assertTextByteLength(entry.body, maxMarkdownBytes, "Markdown content");
        const path = await uniqueRelativeMarkdownPath(
          projectDirectory,
          "entries",
          entry.id,
          used
        );
        used.add(portableContentPathKey(path));
        await atomicWriteText(join(projectDirectory, path), entry.body);
        entries.push({
          id: entry.id,
          stageId: entry.stageId,
          title: entry.title,
          path,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt
        });
      }
      return FolderMaterialProjectManifestSchema.parse({
        ...common,
        kind: kindForDomain(domain),
        materialType: material.materialType,
        materialKind: material.materialKind,
        parentGenre: material.parentGenre,
        subGenre: material.subGenre,
        overview: material.overview,
        entries
      });
    }
    case "skill-library": {
      const skill = resource as SkillLibrary;
      const used = new Set<string>();
      const entries = [];
      await mkdir(join(projectDirectory, "entries"), {
        recursive: true,
        mode: 0o700
      });
      for (const entry of skill.entries) {
        assertTextByteLength(entry.body, maxMarkdownBytes, "Markdown content");
        const path = await uniqueRelativeMarkdownPath(
          projectDirectory,
          "entries",
          entry.id,
          used
        );
        used.add(portableContentPathKey(path));
        await atomicWriteText(join(projectDirectory, path), entry.body);
        entries.push({
          id: entry.id,
          stageId: entry.stageId,
          title: entry.title,
          path,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          ...(entry.sourceCommonSkillId === undefined
            ? {}
            : { sourceCommonSkillId: entry.sourceCommonSkillId }),
          ...(entry.sourceSkillId === undefined
            ? {}
            : { sourceSkillId: entry.sourceSkillId }),
          ...(entry.sourceSkillEntryId === undefined
            ? {}
            : { sourceSkillEntryId: entry.sourceSkillEntryId })
        });
      }
      return FolderSkillProjectManifestSchema.parse({
        ...common,
        kind: kindForDomain(domain),
        skillType: skill.skillType,
        skillKind: skill.skillKind,
        overview: skill.overview,
        isBuiltin: skill.isBuiltin,
        entries
      });
    }
    case "material-group": {
      const group = resource as MaterialLibraryGroup;
      return FolderMaterialGroupProjectManifestSchema.parse({
        ...common,
        kind: kindForDomain(domain),
        members: group.members
      });
    }
    case "skill-group": {
      const group = resource as SkillLibraryGroup;
      return FolderSkillGroupProjectManifestSchema.parse({
        ...common,
        kind: kindForDomain(domain),
        members: group.members
      });
    }
  }
}

async function hydrateResource(
  projectDirectory: string,
  manifest: FolderCatalogProjectManifest,
  maxMarkdownBytes: number,
  maxProjectContentBytes: number
): Promise<FolderCatalogResource> {
  switch (manifest.kind) {
    case "deepwrite.book": {
      const contents = await readProjectMarkdownContents(
        projectDirectory,
        manifest.documents,
        maxMarkdownBytes,
        maxProjectContentBytes
      );
      return {
        id: manifest.id,
        title: manifest.title,
        bookType: manifest.bookType,
        genre: manifest.genre,
        status: manifest.status,
        linkedMaterialIdsByKind: manifest.linkedMaterialIdsByKind,
        linkedSkillIdsByKind: manifest.linkedSkillIdsByKind,
        projectRevision: manifest.revision,
        documents: manifest.documents.map((document, index) => ({
            id: document.id,
            title: document.title,
            content: contents[index]!,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt
          })),
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
    }
    case "deepwrite.material-library": {
      const contents = await readProjectMarkdownContents(
        projectDirectory,
        manifest.entries,
        maxMarkdownBytes,
        maxProjectContentBytes
      );
      return {
        id: manifest.id,
        title: manifest.title,
        materialType: manifest.materialType,
        materialKind: manifest.materialKind,
        parentGenre: manifest.parentGenre,
        subGenre: manifest.subGenre,
        overview: manifest.overview,
        projectRevision: manifest.revision,
        entries: manifest.entries.map((entry, index) => ({
            id: entry.id,
            stageId: entry.stageId,
            title: entry.title,
            body: contents[index]!,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt
          })),
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
    }
    case "deepwrite.skill-library": {
      const contents = await readProjectMarkdownContents(
        projectDirectory,
        manifest.entries,
        maxMarkdownBytes,
        maxProjectContentBytes
      );
      return {
        id: manifest.id,
        title: manifest.title,
        skillType: manifest.skillType,
        skillKind: manifest.skillKind,
        overview: manifest.overview,
        isBuiltin: manifest.isBuiltin,
        projectRevision: manifest.revision,
        entries: manifest.entries.map((entry, index) => ({
            id: entry.id,
            stageId: entry.stageId,
            title: entry.title,
            body: contents[index]!,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            ...(entry.sourceCommonSkillId === undefined
              ? {}
              : { sourceCommonSkillId: entry.sourceCommonSkillId }),
            ...(entry.sourceSkillId === undefined
              ? {}
              : { sourceSkillId: entry.sourceSkillId }),
            ...(entry.sourceSkillEntryId === undefined
              ? {}
              : { sourceSkillEntryId: entry.sourceSkillEntryId })
          })),
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
    }
    case "deepwrite.material-group":
      return {
        id: manifest.id,
        title: manifest.title,
        members: manifest.members,
        projectRevision: manifest.revision,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
    case "deepwrite.skill-group":
      return {
        id: manifest.id,
        title: manifest.title,
        members: manifest.members,
        projectRevision: manifest.revision,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
  }
}

async function readProjectMarkdownContents(
  projectDirectory: string,
  items: ReadonlyArray<{ path: string }>,
  maxMarkdownBytes: number,
  maxProjectContentBytes: number
): Promise<string[]> {
  const contents: string[] = [];
  let totalBytes = 0;
  for (const item of items) {
    const content = await readProjectMarkdown(
      projectDirectory,
      item.path,
      maxMarkdownBytes
    );
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > maxProjectContentBytes) {
      throw new Error(
        `项目 Markdown 总量超过 ${maxProjectContentBytes} 字节安全上限。`
      );
    }
    contents.push(content);
  }
  return contents;
}

function resourceContentByteLength(resource: FolderCatalogResource): number {
  const metadataBytes = Buffer.byteLength(
    JSON.stringify(resource, (key, value) =>
      key === "content" || key === "body" ? undefined : value
    ),
    "utf8"
  );
  if ("documents" in resource) {
    return metadataBytes + resource.documents.reduce(
      (total, document) => total + Buffer.byteLength(document.content, "utf8"),
      0
    );
  }
  if ("entries" in resource) {
    return metadataBytes + resource.entries.reduce(
      (total, entry) => total + Buffer.byteLength(entry.body, "utf8"),
      0
    );
  }
  return metadataBytes;
}

function sanitizeFileName(value: string, fallback = "未命名项目"): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .trim();
  const shortened = [...normalized].slice(0, 80).join("");
  return shortened || fallback;
}

function sanitizePathSegment(value: string): string {
  return sanitizeFileName(value, "content")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

function portableContentPathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

async function uniqueRelativeMarkdownPath(
  projectDirectory: string,
  directory: string,
  id: string,
  usedPortableKeys: ReadonlySet<string>
): Promise<string> {
  const occupied = new Set(usedPortableKeys);
  const contentDirectory = resolve(projectDirectory, directory);
  assertContained(projectDirectory, contentDirectory);
  if (await pathExists(contentDirectory)) {
    const actualDirectory = await secureDirectory(
      contentDirectory,
      "content directory"
    );
    assertContained(projectDirectory, actualDirectory);
    for (const name of await readdir(actualDirectory)) {
      occupied.add(portableContentPathKey(`${directory}/${name}`));
    }
  }
  const stem = sanitizePathSegment(id);
  let index = 1;
  let candidate = `${directory}/${stem}.md`;
  while (
    occupied.has(portableContentPathKey(candidate)) ||
    (await pathExists(resolve(projectDirectory, candidate)))
  ) {
    index += 1;
    candidate = `${directory}/${stem}-${index}.md`;
  }
  return CatalogProjectContentPathSchema.parse(candidate);
}

async function availableProjectDirectory(
  parentDirectory: string,
  title: string
): Promise<string> {
  const name = sanitizeFileName(title);
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = join(parentDirectory, `${name}${suffix}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  throw new Error("无法为项目分配不重复的文件夹名称。");
}

async function secureDirectory(path: string, label: string): Promise<string> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symbolic link.`);
  }
  return await realpath(path);
}

async function secureProjectRoot(path: string): Promise<string> {
  return await secureDirectory(resolve(path), "project root");
}

function assertContained(root: string, candidate: string): void {
  const offset = relative(root, candidate);
  if (offset === "" || (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))) {
    return;
  }
  throw new Error("Project path escapes its project directory.");
}

async function secureExistingProjectPath(
  projectRoot: string,
  relativePath: string,
  markdown: boolean
): Promise<string> {
  if (markdown) {
    CatalogProjectContentPathSchema.parse(relativePath);
  } else if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Project path must be a normalized relative path.");
  }
  const candidate = resolve(projectRoot, relativePath);
  assertContained(projectRoot, candidate);
  const info = await lstat(candidate);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("Project files must be regular files, not symbolic links.");
  }
  const actual = await realpath(candidate);
  assertContained(projectRoot, actual);
  return actual;
}

async function secureWritableProjectPath(
  projectRoot: string,
  relativePath: string
): Promise<string> {
  CatalogProjectContentPathSchema.parse(relativePath);
  const target = resolve(projectRoot, relativePath);
  assertContained(projectRoot, target);
  let currentDirectory = projectRoot;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    const nextDirectory = join(currentDirectory, segment);
    if (!(await pathExists(nextDirectory))) {
      try {
        await mkdir(nextDirectory, { mode: 0o700 });
      } catch (error: unknown) {
        if (!isNodeError(error, "EEXIST")) {
          throw error;
        }
      }
    }
    currentDirectory = await secureDirectory(nextDirectory, "content parent");
    assertContained(projectRoot, currentDirectory);
  }
  if (await pathExists(target)) {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error("Project files must be regular files, not symbolic links.");
    }
    assertContained(projectRoot, await realpath(target));
  }
  return target;
}

async function readProjectMarkdown(
  projectDirectory: string,
  path: string,
  maxBytes: number
): Promise<string> {
  const actual = await secureExistingProjectPath(projectDirectory, path, true);
  return await readRequiredUtf8File(actual, maxBytes, "Markdown file");
}

async function readOptionalUtf8File(
  path: string,
  maxBytes: number,
  label: string
): Promise<string | undefined> {
  try {
    return await readRequiredUtf8File(path, maxBytes, label);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function readRequiredUtf8File(
  path: string,
  maxBytes: number,
  label: string
): Promise<string> {
  const directInfo = await lstat(path);
  if (directInfo.isSymbolicLink() || !directInfo.isFile()) {
    throw new Error(`${label} is not a regular file.`);
  }
  const info = await stat(path);
  if (info.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `JSON 无法解析：${path}（${error instanceof Error ? error.message : "格式错误"}）`
    );
  }
}

function assertTextByteLength(text: string, maxBytes: number, label: string): void {
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
  }
}

function assertJsonByteLength(value: unknown, maxBytes: number): void {
  assertTextByteLength(
    `${JSON.stringify(value, null, 2)}\n`,
    maxBytes,
    "JSON content"
  );
}

async function commitProjectMarkdownUpdate(
  target: string,
  nextContent: string,
  previousContent: string | undefined,
  manifestPath: string,
  manifest: unknown,
  maxMarkdownBytes: number,
  maxManifestBytes: number
): Promise<void> {
  // Preflight deterministic schema-size failures before touching the user's
  // Markdown, then restore the previous file if the manifest commit itself
  // fails. A different on-disk value means an external editor won the race;
  // leave that value intact and surface a conflict instead of overwriting it.
  assertJsonByteLength(manifest, maxManifestBytes);
  await atomicWriteText(target, nextContent);
  try {
    const observed = await readRequiredUtf8File(
      target,
      maxMarkdownBytes,
      "Markdown content"
    );
    if (observed !== nextContent) {
      throw new FolderCatalogConflictError(
        createShortWorkspaceContentRevision(nextContent),
        createShortWorkspaceContentRevision(observed)
      );
    }
    await atomicWriteJson(manifestPath, manifest, maxManifestBytes);
  } catch (error: unknown) {
    try {
      const observed = await readOptionalUtf8File(
        target,
        maxMarkdownBytes,
        "Markdown content"
      );
      if (observed === nextContent) {
        if (previousContent === undefined) {
          await unlinkOptional(target);
        } else {
          await atomicWriteText(target, previousContent);
        }
      }
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [error, rollbackError],
        "项目保存失败，且无法自动恢复原 Markdown。"
      );
    }
    throw error;
  }
}

async function atomicWriteText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.deepwrite-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } catch (error: unknown) {
    await unlinkOptional(temporary);
    throw error;
  }
}

async function atomicWriteJson(
  path: string,
  value: unknown,
  maxBytes: number
): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertTextByteLength(serialized, maxBytes, "JSON content");
  await atomicWriteText(path, serialized);
}

async function unlinkOptional(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  }
}

async function removeEmptyOrPartialProject(path: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(path, { recursive: true, force: true });
}

async function cleanupNewProjectDirectories(paths: readonly string[]): Promise<void> {
  const failures: unknown[] = [];
  for (const path of [...paths].reverse()) {
    try {
      await removeEmptyOrPartialProject(path);
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      "新建项目注册失败，且无法完整清理未注册文件夹。"
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function findRegistration(
  registry: FolderCatalogRegistry,
  id: string,
  domain: FolderCatalogProjectDomain
): RegistryProject {
  const project = registry.projects.find(
    (candidate) => candidate.id === id && candidate.domain === domain
  );
  if (!project) {
    throw new Error("项目不存在、未注册或已从创作空间移除。");
  }
  return project;
}

function defaultDocumentTitle(documentId: string): string {
  return DEFAULT_SHORT_DOCUMENTS.find(([id]) => id === documentId)?.[1] ?? documentId;
}
