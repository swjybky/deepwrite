import {
  findBuiltinGroup,
  findBuiltinLibrary,
  getBuiltinIndexMaterialLibraries,
  getBuiltinIndexSkillLibraries,
  getBuiltinMaterialGroups,
  getBuiltinMaterialLibraries,
  getBuiltinSkillGroups,
  getBuiltinSkillLibraries,
  isBuiltinCatalogProjectId
} from "./builtin-libraries";
import {
  queryWritingWorkspace,
  writingFileMetrics
} from "./folder-catalog-store/writing-read";
import type {
  AcademicWritingIndex,
  WritingReadCommand,
  WritingIndex,
  WritingFile,
  WritingSearchResult
} from "@deepwrite/contracts";
import { applyDraftSectionChange } from "./folder-catalog-store/draft-section-change";
import { resolveLibraryEntryLocation } from "@deepwrite/contracts";
import { withProjectTransactionLock } from "./project-transaction/lock";
import { copyBookImages } from "./book-images/copy";
import {
  captureDocumentVersions,
  DocumentVersionStore
} from "./document-versions/version-store";
import { planLibraryStructure } from "./folder-catalog-store/structure-plan";
import {
  commitStructureTransaction,
  recoverStructureTransaction
} from "./folder-catalog-store/structure-transaction";
import {
  LibraryStructurePlanSchema,
  type LibraryStructureRequest,
  type LibraryStructurePlan
} from "@deepwrite/contracts";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  CreateUnboundEntryInputSchema,
  MaterialStageIdSchema,
  SkillStageIdSchema,
  type CreateUnboundEntryInput,
  type CreateUnboundEntryResult
} from "@deepwrite/contracts";
import {
  LibraryOrganizationSchema,
  emptyLibraryOrganization,
  ReorderLibraryInputSchema,
  reconcileLibraryOrder,
  reorderLibraryIds,
  type ReorderLibraryInput,
  type LibraryOrganization
} from "@deepwrite/contracts";
import {
  writeManagedMaterialEntry,
  type ManagedMaterialEntryInput
} from "./folder-catalog-store/managed-entry";
import { registerCatalogProject } from "./folder-catalog-store/project-registration";
import {
  MarketplaceMaterialDetailSchema,
  type MarketplaceMaterialDetail,
  type MarketplaceMaterialInstallResult
} from "@deepwrite/contracts";
import { deleteRegisteredProject } from "./folder-catalog-store/project-deletion";
import {
  assertAcademicBookLibraryReferences,
  assertBookLibraryReferences
} from "./folder-catalog-store/book-library-references";
import {
  academicManifestContentItems,
  executeCreateAcademicReferenceCard,
  executeDeleteAcademicReferenceCard,
  executeMutateAcademicFramework,
  executeMutateAcademicManuscript,
  executeUpdateAcademicReferenceCard,
  saveAcademicDocumentWithLock,
  scrubAcademicBookLibraryBindings,
  type AcademicMutationDriver
} from "./folder-catalog-store/academic-mutations";
export { FolderCatalogAcademicCiteKeyConflictError } from "./folder-catalog-store/academic-mutations";
import {
  CATALOG_PROJECT_DOMAINS,
  type FolderCatalogProjectDomain,
  type FolderCatalogRegistry,
  type RegistryProject
} from "./folder-catalog-store/registry-types";
export {
  CATALOG_PROJECT_DOMAINS,
  type FolderCatalogProjectDomain
} from "./folder-catalog-store/registry-types";
import {
  DEFAULT_SHORT_DOCUMENTS,
  createInitialAcademicBook,
  createNewShortBook,
  createNewScriptBook,
  assertCreationPlotStages,
  applyGlobalPlotStagesToNewBook
} from "./folder-catalog-store/book-creation";
import {
  mergeCreativePlotStageDefinitions,
  sameCreativePlotStageDefinitions,
  persistCreativePlotStageDefinitions
} from "./folder-catalog-store/plot-stage-definitions";
import {
  createCatalogId,
  randomHex8,
  reorderItemsByAnchor,
  isRecord
} from "@deepwrite/shared";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  AcademicBookSchema,
  CreativeBookSchema,
  type CreativeBook,
  BookSchema,
  BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID,
  CATALOG_DRAFT_DIRECTORY_ID,
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  CatalogDraftSectionSchema,
  CreateAcademicBookInputSchema,
  CreateDraftSectionsInputSchema,
  CreateDraftSectionsResultSchema,
  CatalogDraftRecoverySchema,
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
  CurrentAcademicBookProjectManifestSchema,
  DeleteDraftSectionInputSchema,
  MoveDraftSectionInputSchema,
  DuplicateCatalogProjectInputSchema,
  MutateCharacterStructureInputSchema,
  MutatePlotStructureInputSchema,
  ReadWritingContextInputSchema,
  ReadWritingContextResultSchema,
  SaveDocumentInputSchema,
  SaveDocumentResultSchema,
  MaterialLibraryGroupSchema,
  MaterialLibrarySchema,
  MaterialLibraryProjectManifestSchema,
  MarketplaceInstallPackageSchema,
  CatalogInstallMarketplaceSkillContentResultSchema,
  ExportLibraryPackageInputSchema,
  ImportLibraryPackageResultSchema,
  ImportLibraryEntriesInputSchema,
  SaveLibraryEntryInputSchema,
  MoveLibraryEntryInputSchema,
  SkillLibraryGroupSchema,
  SkillLibrarySchema,
  SkillLibraryProjectManifestSchema,
  ShortBookSchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  WriteWritingContextInputSchema,
  WriteWritingContextResultSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createDefaultBookCharacterStructure,
  BookPlotStagesSchema,
  CreativePlotStagesSchema,
  createDefaultBookPlotStages,
  createDefaultCreativePlotStages,
  createShortWorkspaceContentRevision,
  isBuiltinCreativePlotStageId,
  migrateCatalogDraftDocument,
  type AcademicBook,
  type AcademicReferenceCardManifest,
  type AcademicManuscriptSectionManifest,
  type BookProjectDraftSectionManifest,
  type BookProjectDocumentManifest,
  type Book,
  type CatalogDraftSection,
  type CatalogLegacyImport,
  type CatalogIndexSnapshot,
  type CatalogReadDocumentInput,
  type CatalogReadDocumentResult,
  type CatalogProjectDiagnostic,
  type CatalogDraftRecovery,
  type CatalogSnapshot,
  type CreateAcademicBookInput,
  type CreateAcademicReferenceCardInput,
  type CreateAcademicReferenceCardResult,
  type UpdateLibraryInput,
  type CreateScriptBookInput,
  type CreateShortBookInput,
  type CreateDraftSectionInput,
  type CreateDraftSectionsInput,
  type CreateDraftSectionsResult,
  type CreativePlotStage,
  type CurrentAcademicBookProjectManifest,
  type DeleteAcademicReferenceCardInput,
  type DeleteAcademicReferenceCardResult,
  type DeleteDraftSectionInput,
  type DeleteDraftSectionResult,
  type MoveDraftSectionInput,
  type MoveDraftSectionResult,
  type DuplicateCatalogProjectInput,
  type DuplicateCatalogProjectResult,
  type MaterialLibraryProjectManifest,
  type MaterialLibrary,
  type CatalogLibrary,
  type MaterialLibraryGroup,
  type ExportLibraryPackageInput,
  type ImportLibraryPackageResult,
  type LibraryPackageExportSource,
  type LibraryPackageResolvedImport,
  type MaterialEntry,
  type MaterialStageId,
  type MarketplaceInstallPackage,
  type CatalogInstallMarketplaceSkillContentResult,
  type ImportLibraryEntriesInput,
  type ImportLibraryEntriesResult,
  type MutateAcademicFrameworkInput,
  type MutateAcademicManuscriptInput,
  type MutateAcademicManuscriptResult,
  type MutateCharacterStructureInput,
  type MutatePlotStructureInput,
  type ReadWritingContextInput,
  type ReadWritingContextResult,
  type SaveLibraryEntryInput,
  type MoveLibraryEntryInput,
  type MoveLibraryEntryResult,
  type SaveDocumentResult,
  type ScriptBook,
  type ShortBook,
  type SkillLibraryProjectManifest,
  type SkillLibrary,
  type SkillLibraryGroup,
  type SkillEntry,
  type SkillStageId,
  type UpdateAcademicReferenceCardInput,
  type UpdateAcademicReferenceCardResult,
  type UpdateLibraryGroupInput,
  type WriteWritingContextInput,
  type WriteWritingContextResult,
  type V2BookProjectManifest,
  type V3BookProjectManifest,
  chineseSectionNumber
} from "@deepwrite/contracts";
import {
  initializeWritingContextFile,
  readOrCreateWritingContext,
  writeWritingContextFile
} from "./folder-catalog-store/writing-context";
import type { ImportedLegacyBook } from "./legacy-book-import";
import {
  buildLibraryPackageProjects,
  type LibraryPackageProjectPlan
} from "./folder-catalog-store/library-package-import";
import { nextCopyTitle } from "./copy-title";
import { projectTransactionFileIdentity } from "./project-transaction";
import { adoptManagedMaterialReceipt } from "./folder-catalog-store/managed-receipt";
import {
  readManagedLibrary,
  writeManagedEntries,
  type ManagedEntriesWrite
} from "./folder-catalog-store/managed-batch";
import {
  assertJsonByteLength,
  assertTextByteLength,
  writeBoundedProjectJson,
  writeProjectTextAtomic,
  availableProjectDirectory,
  cleanupNewProjectDirectories,
  commitProjectFileCreations,
  commitProjectMarkdownUpdate,
  parseJson,
  pathExists,
  portableContentPathKey,
  readOptionalUtf8File,
  readProjectMarkdown,
  readRequiredUtf8File,
  removeEmptyOrPartialProject,
  secureDirectory,
  secureExistingProjectPath,
  secureProjectRoot,
  secureWritableProjectPath,
  uniqueRelativeMarkdownPath,
  uniqueRelativeMarkdownPathWithSuffix,
  unlinkOptional
} from "./folder-catalog-store/paths-io";
import {
  type CatalogContentMetadata,
  type CreateFolderLibraryEntryInput,
  type CreateFolderLibraryGroupInput,
  type CreateFolderLibraryInput,
  type CreateScriptBookAtDirectoryInput,
  type CreateShortBookAtDirectoryInput,
  DEFAULT_MAX_DRAFT_RECOVERY_BYTES,
  DEFAULT_MAX_MANIFEST_BYTES,
  DEFAULT_MAX_MARKDOWN_BYTES,
  DEFAULT_MAX_PROJECT_CONTENT_BYTES,
  DEFAULT_MAX_SNAPSHOT_CONTENT_BYTES,
  DRAFT_RECOVERY_FILE,
  type DeleteFolderCatalogProjectInput,
  type DeleteFolderCatalogProjectResult,
  type DuplicateProjectWritePlan,
  type FolderBookProjectManifest,
  FolderCatalogConflictError,
  type FolderCatalogLibraryDomain,
  type FolderCatalogProjectManifest,
  FolderCatalogProjectManifestSchema,
  type FolderCatalogResource,
  type FolderCatalogStoreOptions,
  type FolderCatalogUnregisterDomain,
  type FolderCurrentBookProjectManifest,
  FolderCurrentBookProjectManifestSchema,
  type FolderLegacyBookProjectManifest,
  FolderMaterialGroupProjectManifestSchema,
  FolderMaterialProjectManifestSchema,
  FolderSkillGroupProjectManifestSchema,
  FolderSkillProjectManifestSchema,
  MANIFEST_FILE,
  type OpenFolderCatalogProjectResult,
  REGISTRY_BACKUP_FILE,
  REGISTRY_FILE,
  type RemoveFolderLibraryEntryInput,
  type RemoveFolderLibraryEntryResult,
  type SaveFolderDocumentInput,
  type UnregisterFolderCatalogProjectInput,
  type UnregisterFolderCatalogProjectResult,
  type UpdateFolderBookInput,
  type WriteMissingSnapshotProjectsResult
} from "./folder-catalog-store/types";
import { isNodeError, sha256Hex } from "@deepwrite/shared/node";
export * from "./folder-catalog-store/types";

export interface CreateAcademicBookAtDirectoryInput {
  parentDirectory?: string;
  input: CreateAcademicBookInput;
}

