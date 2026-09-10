import {
  BookPlotStagesSchema,
  CatalogDraftRecoverySchema,
  CatalogIndexSnapshotSchema,
  CatalogReadDocumentInputSchema,
  CatalogReadDocumentResultSchema,
  CatalogSnapshotSchema,
  createShortWorkspaceContentRevision,
  type Book,
  type CatalogDraftRecovery,
  type CatalogIndexSnapshot,
  type CatalogProjectDiagnostic,
  type CatalogReadDocumentInput,
  type CatalogReadDocumentResult,
  type CatalogSnapshot,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type SkillLibrary,
  type SkillLibraryGroup
} from "@deepwrite/contracts";
import { join } from "node:path";
import { kindForDomain, parseId } from "./assertions";
import {
  findManifestDocument,
  indexResourceFromManifest,
  inspectProjectMarkdownMetadata,
  manifestContentItems,
  readCurrentBookManifest,
  readManifestWithoutContent,
  readProject
} from "./manifest";
import {
  assertTextByteLength,
  atomicWriteJson,
  atomicWriteText,
  cleanupNewProjectDirectories,
  isNodeError,
  parseJson,
  portableContentPathKey,
  readOptionalUtf8File,
  readProjectMarkdown,
  secureProjectRoot,
  secureWritableProjectPath,
  uniqueRelativeMarkdownPath
} from "./paths-io";
import {
  mergeCreativePlotStageDefinitions,
  sameCreativePlotStageDefinitions
} from "./plot-stage-definitions";
import {
  emptyRegistry,
  ensureRegistry,
  findRegistration,
  findRegistrationByProjectId,
  mutate,
  readAfterWrites,
  readRegistryOptional,
  setLegacyImport,
  writeMissingSnapshotProjects,
  writeRegistry
} from "./registry";
import {
  FolderCurrentBookProjectManifestSchema,
  MANIFEST_FILE,
  type FolderCatalogProjectDomain,
  type FolderCatalogRegistry,
  type FolderCatalogResource,
  type FolderCatalogStoreContext,
  type OpenFolderCatalogProjectResult
} from "./types";

