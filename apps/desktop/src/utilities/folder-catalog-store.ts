import { createCatalogId, randomHex8 } from "@deepwrite/shared";
import { createHash } from "node:crypto";
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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  BookProjectManifestSchema,
  BookSchema,
  BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID,
  CATALOG_DRAFT_DIRECTORY_ID,
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  CatalogDraftSectionSchema,
  CreateDraftSectionsInputSchema,
  CreateDraftSectionsResultSchema,
  CatalogDraftRecoverySchema,
  CatalogProjectContentPathSchema,
  CatalogProjectManifestSchema,
  CatalogLegacyImportSchema,
  CatalogIndexBookSchema,
  CatalogIndexSnapshotSchema,
  CatalogReadDocumentInputSchema,
  CatalogReadDocumentResultSchema,
  CatalogSnapshotSchema,
  CreateDraftSectionInputSchema,
  CreateLibraryInputSchema,
  UpdateLibraryInputSchema,
  CreateLibraryGroupInputSchema,
  CreateScriptBookInputSchema,
  CreateShortBookInputSchema,
  CurrentBookProjectManifestSchema,
  DeleteDraftSectionInputSchema,
  MoveDraftSectionInputSchema,
  DuplicateCatalogProjectInputSchema,
  LegacyBookProjectManifestSchema,
  MutateCharacterStructureInputSchema,
  MutatePlotStructureInputSchema,
  ReadWritingContextInputSchema,
  ReadWritingContextResultSchema,
  SaveDocumentInputSchema,
  SaveDocumentResultSchema,
  MaterialGroupProjectManifestSchema,
  MaterialLibraryGroupSchema,
  MaterialLibrarySchema,
  MaterialLibraryProjectManifestSchema,
  MarketplaceInstallPackageSchema,
  CatalogInstallMarketplaceSkillContentResultSchema,
  SaveLibraryEntryInputSchema,
  MoveLibraryEntryInputSchema,
  SkillGroupProjectManifestSchema,
  SkillLibraryGroupSchema,
  SkillLibrarySchema,
  SkillLibraryProjectManifestSchema,
  ShortBookSchema,
  ScriptBookSchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  WriteWritingContextInputSchema,
  WriteWritingContextResultSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createCatalogDraftDirectory,
  createDefaultBookCharacterStructure,
  BookPlotStagesSchema,
  CreativePlotStagesSchema,
  DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS,
  createDefaultBookPlotStages,
  createDefaultCreativePlotStages,
  createScriptCatalogDraftDirectory,
  createShortWorkspaceContentRevision,
  isBuiltinCreativePlotStageId,
  migrateCatalogDraftDocument,
  type BookPlotStage,
  type BookProjectDraftSectionManifest,
  type BookProjectDocumentManifest,
  type BookProjectManifest,
  type Book,
  type CatalogDraftSection,
  type CatalogLegacyImport,
  type CatalogIndexSnapshot,
  type CatalogReadDocumentInput,
  type CatalogReadDocumentResult,
  type CatalogProjectManifest,
  type CatalogProjectDiagnostic,
  type CatalogDraftRecovery,
  type CatalogSnapshot,
  type CreateLibraryInput,
  type UpdateLibraryInput,
  type CreateLibraryGroupInput,
  type CreateScriptBookInput,
  type CreateShortBookInput,
  type CreateDraftSectionInput,
  type CreateDraftSectionsInput,
  type CreateDraftSectionsResult,
  type CreativePlotStage,
  type CurrentBookProjectManifest,
  type DeleteDraftSectionInput,
  type DeleteDraftSectionResult,
  type MoveDraftSectionInput,
  type MoveDraftSectionResult,
  type DuplicateCatalogProjectInput,
  type DuplicateCatalogProjectResult,
  type LegacyBookProjectManifest,
  type MaterialLibraryProjectManifest,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type MaterialEntry,
  type MaterialStageId,
  type MarketplaceInstallPackage,
  type CatalogInstallMarketplaceSkillContentResult,
  type MutateCharacterStructureInput,
  type MutatePlotStructureInput,
  type ReadWritingContextInput,
  type ReadWritingContextResult,
  type SaveLibraryEntryInput,
  type MoveLibraryEntryInput,
  type MoveLibraryEntryResult,
  type SaveDocumentInput,
  type SaveDocumentResult,
  type ScriptBook,
  type ShortBook,
  type SkillLibraryProjectManifest,
  type SkillLibrary,
  type SkillLibraryGroup,
  type SkillEntry,
  type SkillStageId,
  type UpdateBookInput,
  type UpdateLibraryGroupInput,
  type WriteWritingContextInput,
  type WriteWritingContextResult,
  type V2BookProjectManifest,
  type V3BookProjectManifest
} from "@deepwrite/contracts";
import {
  initializeWritingContextFile,
  readOrCreateWritingContext,
  writeWritingContextFile
} from "./folder-catalog-store/writing-context";
import type { ImportedLegacyBook } from "./legacy-book-import";
import type { ImportedLegacyLibrary } from "./legacy-library-import";
import { nextCopyTitle } from "./copy-title";
import { projectTransactionFileIdentity } from "./project-transaction";

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
  /** Global short/script plot stage definitions (title/description). */
  creativePlotStages: CreativePlotStage[];
  projects: RegistryProject[];
}

interface WriteMissingSnapshotProjectsResult {
  registry: FolderCatalogRegistry;
  createdProjectDirectories: string[];
}

export type FolderCatalogResource =
  | Book
  | MaterialLibrary
  | MaterialLibraryGroup
  | SkillLibrary
  | SkillLibraryGroup;

interface CatalogContentMetadata {
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

interface DuplicateProjectWritePlan {
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

