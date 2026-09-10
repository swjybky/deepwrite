import {
  CatalogLegacyImportSchema,
  CreativePlotStagesSchema,
  createDefaultCreativePlotStages,
  type CatalogLegacyImport,
  type CatalogSnapshot
} from "@deepwrite/contracts";
import { rename } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  isFolderDomain,
  isRecord,
  parseId,
  parseNonBlankString,
  parseTimestamp
} from "./assertions";
import { writeNewResourceProject } from "./manifest";
import {
  atomicWriteJson,
  cleanupNewProjectDirectories,
  isNodeError,
  parseJson,
  pathExists,
  readOptionalUtf8File,
  secureProjectRoot
} from "./paths-io";
import { mergeCreativePlotStageDefinitions } from "./plot-stage-definitions";
import {
  type FolderCatalogProjectDomain,
  type FolderCatalogRegistry,
  type FolderCatalogResource,
  type FolderCatalogStoreContext,
  type RegistryProject,
  type WriteMissingSnapshotProjectsResult
} from "./types";

export function emptyRegistry(updatedAt: string): FolderCatalogRegistry {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt,
    sourceCatalogMigrated: false,
    creativePlotStages: createDefaultCreativePlotStages(),
    projects: []
  };
}

export function setLegacyImport(
  registry: FolderCatalogRegistry,
  legacyImport: CatalogLegacyImport | undefined
): void {
  if (legacyImport === undefined) {
    delete registry.legacyImport;
  } else {
    registry.legacyImport = legacyImport;
  }
}

export function parseRegistry(value: unknown): FolderCatalogRegistry {
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

export function registryProjectKey(
  domain: FolderCatalogProjectDomain,
  id: string
): string {
  return `${domain}\u0000${id}`;
}

export function findRegistration(
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

export function findRegistrationByProjectId(
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

export async function mutate<Result>(
  store: FolderCatalogStoreContext,
  operation: () => Promise<Result>
): Promise<Result> {
  let result: Result | undefined;
  let failure: unknown;
  const pending = store.writeChain.then(async () => {
    try {
      result = await operation();
    } catch (error: unknown) {
      failure = error;
    }
  });
  store.writeChain = pending.then(
    () => undefined,
    () => undefined
  );
  await pending;
  if (failure !== undefined) {
    throw failure;
  }
  return result!;
}

export async function readAfterWrites<Result>(
  store: FolderCatalogStoreContext,
  operation: () => Promise<Result>
): Promise<Result> {
  // Queue reads behind writes as well. Merely awaiting the current promise
  // leaves a gap in which another caller can start a multi-file commit and a
  // snapshot can observe Markdown and its manifest at different revisions.
  return await mutate(store, operation);
}

export async function ensureRegistry(
  store: FolderCatalogStoreContext
): Promise<FolderCatalogRegistry> {
  const existing = await readRegistryOptional(store);
  if (existing) {
    return existing;
  }
  if (store.initialSnapshot) {
    const snapshot = store.initialSnapshot;
    const base = emptyRegistry(snapshot.updatedAt);
    base.creativePlotStages = mergeCreativePlotStageDefinitions(
      snapshot.creativePlotStages,
      snapshot.books.flatMap((book) => book.plotStages)
    );
    const { registry: next, createdProjectDirectories } =
      await writeMissingSnapshotProjects(store, base, snapshot);
    next.revision = snapshot.revision;
    next.updatedAt = snapshot.updatedAt;
    setLegacyImport(next, snapshot.legacyImport);
    next.sourceCatalogMigrated = true;
    next.creativePlotStages = base.creativePlotStages;
    try {
      await writeRegistry(store, next);
    } catch (error: unknown) {
      await cleanupNewProjectDirectories(createdProjectDirectories);
      throw error;
    }
    return next;
  }
  const registry = emptyRegistry(store.now());
  await writeRegistry(store, registry);
  return registry;
}

export async function readRegistryOptional(
  store: FolderCatalogStoreContext
): Promise<FolderCatalogRegistry | undefined> {
  let primaryText: string | undefined;
  try {
    primaryText = await readOptionalUtf8File(
      store.registryPath,
      store.maxManifestBytes,
      "catalog registry"
    );
    if (primaryText !== undefined) {
      return parseRegistry(parseJson(primaryText, store.registryPath));
    }
  } catch {
    // Fall through to the last known-good backup. The registry is only an
    // index; project folders remain the source of truth.
  }
  try {
    const backupText = await readOptionalUtf8File(
      store.registryBackupPath,
      store.maxManifestBytes,
      "catalog registry backup"
    );
    if (backupText !== undefined) {
      const backup = parseRegistry(
        parseJson(backupText, store.registryBackupPath)
      );
      try {
        await atomicWriteJson(
          store.registryPath,
          backup,
          store.maxManifestBytes
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
  if (primaryText !== undefined || (await pathExists(store.registryPath))) {
    const corruptPath = `${store.registryPath}.corrupt-${Date.now()}`;
    try {
      await rename(store.registryPath, corruptPath);
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
    }
  }
  return undefined;
}

export async function writeRegistry(
  store: FolderCatalogStoreContext,
  registry: FolderCatalogRegistry
): Promise<void> {
  await atomicWriteJson(store.registryPath, registry, store.maxManifestBytes);
  try {
    await atomicWriteJson(
      store.registryBackupPath,
      registry,
      store.maxManifestBytes
    );
  } catch {
    // The primary registry is already committed. A stale backup is still
    // preferable to reporting a successful registration as failed.
  }
}

export async function registerProject(
  store: FolderCatalogStoreContext,
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
  const now = store.now();
  await writeRegistry(store, {
    ...registry,
    revision: registry.revision + 1,
    updatedAt: now,
    projects
  });
}

export async function bumpRegistry(
  store: FolderCatalogStoreContext,
  registry: FolderCatalogRegistry,
  updatedAt: string
): Promise<void> {
  try {
    await writeRegistry(store, {
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

export async function writeMissingSnapshotProjects(
  store: FolderCatalogStoreContext,
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
        const projectDirectory = await writeNewResourceProject(
          store,
          domain,
          store.defaultProjectParents[domain],
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