export function resourceContentByteLength(
  resource: FolderCatalogResource
): number {
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

export async function snapshot(
  store: FolderCatalogStoreContext
): Promise<CatalogSnapshot> {
  return await readAfterWrites(store, async () => {
    const registry = await ensureRegistry(store);
    return await aggregateSnapshot(store, registry);
  });
}

export async function indexSnapshot(
  store: FolderCatalogStoreContext
): Promise<CatalogIndexSnapshot> {
  return await readAfterWrites(store, async () => {
    const registry = await ensureRegistry(store);
    return await aggregateIndexSnapshot(store, registry);
  });
}

export async function readDocument(
  store: FolderCatalogStoreContext,
  rawInput: CatalogReadDocumentInput
): Promise<CatalogReadDocumentResult> {
  const input = CatalogReadDocumentInputSchema.parse(rawInput);
  return await readAfterWrites(store, async () => {
    const registry = await ensureRegistry(store);
    const registration = findRegistrationByProjectId(registry, input.projectId);
    const { projectDirectory, manifest } = await readManifestWithoutContent(
      store,
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
        store.maxMarkdownBytes,
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
      store.maxMarkdownBytes
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

export async function loadDraftRecovery(
  store: FolderCatalogStoreContext
): Promise<CatalogDraftRecovery> {
  return await readAfterWrites(store, async () => {
    const text = await readOptionalUtf8File(
      store.draftRecoveryPath,
      store.maxDraftRecoveryBytes,
      "draft recovery"
    );
    return text === undefined
      ? {}
      : CatalogDraftRecoverySchema.parse(
          parseJson(text, store.draftRecoveryPath)
        );
  });
}

export async function saveDraftRecovery(
  store: FolderCatalogStoreContext,
  rawDrafts: CatalogDraftRecovery
): Promise<void> {
  const drafts = CatalogDraftRecoverySchema.parse(rawDrafts);
  await mutate(store, async () => {
    await atomicWriteJson(
      store.draftRecoveryPath,
      drafts,
      store.maxDraftRecoveryBytes
    );
  });
}

export async function migrateSnapshot(
  store: FolderCatalogStoreContext,
  rawSnapshot: CatalogSnapshot
): Promise<CatalogSnapshot> {
  const snapshot = CatalogSnapshotSchema.parse(structuredClone(rawSnapshot));
  return await mutate(store, async () => {
    const existing = await readRegistryOptional(store);
    if (existing?.sourceCatalogMigrated) {
      return await aggregateSnapshot(store, existing);
    }
    const base = existing ?? emptyRegistry(snapshot.updatedAt);
    base.creativePlotStages = mergeCreativePlotStageDefinitions(
      base.creativePlotStages,
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
    return await aggregateSnapshot(store, next);
  });
}

export async function syncSnapshot(
  store: FolderCatalogStoreContext,
  rawSnapshot: CatalogSnapshot
): Promise<CatalogSnapshot> {
  const snapshot = CatalogSnapshotSchema.parse(structuredClone(rawSnapshot));
  return await mutate(store, async () => {
    const current = await ensureRegistry(store);
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
      await writeMissingSnapshotProjects(store, current, snapshot);
    next.creativePlotStages = mergedStages;
    const changed = next.projects.length !== before || stagesChanged;
    if (changed || snapshot.legacyImport !== undefined) {
      next.revision = Math.max(
        current.revision + (changed ? 1 : 0),
        snapshot.revision
      );
      next.updatedAt = changed ? store.now() : current.updatedAt;
      setLegacyImport(next, snapshot.legacyImport ?? current.legacyImport);
      next.sourceCatalogMigrated = true;
      try {
        await writeRegistry(store, next);
      } catch (error: unknown) {
        await cleanupNewProjectDirectories(createdProjectDirectories);
        throw error;
      }
    }
    return await aggregateSnapshot(store, next);
  });
}

export async function getProjectRevision(
  store: FolderCatalogStoreContext,
  id: string,
  domain: FolderCatalogProjectDomain
): Promise<number> {
  return await readAfterWrites(store, async () => {
    const registry = await ensureRegistry(store);
    const resourceId = parseId(id);
    const registration = findRegistration(registry, resourceId, domain);
    return (
      await readProject(
        store,
        registration.projectDirectory,
        domain,
        resourceId
      )
    ).revision;
  });
}

export async function aggregateSnapshot(
  store: FolderCatalogStoreContext,
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
      opened = await readProject(
        store,
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
      store.maxSnapshotContentBytes
    ) {
      projectDiagnostics.push({
        projectId: project.id,
        kind: kindForDomain(project.domain),
        code: "invalid",
        message: `聚合内容超过 ${store.maxSnapshotContentBytes} 字节安全上限。`
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
    await writeRegistry(store, registry);
  }
  const now = store.now();
  for (let index = 0; index < books.length; index += 1) {
    const book = books[index]!;
    const missing = creativePlotStages.filter(
      (stage) => !book.plotStages.some((candidate) => candidate.id === stage.id)
    );
    if (missing.length === 0) continue;
    const registration = findRegistration(registry, book.id, "book");
    const projectDirectory = await secureProjectRoot(
      registration.projectDirectory
    );
    const manifest = await readCurrentBookManifest(
      store,
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
      store.maxManifestBytes
    );
    books[index] = (await readProject(store, projectDirectory, "book", book.id))
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

export async function aggregateIndexSnapshot(
  store: FolderCatalogStoreContext,
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
      const { projectDirectory, manifest } = await readManifestWithoutContent(
        store,
        project.projectDirectory,
        kindForDomain(project.domain),
        project.id
      );
      const manifestBytes = Buffer.byteLength(JSON.stringify(manifest), "utf8");
      if (manifestBytes >= store.maxProjectContentBytes) {
        throw new Error(
          `项目 manifest 超过 ${store.maxProjectContentBytes} 字节项目预算。`
        );
      }
      const contentMetadataById = await inspectProjectMarkdownMetadata(
        projectDirectory,
        manifest,
        store.maxMarkdownBytes,
        store.maxProjectContentBytes - manifestBytes
      );
      const resource = indexResourceFromManifest(manifest, contentMetadataById);
      switch (project.domain) {
        case "book":
          books.push(resource as CatalogIndexSnapshot["books"][number]);
          break;
        case "material-library":
          materials.push(resource as CatalogIndexSnapshot["materials"][number]);
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