  async indexSnapshot(): Promise<CatalogIndexSnapshot> {
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      return await this.aggregateIndexSnapshot(registry);
    });
  }

  async readDocument(
    rawInput: CatalogReadDocumentInput
  ): Promise<CatalogReadDocumentResult> {
    const input = CatalogReadDocumentInputSchema.parse(rawInput);
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistrationByProjectId(
        registry,
        input.projectId
      );
      const { projectDirectory, manifest } =
        await this.readManifestWithoutContent(
          registration.projectDirectory,
          kindForDomain(registration.domain),
          input.projectId
        );

      if (input.target === "overview") {
        if (
          manifest.kind !== "deepwrite.material-library" &&
          manifest.kind !== "deepwrite.skill-library"
        ) {
          throw new Error("只有素材库或技能库提供库介绍。");
        }
        assertTextByteLength(
          manifest.overview,
          this.maxMarkdownBytes,
          "library overview"
        );
        return CatalogReadDocumentResultSchema.parse({
          projectId: input.projectId,
          target: "overview",
          title: manifest.title,
          content: manifest.overview,
          contentBytes: Buffer.byteLength(manifest.overview, "utf8"),
          revision: createShortWorkspaceContentRevision(manifest.overview),
          projectRevision: manifest.revision,
          updatedAt: manifest.updatedAt
        });
      }

      const document = findManifestDocument(manifest, input.documentId);
      if (!document) {
        throw new Error("文档不存在或不属于指定项目。");
      }
      const content = await readProjectMarkdown(
        projectDirectory,
        document.path,
        this.maxMarkdownBytes
      );
      return CatalogReadDocumentResultSchema.parse({
        projectId: input.projectId,
        target: "document",
        documentId: input.documentId,
        title: document.title,
        content,
        contentBytes: Buffer.byteLength(content, "utf8"),
        revision: createShortWorkspaceContentRevision(content),
        projectRevision: manifest.revision,
        updatedAt: document.updatedAt
      });
    });
  }

  async readWritingContext(
    rawInput: ReadWritingContextInput
  ): Promise<ReadWritingContextResult> {
    const input = ReadWritingContextInputSchema.parse(rawInput);
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      const result = await readOrCreateWritingContext(
        projectDirectory,
        manifest.bookType
      );
      return ReadWritingContextResultSchema.parse({
        bookId: input.bookId,
        workspaceType: manifest.bookType,
        ...result
      });
    });
  }

  async writeWritingContext(
    rawInput: WriteWritingContextInput
  ): Promise<WriteWritingContextResult> {
    const input = WriteWritingContextInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      await writeWritingContextFile(projectDirectory, input.content);
      return WriteWritingContextResultSchema.parse({
        bookId: input.bookId,
        workspaceType: manifest.bookType
      });
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

  async saveDraftRecovery(rawDrafts: CatalogDraftRecovery): Promise<void> {
    const drafts = CatalogDraftRecoverySchema.parse(rawDrafts);
    await this.mutate(async () => {
      await atomicWriteJson(
        this.draftRecoveryPath,
        drafts,
        this.maxDraftRecoveryBytes
      );
    });
  }

  async migrateSnapshot(
    rawSnapshot: CatalogSnapshot
  ): Promise<CatalogSnapshot> {
    const snapshot = CatalogSnapshotSchema.parse(structuredClone(rawSnapshot));
    return await this.mutate(async () => {
      const existing = await this.readRegistryOptional();
      if (existing?.sourceCatalogMigrated) {
        return await this.aggregateSnapshot(existing);
      }
      const base = existing ?? emptyRegistry(snapshot.updatedAt);
      base.creativePlotStages = mergeCreativePlotStageDefinitions(
        base.creativePlotStages,
        snapshot.creativePlotStages,
        snapshot.books.flatMap((book) => book.plotStages)
      );
      const { registry: next, createdProjectDirectories } =
        await this.writeMissingSnapshotProjects(base, snapshot);
      next.revision = snapshot.revision;
      next.updatedAt = snapshot.updatedAt;
      setLegacyImport(next, snapshot.legacyImport);
      next.sourceCatalogMigrated = true;
      next.creativePlotStages = base.creativePlotStages;
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
      const mergedStages = mergeCreativePlotStageDefinitions(
        current.creativePlotStages,
        snapshot.creativePlotStages,
        snapshot.books.flatMap((book) => book.plotStages)
      );
      const stagesChanged = !sameCreativePlotStageDefinitions(
        current.creativePlotStages,
        mergedStages
      );
      current.creativePlotStages = mergedStages;
      const { registry: next, createdProjectDirectories } =
        await this.writeMissingSnapshotProjects(current, snapshot);
      next.creativePlotStages = mergedStages;
      const changed = next.projects.length !== before || stagesChanged;
      if (changed || snapshot.legacyImport !== undefined) {
        next.revision = Math.max(
          current.revision + (changed ? 1 : 0),
          snapshot.revision
        );
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
    const input = CreateShortBookInputSchema.parse(
      wrapped ? rawInput.input : rawInput
    );
    const parent =
      (wrapped ? rawInput.parentDirectory : parentDirectory)?.trim() ||
      this.defaultProjectParents.book;
    return await this.createBookProject(
      parent,
      (now) =>
        ShortBookSchema.parse({
          id: createCatalogId("book"),
          title: input.title,
          bookType: "short",
          genre: input.genre,
          status: "editing",
          linkedMaterialIdsByKind: linkedMaterialIdsFromInput(
            input.linkedMaterialIdsByKind
          ),
          linkedSkillIdsByKind: linkedSkillIdsFromInput(
            input.linkedSkillIdsByKind
          ),
          characterStructure: createDefaultBookCharacterStructure(),
          plotStages: createDefaultBookPlotStages(),
          documents: DEFAULT_SHORT_DOCUMENTS.map(([id, title]) => ({
            id,
            title,
            content: "",
            createdAt: now,
            updatedAt: now
          })),
          draft: createCatalogDraftDirectory(now),
          createdAt: now,
          updatedAt: now
        }),
      input.defaultPlotStageIds
    );
  }

  async createScriptBook(
    rawInput: CreateScriptBookInput,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<ScriptBook>>;
  async createScriptBook(
    rawInput: CreateScriptBookAtDirectoryInput
  ): Promise<OpenFolderCatalogProjectResult<ScriptBook>>;
  async createScriptBook(
    rawInput: CreateScriptBookInput | CreateScriptBookAtDirectoryInput,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<ScriptBook>> {
    const wrapped = isCreateScriptAtDirectoryInput(rawInput);
    const input = CreateScriptBookInputSchema.parse(
      wrapped ? rawInput.input : rawInput
    );
    const parent =
      (wrapped ? rawInput.parentDirectory : parentDirectory)?.trim() ||
      this.defaultProjectParents.book;
    return await this.createBookProject(parent, (now) =>
      ScriptBookSchema.parse({
        id: createCatalogId("book"),
        title: input.title,
        bookType: "script",
        genre: input.genre,
        status: "editing",
        linkedMaterialIdsByKind: linkedMaterialIdsFromInput(
          input.linkedMaterialIdsByKind
        ),
        linkedSkillIdsByKind: linkedSkillIdsFromInput(
          input.linkedSkillIdsByKind
        ),
        characterStructure: createDefaultBookCharacterStructure(),
        plotStages: createDefaultBookPlotStages(),
        documents: DEFAULT_SCRIPT_DOCUMENTS.map(([id, title]) => ({
          id,
          title,
          content: "",
          createdAt: now,
          updatedAt: now
        })),
        draft: createScriptCatalogDraftDirectory(now),
        createdAt: now,
        updatedAt: now
      })
    );
  }

  private async createBookProject<Resource extends Book>(
    parentDirectory: string,
    createBook: (now: string) => Resource,
    defaultPlotStageIds?: readonly string[]
  ): Promise<OpenFolderCatalogProjectResult<Resource>> {
    return await this.mutate(async () => {
      const now = this.now();
      const registry = await this.ensureRegistry();
      const book = applyGlobalPlotStagesToNewBook(
        createBook(now),
        registry.creativePlotStages,
        defaultPlotStageIds
      );
      const snapshot = await this.aggregateSnapshot(registry);
      assertBookLibraryReferences(book, snapshot);
      const projectDirectory = await this.writeNewResourceProject(
        "book",
        parentDirectory,
        book
      );
      try {
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
      )) as OpenFolderCatalogProjectResult<Resource>;
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
  ): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>> {
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
              id: createCatalogId("material"),
              title: input.name,
              materialType: input.libraryType ?? "short",
              materialKind: input.materialKind,
              parentGenre: "",
              subGenre: "",
              overview: "",
              entries: [],
              createdAt: now,
              updatedAt: now
            }
          : {
              id: createCatalogId("skill"),
              title: input.name,
              skillType: input.libraryType ?? "short",
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

  async updateLibrary(
    rawInput: UpdateLibraryInput
  ): Promise<MaterialLibrary | SkillLibrary> {
    const input = UpdateLibraryInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const projectDirectory = await secureProjectRoot(
        findRegistration(
          registry,
          input.libraryId,
          libraryProjectDomain(input.domain)
        ).projectDirectory
      );
      const manifest = await this.readManifest(
        projectDirectory,
        input.domain === "material"
          ? "deepwrite.material-library"
          : "deepwrite.skill-library",
        input.libraryId
      );
      if (!input.force)
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      if (manifest.kind === "deepwrite.skill-library" && manifest.isBuiltin) {
        throw new Error("内置技能库不能修改。");
      }
      const now = this.now();
      const next =
        manifest.kind === "deepwrite.material-library"
          ? MaterialLibraryProjectManifestSchema.parse({
              ...manifest,
              title: input.title ?? manifest.title,
              overview: input.overview ?? manifest.overview,
              revision: manifest.revision + 1,
              updatedAt: now
            })
          : SkillLibraryProjectManifestSchema.parse({
              ...manifest,
              title: input.title ?? manifest.title,
              overview: input.overview ?? manifest.overview,
              revision: manifest.revision + 1,
              updatedAt: now
            });
      await atomicWriteJson(
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return (
        await this.readProject(
          projectDirectory,
          libraryProjectDomain(input.domain)
        )
      ).resource as MaterialLibrary | SkillLibrary;
    });
  }

  async createLibraryGroup(
    rawInput: CreateFolderLibraryGroupInput
  ): Promise<
    OpenFolderCatalogProjectResult<MaterialLibraryGroup | SkillLibraryGroup>
  > {
    const input = CreateLibraryGroupInputSchema.parse(rawInput);
    const projectDomain =
      input.domain === "material" ? "material-group" : "skill-group";
    const parentDirectory =
      rawInput.parentDirectory?.trim() ||
      this.defaultProjectParents[projectDomain];
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
          if (
            library.materialKind !== "mixed" &&
            library.materialKind !== kind
          ) {
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
        const libraries = new Map(
          snapshot.skills.map((library) => [library.id, library])
        );
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
              id: createCatalogId("material-group"),
              title: input.name,
              members: { ...input.members },
              createdAt: now,
              updatedAt: now
            }
          : {
              id: createCatalogId("skill-group"),
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
      )) as OpenFolderCatalogProjectResult<
        MaterialLibraryGroup | SkillLibraryGroup
      >;
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
        id: createCatalogId("book"),
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
              id: createCatalogId("material"),
              entries: input.library.entries.map((entry) => ({
                ...entry,
                id: createCatalogId("material-entry"),
                createdAt: now,
                updatedAt: now
              })),
              createdAt: now,
              updatedAt: now
            }
          : {
              ...input.library,
              id: createCatalogId("skill"),
              isBuiltin: false,
              entries: input.library.entries.map((entry) => ({
                ...entry,
                id: createCatalogId("skill-entry"),
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
  ): Promise<OpenFolderCatalogProjectResult<Book>> {
    return (await this.openCatalogProject(
      projectDirectory,
      "book",
      register
    )) as OpenFolderCatalogProjectResult<Book>;
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

  async updateBook(rawInput: UpdateFolderBookInput): Promise<Book> {
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
      const manifest = await this.readCurrentBookManifest(
        opened.projectDirectory,
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
      } satisfies FolderCurrentBookProjectManifest;
      const validated = FolderCurrentBookProjectManifestSchema.parse(next);
      const snapshot = await this.aggregateSnapshot(registry);
      assertBookLibraryReferences(validated, snapshot);
      await atomicWriteJson(
        join(opened.projectDirectory, MANIFEST_FILE),
        validated,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return (await this.readProject(opened.projectDirectory, "book"))
        .resource as Book;
    });
  }

  async mutatePlotStructure(rawInput: MutatePlotStructureInput): Promise<Book> {
    const input = MutatePlotStructureInputSchema.parse(rawInput);
    if (input.baseProjectRevision !== undefined) {
      assertProjectRevision(input.baseProjectRevision);
    }
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }

      const now = this.now();
      const mutation = input.mutation;

      if (mutation.type === "move") {
        const plotStages = manifest.plotStages.map((stage) => ({ ...stage }));
        const stageIndex = plotStages.findIndex(
          ({ id }) => id === mutation.stageId
        );
        if (stageIndex < 0) {
          throw new Error("该剧情结构已删除或不存在。");
        }
        const targetIndex =
          mutation.direction === "up" ? stageIndex - 1 : stageIndex + 1;
        if (targetIndex < 0 || targetIndex >= plotStages.length) {
          throw new Error("该剧情结构已经位于列表边界。");
        }
        const [stage] = plotStages.splice(stageIndex, 1);
        plotStages.splice(targetIndex, 0, stage!);
        const definitionsById = new Map(
          registry.creativePlotStages.map((definition) => [
            definition.id,
            definition
          ])
        );
        registry.creativePlotStages = CreativePlotStagesSchema.parse([
          ...plotStages.flatMap((item) => {
            const definition = definitionsById.get(item.id);
            return definition ? [definition] : [];
          }),
          ...registry.creativePlotStages.filter(
            (definition) => !plotStages.some(({ id }) => id === definition.id)
          )
        ]);
        await this.applyGlobalPlotStageOrder(registry, now);
        await this.bumpRegistry(registry, now);
        return (await this.readProject(projectDirectory, "book", input.bookId))
          .resource as Book;
      }

      if (mutation.type === "setEnabled") {
        const plotStages = manifest.plotStages.map((stage) => ({ ...stage }));
        const stageIndex = plotStages.findIndex(
          ({ id }) => id === mutation.stageId
        );
        if (stageIndex < 0) {
          throw new Error("该剧情结构已删除或不存在。");
        }
        if (
          !mutation.enabled &&
          !plotStages.some(
            (stage, index) => index !== stageIndex && stage.enabled
          )
        ) {
          throw new Error("至少需要保留一个启用的剧情结构项。");
        }
        plotStages[stageIndex] = {
          ...plotStages[stageIndex]!,
          enabled: mutation.enabled
        };
        const nextManifest = FolderCurrentBookProjectManifestSchema.parse({
          ...manifest,
          revision: manifest.revision + 1,
          plotStages: BookPlotStagesSchema.parse(plotStages),
          updatedAt: now
        });
        await atomicWriteJson(
          join(projectDirectory, MANIFEST_FILE),
          nextManifest,
          this.maxManifestBytes
        );
        await this.bumpRegistry(registry, now);
        return (await this.readProject(projectDirectory, "book", input.bookId))
          .resource as Book;
      }

      const globalStages = registry.creativePlotStages.map((stage) => ({
        ...stage
      }));
      const assertUniqueGlobalTitle = (
        title: string,
        exceptStageId?: string
      ): void => {
        const key = title.trim().toLocaleLowerCase();
        if (
          globalStages.some(
            (stage) =>
              stage.id !== exceptStageId &&
              stage.title.trim().toLocaleLowerCase() === key
          )
        ) {
          throw new Error(`剧情结构名称“${title.trim()}”已存在。`);
        }
      };

      if (mutation.type === "create") {
        const title = mutation.title.trim();
        const description = mutation.description.trim();
        const existingDefinition = mutation.stageId
          ? globalStages.find(({ id }) => id === mutation.stageId)
          : undefined;
        if (existingDefinition) {
          if (
            !input.force ||
            existingDefinition.title !== title ||
            existingDefinition.description !== description
          ) {
            throw new Error(
              `剧情结构标识“${mutation.stageId}”已用于其他创建请求。`
            );
          }
          const existingStage = manifest.plotStages.find(
            ({ id }) => id === mutation.stageId
          );
          const existingDocument = manifest.documents.find(
            ({ id }) => id === mutation.stageId
          );
          if (existingStage && existingDocument) {
            if (
              existingStage.title !== title ||
              existingStage.description !== description ||
              existingDocument.title !== title
            ) {
              throw new Error(
                "剧情结构创建记录与本次创建意图不一致，无法安全重放。"
              );
            }
            return (
              await this.readProject(projectDirectory, "book", input.bookId)
            ).resource as Book;
          }
          if (existingStage || existingDocument) {
            throw new Error("剧情结构创建记录不完整，无法安全重放本次创建。");
          }
          await this.applyGlobalPlotStageCreate(
            registry,
            existingDefinition,
            input.bookId,
            now
          );
          await this.bumpRegistry(registry, now);
          return (
            await this.readProject(projectDirectory, "book", input.bookId)
          ).resource as Book;
        }
        if (globalStages.length >= 32) {
          throw new Error("剧情结构最多支持 32 项。");
        }
        assertUniqueGlobalTitle(title);
        const ids = new Set(globalStages.map(({ id }) => id));
        if (mutation.stageId && ids.has(mutation.stageId)) {
          throw new Error(
            `剧情结构标识“${mutation.stageId}”已被其他结构占用。`
          );
        }
        let stageId = mutation.stageId ?? createCatalogId("plot-stage");
        while (!mutation.stageId && ids.has(stageId)) {
          stageId = createCatalogId("plot-stage");
        }
        const definition: CreativePlotStage = {
          id: stageId,
          title,
          description
        };
        globalStages.push(definition);
        registry.creativePlotStages =
          CreativePlotStagesSchema.parse(globalStages);
        await this.applyGlobalPlotStageCreate(
          registry,
          definition,
          input.bookId,
          now
        );
      } else if (mutation.type === "update") {
        const stageIndex = globalStages.findIndex(
          ({ id }) => id === mutation.stageId
        );
        if (stageIndex < 0) {
          throw new Error("该剧情结构已删除或不存在。");
        }
        assertUniqueGlobalTitle(mutation.title, mutation.stageId);
        globalStages[stageIndex] = {
          id: mutation.stageId,
          title: mutation.title.trim(),
          description: mutation.description.trim()
        };
        registry.creativePlotStages =
          CreativePlotStagesSchema.parse(globalStages);
        await this.applyGlobalPlotStageUpdate(
          registry,
          globalStages[stageIndex]!,
          now
        );
      } else {
        if (isBuiltinCreativePlotStageId(mutation.stageId)) {
          throw new Error("默认剧情结构不可删除。");
        }
        const stageIndex = globalStages.findIndex(
          ({ id }) => id === mutation.stageId
        );
        if (stageIndex < 0) {
          throw new Error("该剧情结构已删除或不存在。");
        }
        if (globalStages.length <= 1) {
          throw new Error("至少需要保留一个剧情结构项。");
        }
        globalStages.splice(stageIndex, 1);
        registry.creativePlotStages =
          CreativePlotStagesSchema.parse(globalStages);
        await this.applyGlobalPlotStageDelete(registry, mutation.stageId, now);
      }

      await this.bumpRegistry(registry, now);
      return (await this.readProject(projectDirectory, "book", input.bookId))
        .resource as Book;
    });
  }

  async mutateCharacterStructure(
    rawInput: MutateCharacterStructureInput
  ): Promise<Book> {
    const input = MutateCharacterStructureInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      const now = this.now();
      const mutation = input.mutation;
      const overviewIndex = manifest.documents.findIndex(
        ({ id }) => id === "character_design"
      );
      if (overviewIndex < 0) {
        throw new Error("人物结构缺少人物概览文件。");
      }
      const overview = manifest.documents[overviewIndex]!;
      const overviewPath = await secureExistingProjectPath(
        projectDirectory,
        overview.path,
        false
      );

      if (mutation.type === "setFormat") {
        if (mutation.format === manifest.characterStructure.format) {
          return (
            await this.readProject(projectDirectory, "book", input.bookId)
          ).resource as Book;
        }
        if (mutation.format === "list") {
          const original = await readRequiredUtf8File(
            overviewPath,
            this.maxMarkdownBytes,
            "character design"
          );
          const documents = manifest.documents.map((document) => ({
            ...document
          }));
          documents[overviewIndex] = {
            ...documents[overviewIndex]!,
            title: "概览",
            updatedAt: now
          };
          const items = [];
          let createdPath: string | undefined;
          if (original.trim()) {
            if (
              manifestContentItems(manifest).length >=
              CATALOG_PROJECT_MAX_CONTENT_ITEMS
            ) {
              throw new Error("作品文件数量已达上限，无法转换为人物条目样式。");
            }
            const itemId = createCatalogId("character");
            const relativePath = await uniqueRelativeMarkdownPath(
              projectDirectory,
              "characters",
              itemId,
              new Set(
                manifestContentItems(manifest).map(({ path }) =>
                  portableContentPathKey(path)
                )
              )
            );
            createdPath = relativePath;
            documents.push({
              id: itemId,
              title: "人物设定",
              path: relativePath,
              createdAt: now,
              updatedAt: now
            });
            items.push({ id: itemId, title: "人物设定", order: 1 });
          }
          const next = FolderCurrentBookProjectManifestSchema.parse({
            ...manifest,
            revision: manifest.revision + 1,
            characterStructure: { format: "list", items },
            documents,
            updatedAt: now
          });
          try {
            if (createdPath) {
              await atomicWriteText(
                await secureWritableProjectPath(projectDirectory, createdPath),
                original
              );
            }
            await commitProjectMarkdownUpdate(
              overviewPath,
              "",
              original,
              join(projectDirectory, MANIFEST_FILE),
              next,
              this.maxMarkdownBytes,
              this.maxManifestBytes
            );
          } catch (error) {
            if (createdPath) {
              await unlink(
                await secureWritableProjectPath(projectDirectory, createdPath)
              ).catch(() => undefined);
            }
            throw error;
          }
        } else {
          if (manifest.characterStructure.format !== "list") {
            throw new Error("当前人物结构不是条目样式。");
          }
          const overviewContent = await readRequiredUtf8File(
            overviewPath,
            this.maxMarkdownBytes,
            "character overview"
          );
          const orderedItems = [...manifest.characterStructure.items].sort(
            (left, right) => left.order - right.order
          );
          const sections: string[] = [];
          if (overviewContent.trim()) {
            sections.push(`# 概览\n\n${overviewContent.trim()}`);
          }
          const itemDocuments = orderedItems.map((item) => {
            const document = manifest.documents.find(
              ({ id }) => id === item.id
            );
            if (!document) throw new Error(`人物条目 ${item.id} 缺少文件。`);
            return { item, document };
          });
          for (const { item, document } of itemDocuments) {
            const content = await readProjectMarkdown(
              projectDirectory,
              document.path,
              this.maxMarkdownBytes
            );
            sections.push(`# ${item.title}\n\n${content.trim()}`.trim());
          }
          const merged = sections.join("\n\n").trim();
          const removedIds = new Set(orderedItems.map(({ id }) => id));
          const textDocuments = manifest.documents
            .filter(({ id }) => !removedIds.has(id))
            .map((document) =>
              document.id === BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID
                ? { ...document, title: "人物设计", updatedAt: now }
                : document
            );
          const next = FolderCurrentBookProjectManifestSchema.parse({
            ...manifest,
            revision: manifest.revision + 1,
            characterStructure: createDefaultBookCharacterStructure(),
            documents: textDocuments,
            updatedAt: now
          });
          await commitProjectMarkdownUpdate(
            overviewPath,
            merged,
            overviewContent,
            join(projectDirectory, MANIFEST_FILE),
            next,
            this.maxMarkdownBytes,
            this.maxManifestBytes
          );
          for (const { document } of itemDocuments) {
            await unlink(
              await secureExistingProjectPath(
                projectDirectory,
                document.path,
                false
              )
            ).catch(() => undefined);
          }
        }
      } else {
        if (manifest.characterStructure.format !== "list") {
          throw new Error("人物条目操作仅适用于条目样式。");
        }
        const items = [...manifest.characterStructure.items]
          .sort((left, right) => left.order - right.order)
          .map((item) => ({ ...item }));
        const documents = manifest.documents.map((document) => ({
          ...document
        }));
        if (mutation.type === "createItem") {
          const title = mutation.title.trim();
          const existingItem = mutation.itemId
            ? items.find(({ id }) => id === mutation.itemId)
            : undefined;
          if (existingItem) {
            const hasDocument = documents.some(
              ({ id }) => id === existingItem.id
            );
            if (input.force && existingItem.title === title && hasDocument) {
              return (
                await this.readProject(projectDirectory, "book", input.bookId)
              ).resource as Book;
            }
            throw new Error("人物条目标识已存在。");
          }
          if (
            items.some(
              (item) =>
                item.title.toLocaleLowerCase() === title.toLocaleLowerCase()
            )
          ) {
            throw new Error(`人物条目“${title}”已存在。`);
          }
          if (
            manifestContentItems(manifest).length >=
            CATALOG_PROJECT_MAX_CONTENT_ITEMS
          ) {
            throw new Error("作品文件数量已达上限，无法新建人物条目。");
          }
          const itemId = mutation.itemId ?? createCatalogId("character");
          if (documents.some(({ id }) => id === itemId)) {
            throw new Error("人物条目标识已存在。");
          }
          const path = await uniqueRelativeMarkdownPath(
            projectDirectory,
            "characters",
            itemId,
            new Set(
              manifestContentItems(manifest).map(({ path: value }) =>
                portableContentPathKey(value)
              )
            )
          );
          items.push({ id: itemId, title, order: items.length + 1 });
          documents.push({
            id: itemId,
            title,
            path,
            createdAt: now,
            updatedAt: now
          });
          const next = FolderCurrentBookProjectManifestSchema.parse({
            ...manifest,
            revision: manifest.revision + 1,
            characterStructure: { format: "list", items },
            documents,
            updatedAt: now
          });
          await commitProjectMarkdownUpdate(
            await secureWritableProjectPath(projectDirectory, path),
            "",
            undefined,
            join(projectDirectory, MANIFEST_FILE),
            next,
            this.maxMarkdownBytes,
            this.maxManifestBytes
          );
        } else {
          const index = items.findIndex(({ id }) => id === mutation.itemId);
          if (index < 0) throw new Error("人物条目已删除或不存在。");
          let deletedPath: string | undefined;
          if (mutation.type === "updateItem") {
            const title = mutation.title.trim();
            if (
              items.some(
                (item, itemIndex) =>
                  itemIndex !== index &&
                  item.title.toLocaleLowerCase() === title.toLocaleLowerCase()
              )
            ) {
              throw new Error(`人物条目“${title}”已存在。`);
            }
            items[index] = { ...items[index]!, title };
            const documentIndex = documents.findIndex(
              ({ id }) => id === mutation.itemId
            );
            if (documentIndex < 0) throw new Error("人物条目文件不存在。");
            documents[documentIndex] = {
              ...documents[documentIndex]!,
              title,
              updatedAt: now
            };
          } else if (mutation.type === "moveItem") {
            const target = mutation.direction === "up" ? index - 1 : index + 1;
            if (target < 0 || target >= items.length) {
              throw new Error("人物条目已经位于列表边界。");
            }
            [items[index], items[target]] = [items[target]!, items[index]!];
          } else {
            const documentIndex = documents.findIndex(
              ({ id }) => id === mutation.itemId
            );
            if (documentIndex < 0) throw new Error("人物条目文件不存在。");
            deletedPath = documents[documentIndex]!.path;
            documents.splice(documentIndex, 1);
            items.splice(index, 1);
          }
          const normalizedItems = items.map((item, itemIndex) => ({
            ...item,
            order: itemIndex + 1
          }));
          const next = FolderCurrentBookProjectManifestSchema.parse({
            ...manifest,
            revision: manifest.revision + 1,
            characterStructure: { format: "list", items: normalizedItems },
            documents,
            updatedAt: now
          });
          await atomicWriteJson(
            join(projectDirectory, MANIFEST_FILE),
            next,
            this.maxManifestBytes
          );
          if (deletedPath) {
            await unlink(
              await secureExistingProjectPath(
                projectDirectory,
                deletedPath,
                false
              )
            ).catch(() => undefined);
          }
        }
      }
      await this.bumpRegistry(registry, now);
      return (await this.readProject(projectDirectory, "book", input.bookId))
        .resource as Book;
    });
  }

  private async applyGlobalPlotStageCreate(
    registry: FolderCatalogRegistry,
    definition: CreativePlotStage,
    enabledBookId: string,
    now: string
  ): Promise<void> {
    for (const registration of registry.projects.filter(
      (project) => project.domain === "book"
    )) {
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        registration.id
      );
      if (manifest.plotStages.some(({ id }) => id === definition.id)) {
        continue;
      }
      if (manifest.plotStages.length >= 32) {
        throw new Error(
          `作品“${manifest.title}”的剧情结构已达上限，无法同步新增阶段。`
        );
      }
      const path = await uniqueRelativeMarkdownPath(
        projectDirectory,
        "stages",
        definition.id,
        new Set(
          manifestContentItems(manifest).map(({ path: itemPath }) =>
            portableContentPathKey(itemPath)
          )
        )
      );
      const nextManifest = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        plotStages: BookPlotStagesSchema.parse([
          ...manifest.plotStages,
          {
            ...definition,
            enabled: registration.id === enabledBookId
          }
        ]),
        documents: [
          ...manifest.documents,
          {
            id: definition.id,
            title: definition.title,
            path,
            createdAt: now,
            updatedAt: now
          }
        ],
        updatedAt: now
      });
      await commitProjectMarkdownUpdate(
        await secureWritableProjectPath(projectDirectory, path),
        "",
        undefined,
        join(projectDirectory, MANIFEST_FILE),
        nextManifest,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
    }
  }

  private async applyGlobalPlotStageUpdate(
    registry: FolderCatalogRegistry,
    definition: CreativePlotStage,
    now: string
  ): Promise<void> {
    for (const registration of registry.projects.filter(
      (project) => project.domain === "book"
    )) {
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        registration.id
      );
      const stageIndex = manifest.plotStages.findIndex(
        ({ id }) => id === definition.id
      );
      const documentIndex = manifest.documents.findIndex(
        ({ id }) => id === definition.id
      );
      if (stageIndex < 0 || documentIndex < 0) {
        continue;
      }
      const plotStages = manifest.plotStages.map((stage) =>
        stage.id === definition.id
          ? {
              ...stage,
              title: definition.title,
              description: definition.description
            }
          : stage
      );
      const documents = manifest.documents.map((document) =>
        document.id === definition.id
          ? { ...document, title: definition.title, updatedAt: now }
          : document
      );
      const nextManifest = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        plotStages: BookPlotStagesSchema.parse(plotStages),
        documents,
        updatedAt: now
      });
      await atomicWriteJson(
        join(projectDirectory, MANIFEST_FILE),
        nextManifest,
        this.maxManifestBytes
      );
    }
  }

  private async applyGlobalPlotStageOrder(
    registry: FolderCatalogRegistry,
    now: string
  ): Promise<void> {
    const order = new Map(
      registry.creativePlotStages.map(({ id }, index) => [id, index])
    );
    for (const registration of registry.projects.filter(
      (project) => project.domain === "book"
    )) {
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        registration.id
      );
      const plotStages = [...manifest.plotStages].sort(
        (left, right) =>
          (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );
      if (
        plotStages.every(
          (stage, index) => stage.id === manifest.plotStages[index]?.id
        )
      ) {
        continue;
      }
      const nextManifest = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        plotStages: BookPlotStagesSchema.parse(plotStages),
        updatedAt: now
      });
      await atomicWriteJson(
        join(projectDirectory, MANIFEST_FILE),
        nextManifest,
        this.maxManifestBytes
      );
    }
  }

  private async applyGlobalPlotStageDelete(
    registry: FolderCatalogRegistry,
    stageId: string,
    now: string
  ): Promise<void> {
    for (const registration of registry.projects.filter(
      (project) => project.domain === "book"
    )) {
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        registration.id
      );
      const stageIndex = manifest.plotStages.findIndex(
        ({ id }) => id === stageId
      );
      const documentIndex = manifest.documents.findIndex(
        ({ id }) => id === stageId
      );
      if (stageIndex < 0) {
        continue;
      }
      if (manifest.plotStages.length <= 1) {
        throw new Error(`作品“${manifest.title}”至少需要保留一个剧情结构项。`);
      }
      if (
        !manifest.plotStages.some(
          (stage, index) => index !== stageIndex && stage.enabled
        )
      ) {
        throw new Error(
          `作品“${manifest.title}”至少需要保留一个启用的剧情结构项，请先启用其他阶段再删除。`
        );
      }
      const documents = [...manifest.documents];
      const plotStages = [...manifest.plotStages];
      plotStages.splice(stageIndex, 1);
      let deletedPath: string | undefined;
      if (documentIndex >= 0) {
        deletedPath = documents[documentIndex]!.path;
        documents.splice(documentIndex, 1);
      }
      const nextManifest = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        plotStages: BookPlotStagesSchema.parse(plotStages),
        documents,
        updatedAt: now
      });
      if (deletedPath) {
        const target = await secureExistingProjectPath(
          projectDirectory,
          deletedPath,
          false
        );
        const backup = `${target}.${randomHex8()}.plot-delete.bak`;
        assertJsonByteLength(nextManifest, this.maxManifestBytes);
        await rename(target, backup);
        try {
          await atomicWriteJson(
            join(projectDirectory, MANIFEST_FILE),
            nextManifest,
            this.maxManifestBytes
          );
        } catch (error: unknown) {
          try {
            await rename(backup, target);
          } catch (rollbackError: unknown) {
            throw new AggregateError(
              [error, rollbackError],
              "剧情结构删除失败，且无法自动恢复 Markdown 文件。"
            );
          }
          throw error;
        }
        await unlinkOptional(backup);
      } else {
        await atomicWriteJson(
          join(projectDirectory, MANIFEST_FILE),
          nextManifest,
          this.maxManifestBytes
        );
      }
    }
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
          if (
            library.materialKind !== "mixed" &&
            library.materialKind !== kind
          ) {
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
        const libraries = new Map(
          snapshot.skills.map((library) => [library.id, library])
        );
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
        title: input.title ?? manifest.title,
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

  async saveDocument(
    rawInput: SaveFolderDocumentInput
  ): Promise<SaveDocumentResult> {
    const input = SaveDocumentInputSchema.parse(rawInput);
    if (input.preserveCurrentContent && input.title === undefined) {
      throw new Error("保留正文内容时必须同时提供新标题。");
    }
    if (!input.preserveCurrentContent) {
      assertTextByteLength(
        input.content,
        this.maxMarkdownBytes,
        "Markdown content"
      );
    }
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      const now = this.now();
      const regularDocumentIndex = manifest.documents.findIndex(
        ({ id }) => id === input.documentId
      );
      const documents = [...manifest.documents];
      const plotStages = manifest.plotStages.map((stage) => ({ ...stage }));
      const characterStructure = structuredClone(manifest.characterStructure);
      const draft = structuredClone(manifest.draft);
      const draftTarget =
        regularDocumentIndex < 0
          ? findDraftDocumentManifest(draft, input.documentId)
          : undefined;
      if (
        regularDocumentIndex < 0 &&
        !draftTarget &&
        isReservedDraftDocumentId(input.documentId)
      ) {
        throw new Error("该正文小节已删除或不存在。");
      }
      const changesDraftSectionTitle = Boolean(
        draftTarget?.kind === "body" &&
        input.title !== undefined &&
        input.title !== draft.sections[draftTarget.sectionIndex]?.title
      );
      if (
        !input.force &&
        (regularDocumentIndex >= 0 || !draftTarget || changesDraftSectionTitle)
      ) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      let documentManifest: BookProjectDocumentManifest;
      let currentContent = "";
      let existingPhysicalFile = true;
      if (regularDocumentIndex >= 0) {
        const existing = documents[regularDocumentIndex]!;
        const plotStageIndex = plotStages.findIndex(
          ({ id }) => id === existing.id
        );
        if (plotStageIndex >= 0 && input.title !== undefined) {
          // Plot stage titles are owned by the global creativePlotStages catalog.
          // Keep the document title aligned with the stage definition.
          if (input.title.trim() !== plotStages[plotStageIndex]!.title) {
            throw new Error(
              "请在剧情结构管理中修改阶段名称；名称修改会全局生效。"
            );
          }
        }
        const characterItemIndex =
          characterStructure.format === "list"
            ? characterStructure.items.findIndex(({ id }) => id === existing.id)
            : -1;
        if (
          existing.id === "character_design" &&
          characterStructure.format === "list" &&
          input.title !== undefined &&
          input.title.trim() !== existing.title
        ) {
          throw new Error("概览名称固定，不能修改。");
        }
        if (
          characterItemIndex >= 0 &&
          input.title !== undefined &&
          characterStructure.format === "list"
        ) {
          const title = input.title.trim();
          if (
            characterStructure.items.some(
              (item, index) =>
                index !== characterItemIndex &&
                item.title.toLocaleLowerCase() === title.toLocaleLowerCase()
            )
          ) {
            throw new Error(`人物条目“${title}”已存在。`);
          }
          characterStructure.items[characterItemIndex] = {
            ...characterStructure.items[characterItemIndex]!,
            title
          };
        }
        currentContent = await readProjectMarkdown(
          projectDirectory,
          existing.path,
          this.maxMarkdownBytes
        );
        documentManifest = {
          ...existing,
          ...(input.title === undefined || plotStageIndex >= 0
            ? {}
            : { title: input.title }),
          updatedAt: now
        };
        documents[regularDocumentIndex] = documentManifest;
      } else {
        if (draftTarget) {
          const section = draft.sections[draftTarget.sectionIndex]!;
          const existing =
            draftTarget.kind === "body" ? section.body : section.characterState;
          currentContent = await readProjectMarkdown(
            projectDirectory,
            existing.path,
            this.maxMarkdownBytes
          );
          if (draftTarget.kind === "body") {
            const sectionTitle = input.title ?? section.title;
            if (
              input.title !== undefined &&
              sectionTitle !== section.title &&
              draft.sections.some(
                (candidate, index) =>
                  index !== draftTarget.sectionIndex &&
                  candidate.title === sectionTitle
              )
            ) {
              throw new Error(
                `正文目录已存在同名${
                  manifest.bookType === "script" ? "剧集" : "章节"
                }「${sectionTitle}」。`
              );
            }
            documentManifest = {
              ...existing,
              title: sectionTitle,
              updatedAt: now
            };
            draft.sections[draftTarget.sectionIndex] = {
              ...section,
              title: sectionTitle,
              body: documentManifest,
              characterState:
                sectionTitle === section.title
                  ? section.characterState
                  : {
                      ...section.characterState,
                      title: draftCharacterStateTitle(sectionTitle),
                      updatedAt: now
                    },
              updatedAt: now
            };
          } else {
            documentManifest = {
              ...existing,
              title: draftCharacterStateTitle(section.title),
              updatedAt: now
            };
            draft.sections[draftTarget.sectionIndex] = {
              ...section,
              characterState: documentManifest,
              updatedAt: now
            };
          }
          draft.updatedAt = now;
        } else {
          if (input.documentId === "draft") {
            throw new Error(
              "正文现在是小节文件夹，不能再按单一 draft 文档整篇覆盖。"
            );
          }
          existingPhysicalFile = false;
          documentManifest = {
            id: input.documentId,
            title: input.title ?? defaultDocumentTitle(input.documentId),
            path: await uniqueRelativeMarkdownPath(
              projectDirectory,
              "stages",
              input.documentId,
              new Set(
                manifestContentItems(manifest).map(({ path }) =>
                  portableContentPathKey(path)
                )
              )
            ),
            createdAt: now,
            updatedAt: now
          };
          documents.push(documentManifest);
        }
      }
      if (!input.force && input.baseRevision !== undefined) {
        const actualRevision =
          createShortWorkspaceContentRevision(currentContent);
        if (input.baseRevision !== actualRevision) {
          throw new FolderCatalogConflictError(
            input.baseRevision,
            actualRevision
          );
        }
      }
      const target = await secureWritableProjectPath(
        projectDirectory,
        documentManifest.path
      );
      if (input.preserveCurrentContent && !existingPhysicalFile) {
        throw new Error("目标文档不存在，无法只修改标题。");
      }
      const committedContent = input.preserveCurrentContent
        ? currentContent
        : input.content;
      const next = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        characterStructure,
        plotStages,
        documents,
        draft,
        updatedAt: now
      });
      await commitProjectMarkdownUpdate(
        target,
        committedContent,
        existingPhysicalFile ? currentContent : undefined,
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return SaveDocumentResultSchema.parse({
        id: documentManifest.id,
        title: documentManifest.title,
        content: committedContent,
        createdAt: documentManifest.createdAt,
        updatedAt: documentManifest.updatedAt,
        projectRevision: next.revision
      });
    });
  }

  async createDraftSection(
    rawInput: CreateDraftSectionInput
  ): Promise<CatalogDraftSection> {
    const input = CreateDraftSectionInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      if (manifest.draft.sections.length >= 100) {
        throw new Error(
          `正文最多支持 100 个${manifest.bookType === "script" ? "剧集" : "小节"}。`
        );
      }

      let insertionIndex = manifest.draft.sections.length;
      if (input.afterSectionId !== undefined) {
        const afterIndex = manifest.draft.sections.findIndex(
          ({ id }) => id === input.afterSectionId
        );
        if (afterIndex < 0) {
          throw new Error(
            `找不到插入位置对应的${
              manifest.bookType === "script" ? "剧集" : "小节"
            }：${input.afterSectionId}`
          );
        }
        insertionIndex = afterIndex + 1;
      }

      const usedDocumentIds = new Set(
        manifestContentItems(manifest).map(({ id }) => id)
      );
      const sectionId = nextDraftSectionId(
        manifest.bookType,
        manifest.draft.sections.map(({ id }) => id),
        usedDocumentIds
      );
      const title =
        input.title ??
        defaultDraftSectionTitle(manifest.bookType, sectionId, insertionIndex);
      const now = this.now();
      const usedPaths = new Set(
        manifestContentItems(manifest).map(({ path }) =>
          portableContentPathKey(path)
        )
      );
      const bodyPath = await uniqueRelativeMarkdownPathWithSuffix(
        projectDirectory,
        "stages/draft",
        sectionId,
        ".body.md",
        usedPaths
      );
      usedPaths.add(portableContentPathKey(bodyPath));
      const characterStatePath = await uniqueRelativeMarkdownPathWithSuffix(
        projectDirectory,
        "stages/draft",
        sectionId,
        ".state.md",
        usedPaths
      );
      const section: BookProjectDraftSectionManifest = {
        id: sectionId,
        title,
        wordCountRequirement: input.wordCountRequirement ?? "",
        body: {
          id: catalogDraftBodyDocumentId(sectionId),
          title,
          path: bodyPath,
          createdAt: now,
          updatedAt: now
        },
        characterState: {
          id: catalogDraftCharacterStateDocumentId(sectionId),
          title: draftCharacterStateTitle(title),
          path: characterStatePath,
          createdAt: now,
          updatedAt: now
        },
        createdAt: now,
        updatedAt: now
      };
      const sections = [...manifest.draft.sections];
      sections.splice(insertionIndex, 0, section);
      const next = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: now,
        draft: {
          ...manifest.draft,
          sections,
          updatedAt: now
        }
      });
      const bodyTarget = await secureWritableProjectPath(
        projectDirectory,
        bodyPath
      );
      const characterStateTarget = await secureWritableProjectPath(
        projectDirectory,
        characterStatePath
      );
      await commitProjectFileCreations(
        [
          { target: bodyTarget, content: "" },
          { target: characterStateTarget, content: "" }
        ],
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return CatalogDraftSectionSchema.parse({
        id: section.id,
        title: section.title,
        wordCountRequirement: section.wordCountRequirement,
        body: {
          id: section.body.id,
          title: section.body.title,
          content: "",
          createdAt: section.body.createdAt,
          updatedAt: section.body.updatedAt
        },
        characterState: {
          id: section.characterState.id,
          title: section.characterState.title,
          content: "",
          createdAt: section.characterState.createdAt,
          updatedAt: section.characterState.updatedAt
        },
        createdAt: section.createdAt,
        updatedAt: section.updatedAt
      });
    });
  }

  async createDraftSections(
    rawInput: CreateDraftSectionsInput
  ): Promise<CreateDraftSectionsResult> {
    const input = CreateDraftSectionsInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      const requestHash = createDraftSectionsRequestHash(input);
      const existingOperation = manifest.draftSectionCreationOperations?.find(
        ({ operationId }) => operationId === input.operationId
      );
      if (existingOperation) {
        if (existingOperation.requestHash !== requestHash) {
          throw new Error(
            `批量创建操作 ${input.operationId} 已使用，且请求内容与首次提交不一致。`
          );
        }
        return await hydrateDraftSectionCreationResult(
          projectDirectory,
          manifest,
          input.operationId,
          existingOperation.sections,
          this.maxMarkdownBytes,
          this.maxProjectContentBytes
        );
      }

      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      if (manifest.draft.sections.length + input.sections.length > 100) {
        throw new Error(
          `正文最多支持 100 个${manifest.bookType === "script" ? "剧集" : "小节"}。`
        );
      }

      let insertionIndex = manifest.draft.sections.length;
      if (input.afterSectionId !== undefined) {
        const afterIndex = manifest.draft.sections.findIndex(
          ({ id }) => id === input.afterSectionId
        );
        if (afterIndex < 0) {
          throw new Error(
            `找不到插入位置对应的${
              manifest.bookType === "script" ? "剧集" : "小节"
            }：${input.afterSectionId}`
          );
        }
        insertionIndex = afterIndex + 1;
      }

      const sections = [...manifest.draft.sections];
      const usedDocumentIds = new Set(
        manifestContentItems(manifest).map(({ id }) => id)
      );
      const usedPaths = new Set(
        manifestContentItems(manifest).map(({ path }) =>
          portableContentPathKey(path)
        )
      );
      const now = this.now();
      const createdSections: BookProjectDraftSectionManifest[] = [];
      for (const [offset, requestedSection] of input.sections.entries()) {
        const sectionId = nextDraftSectionId(
          manifest.bookType,
          [...sections, ...createdSections].map(({ id }) => id),
          usedDocumentIds
        );
        const bodyDocumentId = catalogDraftBodyDocumentId(sectionId);
        const characterStateDocumentId =
          catalogDraftCharacterStateDocumentId(sectionId);
        usedDocumentIds.add(bodyDocumentId);
        usedDocumentIds.add(characterStateDocumentId);
        const title =
          requestedSection.title ??
          defaultDraftSectionTitle(
            manifest.bookType,
            sectionId,
            insertionIndex + offset
          );
        const bodyPath = await uniqueRelativeMarkdownPathWithSuffix(
          projectDirectory,
          "stages/draft",
          sectionId,
          ".body.md",
          usedPaths
        );
        usedPaths.add(portableContentPathKey(bodyPath));
        const characterStatePath = await uniqueRelativeMarkdownPathWithSuffix(
          projectDirectory,
          "stages/draft",
          sectionId,
          ".state.md",
          usedPaths
        );
        usedPaths.add(portableContentPathKey(characterStatePath));
        createdSections.push({
          id: sectionId,
          title,
          wordCountRequirement: requestedSection.wordCountRequirement ?? "",
          body: {
            id: bodyDocumentId,
            title,
            path: bodyPath,
            createdAt: now,
            updatedAt: now
          },
          characterState: {
            id: characterStateDocumentId,
            title: draftCharacterStateTitle(title),
            path: characterStatePath,
            createdAt: now,
            updatedAt: now
          },
          createdAt: now,
          updatedAt: now
        });
      }

      const seenDraftSectionTitles = new Set(
        manifest.draft.sections.map(({ title }) => title)
      );
      for (const section of createdSections) {
        if (seenDraftSectionTitles.has(section.title)) {
          throw new Error(
            `正文目录已存在同名${
              manifest.bookType === "script" ? "剧集" : "小节"
            }“${section.title}”。`
          );
        }
        seenDraftSectionTitles.add(section.title);
      }

      sections.splice(insertionIndex, 0, ...createdSections);
      const operationSections = input.sections.map(
        ({ clientSectionId }, index) => ({
          clientSectionId,
          sectionId: createdSections[index]!.id
        })
      );
      const next = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: now,
        draft: {
          ...manifest.draft,
          sections,
          updatedAt: now
        },
        draftSectionCreationOperations: [
          ...(manifest.draftSectionCreationOperations ?? []),
          {
            operationId: input.operationId,
            requestHash,
            sections: operationSections,
            createdAt: now
          }
        ].slice(-256)
      });
      const files = await Promise.all(
        createdSections.flatMap((section) => [
          secureWritableProjectPath(projectDirectory, section.body.path).then(
            (target) => ({
              target,
              content: ""
            })
          ),
          secureWritableProjectPath(
            projectDirectory,
            section.characterState.path
          ).then((target) => ({ target, content: "" }))
        ])
      );
      await commitProjectFileCreations(
        files,
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return await hydrateDraftSectionCreationResult(
        projectDirectory,
        next,
        input.operationId,
        operationSections,
        this.maxMarkdownBytes,
        this.maxProjectContentBytes
      );
    });
  }

  async deleteDraftSection(
    rawInput: DeleteDraftSectionInput
  ): Promise<DeleteDraftSectionResult> {
    const input = DeleteDraftSectionInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      const sectionIndex = manifest.draft.sections.findIndex(
        ({ id }) => id === input.sectionId
      );
      if (sectionIndex < 0) {
        return {
          bookId: input.bookId,
          sectionId: input.sectionId,
          deleted: false
        };
      }
      if (manifest.draft.sections.length <= 1) {
        throw new Error(
          `正文至少需要保留一个${manifest.bookType === "script" ? "剧集" : "小节"}。`
        );
      }
      const deletedSection = manifest.draft.sections[sectionIndex]!;
      const deletedFileTargets = await Promise.all(
        [deletedSection.body.path, deletedSection.characterState.path].map(
          async (path) =>
            await secureExistingProjectPath(projectDirectory, path, true)
        )
      );
      const now = this.now();
      const next = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: now,
        draft: {
          ...manifest.draft,
          sections: manifest.draft.sections.filter(
            ({ id }) => id !== input.sectionId
          ),
          updatedAt: now
        }
      });
      await atomicWriteJson(
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxManifestBytes
      );
      // The manifest is committed first so a crash cannot leave it pointing at
      // missing files. A failed post-commit cleanup can only leave harmless,
      // unreferenced recovery files behind.
      await Promise.allSettled(
        deletedFileTargets.map(async (target) => await unlinkOptional(target))
      );
      await this.bumpRegistry(registry, now);
      return {
        bookId: input.bookId,
        sectionId: input.sectionId,
        deleted: true
      };
    });
  }

  async moveDraftSection(
    rawInput: MoveDraftSectionInput
  ): Promise<MoveDraftSectionResult> {
    const input = MoveDraftSectionInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, input.bookId, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      const sections = [...manifest.draft.sections];
      const sectionIndex = sections.findIndex(
        ({ id }) => id === input.sectionId
      );
      if (sectionIndex < 0) {
        throw new Error("该正文小节已删除或不存在。");
      }
      const targetIndex =
        input.direction === "up" ? sectionIndex - 1 : sectionIndex + 1;
      if (targetIndex < 0 || targetIndex >= sections.length) {
        return {
          bookId: input.bookId,
          sectionId: input.sectionId,
          direction: input.direction,
          moved: false,
          projectRevision: manifest.revision
        };
      }
      [sections[sectionIndex], sections[targetIndex]] = [
        sections[targetIndex]!,
        sections[sectionIndex]!
      ];
      const now = this.now();
      const next = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        updatedAt: now,
        draft: {
          ...manifest.draft,
          sections,
          updatedAt: now
        }
      });
      await atomicWriteJson(
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return {
        bookId: input.bookId,
        sectionId: input.sectionId,
        direction: input.direction,
        moved: true,
        projectRevision: next.revision
      };
    });
  }

  async saveLibraryEntry(
    rawInput: SaveLibraryEntryInput
  ): Promise<MaterialEntry | SkillEntry> {
    const input = SaveLibraryEntryInputSchema.parse(rawInput);
    assertTextByteLength(
      input.content,
      this.maxMarkdownBytes,
      "Markdown content"
    );
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
        const actualRevision =
          createShortWorkspaceContentRevision(currentContent);
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
        ...(skillEntry.marketplaceSource
          ? { marketplaceSource: skillEntry.marketplaceSource }
          : {}),
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
      const id = createCatalogId(`${domain}-entry`);
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

  async moveLibraryEntry(
    rawInput: MoveLibraryEntryInput
  ): Promise<MoveLibraryEntryResult> {
    const input = MoveLibraryEntryInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const sourceDirectory = await secureProjectRoot(
        findRegistration(
          registry,
          input.sourceLibraryId,
          libraryProjectDomain(input.domain)
        ).projectDirectory
      );
      const sourceManifest = await this.readManifest(
        sourceDirectory,
        input.domain === "material"
          ? "deepwrite.material-library"
          : "deepwrite.skill-library",
        input.sourceLibraryId
      );
      const entryIndex = sourceManifest.entries.findIndex(
        ({ id }) => id === input.entryId
      );
      if (entryIndex < 0) throw new Error("要移动的资料库条目不存在。");
      if (
        sourceManifest.kind === "deepwrite.skill-library" &&
        sourceManifest.isBuiltin
      ) {
        throw new Error("内置技能库条目不能移动。");
      }
      if (!input.force)
        assertBaseRevision(
          input.sourceBaseProjectRevision,
          sourceManifest.revision
        );

      const sourceEntry = sourceManifest.entries[entryIndex]!;
      const now = this.now();
      if (input.sourceLibraryId === input.targetLibraryId) {
        const remaining = sourceManifest.entries.filter(
          ({ id }) => id !== input.entryId
        );
        const beforeIndex = input.beforeEntryId
          ? remaining.findIndex(({ id }) => id === input.beforeEntryId)
          : -1;
        remaining.splice(
          beforeIndex < 0 ? remaining.length : beforeIndex,
          0,
          sourceEntry
        );
        const next =
          sourceManifest.kind === "deepwrite.material-library"
            ? MaterialLibraryProjectManifestSchema.parse({
                ...sourceManifest,
                revision: sourceManifest.revision + 1,
                updatedAt: now,
                entries: remaining
              })
            : SkillLibraryProjectManifestSchema.parse({
                ...sourceManifest,
                revision: sourceManifest.revision + 1,
                updatedAt: now,
                entries: remaining
              });
        await atomicWriteJson(
          join(sourceDirectory, MANIFEST_FILE),
          next,
          this.maxManifestBytes
        );
        await this.bumpRegistry(registry, now);
        return {
          domain: input.domain,
          sourceLibraryId: input.sourceLibraryId,
          targetLibraryId: input.targetLibraryId,
          entryId: input.entryId
        };
      }

      const targetDirectory = await secureProjectRoot(
        findRegistration(
          registry,
          input.targetLibraryId,
          libraryProjectDomain(input.domain)
        ).projectDirectory
      );
      const targetManifest = await this.readManifest(
        targetDirectory,
        input.domain === "material"
          ? "deepwrite.material-library"
          : "deepwrite.skill-library",
        input.targetLibraryId
      );
      if (!input.force)
        assertBaseRevision(
          input.targetBaseProjectRevision,
          targetManifest.revision
        );
      if (
        targetManifest.kind === "deepwrite.skill-library" &&
        targetManifest.isBuiltin
      ) {
        throw new Error("内置技能库为只读内容，不能移入条目。");
      }
      if (
        (sourceManifest.kind === "deepwrite.material-library" &&
          targetManifest.kind === "deepwrite.material-library" &&
          sourceManifest.materialType !== targetManifest.materialType) ||
        (sourceManifest.kind === "deepwrite.skill-library" &&
          targetManifest.kind === "deepwrite.skill-library" &&
          sourceManifest.skillType !== targetManifest.skillType)
      ) {
        throw new Error("不同创作类型的资料库条目不能直接移动。");
      }
      let targetStageId: MaterialStageId | undefined;
      if (
        sourceManifest.kind === "deepwrite.material-library" &&
        targetManifest.kind === "deepwrite.material-library"
      ) {
        const materialEntry =
          sourceEntry as MaterialLibraryProjectManifest["entries"][number];
        const allowed: Record<string, readonly string[]> = {
          character: ["character"],
          gimmick: ["gimmick"],
          plot: ["pacing", "intro", "plot_refine"],
          draft: ["draft_excerpt"],
          other: ["other"],
          mixed: [materialEntry.stageId]
        };
        const selectedTargetStage =
          input.targetStageId ?? materialEntry.stageId;
        targetStageId = selectedTargetStage;
        if (
          sourceManifest.materialKind !== targetManifest.materialKind &&
          input.targetStageId === undefined
        ) {
          throw new Error("移动到不同素材分类时，请选择目标内容阶段。");
        }
        if (
          !(allowed[targetManifest.materialKind] ?? []).includes(
            selectedTargetStage
          )
        ) {
          throw new Error("目标素材库分类不支持该素材条目的内容阶段。");
        }
      } else if (input.targetStageId !== undefined) {
        throw new Error("只有素材条目可以调整内容阶段。");
      }
      if (targetManifest.entries.some(({ id }) => id === sourceEntry.id)) {
        throw new Error("目标资料库已存在同 ID 条目，无法移动。");
      }
      const sourceContent = await readProjectMarkdown(
        sourceDirectory,
        sourceEntry.path,
        this.maxMarkdownBytes
      );
      const targetPath = await uniqueRelativeMarkdownPath(
        targetDirectory,
        "entries",
        sourceEntry.id,
        new Set(
          targetManifest.entries.map((entry) =>
            portableContentPathKey(entry.path)
          )
        )
      );
      const targetFile = await secureWritableProjectPath(
        targetDirectory,
        targetPath
      );
      const movedEntry = {
        ...sourceEntry,
        path: targetPath,
        updatedAt: now,
        ...(targetStageId === undefined ? {} : { stageId: targetStageId })
      };
      const targetEntries = [...targetManifest.entries];
      const beforeIndex = input.beforeEntryId
        ? targetEntries.findIndex(({ id }) => id === input.beforeEntryId)
        : -1;
      targetEntries.splice(
        beforeIndex < 0 ? targetEntries.length : beforeIndex,
        0,
        movedEntry
      );
      const nextTarget =
        targetManifest.kind === "deepwrite.material-library"
          ? MaterialLibraryProjectManifestSchema.parse({
              ...targetManifest,
              revision: targetManifest.revision + 1,
              updatedAt: now,
              entries: targetEntries
            })
          : SkillLibraryProjectManifestSchema.parse({
              ...targetManifest,
              revision: targetManifest.revision + 1,
              updatedAt: now,
              entries: targetEntries
            });
      const nextSourceEntries = sourceManifest.entries.filter(
        ({ id }) => id !== input.entryId
      );
      const nextSource =
        sourceManifest.kind === "deepwrite.material-library"
          ? MaterialLibraryProjectManifestSchema.parse({
              ...sourceManifest,
              revision: sourceManifest.revision + 1,
              updatedAt: now,
              entries: nextSourceEntries
            })
          : SkillLibraryProjectManifestSchema.parse({
              ...sourceManifest,
              revision: sourceManifest.revision + 1,
              updatedAt: now,
              entries: nextSourceEntries
            });
      await commitProjectMarkdownUpdate(
        targetFile,
        sourceContent,
        undefined,
        join(targetDirectory, MANIFEST_FILE),
        nextTarget,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await atomicWriteJson(
        join(sourceDirectory, MANIFEST_FILE),
        nextSource,
        this.maxManifestBytes
      );
      const sourceFile = await secureExistingProjectPath(
        sourceDirectory,
        sourceEntry.path,
        true
      );
      await unlinkOptional(sourceFile);
      await this.bumpRegistry(registry, now);
      return {
        domain: input.domain,
        sourceLibraryId: input.sourceLibraryId,
        targetLibraryId: input.targetLibraryId,
        entryId: input.entryId
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
        `.deepwrite-delete-${randomHex8()}.tmp`
      );
      await rename(target, stagedDeletion);
      try {
        if (!rawInput.force && rawInput.baseRevision !== undefined) {
          const stagedContent = await readRequiredUtf8File(
            stagedDeletion,
            this.maxMarkdownBytes,
            "Markdown content"
          );
          const actualRevision =
            createShortWorkspaceContentRevision(stagedContent);
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
        (project) =>
          project.id === projectId && project.domain === registryDomain
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
        `.deepwrite-deleting-${randomHex8()}`
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

  async duplicateProject(
    rawInput: DuplicateCatalogProjectInput
  ): Promise<DuplicateCatalogProjectResult> {
    const input = DuplicateCatalogProjectInputSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const snapshot = await this.aggregateSnapshot(registry);
      const now = this.now();
      const plans: DuplicateProjectWritePlan[] = [];
      const copiedMemberLibraryIds: string[] = [];
      const materialTitles = snapshot.materials.map(({ title }) => title);
      const skillTitles = snapshot.skills.map(({ title }) => title);
      let primaryResource: FolderCatalogResource;

      if (input.domain === "book") {
        const source = snapshot.books.find(({ id }) => id === input.projectId);
        if (!source) throw new Error("未找到要复制的创作空间。");
        const registration = findRegistration(registry, source.id, "book");
        const title = nextCopyTitle(
          source.title,
          snapshot.books.map((book) => book.title)
        );
        primaryResource = duplicateBookResource(source, title, now);
        const sourceWritingContext = await readOrCreateWritingContext(
          registration.projectDirectory,
          source.bookType
        );
        plans.push({
          domain: "book",
          parentDirectory: dirname(registration.projectDirectory),
          resource: primaryResource,
          writingContext: sourceWritingContext.content
        });
      } else if (input.domain === "material" || input.domain === "skill") {
        const registryDomain = libraryProjectDomain(input.domain);
        const libraries =
          input.domain === "material" ? snapshot.materials : snapshot.skills;
        const source = libraries.find(({ id }) => id === input.projectId);
        if (!source) throw new Error("未找到要复制的资料库。");
        const registration = findRegistration(
          registry,
          source.id,
          registryDomain
        );
        const titlePool =
          input.domain === "material" ? materialTitles : skillTitles;
        const title = nextCopyTitle(source.title, titlePool);
        primaryResource = duplicateLibraryResource(source, title, now);
        plans.push({
          domain: registryDomain,
          parentDirectory:
            input.domain === "skill" &&
            "isBuiltin" in source &&
            source.isBuiltin
              ? this.defaultProjectParents["skill-library"]
              : dirname(registration.projectDirectory),
          resource: primaryResource
        });
      } else if (input.domain === "material-group") {
        const source = snapshot.materialGroups.find(
          ({ id }) => id === input.projectId
        );
        if (!source) throw new Error("未找到要复制的素材分组。");
        const sourceGroupRegistration = findRegistration(
          registry,
          source.id,
          "material-group"
        );
        const copiedBySourceId = new Map<string, MaterialLibrary>();
        const members: MaterialLibraryGroup["members"] = {};
        for (const [kind, libraryId] of Object.entries(source.members)) {
          if (!libraryId) continue;
          let copied = copiedBySourceId.get(libraryId);
          if (!copied) {
            const library = snapshot.materials.find(
              ({ id }) => id === libraryId
            );
            if (!library) {
              throw new Error(`素材分组成员不存在或不可读取：${libraryId}`);
            }
            const registration = findRegistration(
              registry,
              library.id,
              "material-library"
            );
            const title = nextCopyTitle(library.title, materialTitles);
            materialTitles.push(title);
            copied = duplicateLibraryResource(library, title, now);
            copiedBySourceId.set(libraryId, copied);
            copiedMemberLibraryIds.push(copied.id);
            plans.push({
              domain: "material-library",
              parentDirectory: dirname(registration.projectDirectory),
              resource: copied
            });
          }
          members[kind as keyof MaterialLibraryGroup["members"]] = copied.id;
        }
        const title = nextCopyTitle(
          source.title,
          snapshot.materialGroups.map((group) => group.title)
        );
        primaryResource = MaterialLibraryGroupSchema.parse({
          id: createCatalogId("material-group"),
          title,
          members,
          createdAt: now,
          updatedAt: now
        });
        plans.push({
          domain: "material-group",
          parentDirectory: dirname(sourceGroupRegistration.projectDirectory),
          resource: primaryResource
        });
      } else {
        const source = snapshot.skillGroups.find(
          ({ id }) => id === input.projectId
        );
        if (!source) throw new Error("未找到要复制的技能分组。");
        const sourceGroupRegistration = findRegistration(
          registry,
          source.id,
          "skill-group"
        );
        const copiedBySourceId = new Map<string, SkillLibrary>();
        const members: SkillLibraryGroup["members"] = {};
        for (const [kind, libraryId] of Object.entries(source.members)) {
          if (!libraryId) continue;
          let copied = copiedBySourceId.get(libraryId);
          if (!copied) {
            const library = snapshot.skills.find(({ id }) => id === libraryId);
            if (!library) {
              throw new Error(`技能分组成员不存在或不可读取：${libraryId}`);
            }
            const registration = findRegistration(
              registry,
              library.id,
              "skill-library"
            );
            const title = nextCopyTitle(library.title, skillTitles);
            skillTitles.push(title);
            copied = duplicateLibraryResource(library, title, now);
            copiedBySourceId.set(libraryId, copied);
            copiedMemberLibraryIds.push(copied.id);
            plans.push({
              domain: "skill-library",
              parentDirectory: library.isBuiltin
                ? this.defaultProjectParents["skill-library"]
                : dirname(registration.projectDirectory),
              resource: copied
            });
          }
          members[kind as keyof SkillLibraryGroup["members"]] = copied.id;
        }
        const title = nextCopyTitle(
          source.title,
          snapshot.skillGroups.map((group) => group.title)
        );
        primaryResource = SkillLibraryGroupSchema.parse({
          id: createCatalogId("skill-group"),
          title,
          members,
          createdAt: now,
          updatedAt: now
        });
        plans.push({
          domain: "skill-group",
          parentDirectory: dirname(sourceGroupRegistration.projectDirectory),
          resource: primaryResource
        });
      }

      const createdProjectDirectories: string[] = [];
      const registrations: RegistryProject[] = [];
      try {
        for (const plan of plans) {
          const projectDirectory = await this.writeNewResourceProject(
            plan.domain,
            plan.parentDirectory,
            plan.resource
          );
          if (plan.writingContext !== undefined) {
            await writeWritingContextFile(
              projectDirectory,
              plan.writingContext
            );
          }
          createdProjectDirectories.push(projectDirectory);
          registrations.push({
            id: plan.resource.id,
            domain: plan.domain,
            projectDirectory,
            registeredAt: now
          });
        }
        await this.writeRegistry({
          ...registry,
          revision: registry.revision + 1,
          updatedAt: now,
          projects: [...registry.projects, ...registrations]
        });
      } catch (error: unknown) {
        try {
          await cleanupNewProjectDirectories(createdProjectDirectories);
        } catch (cleanupError: unknown) {
          throw new AggregateError(
            [error, cleanupError],
            "复制项目失败，且无法完整清理未注册副本。"
          );
        }
        throw error;
      }

      return {
        sourceProjectId: input.projectId,
        projectId: primaryResource.id,
        domain: input.domain,
        title: primaryResource.title,
        copiedMemberLibraryIds
      };
    });
  }

  async installMarketplaceSkillContent(
    rawInput: MarketplaceInstallPackage
  ): Promise<CatalogInstallMarketplaceSkillContentResult> {
    const input = MarketplaceInstallPackageSchema.parse(rawInput);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const snapshot = await this.aggregateSnapshot(registry);
      const sourceRef = {
        contentType: input.source.contentType,
        id: input.source.contentId
      } as const;
      const matchingLibraries = snapshot.skills.filter(
        ({ marketplaceSource }) =>
          marketplaceSource?.contentType === input.source.contentType &&
          marketplaceSource.contentId === input.source.contentId &&
          marketplaceSource.version === input.source.version
      );
      const matchingEntryLibrary = snapshot.skills.find(({ entries }) =>
        entries.some(
          ({ marketplaceSource }) =>
            marketplaceSource?.contentType === input.source.contentType &&
            marketplaceSource.contentId === input.source.contentId &&
            marketplaceSource.version === input.source.version
        )
      );
      const matchingGroup = snapshot.skillGroups.find(
        ({ marketplaceSource }) =>
          marketplaceSource?.contentType === input.source.contentType &&
          marketplaceSource.contentId === input.source.contentId &&
          marketplaceSource.version === input.source.version
      );
      if (
        matchingLibraries.length > 0 ||
        matchingEntryLibrary ||
        matchingGroup
      ) {
        const installedLibraries = matchingEntryLibrary
          ? [...matchingLibraries, matchingEntryLibrary].filter(
              (library, index, values) =>
                values.findIndex(({ id }) => id === library.id) === index
            )
          : matchingLibraries;
        return CatalogInstallMarketplaceSkillContentResultSchema.parse({
          source: sourceRef,
          version: input.source.version,
          title:
            matchingGroup?.title ?? installedLibraries[0]?.title ?? input.title,
          alreadyInstalled: true,
          libraryIds: installedLibraries.map(({ id }) => id),
          ...(matchingGroup ? { groupId: matchingGroup.id } : {})
        });
      }

      if (input.targetLibraryId) {
        if (
          input.source.contentType !== "skill" ||
          input.createGroup ||
          input.buckets.length !== 1 ||
          input.buckets[0]!.entries.length !== 1
        ) {
          throw new Error("只有单技能可以安装到已有技能库。");
        }
        const targetLibrary = snapshot.skills.find(
          ({ id }) => id === input.targetLibraryId
        );
        if (!targetLibrary || targetLibrary.isBuiltin) {
          throw new Error("目标技能库不存在或不可写。");
        }
        const bucket = input.buckets[0]!;
        const registration = findRegistration(
          registry,
          targetLibrary.id,
          "skill-library"
        );
        const projectDirectory = await secureProjectRoot(
          registration.projectDirectory
        );
        const manifest = await this.readManifest(
          projectDirectory,
          "deepwrite.skill-library",
          targetLibrary.id
        );
        const remoteEntry = bucket.entries[0]!;
        const now = this.now();
        const id = createCatalogId("skill-entry");
        const path = await uniqueRelativeMarkdownPath(
          projectDirectory,
          "entries",
          id,
          new Set(
            manifest.entries.map((entry) => portableContentPathKey(entry.path))
          )
        );
        const title = nextMarketplaceTitle(
          remoteEntry.title,
          manifest.entries.map((entry) => entry.title)
        );
        const entry = {
          id,
          stageId: remoteEntry.stageId,
          title,
          path,
          createdAt: now,
          updatedAt: now,
          marketplaceSource: {
            contentType: input.source.contentType,
            contentId: input.source.contentId,
            version: input.source.version,
            installedAt: now
          },
          sourceSkillId: remoteEntry.marketplaceSkillId
        };
        const next = FolderSkillProjectManifestSchema.parse({
          ...manifest,
          revision: manifest.revision + 1,
          updatedAt: now,
          entries: [...manifest.entries, entry]
        });
        await commitProjectMarkdownUpdate(
          await secureWritableProjectPath(projectDirectory, path),
          remoteEntry.content,
          undefined,
          join(projectDirectory, MANIFEST_FILE),
          next,
          this.maxMarkdownBytes,
          this.maxManifestBytes
        );
        await this.bumpRegistry(registry, now);
        return CatalogInstallMarketplaceSkillContentResultSchema.parse({
          source: sourceRef,
          version: input.source.version,
          title,
          alreadyInstalled: false,
          libraryIds: [targetLibrary.id]
        });
      }

      const now = this.now();
      const usedLibraryTitles = snapshot.skills.map(({ title }) => title);
      const plans: DuplicateProjectWritePlan[] = [];
      const members: SkillLibraryGroup["members"] = {};
      const libraryIds: string[] = [];
      const kindLabels: Record<
        MarketplaceInstallPackage["buckets"][number]["kind"],
        string
      > = {
        general: "通用",
        plot: "剧情",
        style: "风格",
        other: "其他"
      };

      for (const bucket of input.buckets) {
        const baseTitle =
          input.buckets.length === 1 && !input.createGroup
            ? input.title
            : `${input.title} · ${kindLabels[bucket.kind]}`;
        const title = nextMarketplaceTitle(baseTitle, usedLibraryTitles);
        usedLibraryTitles.push(title);
        const usedEntryTitles: string[] = [];
        const library = SkillLibrarySchema.parse({
          id: createCatalogId("skill"),
          title,
          skillType: bucket.libraryType,
          skillKind: bucket.kind,
          overview: input.overview,
          isBuiltin: false,
          marketplaceSource: {
            contentType: input.source.contentType,
            contentId: input.source.contentId,
            version: input.source.version,
            installedAt: now,
            ...(input.createGroup ? { bucketKind: bucket.kind } : {})
          },
          entries: bucket.entries.map((entry) => {
            const entryTitle = nextMarketplaceTitle(
              entry.title,
              usedEntryTitles
            );
            usedEntryTitles.push(entryTitle);
            return {
              id: createCatalogId("skill-entry"),
              stageId: entry.stageId,
              title: entryTitle,
              body: entry.content,
              sourceSkillId: entry.marketplaceSkillId,
              createdAt: now,
              updatedAt: now
            };
          }),
          createdAt: now,
          updatedAt: now
        });
        libraryIds.push(library.id);
        members[bucket.kind] = library.id;
        plans.push({
          domain: "skill-library",
          parentDirectory: this.defaultProjectParents["skill-library"],
          resource: library
        });
      }

      let group: SkillLibraryGroup | undefined;
      if (input.createGroup) {
        group = SkillLibraryGroupSchema.parse({
          id: createCatalogId("skill-group"),
          title: nextMarketplaceTitle(
            input.title,
            snapshot.skillGroups.map(({ title }) => title)
          ),
          members,
          marketplaceSource: {
            contentType: input.source.contentType,
            contentId: input.source.contentId,
            version: input.source.version,
            installedAt: now
          },
          createdAt: now,
          updatedAt: now
        });
        plans.push({
          domain: "skill-group",
          parentDirectory: this.defaultProjectParents["skill-group"],
          resource: group
        });
      }

      const createdProjectDirectories: string[] = [];
      const registrations: RegistryProject[] = [];
      try {
        for (const plan of plans) {
          const projectDirectory = await this.writeNewResourceProject(
            plan.domain,
            plan.parentDirectory,
            plan.resource
          );
          createdProjectDirectories.push(projectDirectory);
          registrations.push({
            id: plan.resource.id,
            domain: plan.domain,
            projectDirectory,
            registeredAt: now
          });
        }
        await this.writeRegistry({
          ...registry,
          revision: registry.revision + 1,
          updatedAt: now,
          projects: [...registry.projects, ...registrations]
        });
      } catch (error: unknown) {
        try {
          await cleanupNewProjectDirectories(createdProjectDirectories);
        } catch (cleanupError: unknown) {
          throw new AggregateError(
            [error, cleanupError],
            "技能广场安装失败，且无法完整清理未注册目录。"
          );
        }
        throw error;
      }

      return CatalogInstallMarketplaceSkillContentResultSchema.parse({
        source: sourceRef,
        version: input.source.version,
        title: group?.title ?? plans[0]!.resource.title,
        alreadyInstalled: false,
        libraryIds,
        ...(group ? { groupId: group.id } : {})
      });
    });
  }

  async removeBook(
    bookId: string
  ): Promise<{ bookId: string; deleted: boolean }> {
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
      base.creativePlotStages = mergeCreativePlotStageDefinitions(
        snapshot.creativePlotStages,
        snapshot.books.flatMap((book) => book.plotStages)
      );
      const { registry: next, createdProjectDirectories } =
        await this.writeMissingSnapshotProjects(base, snapshot);
      next.revision = snapshot.revision;
      next.updatedAt = snapshot.updatedAt;
      setLegacyImport(next, snapshot.legacyImport);
      next.sourceCatalogMigrated = true;
      next.creativePlotStages = base.creativePlotStages;
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

  private async readRegistryOptional(): Promise<
    FolderCatalogRegistry | undefined
  > {
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
    await atomicWriteJson(this.registryPath, registry, this.maxManifestBytes);
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
    const secureParent = await secureDirectory(
      parentDirectory,
      "project parent"
    );
    const finalDirectory = await availableProjectDirectory(
      secureParent,
      resource.title
    );
    const stagingDirectory = join(
      secureParent,
      `.deepwrite-project-${process.pid}-${randomHex8()}.tmp`
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
      if (domain === "book") {
        await initializeWritingContextFile(
          stagingDirectory,
          (resource as Book).bookType
        );
      }
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

  /**
   * Reads only deepwrite.json. In particular, this path must never perform a
   * legacy migration because that migration reads the legacy draft Markdown.
   */
  private async readManifestWithoutContent(
    rawProjectDirectory: string,
    expectedKind?: FolderCatalogProjectManifest["kind"],
    expectedResourceId?: string
  ): Promise<{
    projectDirectory: string;
    manifest: FolderCatalogProjectManifest;
  }> {
    const projectDirectory = await secureProjectRoot(rawProjectDirectory);
    const manifestPath = await secureExistingProjectPath(
      projectDirectory,
      MANIFEST_FILE,
      false
    );
    const text = await readRequiredUtf8File(
      manifestPath,
      this.maxManifestBytes,
      "project manifest"
    );
    const manifest = FolderCatalogProjectManifestSchema.parse(
      parseJson(text, manifestPath)
    );
    assertManifestUniqueness(manifest);
    if (expectedKind && manifest.kind !== expectedKind) {
      throw new Error(
        `项目类型不匹配：需要 ${expectedKind}，实际为 ${manifest.kind}。`
      );
    }
    if (
      expectedResourceId !== undefined &&
      manifest.id !== expectedResourceId
    ) {
      throw new Error("项目标识与注册信息不一致。");
    }
    return { projectDirectory, manifest };
  }

  private async readManifest<Kind extends FolderCatalogProjectManifest["kind"]>(
    projectDirectory: string,
    expectedKind?: Kind,
    expectedResourceId?: string
  ): Promise<Extract<FolderCatalogProjectManifest, { kind: Kind }>> {
    const root = await secureProjectRoot(projectDirectory);
    const manifestPath = await secureExistingProjectPath(
      root,
      MANIFEST_FILE,
      false
    );
    const text = await readRequiredUtf8File(
      manifestPath,
      this.maxManifestBytes,
      "project manifest"
    );
    let manifest = FolderCatalogProjectManifestSchema.parse(
      parseJson(text, manifestPath)
    );
    assertManifestUniqueness(manifest);
    await assertManifestContentFilesUnique(root, manifest);
    if (expectedKind && manifest.kind !== expectedKind) {
      throw new Error(
        `项目类型不匹配：需要 ${expectedKind}，实际为 ${manifest.kind}。`
      );
    }
    if (
      expectedResourceId !== undefined &&
      manifest.id !== expectedResourceId
    ) {
      throw new Error("项目标识与注册信息不一致。");
    }
    if (manifest.kind === "deepwrite.book" && manifest.schemaVersion === 1) {
      manifest = await migrateLegacyBookProject(
        root,
        manifest,
        text,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      assertManifestUniqueness(manifest);
      await assertManifestContentFilesUnique(root, manifest);
    } else if (
      manifest.kind === "deepwrite.book" &&
      manifest.schemaVersion === 2
    ) {
      manifest = await migrateV2BookProject(
        root,
        manifest,
        text,
        this.maxManifestBytes
      );
      assertManifestUniqueness(manifest);
      await assertManifestContentFilesUnique(root, manifest);
    } else if (
      manifest.kind === "deepwrite.book" &&
      manifest.schemaVersion === 3
    ) {
      manifest = await migrateV3BookProject(
        root,
        manifest,
        text,
        this.maxManifestBytes
      );
      assertManifestUniqueness(manifest);
      await assertManifestContentFilesUnique(root, manifest);
    }
    if (expectedKind && manifest.kind !== expectedKind) {
      throw new Error(
        `项目类型不匹配：需要 ${expectedKind}，实际为 ${manifest.kind}。`
      );
    }
    if (
      expectedResourceId !== undefined &&
      manifest.id !== expectedResourceId
    ) {
      throw new Error("项目标识与注册信息不一致。");
    }
    return manifest as Extract<FolderCatalogProjectManifest, { kind: Kind }>;
  }

  private async readCurrentBookManifest(
    projectDirectory: string,
    expectedResourceId?: string
  ): Promise<FolderCurrentBookProjectManifest> {
    const manifest = await this.readManifest(
      projectDirectory,
      "deepwrite.book",
      expectedResourceId
    );
    if (manifest.schemaVersion !== 4) {
      throw new Error("书籍项目未完成人物结构迁移。");
    }
    return manifest;
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
      throw new Error(
        `项目类型不匹配：需要 ${expectedDomain}，实际为 ${domain}。`
      );
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
    const normalizedDirectory = await secureProjectRoot(
      project.projectDirectory
    );
    const current = registry.projects.find(
      ({ id, domain }) => id === project.id && domain === project.domain
    );
    const duplicateDirectory = registry.projects.find(
      ({ projectDirectory }) =>
        resolve(projectDirectory) === normalizedDirectory
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
    const books: Book[] = [];
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
          message: error instanceof Error ? error.message : "本地项目无法读取。"
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
          books.push(opened.resource as Book);
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
    const creativePlotStages = mergeCreativePlotStageDefinitions(
      registry.creativePlotStages,
      books.flatMap((book) => book.plotStages)
    );
    if (
      !sameCreativePlotStageDefinitions(
        registry.creativePlotStages,
        creativePlotStages
      )
    ) {
      registry.creativePlotStages = creativePlotStages;
      await this.writeRegistry(registry);
    }
    const now = this.now();
    for (let index = 0; index < books.length; index += 1) {
      const book = books[index]!;
      const missing = creativePlotStages.filter(
        (stage) =>
          !book.plotStages.some((candidate) => candidate.id === stage.id)
      );
      if (missing.length === 0) continue;
      const registration = findRegistration(registry, book.id, "book");
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        book.id
      );
      let plotStages = manifest.plotStages.map((stage) => ({ ...stage }));
      let documents = manifest.documents.map((document) => ({ ...document }));
      const usedPaths = new Set(
        manifestContentItems(manifest).map(({ path }) =>
          portableContentPathKey(path)
        )
      );
      const pendingFiles: Array<{ path: string; content: string }> = [];
      for (const stage of missing) {
        if (plotStages.length >= 32) {
          throw new Error(
            `作品“${manifest.title}”的剧情结构已达上限，无法同步全局阶段。`
          );
        }
        plotStages.push({ ...stage, enabled: false });
        if (!documents.some((document) => document.id === stage.id)) {
          const path = await uniqueRelativeMarkdownPath(
            projectDirectory,
            "stages",
            stage.id,
            usedPaths
          );
          usedPaths.add(portableContentPathKey(path));
          pendingFiles.push({ path, content: "" });
          documents.push({
            id: stage.id,
            title: stage.title,
            path,
            createdAt: now,
            updatedAt: now
          });
        }
      }
      // Align titles/descriptions with the global catalog.
      plotStages = plotStages.map((stage) => {
        const definition = creativePlotStages.find(({ id }) => id === stage.id);
        return definition
          ? {
              ...stage,
              title: definition.title,
              description: definition.description
            }
          : stage;
      });
      documents = documents.map((document) => {
        const definition = creativePlotStages.find(
          ({ id }) => id === document.id
        );
        return definition ? { ...document, title: definition.title } : document;
      });
      const nextManifest = FolderCurrentBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        plotStages: BookPlotStagesSchema.parse(plotStages),
        documents,
        updatedAt: now
      });
      for (const file of pendingFiles) {
        await atomicWriteText(
          await secureWritableProjectPath(projectDirectory, file.path),
          file.content
        );
      }
      await atomicWriteJson(
        join(projectDirectory, MANIFEST_FILE),
        nextManifest,
        this.maxManifestBytes
      );
      books[index] = (await this.readProject(projectDirectory, "book", book.id))
        .resource as Book;
    }
    return CatalogSnapshotSchema.parse({
      schemaVersion: 1,
      revision: registry.revision,
      creativePlotStages,
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

  private async aggregateIndexSnapshot(
    registry: FolderCatalogRegistry
  ): Promise<CatalogIndexSnapshot> {
    const books: CatalogIndexSnapshot["books"] = [];
    const materials: CatalogIndexSnapshot["materials"] = [];
    const materialGroups: CatalogIndexSnapshot["materialGroups"] = [];
    const skills: CatalogIndexSnapshot["skills"] = [];
    const skillGroups: CatalogIndexSnapshot["skillGroups"] = [];
    const projectDiagnostics: CatalogProjectDiagnostic[] = [];

    for (const project of registry.projects) {
      try {
        const { projectDirectory, manifest } =
          await this.readManifestWithoutContent(
            project.projectDirectory,
            kindForDomain(project.domain),
            project.id
          );
        const manifestBytes = Buffer.byteLength(
          JSON.stringify(manifest),
          "utf8"
        );
        if (manifestBytes >= this.maxProjectContentBytes) {
          throw new Error(
            `项目 manifest 超过 ${this.maxProjectContentBytes} 字节项目预算。`
          );
        }
        const contentMetadataById = await inspectProjectMarkdownMetadata(
          projectDirectory,
          manifest,
          this.maxMarkdownBytes,
          this.maxProjectContentBytes - manifestBytes
        );
        const resource = indexResourceFromManifest(
          manifest,
          contentMetadataById
        );
        switch (project.domain) {
          case "book":
            books.push(resource as CatalogIndexSnapshot["books"][number]);
            break;
          case "material-library":
            materials.push(
              resource as CatalogIndexSnapshot["materials"][number]
            );
            break;
          case "material-group":
            materialGroups.push(
              resource as CatalogIndexSnapshot["materialGroups"][number]
            );
            break;
          case "skill-library":
            skills.push(resource as CatalogIndexSnapshot["skills"][number]);
            break;
          case "skill-group":
            skillGroups.push(
              resource as CatalogIndexSnapshot["skillGroups"][number]
            );
            break;
        }
      } catch (error: unknown) {
        projectDiagnostics.push({
          projectId: project.id,
          kind: kindForDomain(project.domain),
          code:
            isNodeError(error, "ENOENT") || isNodeError(error, "ENOTDIR")
              ? "unavailable"
              : "invalid",
          message: error instanceof Error ? error.message : "本地项目无法读取。"
        });
      }
    }

    const creativePlotStages = mergeCreativePlotStageDefinitions(
      registry.creativePlotStages,
      books.flatMap((book) => book.plotStages)
    );
    return CatalogIndexSnapshotSchema.parse({
      schemaVersion: 1,
      revision: registry.revision,
      creativePlotStages,
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

  private async mutate<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
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

function duplicateBookResource(source: Book, title: string, now: string): Book {
  const { projectRevision: _projectRevision, ...copyable } = source;
  return BookSchema.parse({
    ...structuredClone(copyable),
    id: createCatalogId("book"),
    title,
    createdAt: now,
    updatedAt: now
  });
}

function duplicateLibraryResource(
  source: MaterialLibrary,
  title: string,
  now: string
): MaterialLibrary;
function duplicateLibraryResource(
  source: SkillLibrary,
  title: string,
  now: string
): SkillLibrary;
function duplicateLibraryResource(
  source: MaterialLibrary | SkillLibrary,
  title: string,
  now: string
): MaterialLibrary | SkillLibrary;
function duplicateLibraryResource(
  source: MaterialLibrary | SkillLibrary,
  title: string,
  now: string
): MaterialLibrary | SkillLibrary {
  const { projectRevision: _projectRevision, ...copyable } = source;
  if ("materialType" in copyable) {
    return MaterialLibrarySchema.parse({
      ...structuredClone(copyable),
      id: createCatalogId("material"),
      title,
      createdAt: now,
      updatedAt: now
    });
  }
  return SkillLibrarySchema.parse({
    ...structuredClone(copyable),
    id: createCatalogId("skill"),
    title,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now
  });
}

function nextMarketplaceTitle(
  baseTitle: string,
  existingTitles: readonly string[]
): string {
  const normalized = new Set(
    existingTitles.map((title) => title.trim().toLocaleLowerCase())
  );
  if (!normalized.has(baseTitle.trim().toLocaleLowerCase())) return baseTitle;
  let suffix = 2;
  while (
    normalized.has(`${baseTitle} (${suffix})`.trim().toLocaleLowerCase())
  ) {
    suffix += 1;
  }
  return `${baseTitle} (${suffix})`;
}

const DEFAULT_SHORT_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["worldbuilding", "世界观"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["narrative_perspective", "叙事视角"],
  ["outline", "大纲"]
] as const;

const DEFAULT_SCRIPT_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["worldbuilding", "世界观"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["narrative_perspective", "叙事视角"],
  ["outline", "大纲"]
] as const;

function linkedMaterialIdsFromInput(
  value:
    | CreateShortBookInput["linkedMaterialIdsByKind"]
    | CreateScriptBookInput["linkedMaterialIdsByKind"]
): Book["linkedMaterialIdsByKind"] {
  return {
    character: [...(value?.character ?? [])],
    gimmick: [...(value?.gimmick ?? [])],
    plot: [...(value?.plot ?? [])],
    draft: [...(value?.draft ?? [])],
    other: [...(value?.other ?? [])]
  };
}

function linkedSkillIdsFromInput(
  value:
    | CreateShortBookInput["linkedSkillIdsByKind"]
    | CreateScriptBookInput["linkedSkillIdsByKind"]
): Book["linkedSkillIdsByKind"] {
  return {
    general: [...(value?.general ?? [])],
    plot: [...(value?.plot ?? [])],
    style: [...(value?.style ?? [])],
    other: [...(value?.other ?? [])]
  };
}

const DRAFT_CHARACTER_STATE_TITLE_SUFFIX = " · 人物状态";
const CATALOG_TITLE_MAX_LENGTH = 256;

function draftCharacterStateTitle(sectionTitle: string): string {
  const availableSectionTitleLength =
    CATALOG_TITLE_MAX_LENGTH - DRAFT_CHARACTER_STATE_TITLE_SUFFIX.length;
  return `${sectionTitle.slice(0, availableSectionTitleLength)}${DRAFT_CHARACTER_STATE_TITLE_SUFFIX}`;
}

function findDraftDocumentManifest(
  draft: FolderCurrentBookProjectManifest["draft"],
  documentId: string
): { sectionIndex: number; kind: "body" | "characterState" } | undefined {
  for (const [sectionIndex, section] of draft.sections.entries()) {
    if (section.body.id === documentId) {
      return { sectionIndex, kind: "body" };
    }
    if (section.characterState.id === documentId) {
      return { sectionIndex, kind: "characterState" };
    }
  }
  return undefined;
}

function findManifestDocument(
  manifest: FolderCatalogProjectManifest,
  documentId: string
):
  | {
      id: string;
      title: string;
      path: string;
      updatedAt: string;
    }
  | undefined {
  if (manifest.kind === "deepwrite.book") {
    const document = manifest.documents.find(({ id }) => id === documentId);
    if (document) return document;
    if (manifest.schemaVersion === 1) return undefined;
    const draftDocument = findDraftDocumentManifest(manifest.draft, documentId);
    if (!draftDocument) return undefined;
    const section = manifest.draft.sections[draftDocument.sectionIndex]!;
    return draftDocument.kind === "body"
      ? section.body
      : section.characterState;
  }
  if (
    manifest.kind === "deepwrite.material-library" ||
    manifest.kind === "deepwrite.skill-library"
  ) {
    return manifest.entries.find(({ id }) => id === documentId);
  }
  return undefined;
}

function isReservedDraftDocumentId(documentId: string): boolean {
  return (
    documentId.startsWith("draft-section:") &&
    (documentId.endsWith(":body") || documentId.endsWith(":character-state"))
  );
}

function nextDraftSectionId(
  bookType: Book["bookType"],
  sectionIds: readonly string[],
  documentIds: ReadonlySet<string>
): string {
  const usedSections = new Set(sectionIds);
  const prefix = bookType === "script" ? "episode" : "section";
  const numericPattern =
    bookType === "script" ? /^episode-(\d+)$/u : /^section-(\d+)$/u;
  const highest = sectionIds.reduce((value, sectionId) => {
    const numeric = numericPattern.exec(sectionId)?.[1];
    return numeric ? Math.max(value, Number(numeric)) : value;
  }, 0);
  let sectionNumber = highest + 1;
  while (true) {
    const sectionId = `${prefix}-${sectionNumber}`;
    if (
      !usedSections.has(sectionId) &&
      !documentIds.has(catalogDraftBodyDocumentId(sectionId)) &&
      !documentIds.has(catalogDraftCharacterStateDocumentId(sectionId))
    ) {
      return sectionId;
    }
    sectionNumber += 1;
  }
}

function chineseSectionNumber(value: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value]!;
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}`;
  }
  return String(value);
}

function defaultDraftSectionTitle(
  bookType: Book["bookType"],
  sectionId: string,
  index: number
): string {
  if (bookType === "short" && sectionId === "intro") return "导语";
  const numeric = (
    bookType === "script" ? /^episode-(\d+)$/u : /^section-(\d+)$/u
  ).exec(sectionId)?.[1];
  return `第${chineseSectionNumber(numeric ? Number(numeric) : index + 1)}${
    bookType === "script" ? "集" : "节"
  }`;
}

function createDraftSectionsRequestHash(
  input: CreateDraftSectionsInput
): string {
  // Concurrency guards are intentionally excluded: a retry after a successful
  // commit must resolve to the original mapping even though the project
  // revision has advanced.
  const intent = {
    bookId: input.bookId,
    afterSectionId: input.afterSectionId ?? null,
    sections: input.sections.map((section) => ({
      clientSectionId: section.clientSectionId,
      title: section.title ?? null,
      wordCountRequirement: section.wordCountRequirement ?? null
    }))
  };
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

async function hydrateDraftSectionCreationResult(
  projectDirectory: string,
  manifest: FolderCurrentBookProjectManifest,
  operationId: string,
  operationSections: ReadonlyArray<{
    clientSectionId: string;
    sectionId: string;
  }>,
  maxMarkdownBytes: number,
  maxProjectContentBytes: number
): Promise<CreateDraftSectionsResult> {
  const sections = operationSections.map(({ sectionId }) => {
    const section = manifest.draft.sections.find(({ id }) => id === sectionId);
    if (!section) {
      throw new Error(
        `批量创建操作 ${operationId} 对应的正文小节已被删除：${sectionId}`
      );
    }
    return section;
  });
  const contents = await readProjectMarkdownContents(
    projectDirectory,
    sections.flatMap((section) => [section.body, section.characterState]),
    maxMarkdownBytes,
    maxProjectContentBytes
  );
  return CreateDraftSectionsResultSchema.parse({
    operationId,
    bookId: manifest.id,
    projectRevision: manifest.revision,
    sections: operationSections.map(({ clientSectionId }, index) => {
      const section = sections[index]!;
      return {
        clientSectionId,
        section: {
          id: section.id,
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          body: {
            id: section.body.id,
            title: section.body.title,
            content: contents[index * 2]!,
            createdAt: section.body.createdAt,
            updatedAt: section.body.updatedAt
          },
          characterState: {
            id: section.characterState.id,
            title: section.characterState.title,
            content: contents[index * 2 + 1]!,
            createdAt: section.characterState.createdAt,
            updatedAt: section.characterState.updatedAt
          },
          createdAt: section.createdAt,
          updatedAt: section.updatedAt
        }
      };
    })
  });
}

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
    creativePlotStages: createDefaultCreativePlotStages(),
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
    throw new Error(
      "Catalog registry revision must be a non-negative integer."
    );
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
      throw new Error(
        `Catalog registry project ${index} has an invalid domain.`
      );
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
    new Set(projects.map(({ id, domain }) => registryProjectKey(domain, id)))
      .size !== projects.length
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
  const creativePlotStages =
    Array.isArray(value.creativePlotStages) &&
    value.creativePlotStages.length > 0
      ? CreativePlotStagesSchema.parse(value.creativePlotStages)
      : createDefaultCreativePlotStages();
  return {
    schemaVersion: 1,
    revision,
    updatedAt,
    sourceCatalogMigrated: value.sourceCatalogMigrated,
    creativePlotStages,
    projects,
    ...(legacyImport === undefined ? {} : { legacyImport })
  };
}

function mergeCreativePlotStageDefinitions(
  ...groups: ReadonlyArray<
    ReadonlyArray<{ id: string; title: string; description: string }>
  >
): CreativePlotStage[] {
  const definitions = new Map<string, CreativePlotStage>();
  for (const group of groups) {
    for (const stage of group) {
      if (!definitions.has(stage.id)) {
        definitions.set(stage.id, {
          id: stage.id,
          title: stage.title,
          description: stage.description
        });
      }
    }
  }
  for (const stage of createDefaultCreativePlotStages()) {
    if (!definitions.has(stage.id)) definitions.set(stage.id, stage);
  }
  return CreativePlotStagesSchema.parse([...definitions.values()]);
}

function sameCreativePlotStageDefinitions(
  left: readonly CreativePlotStage[],
  right: readonly CreativePlotStage[]
): boolean {
  if (left.length !== right.length) return false;
  const rightById = new Map(right.map((stage) => [stage.id, stage]));
  return left.every((stage) => {
    const other = rightById.get(stage.id);
    return (
      other !== undefined &&
      other.title === stage.title &&
      other.description === stage.description
    );
  });
}

function applyGlobalPlotStagesToNewBook<Resource extends Book>(
  book: Resource,
  globalStages: readonly CreativePlotStage[],
  defaultPlotStageIds?: readonly string[]
): Resource {
  const definitions =
    globalStages.length > 0
      ? mergeCreativePlotStageDefinitions(globalStages)
      : createDefaultCreativePlotStages();
  const existingDocuments = new Map(
    book.documents.map((document) => [document.id, document])
  );
  const existingStages = new Map(
    book.plotStages.map((stage) => [stage.id, stage])
  );
  const configuredStageIds = defaultPlotStageIds
    ? new Set(defaultPlotStageIds)
    : undefined;
  const plotStages: BookPlotStage[] = definitions.map((stage) => ({
    ...stage,
    enabled:
      configuredStageIds?.has(stage.id) ??
      existingStages.get(stage.id)?.enabled ??
      DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS.has(stage.id)
  }));
  const documents = [
    ...(existingDocuments.get("character_design")
      ? [existingDocuments.get("character_design")!]
      : []),
    ...plotStages.map((stage) => {
      const existing = existingDocuments.get(stage.id);
      return {
        id: stage.id,
        title: stage.title,
        content: existing?.content ?? "",
        createdAt: existing?.createdAt ?? book.createdAt,
        updatedAt: existing?.updatedAt ?? book.updatedAt
      };
    }),
    ...book.documents.filter(
      (document) =>
        document.id !== "character_design" &&
        !plotStages.some((stage) => stage.id === document.id)
    )
  ];
  return {
    ...book,
    plotStages,
    documents
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
    throw new Error(
      "deletable project domain must be book, material, or skill."
    );
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

function manifestContentItems(
  manifest: FolderCatalogProjectManifest
): Array<{ id: string; path: string }> {
  if (manifest.kind === "deepwrite.book") {
    return manifest.schemaVersion !== 1
      ? [
          ...manifest.documents,
          ...manifest.draft.sections.flatMap((section) => [
            section.body,
            section.characterState
          ])
        ]
      : [...manifest.documents];
  }
  if (
    manifest.kind === "deepwrite.material-library" ||
    manifest.kind === "deepwrite.skill-library"
  ) {
    return [...manifest.entries];
  }
  return [];
}

function assertManifestUniqueness(
  manifest: FolderCatalogProjectManifest
): void {
  const items = manifestContentItems(manifest);
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    throw new Error("Project manifest content ids must be unique.");
  }
  if (
    new Set(items.map(({ path }) => portableContentPathKey(path))).size !==
    items.length
  ) {
    throw new Error("Project manifest content paths must be unique.");
  }
}

async function assertManifestContentFilesUnique(
  projectDirectory: string,
  manifest: FolderCatalogProjectManifest
): Promise<void> {
  const items = manifestContentItems(manifest);
  const identities = new Set<string>();
  for (const item of items) {
    const actualPath = await secureExistingProjectPath(
      projectDirectory,
      item.path,
      true
    );
    const info = await stat(actualPath, { bigint: true });
    const identity = projectTransactionFileIdentity(info);
    if (identities.has(identity)) {
      throw new Error(
        "Project manifest content paths must resolve to distinct files."
      );
    }
    identities.add(identity);
  }
}

/**
 * Resolve and stat every Markdown file without opening it. The returned byte
 * counts power the metadata-only index and the inode identity check prevents
 * aliases from making two manifest entries point at the same file.
 */
async function inspectProjectMarkdownMetadata(
  projectDirectory: string,
  manifest: FolderCatalogProjectManifest,
  maxMarkdownBytes: number,
  maxProjectContentBytes: number
): Promise<ReadonlyMap<string, CatalogContentMetadata>> {
  const items = manifestContentItems(manifest);
  const identities = new Set<string>();
  const contentMetadataById = new Map<string, CatalogContentMetadata>();
  const markdownLimit = BigInt(maxMarkdownBytes);
  const projectLimit = BigInt(maxProjectContentBytes);
  let totalBytes = 0n;
  for (const item of items) {
    const actualPath = await secureExistingProjectPath(
      projectDirectory,
      item.path,
      true
    );
    const info = await stat(actualPath, { bigint: true });
    if (info.size > markdownLimit) {
      throw new Error(
        `Markdown file exceeds the ${maxMarkdownBytes} byte limit.`
      );
    }
    totalBytes += info.size;
    if (totalBytes > projectLimit) {
      throw new Error(
        `项目 Markdown 总量超过 ${maxProjectContentBytes} 字节安全上限。`
      );
    }
    const identity = projectTransactionFileIdentity(info);
    if (identities.has(identity)) {
      throw new Error(
        "Project manifest content paths must resolve to distinct files."
      );
    }
    identities.add(identity);
    contentMetadataById.set(item.id, {
      contentBytes: Number(info.size),
      contentStamp: `fs-v1:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
    });
  }
  return contentMetadataById;
}

function isCreateAtDirectoryInput(
  value: CreateShortBookInput | CreateShortBookAtDirectoryInput
): value is CreateShortBookAtDirectoryInput {
  return "input" in value;
}

function isCreateScriptAtDirectoryInput(
  value: CreateScriptBookInput | CreateScriptBookAtDirectoryInput
): value is CreateScriptBookAtDirectoryInput {
  return "input" in value;
}

function assertBookLibraryReferences(
  book: Pick<
    Book,
    "title" | "bookType" | "linkedMaterialIdsByKind" | "linkedSkillIdsByKind"
  >,
  snapshot: Pick<CatalogSnapshot, "materials" | "skills">
): void {
  const materials = new Map(
    snapshot.materials.map((material) => [material.id, material])
  );
  const skills = new Map(snapshot.skills.map((skill) => [skill.id, skill]));
  for (const [kind, materialIds] of Object.entries(
    book.linkedMaterialIdsByKind
  )) {
    for (const materialId of materialIds) {
      const material = materials.get(materialId);
      if (!material) {
        throw new Error(
          `书籍「${book.title}」关联了不存在的素材库：${materialId}`
        );
      }
      if (material.materialKind !== "mixed" && material.materialKind !== kind) {
        throw new Error(`素材库「${material.title}」不能关联到 ${kind} 分类。`);
      }
    }
  }
  for (const [kind, skillIds] of Object.entries(book.linkedSkillIdsByKind)) {
    for (const skillId of skillIds) {
      const skill = skills.get(skillId);
      if (!skill) {
        throw new Error(
          `书籍「${book.title}」绑定了不存在的技能库：${skillId}`
        );
      }
      if (skill.skillKind !== kind) {
        throw new Error(`技能库「${skill.title}」不能绑定到 ${kind} 分类。`);
      }
    }
  }
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
  const selected = libraryIds.filter((libraryId): libraryId is string =>
    Boolean(libraryId)
  );
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
      group.id !== currentGroupId &&
      Object.values(group.members).includes(libraryId)
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

async function migrateLegacyBookProject(
  projectDirectory: string,
  manifest: FolderLegacyBookProjectManifest,
  originalManifestText: string,
  maxMarkdownBytes: number,
  maxManifestBytes: number
): Promise<FolderCurrentBookProjectManifest> {
  const exactDraftIndex = manifest.documents.findIndex(
    (document) => document.id === "draft"
  );
  const draftIndex =
    exactDraftIndex >= 0
      ? exactDraftIndex
      : manifest.documents.findIndex(
          (document) => document.title === "正文编写"
        );
  const draftManifest =
    draftIndex >= 0 ? manifest.documents[draftIndex] : undefined;
  const legacyDraft = draftManifest
    ? {
        id: draftManifest.id,
        title: draftManifest.title,
        content: await readProjectMarkdown(
          projectDirectory,
          draftManifest.path,
          maxMarkdownBytes
        ),
        createdAt: draftManifest.createdAt,
        updatedAt: draftManifest.updatedAt
      }
    : undefined;
  const draft = migrateCatalogDraftDocument(
    legacyDraft,
    manifest.createdAt,
    manifest.updatedAt
  );
  const documents = manifest.documents.filter(
    (_, index) => index !== draftIndex
  );
  const usedPaths = new Set(
    manifest.documents.map(({ path }) => portableContentPathKey(path))
  );
  const pendingFiles: Array<{ path: string; content: string }> = [];
  const sections: BookProjectDraftSectionManifest[] = [];
  for (const section of draft.sections) {
    assertTextByteLength(
      section.body.content,
      maxMarkdownBytes,
      "Draft body Markdown content"
    );
    assertTextByteLength(
      section.characterState.content,
      maxMarkdownBytes,
      "Draft character-state Markdown content"
    );
    const bodyPath = await uniqueRelativeMarkdownPathWithSuffix(
      projectDirectory,
      "stages/draft",
      section.id,
      ".body.md",
      usedPaths
    );
    usedPaths.add(portableContentPathKey(bodyPath));
    const characterStatePath = await uniqueRelativeMarkdownPathWithSuffix(
      projectDirectory,
      "stages/draft",
      section.id,
      ".state.md",
      usedPaths
    );
    usedPaths.add(portableContentPathKey(characterStatePath));
    pendingFiles.push(
      { path: bodyPath, content: section.body.content },
      { path: characterStatePath, content: section.characterState.content }
    );
    sections.push({
      id: section.id,
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      body: {
        id: section.body.id,
        title: section.body.title,
        path: bodyPath,
        createdAt: section.body.createdAt,
        updatedAt: section.body.updatedAt
      },
      characterState: {
        id: section.characterState.id,
        title: section.characterState.title,
        path: characterStatePath,
        createdAt: section.characterState.createdAt,
        updatedAt: section.characterState.updatedAt
      },
      createdAt: section.createdAt,
      updatedAt: section.updatedAt
    });
  }
  const plotStages = createDefaultBookPlotStages({ allEnabled: true });
  for (const stage of plotStages) {
    const documentIndex = documents.findIndex(({ id }) => id === stage.id);
    if (documentIndex >= 0) {
      documents[documentIndex] = {
        ...documents[documentIndex]!,
        title: stage.title
      };
      continue;
    }
    const path = await uniqueRelativeMarkdownPath(
      projectDirectory,
      "stages",
      stage.id,
      usedPaths
    );
    usedPaths.add(portableContentPathKey(path));
    pendingFiles.push({ path, content: "" });
    documents.push({
      id: stage.id,
      title: stage.title,
      path,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt
    });
  }
  await appendMissingCharacterOverviewDocument({
    projectDirectory,
    documents,
    usedPaths,
    pendingFiles,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  });
  const next = FolderCurrentBookProjectManifestSchema.parse({
    ...manifest,
    schemaVersion: 4,
    characterStructure: createDefaultBookCharacterStructure(),
    plotStages,
    documents,
    draft: {
      id: draft.id,
      title: draft.title,
      sections,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt
    }
  });
  assertJsonByteLength(next, maxManifestBytes);

  // The v1 manifest remains authoritative until every new file is committed.
  // A failure or process stop before the final manifest rename can at worst
  // leave unreferenced recovery files; the original draft.md is never removed.
  for (const file of pendingFiles) {
    const target = await secureWritableProjectPath(projectDirectory, file.path);
    await atomicWriteText(target, file.content);
  }
  const currentManifestText = await readRequiredUtf8File(
    join(projectDirectory, MANIFEST_FILE),
    maxManifestBytes,
    "project manifest"
  );
  const currentLegacyDraftContent = draftManifest
    ? await readProjectMarkdown(
        projectDirectory,
        draftManifest.path,
        maxMarkdownBytes
      )
    : undefined;
  assertLegacyBookMigrationSourcesUnchanged({
    originalManifestText,
    currentManifestText,
    originalLegacyDraftContent: legacyDraft?.content,
    currentLegacyDraftContent
  });
  await atomicWriteJson(
    join(projectDirectory, MANIFEST_FILE),
    next,
    maxManifestBytes
  );
  return next;
}

async function migrateV2BookProject(
  projectDirectory: string,
  manifest: V2BookProjectManifest,
  originalManifestText: string,
  maxManifestBytes: number
): Promise<FolderCurrentBookProjectManifest> {
  const plotStages = createDefaultBookPlotStages({ allEnabled: true });
  const documents = manifest.documents.map((document) => ({ ...document }));
  const usedPaths = new Set(
    [
      ...manifest.documents,
      ...manifest.draft.sections.flatMap((section) => [
        section.body,
        section.characterState
      ])
    ].map(({ path }) => portableContentPathKey(path))
  );
  const pendingFiles: Array<{ path: string; content: string }> = [];

  for (const stage of plotStages) {
    const documentIndex = documents.findIndex(({ id }) => id === stage.id);
    if (documentIndex >= 0) {
      documents[documentIndex] = {
        ...documents[documentIndex]!,
        title: stage.title
      };
      continue;
    }
    const path = await uniqueRelativeMarkdownPath(
      projectDirectory,
      "stages",
      stage.id,
      usedPaths
    );
    usedPaths.add(portableContentPathKey(path));
    pendingFiles.push({ path, content: "" });
    documents.push({
      id: stage.id,
      title: stage.title,
      path,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt
    });
  }

  await appendMissingCharacterOverviewDocument({
    projectDirectory,
    documents,
    usedPaths,
    pendingFiles,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  });

  const next = FolderCurrentBookProjectManifestSchema.parse({
    ...manifest,
    schemaVersion: 4,
    characterStructure: createDefaultBookCharacterStructure(),
    plotStages,
    documents
  });
  assertJsonByteLength(next, maxManifestBytes);

  // v2 remains authoritative until every missing stage document is durable.
  for (const file of pendingFiles) {
    const target = await secureWritableProjectPath(projectDirectory, file.path);
    await atomicWriteText(target, file.content);
  }
  const currentManifestText = await readRequiredUtf8File(
    join(projectDirectory, MANIFEST_FILE),
    maxManifestBytes,
    "project manifest"
  );
  if (currentManifestText !== originalManifestText) {
    throw new Error("书籍在剧情结构迁移期间被外部修改，已中止迁移。");
  }
  await atomicWriteJson(
    join(projectDirectory, MANIFEST_FILE),
    next,
    maxManifestBytes
  );
  return next;
}

async function migrateV3BookProject(
  projectDirectory: string,
  manifest: V3BookProjectManifest,
  originalManifestText: string,
  maxManifestBytes: number
): Promise<FolderCurrentBookProjectManifest> {
  const documents = manifest.documents.map((document) => ({ ...document }));
  const usedPaths = new Set(
    manifestContentItems(manifest).map(({ path }) =>
      portableContentPathKey(path)
    )
  );
  const pendingFiles: Array<{ path: string; content: string }> = [];
  await appendMissingCharacterOverviewDocument({
    projectDirectory,
    documents,
    usedPaths,
    pendingFiles,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  });
  const next = FolderCurrentBookProjectManifestSchema.parse({
    ...manifest,
    schemaVersion: 4,
    characterStructure: createDefaultBookCharacterStructure(),
    documents
  });
  assertJsonByteLength(next, maxManifestBytes);
  for (const file of pendingFiles) {
    const target = await secureWritableProjectPath(projectDirectory, file.path);
    await atomicWriteText(target, file.content);
  }
  const currentManifestText = await readRequiredUtf8File(
    join(projectDirectory, MANIFEST_FILE),
    maxManifestBytes,
    "project manifest"
  );
  if (currentManifestText !== originalManifestText) {
    throw new Error("书籍在人物结构迁移期间被外部修改，已中止迁移。");
  }
  await atomicWriteJson(
    join(projectDirectory, MANIFEST_FILE),
    next,
    maxManifestBytes
  );
  return next;
}

async function appendMissingCharacterOverviewDocument(input: {
  projectDirectory: string;
  documents: BookProjectDocumentManifest[];
  usedPaths: Set<string>;
  pendingFiles: Array<{ path: string; content: string }>;
  createdAt: string;
  updatedAt: string;
}): Promise<void> {
  if (
    input.documents.some(({ id }) => id === BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID)
  ) {
    return;
  }
  const path = await uniqueRelativeMarkdownPath(
    input.projectDirectory,
    "stages",
    BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID,
    input.usedPaths
  );
  input.usedPaths.add(portableContentPathKey(path));
  input.pendingFiles.push({ path, content: "" });
  input.documents.push({
    id: BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID,
    title: "人物设计",
    path,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  });
}

export function assertLegacyBookMigrationSourcesUnchanged(input: {
  originalManifestText: string;
  currentManifestText: string;
  originalLegacyDraftContent: string | undefined;
  currentLegacyDraftContent: string | undefined;
}): void {
  if (
    input.originalManifestText !== input.currentManifestText ||
    input.originalLegacyDraftContent !== input.currentLegacyDraftContent
  ) {
    throw new Error("旧版书籍在正文迁移期间被外部修改，已中止迁移。");
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
      const book = resource as Book;
      const used = new Set<string>();
      const documents: BookProjectDocumentManifest[] = [];
      for (const document of book.documents) {
        assertTextByteLength(
          document.content,
          maxMarkdownBytes,
          "Markdown content"
        );
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
      const sections: BookProjectDraftSectionManifest[] = [];
      for (const section of book.draft.sections) {
        assertTextByteLength(
          section.body.content,
          maxMarkdownBytes,
          "Draft body Markdown content"
        );
        assertTextByteLength(
          section.characterState.content,
          maxMarkdownBytes,
          "Draft character-state Markdown content"
        );
        const bodyPath = await uniqueRelativeMarkdownPathWithSuffix(
          projectDirectory,
          "stages/draft",
          section.id,
          ".body.md",
          used
        );
        used.add(portableContentPathKey(bodyPath));
        const characterStatePath = await uniqueRelativeMarkdownPathWithSuffix(
          projectDirectory,
          "stages/draft",
          section.id,
          ".state.md",
          used
        );
        used.add(portableContentPathKey(characterStatePath));
        await atomicWriteText(
          join(projectDirectory, bodyPath),
          section.body.content
        );
        await atomicWriteText(
          join(projectDirectory, characterStatePath),
          section.characterState.content
        );
        sections.push({
          id: section.id,
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          body: {
            id: section.body.id,
            title: section.body.title,
            path: bodyPath,
            createdAt: section.body.createdAt,
            updatedAt: section.body.updatedAt
          },
          characterState: {
            id: section.characterState.id,
            title: section.characterState.title,
            path: characterStatePath,
            createdAt: section.characterState.createdAt,
            updatedAt: section.characterState.updatedAt
          },
          createdAt: section.createdAt,
          updatedAt: section.updatedAt
        });
      }
      return FolderCurrentBookProjectManifestSchema.parse({
        ...common,
        schemaVersion: 4,
        kind: kindForDomain(domain),
        bookType: book.bookType,
        genre: book.genre,
        status: book.status,
        linkedMaterialIdsByKind: book.linkedMaterialIdsByKind,
        linkedSkillIdsByKind: book.linkedSkillIdsByKind,
        characterStructure: book.characterStructure,
        plotStages: book.plotStages,
        documents,
        draft: {
          id: book.draft.id,
          title: book.draft.title,
          sections,
          createdAt: book.draft.createdAt,
          updatedAt: book.draft.updatedAt
        }
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
          ...(entry.marketplaceSource
            ? { marketplaceSource: entry.marketplaceSource }
            : {}),
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
        ...(skill.marketplaceSource
          ? { marketplaceSource: skill.marketplaceSource }
          : {}),
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
        members: group.members,
        ...(group.marketplaceSource
          ? { marketplaceSource: group.marketplaceSource }
          : {})
      });
    }
  }
}

function emptyContentMetadata(updatedAt: string): CatalogContentMetadata {
  return {
    contentBytes: 0,
    contentStamp: `manifest-v1:0:${updatedAt}`
  };
}

function manifestContentStamp(content: string, updatedAt: string): string {
  return `manifest-v1:${Buffer.byteLength(content, "utf8")}:${updatedAt}`;
}

function indexBookFromManifest(
  manifest: FolderBookProjectManifest,
  contentMetadataById: ReadonlyMap<string, CatalogContentMetadata>
): CatalogIndexSnapshot["books"][number] {
  const bookInput = {
    id: manifest.id,
    title: manifest.title,
    bookType: manifest.bookType,
    genre: manifest.genre,
    status: manifest.status,
    linkedMaterialIdsByKind: manifest.linkedMaterialIdsByKind,
    linkedSkillIdsByKind: manifest.linkedSkillIdsByKind,
    projectRevision: manifest.revision,
    documents: manifest.documents.map((document) => ({
      id: document.id,
      title: document.title,
      content: "",
      createdAt: document.createdAt,
      updatedAt: document.updatedAt
    })),
    ...(manifest.schemaVersion === 1
      ? {}
      : {
          draft: {
            id: manifest.draft.id,
            title: manifest.draft.title,
            sections: manifest.draft.sections.map((section) => ({
              id: section.id,
              title: section.title,
              wordCountRequirement: section.wordCountRequirement,
              body: {
                id: section.body.id,
                title: section.body.title,
                content: "",
                createdAt: section.body.createdAt,
                updatedAt: section.body.updatedAt
              },
              characterState: {
                id: section.characterState.id,
                title: section.characterState.title,
                content: "",
                createdAt: section.characterState.createdAt,
                updatedAt: section.characterState.updatedAt
              },
              createdAt: section.createdAt,
              updatedAt: section.updatedAt
            })),
            createdAt: manifest.draft.createdAt,
            updatedAt: manifest.draft.updatedAt
          }
        }),
    ...(manifest.schemaVersion === 3 || manifest.schemaVersion === 4
      ? { plotStages: manifest.plotStages }
      : {}),
    ...(manifest.schemaVersion === 4
      ? { characterStructure: manifest.characterStructure }
      : {}),
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  };
  const book = BookSchema.parse(bookInput);
  const legacyDraft =
    manifest.schemaVersion === 1
      ? manifest.documents.find(
          (document) =>
            document.id === CATALOG_DRAFT_DIRECTORY_ID ||
            document.title === "正文编写"
        )
      : undefined;
  const legacyDraftMetadata = legacyDraft
    ? contentMetadataById.get(legacyDraft.id)
    : undefined;
  return CatalogIndexBookSchema.parse({
    ...book,
    documents: book.documents.map((document) => ({
      ...document,
      content: "",
      ...(contentMetadataById.get(document.id) ??
        emptyContentMetadata(document.updatedAt))
    })),
    draft: {
      ...book.draft,
      sections: book.draft.sections.map((section, sectionIndex) => ({
        ...section,
        body: {
          ...section.body,
          content: "",
          ...(contentMetadataById.get(section.body.id) ??
            (sectionIndex === 0 ? legacyDraftMetadata : undefined) ??
            emptyContentMetadata(section.body.updatedAt))
        },
        characterState: {
          ...section.characterState,
          content: "",
          ...(contentMetadataById.get(section.characterState.id) ??
            emptyContentMetadata(section.characterState.updatedAt))
        }
      }))
    }
  });
}

function indexResourceFromManifest(
  manifest: FolderCatalogProjectManifest,
  contentMetadataById: ReadonlyMap<string, CatalogContentMetadata>
):
  | CatalogIndexSnapshot["books"][number]
  | CatalogIndexSnapshot["materials"][number]
  | CatalogIndexSnapshot["materialGroups"][number]
  | CatalogIndexSnapshot["skills"][number]
  | CatalogIndexSnapshot["skillGroups"][number] {
  switch (manifest.kind) {
    case "deepwrite.book":
      return indexBookFromManifest(manifest, contentMetadataById);
    case "deepwrite.material-library":
      return {
        id: manifest.id,
        title: manifest.title,
        materialType: manifest.materialType,
        materialKind: manifest.materialKind,
        parentGenre: manifest.parentGenre,
        subGenre: manifest.subGenre,
        overview: "",
        overviewContentBytes: Buffer.byteLength(manifest.overview, "utf8"),
        overviewContentStamp: manifestContentStamp(
          manifest.overview,
          manifest.updatedAt
        ),
        projectRevision: manifest.revision,
        entries: manifest.entries.map((entry) => ({
          id: entry.id,
          stageId: entry.stageId,
          title: entry.title,
          body: "",
          ...(contentMetadataById.get(entry.id) ??
            emptyContentMetadata(entry.updatedAt)),
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt
        })),
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
    case "deepwrite.skill-library":
      return {
        id: manifest.id,
        title: manifest.title,
        skillType: manifest.skillType,
        skillKind: manifest.skillKind,
        overview: "",
        overviewContentBytes: Buffer.byteLength(manifest.overview, "utf8"),
        overviewContentStamp: manifestContentStamp(
          manifest.overview,
          manifest.updatedAt
        ),
        isBuiltin: manifest.isBuiltin,
        ...(manifest.marketplaceSource
          ? { marketplaceSource: manifest.marketplaceSource }
          : {}),
        projectRevision: manifest.revision,
        entries: manifest.entries.map((entry) => ({
          id: entry.id,
          stageId: entry.stageId,
          title: entry.title,
          body: "",
          ...(contentMetadataById.get(entry.id) ??
            emptyContentMetadata(entry.updatedAt)),
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          ...(entry.marketplaceSource
            ? { marketplaceSource: entry.marketplaceSource }
            : {}),
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
        ...(manifest.marketplaceSource
          ? { marketplaceSource: manifest.marketplaceSource }
          : {}),
        projectRevision: manifest.revision,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
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
      if (manifest.schemaVersion !== 4) {
        throw new Error("书籍项目未完成正文目录迁移。");
      }
      const draftFiles = manifest.draft.sections.flatMap((section) => [
        section.body,
        section.characterState
      ]);
      const contents = await readProjectMarkdownContents(
        projectDirectory,
        [...manifest.documents, ...draftFiles],
        maxMarkdownBytes,
        maxProjectContentBytes
      );
      const draftOffset = manifest.documents.length;
      return BookSchema.parse({
        id: manifest.id,
        title: manifest.title,
        bookType: manifest.bookType,
        genre: manifest.genre,
        status: manifest.status,
        linkedMaterialIdsByKind: manifest.linkedMaterialIdsByKind,
        linkedSkillIdsByKind: manifest.linkedSkillIdsByKind,
        characterStructure: manifest.characterStructure,
        plotStages: manifest.plotStages,
        projectRevision: manifest.revision,
        documents: manifest.documents.map((document, index) => ({
          id: document.id,
          title: document.title,
          content: contents[index]!,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt
        })),
        draft: {
          id: manifest.draft.id,
          title: manifest.draft.title,
          sections: manifest.draft.sections.map((section, index) => ({
            id: section.id,
            title: section.title,
            wordCountRequirement: section.wordCountRequirement,
            body: {
              id: section.body.id,
              title: section.body.title,
              content: contents[draftOffset + index * 2]!,
              createdAt: section.body.createdAt,
              updatedAt: section.body.updatedAt
            },
            characterState: {
              id: section.characterState.id,
              title: section.characterState.title,
              content: contents[draftOffset + index * 2 + 1]!,
              createdAt: section.characterState.createdAt,
              updatedAt: section.characterState.updatedAt
            },
            createdAt: section.createdAt,
            updatedAt: section.updatedAt
          })),
          createdAt: manifest.draft.createdAt,
          updatedAt: manifest.draft.updatedAt
        },
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      });
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
        ...(manifest.marketplaceSource
          ? { marketplaceSource: manifest.marketplaceSource }
          : {}),
        projectRevision: manifest.revision,
        entries: manifest.entries.map((entry, index) => ({
          id: entry.id,
          stageId: entry.stageId,
          title: entry.title,
          body: contents[index]!,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          ...(entry.marketplaceSource
            ? { marketplaceSource: entry.marketplaceSource }
            : {}),
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
        ...(manifest.marketplaceSource
          ? { marketplaceSource: manifest.marketplaceSource }
          : {}),
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
      key === "content" || (key === "body" && typeof value === "string")
        ? undefined
        : value
    ),
    "utf8"
  );
  if ("documents" in resource) {
    const documentBytes = resource.documents.reduce(
      (total, document) => total + Buffer.byteLength(document.content, "utf8"),
      0
    );
    const draftBytes = resource.draft.sections.reduce(
      (total, section) =>
        total +
        Buffer.byteLength(section.body.content, "utf8") +
        Buffer.byteLength(section.characterState.content, "utf8"),
      0
    );
    return metadataBytes + documentBytes + draftBytes;
  }
  if ("entries" in resource) {
    return (
      metadataBytes +
      resource.entries.reduce(
        (total, entry) => total + Buffer.byteLength(entry.body, "utf8"),
        0
      )
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

async function uniqueRelativeMarkdownPathWithSuffix(
  projectDirectory: string,
  directory: string,
  id: string,
  suffix: `.${string}.md`,
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
  let candidate = `${directory}/${stem}${suffix}`;
  while (
    occupied.has(portableContentPathKey(candidate)) ||
    (await pathExists(resolve(projectDirectory, candidate)))
  ) {
    index += 1;
    candidate = `${directory}/${stem}-${index}${suffix}`;
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
  if (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))
  ) {
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
      throw new Error(
        "Project files must be regular files, not symbolic links."
      );
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

function assertTextByteLength(
  text: string,
  maxBytes: number,
  label: string
): void {
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
  assertTextByteLength(nextContent, maxMarkdownBytes, "Markdown content");
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

async function commitProjectFileCreations(
  files: ReadonlyArray<{ target: string; content: string }>,
  manifestPath: string,
  manifest: unknown,
  maxMarkdownBytes: number,
  maxManifestBytes: number
): Promise<void> {
  assertJsonByteLength(manifest, maxManifestBytes);
  for (const file of files) {
    assertTextByteLength(file.content, maxMarkdownBytes, "Markdown content");
    if (await pathExists(file.target)) {
      throw new Error("新的正文小节文件路径已被其他文件占用。");
    }
  }
  const committed: Array<{ target: string; content: string }> = [];
  try {
    for (const file of files) {
      await atomicWriteText(file.target, file.content);
      committed.push(file);
    }
    await atomicWriteJson(manifestPath, manifest, maxManifestBytes);
  } catch (error: unknown) {
    const rollbackErrors: unknown[] = [];
    for (const file of committed.reverse()) {
      try {
        const observed = await readOptionalUtf8File(
          file.target,
          maxMarkdownBytes,
          "Markdown content"
        );
        if (observed === file.content) {
          await unlinkOptional(file.target);
        }
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "正文小节创建失败，且无法完整清理未提交文件。"
      );
    }
    throw error;
  }
}

async function atomicWriteText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.deepwrite-${randomHex8()}.tmp`);
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

async function cleanupNewProjectDirectories(
  paths: readonly string[]
): Promise<void> {
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

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
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

function findRegistrationByProjectId(
  registry: FolderCatalogRegistry,
  id: string
): RegistryProject {
  const projects = registry.projects.filter((candidate) => candidate.id === id);
  if (projects.length === 0) {
    throw new Error("项目不存在、未注册或已从创作空间移除。");
  }
  if (projects.length > 1) {
    throw new Error("项目标识不唯一，无法确定要读取的项目。");
  }
  return projects[0]!;
}

function defaultDocumentTitle(documentId: string): string {
  return (
    DEFAULT_SHORT_DOCUMENTS.find(([id]) => id === documentId)?.[1] ?? documentId
  );
}