function nextImportedEntryTitle(
  sourceTitle: string,
  occupiedTitles: Set<string>
): string {
  const comparable = (value: string): string =>
    value.normalize("NFC").toLocaleLowerCase("en-US");
  const base = [...sourceTitle.normalize("NFC").trim()].slice(0, 256).join("");
  if (!occupiedTitles.has(comparable(base))) {
    occupiedTitles.add(comparable(base));
    return base;
  }
  for (let index = 2; index < 100_000; index += 1) {
    const suffix = ` (${index})`;
    const shortened = [...base]
      .slice(0, Math.max(1, 256 - [...suffix].length))
      .join("")
      .trimEnd();
    const candidate = `${shortened || "未命名条目"}${suffix}`;
    if (occupiedTitles.has(comparable(candidate))) continue;
    occupiedTitles.add(comparable(candidate));
    return candidate;
  }
  throw new Error("无法为导入条目生成不重复的标题。");
}

export class FolderCatalogStore {
  readonly registryPath: string;
  readonly registryBackupPath: string;
  readonly projectsRoot: string;
  readonly draftRecoveryPath: string;
  readonly defaultProjectParents: Readonly<
    Record<FolderCatalogProjectDomain, string>
  >;

  private readonly includeBuiltinLibraries: boolean;
  private readonly initialSnapshot: CatalogSnapshot | undefined;
  private readonly now: () => string;
  private readonly maxManifestBytes: number;
  private readonly maxMarkdownBytes: number;
  private readonly maxProjectContentBytes: number;
  private readonly maxSnapshotContentBytes: number;
  private readonly maxDraftRecoveryBytes: number;
  // Retain only counts for the last indexed work. Each hit still validates the current file stamp.
  private writingCounts = {
    root: "",
    files: new Map<
      string,
      { stamp: string; metrics: ReturnType<typeof writingFileMetrics> }
    >()
  };
  private readonly mutationScope = new AsyncLocalStorage<boolean>();
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
    this.includeBuiltinLibraries = Boolean(options.includeBuiltinLibraries);
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

  private isVirtualBuiltinId(id: string): boolean {
    return this.includeBuiltinLibraries && isBuiltinCatalogProjectId(id);
  }

  private assertNotBuiltinCatalogProject(
    id: string,
    message = "内置资料库为只读，不能修改，请先复制后再自定义。"
  ): void {
    if (this.isVirtualBuiltinId(id)) {
      throw new Error(message);
    }
  }

  async writeManagedEntry(input: ManagedMaterialEntryInput) {
    this.assertNotBuiltinCatalogProject(input.libraryId);
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(
        registry,
        input.libraryId,
        "material-library"
      );
      const root = await secureProjectRoot(registration.projectDirectory);
      const receipt = await writeManagedMaterialEntry(root, input);
      await this.bumpRegistry(registry, this.now());
      return receipt;
    });
  }
  async readManagedLibrary(libraryId: string) {
    return this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(
        registry,
        libraryId,
        "material-library"
      );
      return readManagedLibrary(
        await secureProjectRoot(registration.projectDirectory),
        libraryId
      );
    });
  }
  async writeManagedEntries(input: ManagedEntriesWrite) {
    this.assertNotBuiltinCatalogProject(input.libraryId);
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(
        registry,
        input.libraryId,
        "material-library"
      );
      const result = await writeManagedEntries(
        await secureProjectRoot(registration.projectDirectory),
        input
      );
      await this.bumpRegistry(registry, this.now());
      return result;
    });
  }
  async adoptManagedReceipt(
    libraryId: string,
    receipt: import("@deepwrite/contracts").DecompositionReceipt
  ) {
    this.assertNotBuiltinCatalogProject(libraryId);
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(
        registry,
        libraryId,
        "material-library"
      );
      const result = await adoptManagedMaterialReceipt(
        await secureProjectRoot(registration.projectDirectory),
        receipt
      );
      await this.bumpRegistry(registry, this.now());
      return result;
    });
  }

  async managedProjectDirectory(projectId: string): Promise<string> {
    return this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      return await secureProjectRoot(
        findRegistrationByProjectId(registry, projectId).projectDirectory
      );
    });
  }

  async previewLibraryStructure(
    input: LibraryStructureRequest
  ): Promise<LibraryStructurePlan> {
    return this.readAfterWrites(
      async () =>
        (
          await planLibraryStructure(input, {
            registry: await this.ensureRegistry(),
            registryPath: this.registryPath,
            defaultProjectParents: this.defaultProjectParents,
            maxManifestBytes: this.maxManifestBytes,
            maxMarkdownBytes: this.maxMarkdownBytes,
            now: this.now()
          })
        ).plan
    );
  }

  async applyLibraryStructure(
    raw: LibraryStructurePlan
  ): Promise<{ requestId: string; applied: true }> {
    const input = LibraryStructurePlanSchema.parse(raw);
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const receiptPath = `library-structure-receipts/${sha256Hex(input.requestId)}.json`;
      const receipt = await readOptionalUtf8File(
        join(dirname(this.registryPath), receiptPath),
        1024 * 1024,
        "organization receipt"
      );
      const identity = sha256Hex(JSON.stringify(input));
      if (receipt) {
        if (JSON.parse(receipt).identity !== identity)
          throw new Error("整理请求标识已用于不同的操作。");
        return { requestId: input.requestId, applied: true };
      }
      const { plan, roots } = await planLibraryStructure(
        {
          domain: input.domain,
          requestId: input.requestId,
          ...(input.managementScope
            ? { managementScope: input.managementScope }
            : {}),
          operations: input.operations
        },
        {
          registry,
          registryPath: this.registryPath,
          defaultProjectParents: this.defaultProjectParents,
          maxManifestBytes: this.maxManifestBytes,
          maxMarkdownBytes: this.maxMarkdownBytes,
          now: this.now()
        }
      );
      if (
        plan.baseVersion !== input.baseVersion ||
        plan.summary !== input.summary
      )
        throw new Error("资料库已更新，请重新生成整理提案。");
      roots.at(-1)!.files.push({
        action: "write",
        path: receiptPath,
        content: JSON.stringify({ identity }),
        expectedSha256: null
      });
      await commitStructureTransaction(dirname(this.registryPath), roots);
      const next = await this.ensureRegistry();
      await this.writeRegistry(next);
      return { requestId: input.requestId, applied: true };
    });
  }

  async createUnboundEntry(
    rawInput: CreateUnboundEntryInput
  ): Promise<CreateUnboundEntryResult> {
    const input = CreateUnboundEntryInputSchema.parse(rawInput);
    const stageId =
      input.domain === "material"
        ? MaterialStageIdSchema.parse(input.stageId)
        : SkillStageIdSchema.parse(input.stageId);
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const snapshot = await this.aggregateIndexSnapshot(registry);
      const ids = new Set(
        registry.libraryOrganization?.unboundLibraryIds ?? []
      );
      const existing =
        input.domain === "material"
          ? snapshot.materials.find((library) => ids.has(library.id))
          : snapshot.skills.find((library) => ids.has(library.id));
      const library =
        existing ??
        (
          await this.createLibrary(
            input.domain === "material"
              ? {
                  domain: "material",
                  name: "未绑定素材",
                  materialKind: "other",
                  libraryType: input.libraryType ?? "short",
                  unbound: true
                }
              : {
                  domain: "skill",
                  name: "未绑定技能",
                  skillKind: "general",
                  libraryType: input.libraryType ?? "short",
                  unbound: true
                }
          )
        ).resource;
      const entry =
        input.domain === "material"
          ? await this.createLibraryEntry({
              domain: "material",
              libraryId: library.id,
              title: input.title,
              content: input.content,
              stageId: MaterialStageIdSchema.parse(stageId),
              baseProjectRevision: library.projectRevision
            })
          : await this.createLibraryEntry({
              domain: "skill",
              libraryId: library.id,
              title: input.title,
              content: input.content,
              stageId: SkillStageIdSchema.parse(stageId),
              baseProjectRevision: library.projectRevision
            });
      return { libraryId: library.id, entryId: entry.id };
    });
  }

  async reorderLibrary(
    rawInput: ReorderLibraryInput
  ): Promise<LibraryOrganization> {
    const input = ReorderLibraryInputSchema.parse(rawInput);
    if (input.groupId) {
      this.assertNotBuiltinCatalogProject(
        input.groupId,
        "内置资料分组内顺序不可修改。"
      );
    }
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const organization =
        registry.libraryOrganization ?? emptyLibraryOrganization();
      assertBaseRevision(input.baseRevision, organization.revision);
      const snapshot = await this.aggregateIndexSnapshot(registry);
      const groups =
        input.domain === "material"
          ? snapshot.materialGroups
          : snapshot.skillGroups;
      const libraries =
        input.domain === "material" ? snapshot.materials : snapshot.skills;
      const group = input.groupId
        ? groups.find(({ id }) => id === input.groupId)
        : undefined;
      if (input.groupId && !group) throw new Error("分组不存在。");
      const grouped = new Set(groups.flatMap((item) => item.memberIds));
      const available = group
        ? [...group.memberIds]
        : [
            ...groups.map(({ id }) => id),
            ...libraries
              .filter(
                ({ id }) =>
                  !grouped.has(id) &&
                  !organization.unboundLibraryIds.includes(id)
              )
              .map(({ id }) => id)
          ];
      const order = reconcileLibraryOrder(
        available,
        input.groupId
          ? (organization.groups[input.groupId] ?? [])
          : organization[input.domain]
      );
      const next = structuredClone(organization);
      const reordered = reorderLibraryIds(order, input);
      if (input.groupId) next.groups[input.groupId] = reordered;
      else next[input.domain] = reordered;
      next.revision += 1;
      await this.writeRegistry({
        ...registry,
        revision: registry.revision + 1,
        updatedAt: this.now(),
        libraryOrganization: next
      });
      return next;
    });
  }

  async snapshot(): Promise<CatalogSnapshot> {
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      return await this.aggregateSnapshot(registry);
    });
  }

  async projectDirectory(projectId: string): Promise<string> {
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      return findRegistrationByProjectId(registry, projectId).projectDirectory;
    });
  }

  async indexSnapshot(): Promise<CatalogIndexSnapshot> {
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      return await this.aggregateIndexSnapshot(registry);
    });
  }

  async readWritingWorkspace(
    { bookId, bookType, query }: WritingReadCommand["payload"],
    runId: string
  ): Promise<
    WritingIndex | AcademicWritingIndex | WritingFile | WritingSearchResult
  > {
    return this.readAfterWrites(async () => {
      const registryText = await readRequiredUtf8File(
        this.registryPath,
        this.maxManifestBytes,
        "catalog registry"
      );
      const registry = parseRegistry(
        parseJson(registryText, this.registryPath)
      );
      const registration = findRegistration(registry, bookId, "book");
      const { projectDirectory, manifest } =
        await this.readManifestWithoutContent(
          registration.projectDirectory,
          "deepwrite.book",
          bookId
        );
      if (manifest.kind !== "deepwrite.book" || manifest.bookType !== bookType)
        throw new Error("Writing workspace type mismatch.");
      const read = (path: string) =>
        readProjectMarkdown(projectDirectory, path, this.maxMarkdownBytes);
      if (this.writingCounts.root !== projectDirectory)
        this.writingCounts = { root: projectDirectory, files: new Map() };
      return queryWritingWorkspace(
        manifest,
        query,
        runId,
        read,
        async (path) => {
          const actual = await secureExistingProjectPath(
            projectDirectory,
            path,
            true
          );
          const info = await stat(actual, { bigint: true });
          const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
          const cached = this.writingCounts.files.get(path);
          if (cached?.stamp === stamp) return cached.metrics;
          const metrics = writingFileMetrics(
            await readRequiredUtf8File(
              actual,
              this.maxMarkdownBytes,
              "Markdown file"
            )
          );
          if (this.writingCounts.files.size > 8192)
            this.writingCounts.files.clear();
          this.writingCounts.files.set(path, { stamp, metrics });
          return metrics;
        }
      );
    });
  }

  async readDocument(
    rawInput: CatalogReadDocumentInput
  ): Promise<CatalogReadDocumentResult> {
    const input = CatalogReadDocumentInputSchema.parse(rawInput);
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      if (input.target === "document") {
        const location = resolveLibraryEntryLocation(
          registry.libraryOrganization,
          input.projectId,
          input.documentId
        );
        input.projectId = location.libraryId;
        input.documentId = location.entryId;
      }
      const builtinLibrary = this.includeBuiltinLibraries
        ? findBuiltinLibrary(input.projectId)?.library
        : undefined;
      if (builtinLibrary) {
        if (input.target === "overview") {
          assertTextByteLength(
            builtinLibrary.overview,
            this.maxMarkdownBytes,
            "library overview"
          );
          return CatalogReadDocumentResultSchema.parse({
            projectId: input.projectId,
            target: "overview",
            title: builtinLibrary.title,
            content: builtinLibrary.overview,
            contentBytes: Buffer.byteLength(builtinLibrary.overview, "utf8"),
            revision: createShortWorkspaceContentRevision(
              builtinLibrary.overview
            ),
            projectRevision: builtinLibrary.projectRevision ?? 0,
            updatedAt: builtinLibrary.updatedAt
          });
        }
        const entry = builtinLibrary.entries.find(
          ({ id }) => id === input.documentId
        );
        if (!entry) {
          throw new Error("文档不存在或不属于指定项目。");
        }
        assertTextByteLength(
          entry.body,
          this.maxMarkdownBytes,
          "Markdown content"
        );
        return CatalogReadDocumentResultSchema.parse({
          projectId: input.projectId,
          target: "document",
          documentId: input.documentId,
          title: entry.title,
          content: entry.body,
          contentBytes: Buffer.byteLength(entry.body, "utf8"),
          revision: createShortWorkspaceContentRevision(entry.body),
          projectRevision: builtinLibrary.projectRevision ?? 0,
          updatedAt: entry.updatedAt
        });
      }
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
      await writeBoundedProjectJson(
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
        snapshot.books.flatMap((book) =>
          book.bookType === "academic" ? [] : book.plotStages
        )
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
        snapshot.books.flatMap((book) =>
          book.bookType === "academic" ? [] : book.plotStages
        )
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
      (now) => createNewShortBook(input, now),
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
    return await this.createBookProject(
      parent,
      (now) => createNewScriptBook(input, now),
      input.defaultPlotStageIds
    );
  }

  async createAcademicBook(
    rawInput: CreateAcademicBookInput,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<AcademicBook>>;
  async createAcademicBook(
    rawInput: CreateAcademicBookAtDirectoryInput
  ): Promise<OpenFolderCatalogProjectResult<AcademicBook>>;
  async createAcademicBook(
    rawInput: CreateAcademicBookInput | CreateAcademicBookAtDirectoryInput,
    parentDirectory?: string
  ): Promise<OpenFolderCatalogProjectResult<AcademicBook>> {
    const wrapped = "input" in rawInput;
    const input = CreateAcademicBookInputSchema.parse(
      wrapped ? rawInput.input : rawInput
    );
    const parent =
      (wrapped ? rawInput.parentDirectory : parentDirectory)?.trim() ||
      this.defaultProjectParents.book;
    return await this.mutate(async () => {
      const now = this.now();
      const registry = await this.ensureRegistry();
      const snapshot = await this.aggregateSnapshot(registry);
      const book = createInitialAcademicBook(input, now);
      assertAcademicBookLibraryReferences(book, snapshot);
      const projectDirectory = await this.writeNewResourceProject(
        "book",
        parent,
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
      )) as OpenFolderCatalogProjectResult<AcademicBook>;
    });
  }

  private async createBookProject<Resource extends ShortBook | ScriptBook>(
    parentDirectory: string,
    createBook: (now: string) => Resource,
    defaultPlotStageIds?: readonly string[]
  ): Promise<OpenFolderCatalogProjectResult<Resource>> {
    return await this.mutate(async () => {
      const now = this.now();
      const registry = await this.ensureRegistry();
      const snapshot = await this.aggregateSnapshot(registry);
      assertCreationPlotStages(
        defaultPlotStageIds,
        registry.creativePlotStages
      );
      const book = applyGlobalPlotStagesToNewBook(
        createBook(now),
        registry.creativePlotStages,
        defaultPlotStageIds
      );
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
              id: rawInput.id ?? createCatalogId("material"),
              title: input.name,
              materialType: input.libraryType ?? "short",
              materialKind: rawInput.unbound ? "mixed" : input.materialKind,
              ...(rawInput.unbound || !input.customTag
                ? {}
                : { customTag: input.customTag }),
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
              ...(input.customTag ? { customTag: input.customTag } : {}),
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
        if (rawInput.unbound) {
          registry.libraryOrganization ??= emptyLibraryOrganization();
          registry.libraryOrganization.unboundLibraryIds.push(resource.id);
          registry.libraryOrganization.revision += 1;
        }
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
    this.assertNotBuiltinCatalogProject(input.libraryId);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      if (
        registry.libraryOrganization?.unboundLibraryIds.includes(
          input.libraryId
        )
      )
        throw new Error("未绑定收纳区不能作为正式库修改或移除。");
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
      const nextCustomTag =
        input.customTag === undefined ? manifest.customTag : input.customTag;
      const { customTag: _prevCustomTag, ...manifestWithoutCustomTag } =
        manifest;
      const next =
        manifest.kind === "deepwrite.material-library"
          ? MaterialLibraryProjectManifestSchema.parse({
              ...manifestWithoutCustomTag,
              title: input.title ?? manifest.title,
              overview: input.overview ?? manifest.overview,
              materialKind: input.materialKind ?? manifest.materialKind,
              ...(nextCustomTag ? { customTag: nextCustomTag } : {}),
              revision: manifest.revision + 1,
              updatedAt: now
            })
          : SkillLibraryProjectManifestSchema.parse({
              ...manifestWithoutCustomTag,
              title: input.title ?? manifest.title,
              overview: input.overview ?? manifest.overview,
              skillKind: input.skillKind ?? manifest.skillKind,
              ...(nextCustomTag ? { customTag: nextCustomTag } : {}),
              revision: manifest.revision + 1,
              updatedAt: now
            });
      await writeBoundedProjectJson(
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
      assertUniqueGroupMembers(input.memberIds);
      if (input.domain === "material") {
        const libraries = new Map(
          snapshot.materials.map((library) => [library.id, library])
        );
        for (const libraryId of input.memberIds) {
          this.assertNotBuiltinCatalogProject(
            libraryId,
            "内置资料库不能加入自定义分组，请先复制后再分组。"
          );
          const library = libraries.get(libraryId);
          if (library?.isBuiltin)
            throw new Error("内置资料库不能加入自定义分组，请先复制后再分组。");
          if (library?.isUnbound) throw new Error("未绑定收纳区不能加入分组。");
          if (!library) {
            throw new Error(`新建素材分组引用了不存在的素材库：${libraryId}`);
          }
          assertLibraryNotInAnotherGroup(
            snapshot.materialGroups,
            libraryId,
            "素材"
          );
        }
      } else {
        const libraries = new Map(
          snapshot.skills.map((library) => [library.id, library])
        );
        for (const libraryId of input.memberIds) {
          this.assertNotBuiltinCatalogProject(
            libraryId,
            "内置资料库不能加入自定义分组，请先复制后再分组。"
          );
          const library = libraries.get(libraryId);
          if (library?.isBuiltin)
            throw new Error("内置资料库不能加入自定义分组，请先复制后再分组。");
          if (library?.isUnbound) throw new Error("未绑定收纳区不能加入分组。");
          if (!library) {
            throw new Error(`新建技能分组引用了不存在的技能库：${libraryId}`);
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
              id: rawInput.id ?? createCatalogId("material-group"),
              title: input.name,
              memberIds: [...input.memberIds],
              createdAt: now,
              updatedAt: now
            }
          : {
              id: createCatalogId("skill-group"),
              title: input.name,
              memberIds: [...input.memberIds],
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

  /** Reads one library, or a group's member libraries, for export only. */
  async readLibraryPackageSource(
    rawInput: ExportLibraryPackageInput
  ): Promise<LibraryPackageExportSource> {
    const input = ExportLibraryPackageInputSchema.parse(rawInput);
    const libraryDomain = libraryProjectDomain(input.domain);
    return await this.readAfterWrites(async () => {
      const registry = await this.ensureRegistry();
      const readLibrary = async (id: string) => {
        const builtinLibrary = this.includeBuiltinLibraries
          ? findBuiltinLibrary(id)
          : undefined;
        if (builtinLibrary && builtinLibrary.domain === input.domain) {
          return builtinLibrary.library;
        }
        return (
          await this.readProject(
            findRegistration(registry, id, libraryDomain).projectDirectory,
            libraryDomain,
            id
          )
        ).resource as CatalogLibrary;
      };
      if (input.target.type === "library") {
        return {
          domain: input.domain,
          groupTitle: null,
          members: [{ slot: null, library: await readLibrary(input.target.id) }]
        };
      }
      const groupDomain =
        input.domain === "material" ? "material-group" : "skill-group";
      const builtinGroup = this.includeBuiltinLibraries
        ? findBuiltinGroup(input.target.id)
        : undefined;
      const group =
        builtinGroup && builtinGroup.domain === groupDomain
          ? builtinGroup.group
          : ((
              await this.readProject(
                findRegistration(registry, input.target.id, groupDomain)
                  .projectDirectory,
                groupDomain,
                input.target.id
              )
            ).resource as MaterialLibraryGroup | SkillLibraryGroup);
      const members: LibraryPackageExportSource["members"][number][] = [];
      for (const id of group.memberIds) {
        try {
          const library = await readLibrary(id);
          const slot = library.customTag
            ? null
            : "materialKind" in library
              ? library.materialKind === "mixed"
                ? "other"
                : library.materialKind
              : library.skillKind;
          members.push({ slot, library });
        } catch {
          members.push({ slot: null, library: null });
        }
      }
      if (!members.some(({ library }) => library)) {
        throw new Error("这个分组没有可用的成员库，没有可导出的内容。");
      }
      return { domain: input.domain, groupTitle: group.title, members };
    });
  }

  /** Creates every library (and the group) of one import, or none of them. */
  async importLibraryPackage(
    resolved: LibraryPackageResolvedImport,
    parents: { library: string; group: string }
  ): Promise<ImportLibraryPackageResult> {
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const snapshot = await this.aggregateSnapshot(registry);
      const now = this.now();
      const material = resolved.domain === "material";
      const projects = buildLibraryPackageProjects(resolved, {
        libraryTitles: (material ? snapshot.materials : snapshot.skills).map(
          ({ title }) => title
        ),
        groupTitles: (material
          ? snapshot.materialGroups
          : snapshot.skillGroups
        ).map(({ title }) => title),
        parents,
        now
      });
      await this.writeAndRegisterNewProjects(
        registry,
        projects.plans,
        now,
        "导入失败，且无法完整清理未注册目录。"
      );
      return ImportLibraryPackageResultSchema.parse({
        domain: resolved.domain,
        libraryIds: projects.libraryIds,
        entryCount: projects.entryCount,
        ...(projects.groupId ? { groupId: projects.groupId } : {})
      });
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
      await this.registerProject(
        registry,
        {
          id: opened.resource.id,
          domain: opened.domain,
          projectDirectory: opened.projectDirectory,
          registeredAt: this.now()
        },
        opened.domain === "book" &&
          (opened.resource as Book).bookType !== "academic"
          ? ((opened.resource as ShortBook | ScriptBook).plotStages ?? [])
          : []
      );
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
      if (manifest.bookType === "academic") {
        const validated = CurrentAcademicBookProjectManifestSchema.parse({
          ...manifest,
          revision: manifest.revision + 1,
          title: input.title ?? manifest.title,
          subtype: input.subtype ?? manifest.subtype,
          citationStyle: input.citationStyle ?? manifest.citationStyle,
          status: input.status ?? manifest.status,
          linkedMaterialIds:
            input.linkedMaterialIds === undefined
              ? manifest.linkedMaterialIds
              : [...input.linkedMaterialIds],
          linkedSkillIds:
            input.linkedSkillIds === undefined
              ? manifest.linkedSkillIds
              : [...input.linkedSkillIds],
          updatedAt: now
        });
        const snapshot = await this.aggregateSnapshot(registry);
        assertAcademicBookLibraryReferences(
          {
            title: validated.title,
            linkedMaterialIds: input.linkedMaterialIds,
            linkedSkillIds: input.linkedSkillIds
          },
          snapshot
        );
        await writeBoundedProjectJson(
          join(opened.projectDirectory, MANIFEST_FILE),
          validated,
          this.maxManifestBytes
        );
        await this.bumpRegistry(registry, now);
        return (await this.readProject(opened.projectDirectory, "book"))
          .resource as Book;
      }
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
      // Unchanged bindings may refer to deleted or temporarily unavailable
      // libraries. They must not block repairing another domain or metadata.
      assertBookLibraryReferences(
        { ...input, title: validated.title },
        snapshot
      );
      await writeBoundedProjectJson(
        join(opened.projectDirectory, MANIFEST_FILE),
        validated,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return (await this.readProject(opened.projectDirectory, "book"))
        .resource as Book;
    });
  }

  async mutatePlotStructure(
    rawInput: MutatePlotStructureInput
  ): Promise<CreativeBook> {
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
      if (manifest.bookType === "academic") {
        throw new Error("学术作品请使用学术论证框架接口管理阶段。");
      }
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }

      const now = this.now();
      const mutation = input.mutation;

      if (mutation.type === "move" || mutation.type === "reorder") {
        let plotStages = manifest.plotStages.map((stage) => ({ ...stage }));
        const stageIndex = plotStages.findIndex(
          ({ id }) => id === mutation.stageId
        );
        if (stageIndex < 0) {
          throw new Error("该剧情结构已删除或不存在。");
        }
        if (mutation.type === "reorder") {
          if (!plotStages.some(({ id }) => id === mutation.anchorId)) {
            throw new Error("目标剧情结构已删除或不存在。");
          }
          const reordered = reorderItemsByAnchor(
            plotStages,
            mutation.stageId,
            mutation.anchorId,
            mutation.position
          );
          if (!reordered.moved) {
            return CreativeBookSchema.parse(
              (await this.readProject(projectDirectory, "book", input.bookId))
                .resource
            );
          }
          plotStages = reordered.items;
        } else {
          const targetIndex =
            mutation.direction === "up" ? stageIndex - 1 : stageIndex + 1;
          if (targetIndex < 0 || targetIndex >= plotStages.length) {
            throw new Error("该剧情结构已经位于列表边界。");
          }
          const [stage] = plotStages.splice(stageIndex, 1);
          plotStages.splice(targetIndex, 0, stage!);
        }
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
        return CreativeBookSchema.parse(
          (await this.readProject(projectDirectory, "book", input.bookId))
            .resource
        );
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
        await writeBoundedProjectJson(
          join(projectDirectory, MANIFEST_FILE),
          nextManifest,
          this.maxManifestBytes
        );
        await this.bumpRegistry(registry, now);
        return CreativeBookSchema.parse(
          (await this.readProject(projectDirectory, "book", input.bookId))
            .resource
        );
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
            return CreativeBookSchema.parse(
              (await this.readProject(projectDirectory, "book", input.bookId))
                .resource
            );
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
          return CreativeBookSchema.parse(
            (await this.readProject(projectDirectory, "book", input.bookId))
              .resource
          );
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
      return CreativeBookSchema.parse(
        (await this.readProject(projectDirectory, "book", input.bookId))
          .resource
      );
    });
  }

  async mutateCharacterStructure(
    rawInput: MutateCharacterStructureInput
  ): Promise<CreativeBook> {
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
      if (manifest.bookType === "academic") {
        throw new Error("学术作品请使用学术论证框架接口管理阶段。");
      }
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
          return CreativeBookSchema.parse(
            (await this.readProject(projectDirectory, "book", input.bookId))
              .resource
          );
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
              await writeProjectTextAtomic(
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
              return CreativeBookSchema.parse(
                (await this.readProject(projectDirectory, "book", input.bookId))
                  .resource
              );
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
          } else if (mutation.type === "reorderItem") {
            if (!items.some(({ id }) => id === mutation.anchorId)) {
              throw new Error("目标人物条目已删除或不存在。");
            }
            const reordered = reorderItemsByAnchor(
              items,
              mutation.itemId,
              mutation.anchorId,
              mutation.position
            );
            if (!reordered.moved) {
              return CreativeBookSchema.parse(
                (await this.readProject(projectDirectory, "book", input.bookId))
                  .resource
              );
            }
            items.splice(0, items.length, ...reordered.items);
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
          await writeBoundedProjectJson(
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
      return CreativeBookSchema.parse(
        (await this.readProject(projectDirectory, "book", input.bookId))
          .resource
      );
    });
  }

  private academicMutationDriver(): AcademicMutationDriver {
    return {
      now: this.now,
      maxMarkdownBytes: this.maxMarkdownBytes,
      maxManifestBytes: this.maxManifestBytes,
      assertBaseRevision,
      createConflictError: (expected, actual) =>
        new FolderCatalogConflictError(expected, actual),
      readAcademicBook: async (projectDirectory, bookId) =>
        AcademicBookSchema.parse(
          (await this.readProject(projectDirectory, "book", bookId)).resource
        ),
      bumpRegistry: (registry, now) => this.bumpRegistry(registry, now)
    };
  }

  private async readAcademicBookContext(bookId: string): Promise<{
    registry: FolderCatalogRegistry;
    projectDirectory: string;
    manifest: CurrentAcademicBookProjectManifest;
  }> {
    const registry = await this.ensureRegistry();
    const registration = findRegistration(registry, bookId, "book");
    const projectDirectory = await secureProjectRoot(
      registration.projectDirectory
    );
    const manifest = await this.readCurrentBookManifest(
      projectDirectory,
      bookId
    );
    if (manifest.bookType !== "academic") {
      throw new Error("当前作品不是学术作品。");
    }
    return { registry, projectDirectory, manifest };
  }

  async mutateAcademicFramework(
    rawInput: MutateAcademicFrameworkInput
  ): Promise<AcademicBook> {
    return await this.mutate(async () => {
      const { registry, projectDirectory, manifest } =
        await this.readAcademicBookContext(rawInput.bookId);
      return await executeMutateAcademicFramework({
        projectDirectory,
        manifest,
        rawInput,
        registry,
        driver: this.academicMutationDriver()
      });
    });
  }

  async createAcademicReferenceCard(
    rawInput: CreateAcademicReferenceCardInput
  ): Promise<CreateAcademicReferenceCardResult> {
    return await this.mutate(async () => {
      const { registry, projectDirectory, manifest } =
        await this.readAcademicBookContext(rawInput.bookId);
      return await executeCreateAcademicReferenceCard({
        projectDirectory,
        manifest,
        rawInput,
        registry,
        driver: this.academicMutationDriver()
      });
    });
  }

  async updateAcademicReferenceCard(
    rawInput: UpdateAcademicReferenceCardInput
  ): Promise<UpdateAcademicReferenceCardResult> {
    return await this.mutate(async () => {
      const { registry, projectDirectory, manifest } =
        await this.readAcademicBookContext(rawInput.bookId);
      return await executeUpdateAcademicReferenceCard({
        projectDirectory,
        manifest,
        rawInput,
        registry,
        driver: this.academicMutationDriver()
      });
    });
  }

  async deleteAcademicReferenceCard(
    rawInput: DeleteAcademicReferenceCardInput
  ): Promise<DeleteAcademicReferenceCardResult> {
    return await this.mutate(async () => {
      const { registry, projectDirectory, manifest } =
        await this.readAcademicBookContext(rawInput.bookId);
      return await executeDeleteAcademicReferenceCard({
        projectDirectory,
        manifest,
        rawInput,
        registry,
        driver: this.academicMutationDriver()
      });
    });
  }

  async mutateAcademicManuscript(
    rawInput: MutateAcademicManuscriptInput
  ): Promise<MutateAcademicManuscriptResult> {
    return await this.mutate(async () => {
      const { registry, projectDirectory, manifest } =
        await this.readAcademicBookContext(rawInput.bookId);
      return await executeMutateAcademicManuscript({
        projectDirectory,
        manifest,
        rawInput,
        registry,
        driver: this.academicMutationDriver()
      });
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
      if (manifest.bookType === "academic") continue;
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
      if (manifest.bookType === "academic") continue;
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
      await writeBoundedProjectJson(
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
      if (manifest.bookType === "academic") continue;
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
      await writeBoundedProjectJson(
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
      if (manifest.bookType === "academic") continue;
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
          await writeBoundedProjectJson(
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
        await writeBoundedProjectJson(
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
    this.assertNotBuiltinCatalogProject(
      input.groupId,
      "内置资料分组为只读，不能修改，请先复制后再自定义。"
    );
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
      assertUniqueGroupMembers(input.memberIds);
      if (input.domain === "material") {
        const libraries = new Map(
          snapshot.materials.map((library) => [library.id, library])
        );
        for (const libraryId of input.memberIds) {
          this.assertNotBuiltinCatalogProject(
            libraryId,
            "内置资料库不能加入自定义分组，请先复制后再分组。"
          );
          const library = libraries.get(libraryId);
          if (library?.isBuiltin)
            throw new Error("内置资料库不能加入自定义分组，请先复制后再分组。");
          if (library?.isUnbound) throw new Error("未绑定收纳区不能加入分组。");
          if (!library) {
            throw new Error(`素材分组引用了不存在的素材库：${libraryId}`);
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
        for (const libraryId of input.memberIds) {
          this.assertNotBuiltinCatalogProject(
            libraryId,
            "内置资料库不能加入自定义分组，请先复制后再分组。"
          );
          const library = libraries.get(libraryId);
          if (library?.isBuiltin)
            throw new Error("内置资料库不能加入自定义分组，请先复制后再分组。");
          if (library?.isUnbound) throw new Error("未绑定收纳区不能加入分组。");
          if (!library) {
            throw new Error(`技能分组引用了不存在的技能库：${libraryId}`);
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
        memberIds: [...input.memberIds],
        updatedAt: now
      };
      const validated =
        input.domain === "material"
          ? FolderMaterialGroupProjectManifestSchema.parse(next)
          : FolderSkillGroupProjectManifestSchema.parse(next);
      await writeBoundedProjectJson(
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
    return this.saveDocumentWithLock(rawInput, false);
  }

  async withDocumentVersions<T>(
    bookId: string,
    documentId: string,
    operation: (
      versions: DocumentVersionStore,
      current: import("@deepwrite/contracts").CatalogReadDocumentResult,
      save: (content: string) => Promise<SaveDocumentResult>
    ) => Promise<T>
  ): Promise<T> {
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(registry, bookId, "book");
      const directory = await secureProjectRoot(registration.projectDirectory);
      return withProjectTransactionLock(directory, async () => {
        const current = await this.readDocument({
          projectId: bookId,
          target: "document",
          documentId
        });
        const versions = new DocumentVersionStore(
          directory,
          { workspace: "catalog", bookId, documentId },
          this.maxMarkdownBytes,
          this.now
        );
        return operation(versions, current, (content) =>
          this.saveDocumentWithLock(
            {
              bookId,
              documentId,
              content,
              baseProjectRevision: current.projectRevision,
              baseRevision: current.revision
            },
            true
          )
        );
      });
    });
  }

  private async saveDocumentWithLock(
    rawInput: SaveFolderDocumentInput,
    lockHeld: boolean
  ): Promise<SaveDocumentResult> {
    const input = SaveDocumentInputSchema.parse(rawInput);
    if (
      input.preserveCurrentContent &&
      input.title === undefined &&
      !input.draftSectionChange
    ) {
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
      if (!lockHeld)
        return withProjectTransactionLock(projectDirectory, () =>
          this.saveDocumentWithLock(input, true)
        );
      const manifest = await this.readCurrentBookManifest(
        projectDirectory,
        input.bookId
      );
      if (manifest.bookType === "academic") {
        return await saveAcademicDocumentWithLock({
          projectDirectory,
          manifest,
          input,
          registry,
          driver: this.academicMutationDriver()
        });
      }
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
      if (
        input.draftSectionChange &&
        (draftTarget?.kind !== "body" ||
          !input.preserveCurrentContent ||
          input.title !== undefined)
      )
        throw new Error("小节属性修改必须指定正文文档并保留原文。");
      const changesDraftSectionTitle = Boolean(
        draftTarget?.kind === "body" &&
        input.title !== undefined &&
        input.title !== draft.sections[draftTarget.sectionIndex]?.title
      );
      if (
        !input.force &&
        (regularDocumentIndex >= 0 ||
          !draftTarget ||
          changesDraftSectionTitle ||
          input.draftSectionChange)
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
                  candidate.title.toLocaleLowerCase() ===
                    sectionTitle.toLocaleLowerCase()
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
          if (input.draftSectionChange) {
            applyDraftSectionChange(
              draft.sections,
              draftTarget.sectionIndex,
              input.draftSectionChange,
              (expected, actual) =>
                new FolderCatalogConflictError(expected, actual)
            );
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
      if (input.versionOrigin && !input.preserveCurrentContent) {
        await captureDocumentVersions(
          new DocumentVersionStore(
            projectDirectory,
            {
              workspace: "catalog",
              bookId: input.bookId,
              documentId: input.documentId
            },
            this.maxMarkdownBytes,
            this.now
          ),
          currentContent,
          committedContent,
          input.versionOrigin
        );
      }
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
      if (manifest.bookType === "academic") {
        throw new Error("学术作品请使用学术论证框架接口管理阶段。");
      }
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
      if (manifest.bookType === "academic") {
        throw new Error("学术作品请使用学术正文目录接口管理小节。");
      }
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
        manifest.draft.sections.map(({ title }) => title.toLocaleLowerCase())
      );
      for (const section of createdSections) {
        if (seenDraftSectionTitles.has(section.title.toLocaleLowerCase())) {
          throw new Error(
            `正文目录已存在同名${
              manifest.bookType === "script" ? "剧集" : "小节"
            }“${section.title}”。`
          );
        }
        seenDraftSectionTitles.add(section.title.toLocaleLowerCase());
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
      if (next.bookType === "academic") {
        throw new Error("学术作品不支持短篇/剧本小节创建接口。");
      }
      const files = await Promise.all(
        createdSections.flatMap((section, index) => [
          secureWritableProjectPath(projectDirectory, section.body.path).then(
            (target) => ({
              target,
              content: input.sections[index]!.bodyContent ?? ""
            })
          ),
          secureWritableProjectPath(
            projectDirectory,
            section.characterState.path
          ).then((target) => ({
            target,
            content: input.sections[index]!.stateContent ?? ""
          }))
        ])
      );
      const batchBytes = files.reduce(
        (sum, file) => sum + Buffer.byteLength(file.content, "utf8"),
        0
      );
      if (batchBytes) {
        const remaining =
          this.maxProjectContentBytes -
          Buffer.byteLength(JSON.stringify(next), "utf8") -
          batchBytes;
        if (remaining < 0)
          throw new Error(
            `项目 Markdown 总量超过 ${this.maxProjectContentBytes} 字节安全上限。`
          );
        await inspectProjectMarkdownMetadata(
          projectDirectory,
          manifest,
          this.maxMarkdownBytes,
          remaining
        );
      }
      await commitProjectFileCreations(
        files,
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      if (input.versionOrigin) {
        for (const [index, section] of createdSections.entries()) {
          const requested = input.sections[index]!;
          for (const [doc, content] of [
            [section.body, requested.bodyContent],
            [section.characterState, requested.stateContent]
          ] as const) {
            if (content)
              await captureDocumentVersions(
                new DocumentVersionStore(
                  projectDirectory,
                  {
                    workspace: "catalog",
                    bookId: input.bookId,
                    documentId: doc.id
                  },
                  this.maxMarkdownBytes,
                  this.now
                ),
                "",
                content,
                input.versionOrigin
              );
          }
        }
      }
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
      if (manifest.bookType === "academic") {
        throw new Error("学术作品请使用学术论证框架接口管理阶段。");
      }
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
      await writeBoundedProjectJson(
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
      if (manifest.bookType === "academic") {
        throw new Error("学术作品请使用学术论证框架接口管理阶段。");
      }
      if (!input.force) {
        assertBaseRevision(input.baseProjectRevision, manifest.revision);
      }
      let sections = [...manifest.draft.sections];
      const sectionIndex = sections.findIndex(
        ({ id }) => id === input.sectionId
      );
      if (sectionIndex < 0) {
        throw new Error("该正文小节已删除或不存在。");
      }
      if (input.direction !== undefined) {
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
      } else {
        const anchorSectionId = input.anchorSectionId!;
        if (!sections.some(({ id }) => id === anchorSectionId)) {
          throw new Error("目标正文小节已删除或不存在。");
        }
        const reordered = reorderItemsByAnchor(
          sections,
          input.sectionId,
          anchorSectionId,
          input.position!
        );
        if (!reordered.moved) {
          return {
            bookId: input.bookId,
            sectionId: input.sectionId,
            moved: false,
            projectRevision: manifest.revision
          };
        }
        sections = reordered.items;
      }
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
      await writeBoundedProjectJson(
        join(projectDirectory, MANIFEST_FILE),
        next,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return {
        bookId: input.bookId,
        sectionId: input.sectionId,
        ...(input.direction !== undefined
          ? { direction: input.direction }
          : {}),
        moved: true,
        projectRevision: next.revision
      };
    });
  }

  async saveLibraryEntry(
    rawInput: SaveLibraryEntryInput
  ): Promise<MaterialEntry | SkillEntry> {
    const input = SaveLibraryEntryInputSchema.parse(rawInput);
    this.assertNotBuiltinCatalogProject(input.libraryId);
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
      if (manifest.kind === "deepwrite.skill-library" && manifest.isBuiltin) {
        throw new Error("内置技能库条目为只读内容，不能修改。");
      }
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
    this.assertNotBuiltinCatalogProject(libraryId);
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
      if (manifest.kind === "deepwrite.skill-library" && manifest.isBuiltin) {
        throw new Error("内置技能库为只读内容，不能新增条目。");
      }
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

  async importLibraryEntries(
    rawInput: ImportLibraryEntriesInput
  ): Promise<ImportLibraryEntriesResult> {
    const input = ImportLibraryEntriesInputSchema.parse(rawInput);
    this.assertNotBuiltinCatalogProject(
      input.libraryId,
      "内置资料库为只读内容，不能导入条目。"
    );
    for (const entry of input.entries) {
      assertTextByteLength(
        entry.content,
        this.maxMarkdownBytes,
        "Markdown content"
      );
    }
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(
        registry,
        input.libraryId,
        libraryProjectDomain(input.domain)
      );
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const manifest = await this.readManifest(
        projectDirectory,
        input.domain === "material"
          ? "deepwrite.material-library"
          : "deepwrite.skill-library",
        input.libraryId
      );
      assertBaseRevision(input.baseProjectRevision, manifest.revision);
      if (manifest.kind === "deepwrite.skill-library" && manifest.isBuiltin) {
        throw new Error("内置技能库为只读内容，不能导入条目。");
      }
      if (
        manifest.entries.length + input.entries.length >
        CATALOG_PROJECT_MAX_CONTENT_ITEMS
      ) {
        throw new Error("导入条目数量超过资料库容量，请减少选择后重试。");
      }

      const now = this.now();
      const occupiedTitles = new Set(
        manifest.entries.map((entry) =>
          entry.title.normalize("NFC").toLocaleLowerCase("en-US")
        )
      );
      const usedPaths = new Set(
        manifest.entries.map((entry) => portableContentPathKey(entry.path))
      );
      const createdEntries: Array<MaterialEntry | SkillEntry> = [];
      const manifestEntries: Array<
        | MaterialLibraryProjectManifest["entries"][number]
        | SkillLibraryProjectManifest["entries"][number]
      > = [];
      const files: Array<{ target: string; content: string }> = [];

      for (const source of input.entries) {
        const title = nextImportedEntryTitle(source.title, occupiedTitles);
        const id = createCatalogId(`${input.domain}-entry`);
        const path = await uniqueRelativeMarkdownPath(
          projectDirectory,
          "entries",
          id,
          usedPaths
        );
        usedPaths.add(portableContentPathKey(path));
        files.push({
          target: await secureWritableProjectPath(projectDirectory, path),
          content: source.content
        });
        if (manifest.kind === "deepwrite.material-library") {
          const stageId: MaterialStageId =
            (source.stageId as MaterialStageId) ??
            (manifest.materialKind === "character"
              ? "character"
              : manifest.materialKind === "gimmick"
                ? "gimmick"
                : manifest.materialKind === "plot"
                  ? "pacing"
                  : manifest.materialKind === "draft"
                    ? "draft_excerpt"
                    : "other");
          const entry = {
            id,
            stageId,
            title,
            path,
            createdAt: now,
            updatedAt: now
          };
          manifestEntries.push(entry);
          createdEntries.push({ ...entry, body: source.content });
        } else {
          const stageId: SkillStageId =
            (source.stageId as SkillStageId) ??
            (manifest.skillKind === "plot" ? "plot_design" : "draft");
          const entry = {
            id,
            stageId,
            title,
            path,
            createdAt: now,
            updatedAt: now
          };
          manifestEntries.push(entry);
          createdEntries.push({ ...entry, body: source.content });
        }
      }

      const nextManifest =
        manifest.kind === "deepwrite.material-library"
          ? FolderMaterialProjectManifestSchema.parse({
              ...manifest,
              revision: manifest.revision + 1,
              updatedAt: now,
              entries: [...manifest.entries, ...manifestEntries]
            })
          : FolderSkillProjectManifestSchema.parse({
              ...manifest,
              revision: manifest.revision + 1,
              updatedAt: now,
              entries: [...manifest.entries, ...manifestEntries]
            });
      await commitProjectFileCreations(
        files,
        join(projectDirectory, MANIFEST_FILE),
        nextManifest,
        this.maxMarkdownBytes,
        this.maxManifestBytes
      );
      await this.bumpRegistry(registry, now);
      return { entries: createdEntries };
    });
  }

  async moveLibraryEntry(
    rawInput: MoveLibraryEntryInput
  ): Promise<MoveLibraryEntryResult> {
    const input = MoveLibraryEntryInputSchema.parse(rawInput);
    this.assertNotBuiltinCatalogProject(
      input.sourceLibraryId,
      "内置资料库条目为只读，不能移动。"
    );
    this.assertNotBuiltinCatalogProject(
      input.targetLibraryId,
      "内置资料库为只读，不能移入条目。"
    );
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
      if (input.sourceLibraryId === input.targetLibraryId) {
        const remaining = sourceManifest.entries.filter(
          ({ id }) => id !== input.entryId
        );
        const before = remaining.find(
          (entry) => entry.id === input.beforeEntryId
        );
        const anchor = before ?? remaining.at(-1);
        if (anchor) {
          const plan = await this.previewLibraryStructure({
            domain: input.domain,
            requestId: randomUUID(),
            operations: [
              {
                action: "reorder-entry",
                libraryId: input.sourceLibraryId,
                id: input.entryId,
                anchorId: anchor.id,
                position: before ? "before" : "after"
              }
            ]
          });
          await this.applyLibraryStructure(plan);
        }
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
      let targetStageId: MaterialStageId | undefined;
      if (
        sourceManifest.kind === "deepwrite.material-library" &&
        targetManifest.kind === "deepwrite.material-library"
      ) {
        const materialEntry =
          sourceEntry as MaterialLibraryProjectManifest["entries"][number];
        targetStageId = input.targetStageId ?? materialEntry.stageId;
      } else if (input.targetStageId !== undefined) {
        throw new Error("只有素材条目可以调整内容阶段。");
      }
      if (targetManifest.entries.some(({ id }) => id === sourceEntry.id)) {
        throw new Error("目标资料库已存在同 ID 条目，无法移动。");
      }
      const plan = await this.previewLibraryStructure({
        domain: input.domain,
        requestId: randomUUID(),
        operations: [
          {
            action: "move-entries",
            libraryId: input.sourceLibraryId,
            entryIds: [input.entryId],
            target: { kind: "library", libraryId: input.targetLibraryId },
            ...(targetStageId ? { targetStageId } : {}),
            ...(input.beforeEntryId
              ? { beforeEntryId: input.beforeEntryId }
              : {})
          }
        ]
      });
      await this.applyLibraryStructure(plan);
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
    this.assertNotBuiltinCatalogProject(libraryId, "内置资料库条目不能删除。");
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = findRegistration(
        registry,
        libraryId,
        libraryProjectDomain(domain)
      );
      const directory = await secureProjectRoot(registration.projectDirectory);
      const manifest = await this.readManifest(
        directory,
        domain === "material"
          ? "deepwrite.material-library"
          : "deepwrite.skill-library",
        libraryId
      );
      if (!rawInput.force)
        assertBaseRevision(rawInput.baseProjectRevision, manifest.revision);
      if (manifest.kind === "deepwrite.skill-library" && manifest.isBuiltin)
        throw new Error("内置技能库条目不能删除。");
      const entry = manifest.entries.find((item) => item.id === entryId);
      if (!entry) return { libraryId, entryId, deleted: false };
      const content = await readProjectMarkdown(
        directory,
        entry.path,
        this.maxMarkdownBytes
      );
      if (
        !rawInput.force &&
        rawInput.baseRevision !== undefined &&
        rawInput.baseRevision !== createShortWorkspaceContentRevision(content)
      )
        throw new FolderCatalogConflictError(
          rawInput.baseRevision,
          createShortWorkspaceContentRevision(content)
        );
      const plan = await this.previewLibraryStructure({
        domain,
        requestId: createCatalogId("remove-entry"),
        operations: [
          { action: "delete-entries", libraryId, entryIds: [entryId] }
        ]
      });
      await this.applyLibraryStructure(plan);
      return { libraryId, entryId, deleted: true };
    });
  }

  async unregisterProject(
    rawInput: UnregisterFolderCatalogProjectInput
  ): Promise<UnregisterFolderCatalogProjectResult> {
    const projectId = parseId(rawInput.projectId);
    const domain = parseUnregisterDomain(rawInput.domain);
    this.assertNotBuiltinCatalogProject(
      projectId,
      "内置资料库或分组不能移除。"
    );
    const registryDomain = registryDomainForUnregister(domain);
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const registration = registry.projects.find(
        (project) =>
          project.id === projectId && project.domain === registryDomain
      );
      const isUnboundLibrary =
        (registryDomain === "material-library" ||
          registryDomain === "skill-library") &&
        (registry.libraryOrganization?.unboundLibraryIds.includes(projectId) ??
          false);
      if (
        isUnboundLibrary &&
        registration &&
        (await this.isRegisteredProjectReadable(registration))
      ) {
        throw new Error("未绑定收纳区不能作为正式库修改或移除。");
      }
      const projects = registry.projects.filter(
        (project) =>
          !(project.id === projectId && project.domain === registryDomain)
      );
      const unregistered = projects.length !== registry.projects.length;
      if (unregistered) {
        const now = this.now();
        const nextLibraryOrganization = pruneProjectFromLibraryOrganization(
          registry.libraryOrganization,
          registryDomain,
          projectId
        );
        const nextRegistry: FolderCatalogRegistry = {
          ...registry,
          ...(nextLibraryOrganization === undefined
            ? {}
            : { libraryOrganization: nextLibraryOrganization }),
          revision: registry.revision + 1,
          updatedAt: now,
          projects
        };
        await this.writeRegistry(nextRegistry);
        if (
          registryDomain === "material-library" ||
          registryDomain === "skill-library"
        ) {
          await scrubAcademicBookLibraryBindings({
            registry: nextRegistry,
            removedMaterialIds:
              registryDomain === "material-library"
                ? new Set([projectId])
                : new Set(),
            removedSkillIds:
              registryDomain === "skill-library"
                ? new Set([projectId])
                : new Set(),
            readBookManifest: (dir, id) =>
              this.readCurrentBookManifest(dir, id),
            maxManifestBytes: this.maxManifestBytes,
            now
          });
        }
      }
      return { projectId, domain, unregistered };
    });
  }

  async deleteProject(
    rawInput: DeleteFolderCatalogProjectInput
  ): Promise<DeleteFolderCatalogProjectResult> {
    this.assertNotBuiltinCatalogProject(
      rawInput.projectId,
      "内置资料库或分组不能删除。"
    );
    return await this.mutate(async () => {
      const registry = await this.ensureRegistry();
      if (
        registry.libraryOrganization?.unboundLibraryIds.includes(
          rawInput.projectId
        )
      )
        throw new Error("未绑定收纳区不能删除。");
      const result = await deleteRegisteredProject(registry, rawInput, {
        now: this.now,
        readProject: (directory, domain, id) =>
          this.readProject(directory, domain, id),
        assertBaseRevision,
        writeRegistry: (next) => this.writeRegistry(next)
      });
      if (result.deleted && result.domain !== "book") {
        const updatedRegistry = await this.ensureRegistry();
        const removedIds = new Set<string>([
          ...(result.domain === "material" || result.domain === "skill"
            ? [result.projectId]
            : []),
          ...(result.deletedMemberLibraryIds ?? [])
        ]);
        const isMaterialDomain =
          result.domain === "material" || result.domain === "material-group";
        await scrubAcademicBookLibraryBindings({
          registry: updatedRegistry,
          removedMaterialIds: isMaterialDomain ? removedIds : new Set(),
          removedSkillIds: isMaterialDomain ? new Set() : removedIds,
          readBookManifest: (dir, id) => this.readCurrentBookManifest(dir, id),
          maxManifestBytes: this.maxManifestBytes,
          now: this.now()
        });
      }
      return result;
    });
  }

  async duplicateProject(
    rawInput: DuplicateCatalogProjectInput,
    targetParents?: Partial<Record<FolderCatalogProjectDomain, string>>
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
          parentDirectory:
            targetParents?.book?.trim() ||
            dirname(registration.projectDirectory),
          resource: primaryResource,
          writingContext: sourceWritingContext.content,
          sourceBookDirectory: registration.projectDirectory
        });
      } else if (input.domain === "material" || input.domain === "skill") {
        const registryDomain = libraryProjectDomain(input.domain);
        const libraries =
          input.domain === "material" ? snapshot.materials : snapshot.skills;
        const source = libraries.find(({ id }) => id === input.projectId);
        if (!source) throw new Error("未找到要复制的资料库。");
        const isBuiltinSource = this.isVirtualBuiltinId(source.id);
        const registration = isBuiltinSource
          ? undefined
          : findRegistration(registry, source.id, registryDomain);
        const titlePool =
          input.domain === "material" ? materialTitles : skillTitles;
        const title = nextCopyTitle(source.title, titlePool);
        primaryResource = duplicateLibraryResource(source, title, now);
        plans.push({
          domain: registryDomain,
          parentDirectory:
            targetParents?.[registryDomain]?.trim() ||
            (isBuiltinSource || ("isBuiltin" in source && source.isBuiltin)
              ? this.defaultProjectParents[registryDomain]
              : dirname(registration!.projectDirectory)),
          resource: primaryResource
        });
      } else if (input.domain === "material-group") {
        const source = snapshot.materialGroups.find(
          ({ id }) => id === input.projectId
        );
        if (!source) throw new Error("未找到要复制的素材分组。");
        const isBuiltinGroup = this.isVirtualBuiltinId(source.id);
        const sourceGroupRegistration = isBuiltinGroup
          ? undefined
          : findRegistration(registry, source.id, "material-group");
        const copiedBySourceId = new Map<string, MaterialLibrary>();
        const memberIds: string[] = [];
        for (const libraryId of source.memberIds) {
          if (!libraryId) continue;
          let copied = copiedBySourceId.get(libraryId);
          if (!copied) {
            const library = snapshot.materials.find(
              ({ id }) => id === libraryId
            );
            if (!library) {
              throw new Error(`素材分组成员不存在或不可读取：${libraryId}`);
            }
            const isBuiltinMember = this.isVirtualBuiltinId(library.id);
            const registration = isBuiltinMember
              ? undefined
              : findRegistration(registry, library.id, "material-library");
            const title = nextCopyTitle(library.title, materialTitles);
            materialTitles.push(title);
            copied = duplicateLibraryResource(library, title, now);
            copiedBySourceId.set(libraryId, copied);
            copiedMemberLibraryIds.push(copied.id);
            plans.push({
              domain: "material-library",
              parentDirectory:
                targetParents?.["material-library"]?.trim() ||
                (isBuiltinMember || library.isBuiltin
                  ? this.defaultProjectParents["material-library"]
                  : dirname(registration!.projectDirectory)),
              resource: copied
            });
          }
          memberIds.push(copied.id);
        }
        const title = nextCopyTitle(
          source.title,
          snapshot.materialGroups.map((group) => group.title)
        );
        primaryResource = MaterialLibraryGroupSchema.parse({
          id: createCatalogId("material-group"),
          title,
          memberIds,
          createdAt: now,
          updatedAt: now
        });
        plans.push({
          domain: "material-group",
          parentDirectory:
            targetParents?.["material-group"]?.trim() ||
            (isBuiltinGroup
              ? this.defaultProjectParents["material-group"]
              : dirname(sourceGroupRegistration!.projectDirectory)),
          resource: primaryResource
        });
      } else {
        const source = snapshot.skillGroups.find(
          ({ id }) => id === input.projectId
        );
        if (!source) throw new Error("未找到要复制的技能分组。");
        const isBuiltinGroup = this.isVirtualBuiltinId(source.id);
        const sourceGroupRegistration = isBuiltinGroup
          ? undefined
          : findRegistration(registry, source.id, "skill-group");
        const copiedBySourceId = new Map<string, SkillLibrary>();
        const memberIds: string[] = [];
        for (const libraryId of source.memberIds) {
          if (!libraryId) continue;
          let copied = copiedBySourceId.get(libraryId);
          if (!copied) {
            const library = snapshot.skills.find(({ id }) => id === libraryId);
            if (!library) {
              throw new Error(`技能分组成员不存在或不可读取：${libraryId}`);
            }
            const isBuiltinMember = this.isVirtualBuiltinId(library.id);
            const registration = isBuiltinMember
              ? undefined
              : findRegistration(registry, library.id, "skill-library");
            const title = nextCopyTitle(library.title, skillTitles);
            skillTitles.push(title);
            copied = duplicateLibraryResource(library, title, now);
            copiedBySourceId.set(libraryId, copied);
            copiedMemberLibraryIds.push(copied.id);
            plans.push({
              domain: "skill-library",
              parentDirectory:
                targetParents?.["skill-library"]?.trim() ||
                (isBuiltinMember || library.isBuiltin
                  ? this.defaultProjectParents["skill-library"]
                  : dirname(registration!.projectDirectory)),
              resource: copied
            });
          }
          memberIds.push(copied.id);
        }
        const title = nextCopyTitle(
          source.title,
          snapshot.skillGroups.map((group) => group.title)
        );
        primaryResource = SkillLibraryGroupSchema.parse({
          id: createCatalogId("skill-group"),
          title,
          memberIds,
          createdAt: now,
          updatedAt: now
        });
        plans.push({
          domain: "skill-group",
          parentDirectory:
            targetParents?.["skill-group"]?.trim() ||
            (isBuiltinGroup
              ? this.defaultProjectParents["skill-group"]
              : dirname(sourceGroupRegistration!.projectDirectory)),
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
            plan.resource,
            plan.sourceBookDirectory
          );
          createdProjectDirectories.push(projectDirectory);
          if (plan.writingContext !== undefined) {
            await writeWritingContextFile(
              projectDirectory,
              plan.writingContext
            );
          }
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

  async installMarketplaceMaterial(
    rawInput: MarketplaceMaterialDetail
  ): Promise<MarketplaceMaterialInstallResult> {
    const input = MarketplaceMaterialDetailSchema.parse(rawInput);
    const identity = createHash("sha256")
      .update(JSON.stringify([input.id, input.version]))
      .digest("hex");
    const libraryId = `material-marketplace-${identity}`;
    return this.mutate(async () => {
      const registry = await this.ensureRegistry();
      const snapshot = await this.aggregateIndexSnapshot(registry);
      const existing = snapshot.materials.find(({ id }) => id === libraryId);
      if (existing) {
        return { libraryId, title: existing.title, alreadyInstalled: true };
      }
      if (
        registry.projects.some(
          ({ id, domain }) => id === libraryId && domain === "material-library"
        )
      ) {
        throw new Error("此素材库版本已注册，本地目录不可读。");
      }
      const now = this.now();
      const title = nextMarketplaceTitle(
        input.title,
        snapshot.materials.map(({ title }) => title)
      );
      const library = MaterialLibrarySchema.parse({
        id: libraryId,
        title,
        overview: input.overview,
        materialKind: input.kind,
        materialType: input.libraryType,
        parentGenre: input.parentGenre,
        subGenre: input.subGenre,
        entries: input.entries.map((entry) => ({
          ...entry,
          id: createCatalogId("material-entry"),
          createdAt: now,
          updatedAt: now
        })),
        createdAt: now,
        updatedAt: now
      });
      await this.writeAndRegisterNewProjects(
        registry,
        [
          {
            domain: "material-library",
            parentDirectory: this.defaultProjectParents["material-library"],
            resource: library
          }
        ],
        now,
        "素材广场导入失败，且无法完整清理未注册目录。"
      );
      return { libraryId, title, alreadyInstalled: false };
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

      if (input.source.contentType === "skill" || input.targetLibraryId) {
        if (
          input.source.contentType !== "skill" ||
          input.createGroup ||
          input.buckets.length !== 1 ||
          input.buckets[0]!.entries.length !== 1
        ) {
          throw new Error("只有单技能可以安装到已有技能库。");
        }
        const targetLibrary = input.targetLibraryId
          ? snapshot.skills.find(({ id }) => id === input.targetLibraryId)
          : snapshot.skills.find(({ isUnbound }) => isUnbound);
        if (
          targetLibrary?.isBuiltin ||
          (input.targetLibraryId && !targetLibrary)
        ) {
          throw new Error("目标技能库不存在或不可写。");
        }
        const bucket = input.buckets[0]!;
        const remoteEntry = bucket.entries[0]!;
        const now = this.now();
        const installedEntry = {
          id: createCatalogId("skill-entry"),
          stageId: remoteEntry.stageId,
          title: remoteEntry.title,
          createdAt: now,
          updatedAt: now,
          marketplaceSource: { ...input.source, installedAt: now },
          sourceSkillId: remoteEntry.marketplaceSkillId
        };
        if (!targetLibrary) {
          const library = SkillLibrarySchema.parse({
            id: createCatalogId("skill"),
            title: "未绑定技能",
            skillType: bucket.libraryType,
            skillKind: "general",
            overview: "",
            isBuiltin: false,
            entries: [{ ...installedEntry, body: remoteEntry.content }],
            createdAt: now,
            updatedAt: now
          });
          const organization =
            registry.libraryOrganization ?? emptyLibraryOrganization();
          await this.writeAndRegisterNewProjects(
            {
              ...registry,
              libraryOrganization: {
                ...organization,
                revision: organization.revision + 1,
                unboundLibraryIds: [
                  ...organization.unboundLibraryIds,
                  library.id
                ]
              }
            },
            [
              {
                domain: "skill-library",
                parentDirectory: this.defaultProjectParents["skill-library"],
                resource: library
              }
            ],
            now,
            "技能广场安装失败，且无法完整清理未注册目录。"
          );
          return CatalogInstallMarketplaceSkillContentResultSchema.parse({
            source: sourceRef,
            version: input.source.version,
            title: remoteEntry.title,
            alreadyInstalled: false,
            libraryIds: [library.id]
          });
        }
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
        const path = await uniqueRelativeMarkdownPath(
          projectDirectory,
          "entries",
          installedEntry.id,
          new Set(
            manifest.entries.map((entry) => portableContentPathKey(entry.path))
          )
        );
        const title = nextMarketplaceTitle(
          remoteEntry.title,
          manifest.entries.map((entry) => entry.title)
        );
        const next = FolderSkillProjectManifestSchema.parse({
          ...manifest,
          revision: manifest.revision + 1,
          updatedAt: now,
          entries: [...manifest.entries, { ...installedEntry, title, path }]
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
          memberIds: libraryIds,
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
    await recoverStructureTransaction(dirname(this.registryPath));
    const existing = await this.readRegistryOptional();
    if (existing) {
      return existing;
    }
    if (this.initialSnapshot) {
      const snapshot = this.initialSnapshot;
      const base = emptyRegistry(snapshot.updatedAt);
      base.creativePlotStages = mergeCreativePlotStageDefinitions(
        snapshot.creativePlotStages,
        snapshot.books.flatMap((book) =>
          book.bookType === "academic" ? [] : book.plotStages
        )
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
          await writeBoundedProjectJson(
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
    await writeBoundedProjectJson(
      this.registryPath,
      registry,
      this.maxManifestBytes
    );
    try {
      await writeBoundedProjectJson(
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
    if (!next.libraryOrganization && snapshot.libraryOrganization)
      next.libraryOrganization = structuredClone(snapshot.libraryOrganization);
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

  /** Writes new projects, then registers them in one registry write. */
  private async writeAndRegisterNewProjects(
    registry: FolderCatalogRegistry,
    plans: readonly LibraryPackageProjectPlan[],
    now: string,
    cleanupFailureMessage: string
  ): Promise<void> {
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
        throw new AggregateError([error, cleanupError], cleanupFailureMessage);
      }
      throw error;
    }
  }

  private async writeNewResourceProject(
    domain: FolderCatalogProjectDomain,
    parentDirectory: string,
    resource: FolderCatalogResource,
    sourceBookDirectory?: string
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
        if (sourceBookDirectory) {
          await copyBookImages(sourceBookDirectory, stagingDirectory);
        }
      }
      await writeBoundedProjectJson(
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

  private async isRegisteredProjectReadable(
    project: RegistryProject
  ): Promise<boolean> {
    try {
      const { projectDirectory, manifest } =
        await this.readManifestWithoutContent(
          project.projectDirectory,
          kindForDomain(project.domain),
          project.id
        );
      const manifestBytes = Buffer.byteLength(JSON.stringify(manifest), "utf8");
      if (manifestBytes >= this.maxProjectContentBytes) {
        return false;
      }
      await inspectProjectMarkdownMetadata(
        projectDirectory,
        manifest,
        this.maxMarkdownBytes,
        this.maxProjectContentBytes - manifestBytes
      );
      return true;
    } catch {
      return false;
    }
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
    project: RegistryProject,
    plotStages: readonly CreativePlotStage[] = []
  ): Promise<void> {
    await registerCatalogProject(registry, project, plotStages, {
      secureProjectRoot,
      pathExists,
      now: this.now,
      writeRegistry: (next) => this.writeRegistry(next)
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
    const creativePlotStages = await persistCreativePlotStageDefinitions(
      registry,
      books.flatMap((book) =>
        book.bookType === "academic" ? [] : book.plotStages
      ),
      (next) => this.writeRegistry(next)
    );
    const now = this.now();
    for (let index = 0; index < books.length; index += 1) {
      const book = books[index]!;
      if (book.bookType === "academic") continue;
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
      if (manifest.bookType === "academic") continue;
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
        await writeProjectTextAtomic(
          await secureWritableProjectPath(projectDirectory, file.path),
          file.content
        );
      }
      await writeBoundedProjectJson(
        join(projectDirectory, MANIFEST_FILE),
        nextManifest,
        this.maxManifestBytes
      );
      books[index] = (await this.readProject(projectDirectory, "book", book.id))
        .resource as Book;
    }
    const snapshotMaterials = materials.map((library) => ({
      ...library,
      ...(registry.libraryOrganization?.unboundLibraryIds.includes(library.id)
        ? { isUnbound: true }
        : {})
    }));
    const snapshotSkills = skills.map((library) => ({
      ...library,
      ...(registry.libraryOrganization?.unboundLibraryIds.includes(library.id)
        ? { isUnbound: true }
        : {})
    }));
    return CatalogSnapshotSchema.parse({
      schemaVersion: 1,
      revision: registry.revision,
      libraryOrganization: registry.libraryOrganization,
      creativePlotStages,
      books,
      materials: this.includeBuiltinLibraries
        ? mergeUniqueById(snapshotMaterials, getBuiltinMaterialLibraries())
        : snapshotMaterials,
      materialGroups: this.includeBuiltinLibraries
        ? mergeUniqueById(materialGroups, getBuiltinMaterialGroups())
        : materialGroups,
      skills: this.includeBuiltinLibraries
        ? mergeUniqueById(snapshotSkills, getBuiltinSkillLibraries())
        : snapshotSkills,
      skillGroups: this.includeBuiltinLibraries
        ? mergeUniqueById(skillGroups, getBuiltinSkillGroups())
        : skillGroups,
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

    const creativePlotStages = await persistCreativePlotStageDefinitions(
      registry,
      books.flatMap((book) =>
        book.bookType === "academic" ? [] : book.plotStages
      ),
      (next) => this.writeRegistry(next)
    );
    const indexMaterials = materials.map((library) => ({
      ...library,
      ...(registry.libraryOrganization?.unboundLibraryIds.includes(library.id)
        ? { isUnbound: true }
        : {})
    }));
    const indexSkills = skills.map((library) => ({
      ...library,
      ...(registry.libraryOrganization?.unboundLibraryIds.includes(library.id)
        ? { isUnbound: true }
        : {})
    }));
    return CatalogIndexSnapshotSchema.parse({
      schemaVersion: 1,
      revision: registry.revision,
      libraryOrganization: registry.libraryOrganization,
      creativePlotStages,
      books,
      materials: this.includeBuiltinLibraries
        ? mergeUniqueById(indexMaterials, getBuiltinIndexMaterialLibraries())
        : indexMaterials,
      materialGroups: this.includeBuiltinLibraries
        ? mergeUniqueById(materialGroups, getBuiltinMaterialGroups())
        : materialGroups,
      skills: this.includeBuiltinLibraries
        ? mergeUniqueById(indexSkills, getBuiltinIndexSkillLibraries())
        : indexSkills,
      skillGroups: this.includeBuiltinLibraries
        ? mergeUniqueById(skillGroups, getBuiltinSkillGroups())
        : skillGroups,
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
    if (this.mutationScope.getStore()) return operation();
    let result: Result | undefined;
    let failure: unknown;
    const pending = this.writeChain.then(() =>
      this.mutationScope.run(true, async () => {
        try {
          result = await operation();
        } catch (error: unknown) {
          failure = error;
        }
      })
    );
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
  const {
    projectRevision: _projectRevision,
    isBuiltin: _isBuiltin,
    ...copyable
  } = source;
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

function mergeUniqueById<Item extends { id: string }>(
  existing: readonly Item[],
  additions: readonly Item[]
): Item[] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...additions.filter((item) => !seen.has(item.id))];
}

function nextMarketplaceTitle(
  baseTitle: string,
  existingTitles: readonly string[]
): string {
  const normalized = new Set(
    existingTitles.map((title) => title.trim().toLocaleLowerCase())
  );
  for (let counter = 1; ; counter += 1) {
    const suffix = counter === 1 ? "" : ` (${counter})`;
    const truncated = baseTitle
      .slice(0, CATALOG_TITLE_MAX_LENGTH - suffix.length)
      .replace(/[\uD800-\uDBFF]$/u, "")
      .trimEnd();
    const title = `${truncated}${suffix}`;
    if (!normalized.has(title.trimStart().toLocaleLowerCase())) return title;
  }
}

const DRAFT_CHARACTER_STATE_TITLE_SUFFIX = " · 状态";
const CATALOG_TITLE_MAX_LENGTH = 256;

function draftCharacterStateTitle(sectionTitle: string): string {
  const availableSectionTitleLength =
    CATALOG_TITLE_MAX_LENGTH - DRAFT_CHARACTER_STATE_TITLE_SUFFIX.length;
  return `${sectionTitle.slice(0, availableSectionTitleLength)}${DRAFT_CHARACTER_STATE_TITLE_SUFFIX}`;
}

function findDraftDocumentManifest(
  draft: Extract<
    FolderCurrentBookProjectManifest,
    { bookType: "short" | "script" }
  >["draft"],
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
    if (manifest.bookType === "academic") {
      if (manifest.foundation.thesisOverview.id === documentId) {
        return manifest.foundation.thesisOverview;
      }
      if (manifest.foundation.terminology.id === documentId) {
        return manifest.foundation.terminology;
      }
      const card = manifest.foundation.cards.find(
        (item) => item.document.id === documentId
      );
      if (card) return card.document;
      const stageDoc = manifest.documents.find(({ id }) => id === documentId);
      if (stageDoc) return stageDoc;
      for (const section of manifest.manuscript.sections) {
        if (section.brief.id === documentId) return section.brief;
        if (section.body.id === documentId) return section.body;
        if (section.state.id === documentId) return section.state;
      }
      return undefined;
    }
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
      wordCountRequirement: section.wordCountRequirement ?? null,
      ...(section.bodyContent ? { bodyContent: section.bodyContent } : {}),
      ...(section.stateContent ? { stateContent: section.stateContent } : {})
    }))
  };
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

async function hydrateDraftSectionCreationResult(
  projectDirectory: string,
  manifest: Extract<
    FolderCurrentBookProjectManifest,
    { bookType: "short" | "script" }
  >,
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

function pruneProjectFromLibraryOrganization(
  organization: LibraryOrganization | undefined,
  domain: FolderCatalogProjectDomain,
  projectId: string
): LibraryOrganization | undefined {
  if (!organization || domain === "book") {
    return organization;
  }
  let changed = false;
  const filterIds = (ids: readonly string[]): string[] => {
    const next = ids.filter((id) => id !== projectId);
    if (next.length !== ids.length) changed = true;
    return next;
  };
  let material = organization.material;
  let skill = organization.skill;
  let unboundLibraryIds = organization.unboundLibraryIds;
  const groups: Record<string, string[]> = {};
  let entryLocations = organization.entryLocations;

  if (domain === "material-library" || domain === "skill-library") {
    unboundLibraryIds = filterIds(organization.unboundLibraryIds);
    if (domain === "material-library") {
      material = filterIds(organization.material);
    } else {
      skill = filterIds(organization.skill);
    }
    for (const [groupId, memberIds] of Object.entries(organization.groups)) {
      groups[groupId] = filterIds(memberIds);
    }
    if (organization.entryLocations !== undefined) {
      const nextLocations: NonNullable<LibraryOrganization["entryLocations"]> =
        {};
      for (const [key, location] of Object.entries(
        organization.entryLocations
      )) {
        if (location.libraryId === projectId) {
          changed = true;
          continue;
        }
        nextLocations[key] = location;
      }
      entryLocations = nextLocations;
    }
  } else {
    if (domain === "material-group") {
      material = filterIds(organization.material);
    } else {
      skill = filterIds(organization.skill);
    }
    for (const [groupId, memberIds] of Object.entries(organization.groups)) {
      if (groupId === projectId) {
        changed = true;
        continue;
      }
      groups[groupId] = memberIds;
    }
  }

  if (!changed) {
    return organization;
  }
  return LibraryOrganizationSchema.parse({
    revision: organization.revision + 1,
    material,
    skill,
    groups,
    unboundLibraryIds,
    ...(entryLocations === undefined ? {} : { entryLocations })
  });
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
    ...(value.libraryOrganization === undefined
      ? {}
      : {
          libraryOrganization: LibraryOrganizationSchema.parse(
            value.libraryOrganization
          )
        }),
    sourceCatalogMigrated: value.sourceCatalogMigrated,
    creativePlotStages,
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
    if (manifest.bookType === "academic") {
      return academicManifestContentItems(manifest);
    }
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

function assertBaseRevision(
  expected: number | undefined,
  actual: number
): void {
  if (expected !== undefined && expected !== actual) {
    throw new FolderCatalogConflictError(expected, actual);
  }
}

function assertUniqueGroupMembers(
  libraryIds: ReadonlyArray<string | undefined>
): void {
  const selected = libraryIds.filter((libraryId): libraryId is string =>
    Boolean(libraryId)
  );
  if (new Set(selected).size !== selected.length) {
    throw new Error("同一个资料库不能在一个分组中重复添加。");
  }
}

function assertLibraryNotInAnotherGroup(
  groups: ReadonlyArray<{
    id: string;
    title: string;
    memberIds: readonly string[];
  }>,
  libraryId: string,
  domainLabel: "素材" | "技能",
  currentGroupId?: string
): void {
  const existing = groups.find(
    (group) =>
      group.id !== currentGroupId && group.memberIds.includes(libraryId)
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
    await writeProjectTextAtomic(target, file.content);
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
  await writeBoundedProjectJson(
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
    await writeProjectTextAtomic(target, file.content);
  }
  const currentManifestText = await readRequiredUtf8File(
    join(projectDirectory, MANIFEST_FILE),
    maxManifestBytes,
    "project manifest"
  );
  if (currentManifestText !== originalManifestText) {
    throw new Error("书籍在剧情结构迁移期间被外部修改，已中止迁移。");
  }
  await writeBoundedProjectJson(
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
    await writeProjectTextAtomic(target, file.content);
  }
  const currentManifestText = await readRequiredUtf8File(
    join(projectDirectory, MANIFEST_FILE),
    maxManifestBytes,
    "project manifest"
  );
  if (currentManifestText !== originalManifestText) {
    throw new Error("书籍在人物结构迁移期间被外部修改，已中止迁移。");
  }
  await writeBoundedProjectJson(
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
      if (book.bookType === "academic") {
        const writeDoc = async (
          dir: string,
          stem: string,
          doc: Book["documents"][number]
        ): Promise<BookProjectDocumentManifest> => {
          assertTextByteLength(
            doc.content,
            maxMarkdownBytes,
            "Markdown content"
          );
          const path = await uniqueRelativeMarkdownPath(
            projectDirectory,
            dir,
            stem,
            used
          );
          used.add(portableContentPathKey(path));
          await writeProjectTextAtomic(
            join(projectDirectory, path),
            doc.content
          );
          return {
            id: doc.id,
            title: doc.title,
            path,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
          };
        };
        const thesisOverview = await writeDoc(
          "foundation",
          "thesis-overview",
          book.foundation.thesisOverview
        );
        const terminology = await writeDoc(
          "foundation",
          "terminology",
          book.foundation.terminology
        );
        const cards: AcademicReferenceCardManifest[] = [];
        for (const card of book.foundation.cards) {
          const doc = await writeDoc(
            "foundation/cards",
            card.id,
            card.document
          );
          cards.push({
            id: card.id,
            citeKey: card.citeKey,
            cardType: card.cardType,
            title: card.title,
            document: doc,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt
          });
        }
        const documents: BookProjectDocumentManifest[] = [];
        for (const document of book.documents) {
          documents.push(await writeDoc("framework", document.id, document));
        }
        const sections: AcademicManuscriptSectionManifest[] = [];
        for (const section of book.manuscript.sections) {
          for (const kind of ["brief", "body", "state"] as const) {
            assertTextByteLength(
              section[kind].content,
              maxMarkdownBytes,
              `Academic section ${kind} Markdown content`
            );
          }
          const briefPath = await uniqueRelativeMarkdownPathWithSuffix(
            projectDirectory,
            "manuscript/sections",
            section.id,
            ".brief.md",
            used
          );
          used.add(portableContentPathKey(briefPath));
          const bodyPath = await uniqueRelativeMarkdownPathWithSuffix(
            projectDirectory,
            "manuscript/sections",
            section.id,
            ".body.md",
            used
          );
          used.add(portableContentPathKey(bodyPath));
          const statePath = await uniqueRelativeMarkdownPathWithSuffix(
            projectDirectory,
            "manuscript/sections",
            section.id,
            ".state.md",
            used
          );
          used.add(portableContentPathKey(statePath));
          await writeProjectTextAtomic(
            join(projectDirectory, briefPath),
            section.brief.content
          );
          await writeProjectTextAtomic(
            join(projectDirectory, bodyPath),
            section.body.content
          );
          await writeProjectTextAtomic(
            join(projectDirectory, statePath),
            section.state.content
          );
          sections.push({
            id: section.id,
            ...(section.chapterId ? { chapterId: section.chapterId } : {}),
            title: section.title,
            wordCountRequirement: section.wordCountRequirement,
            brief: {
              id: section.brief.id,
              title: section.brief.title,
              path: briefPath,
              createdAt: section.brief.createdAt,
              updatedAt: section.brief.updatedAt
            },
            body: {
              id: section.body.id,
              title: section.body.title,
              path: bodyPath,
              createdAt: section.body.createdAt,
              updatedAt: section.body.updatedAt
            },
            state: {
              id: section.state.id,
              title: section.state.title,
              path: statePath,
              createdAt: section.state.createdAt,
              updatedAt: section.state.updatedAt
            },
            createdAt: section.createdAt,
            updatedAt: section.updatedAt
          });
        }
        return CurrentAcademicBookProjectManifestSchema.parse({
          ...common,
          schemaVersion: 4,
          kind: kindForDomain(domain),
          bookType: "academic",
          subtype: book.subtype,
          citationStyle: book.citationStyle,
          status: book.status,
          linkedMaterialIds: book.linkedMaterialIds,
          linkedSkillIds: book.linkedSkillIds,
          foundation: {
            thesisOverview,
            terminology,
            cards
          },
          frameworkStages: book.frameworkStages,
          documents,
          manuscript: {
            chapters: book.manuscript.chapters,
            sections
          }
        });
      }
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
        await writeProjectTextAtomic(
          join(projectDirectory, path),
          document.content
        );
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
        await writeProjectTextAtomic(
          join(projectDirectory, bodyPath),
          section.body.content
        );
        await writeProjectTextAtomic(
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
        await writeProjectTextAtomic(join(projectDirectory, path), entry.body);
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
        ...(material.customTag ? { customTag: material.customTag } : {}),
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
        await writeProjectTextAtomic(join(projectDirectory, path), entry.body);
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
        ...(skill.customTag ? { customTag: skill.customTag } : {}),
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
        memberIds: group.memberIds
      });
    }
    case "skill-group": {
      const group = resource as SkillLibraryGroup;
      return FolderSkillGroupProjectManifestSchema.parse({
        ...common,
        kind: kindForDomain(domain),
        memberIds: group.memberIds,
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
  if (manifest.bookType === "academic") {
    const toIndexDoc = (doc: BookProjectDocumentManifest) => ({
      id: doc.id,
      title: doc.title,
      content: "" as const,
      ...(contentMetadataById.get(doc.id) ??
        emptyContentMetadata(doc.updatedAt)),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
    return CatalogIndexBookSchema.parse({
      id: manifest.id,
      title: manifest.title,
      bookType: "academic",
      subtype: manifest.subtype,
      citationStyle: manifest.citationStyle,
      status: manifest.status,
      linkedMaterialIds: manifest.linkedMaterialIds,
      linkedSkillIds: manifest.linkedSkillIds,
      projectRevision: manifest.revision,
      foundation: {
        thesisOverview: toIndexDoc(manifest.foundation.thesisOverview),
        terminology: toIndexDoc(manifest.foundation.terminology),
        cards: manifest.foundation.cards.map((card) => ({
          id: card.id,
          citeKey: card.citeKey,
          cardType: card.cardType,
          title: card.title,
          document: toIndexDoc(card.document),
          createdAt: card.createdAt,
          updatedAt: card.updatedAt
        }))
      },
      frameworkStages: manifest.frameworkStages,
      documents: manifest.documents.map(toIndexDoc),
      manuscript: {
        chapters: manifest.manuscript.chapters,
        sections: manifest.manuscript.sections.map((section) => ({
          id: section.id,
          ...(section.chapterId ? { chapterId: section.chapterId } : {}),
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          brief: toIndexDoc(section.brief),
          body: toIndexDoc(section.body),
          state: toIndexDoc(section.state),
          createdAt: section.createdAt,
          updatedAt: section.updatedAt
        }))
      },
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt
    });
  }
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
  if (book.bookType === "academic") {
    throw new Error("Unexpected academic book in creative book indexer.");
  }
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
        ...(manifest.customTag ? { customTag: manifest.customTag } : {}),
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
        ...(manifest.customTag ? { customTag: manifest.customTag } : {}),
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
        memberIds: manifest.memberIds,
        projectRevision: manifest.revision,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
    case "deepwrite.skill-group":
      return {
        id: manifest.id,
        title: manifest.title,
        memberIds: manifest.memberIds,
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
      if (manifest.bookType === "academic") {
        const items = academicManifestContentItems(manifest);
        const contents = await readProjectMarkdownContents(
          projectDirectory,
          items,
          maxMarkdownBytes,
          maxProjectContentBytes
        );
        let cursor = 0;
        const nextDoc = (doc: BookProjectDocumentManifest) => ({
          id: doc.id,
          title: doc.title,
          content: contents[cursor++]!,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt
        });
        const thesisOverview = nextDoc(manifest.foundation.thesisOverview);
        const terminology = nextDoc(manifest.foundation.terminology);
        const cards = manifest.foundation.cards.map((card) => ({
          id: card.id,
          citeKey: card.citeKey,
          cardType: card.cardType,
          title: card.title,
          document: nextDoc(card.document),
          createdAt: card.createdAt,
          updatedAt: card.updatedAt
        }));
        const documents = manifest.documents.map(nextDoc);
        const sections = manifest.manuscript.sections.map((section) => ({
          id: section.id,
          ...(section.chapterId ? { chapterId: section.chapterId } : {}),
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          brief: nextDoc(section.brief),
          body: nextDoc(section.body),
          state: nextDoc(section.state),
          createdAt: section.createdAt,
          updatedAt: section.updatedAt
        }));
        return AcademicBookSchema.parse({
          id: manifest.id,
          title: manifest.title,
          bookType: "academic",
          subtype: manifest.subtype,
          citationStyle: manifest.citationStyle,
          status: manifest.status,
          linkedMaterialIds: manifest.linkedMaterialIds,
          linkedSkillIds: manifest.linkedSkillIds,
          projectRevision: manifest.revision,
          foundation: {
            thesisOverview,
            terminology,
            cards
          },
          frameworkStages: manifest.frameworkStages,
          documents,
          manuscript: {
            chapters: manifest.manuscript.chapters,
            sections
          },
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt
        });
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
        ...(manifest.customTag ? { customTag: manifest.customTag } : {}),
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
        ...(manifest.customTag ? { customTag: manifest.customTag } : {}),
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
        memberIds: manifest.memberIds,
        projectRevision: manifest.revision,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      };
    case "deepwrite.skill-group":
      return {
        id: manifest.id,
        title: manifest.title,
        memberIds: manifest.memberIds,
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
    if (resource.bookType === "academic") {
      const foundationBytes =
        Buffer.byteLength(resource.foundation.thesisOverview.content, "utf8") +
        Buffer.byteLength(resource.foundation.terminology.content, "utf8") +
        resource.foundation.cards.reduce(
          (sum, card) => sum + Buffer.byteLength(card.document.content, "utf8"),
          0
        );
      const manuscriptBytes = resource.manuscript.sections.reduce(
        (sum, section) =>
          sum +
          Buffer.byteLength(section.brief.content, "utf8") +
          Buffer.byteLength(section.body.content, "utf8") +
          Buffer.byteLength(section.state.content, "utf8"),
        0
      );
      return metadataBytes + foundationBytes + documentBytes + manuscriptBytes;
    }
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
