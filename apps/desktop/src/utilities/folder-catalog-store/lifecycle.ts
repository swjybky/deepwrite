import { dirname } from "node:path";
import { join } from "node:path";
import { rename } from "node:fs/promises";
import {
  BookSchema,
  createCatalogDraftDirectory,
  createDefaultBookCharacterStructure,
  createDefaultBookPlotStages,
  CreateLibraryGroupInputSchema,
  CreateLibraryInputSchema,
  CreateScriptBookInputSchema,
  CreateShortBookInputSchema,
  createScriptCatalogDraftDirectory,
  DuplicateCatalogProjectInputSchema,
  MaterialLibraryGroupSchema,
  MaterialLibraryProjectManifestSchema,
  MaterialLibrarySchema,
  ScriptBookSchema,
  ShortBookSchema,
  SkillLibraryGroupSchema,
  SkillLibraryProjectManifestSchema,
  SkillLibrarySchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  UpdateLibraryInputSchema,
  type Book,
  type CreateScriptBookInput,
  type CreateShortBookInput,
  type DuplicateCatalogProjectInput,
  type DuplicateCatalogProjectResult,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type ScriptBook,
  type ShortBook,
  type SkillLibrary,
  type SkillLibraryGroup,
  type UpdateLibraryGroupInput,
  type UpdateLibraryInput
} from "@deepwrite/contracts";
import { nextCopyTitle } from "../copy-title";
import type { ImportedLegacyBook } from "../legacy-book-import";
import { createCatalogId, randomHex8 } from "@deepwrite/shared";
import {
  assertBaseRevision,
  assertBookLibraryReferences,
  assertLibraryNotInAnotherGroup,
  assertProjectRevision,
  assertUniqueGroupMembers,
  isCreateAtDirectoryInput,
  isCreateScriptAtDirectoryInput,
  libraryProjectDomain,
  parseDeletableProjectDomain,
  parseId,
  parseUnregisterDomain,
  registryDomainForUnregister
} from "./assertions";
import { applyGlobalPlotStagesToNewBook } from "./plot-stages";
import {
  FolderCurrentBookProjectManifestSchema,
  FolderMaterialGroupProjectManifestSchema,
  FolderSkillGroupProjectManifestSchema,
  MANIFEST_FILE,
  type CreateFolderLibraryGroupInput,
  type CreateFolderLibraryInput,
  type CreateScriptBookAtDirectoryInput,
  type CreateShortBookAtDirectoryInput,
  type DeleteFolderCatalogProjectInput,
  type DeleteFolderCatalogProjectResult,
  type DuplicateProjectWritePlan,
  type FolderCatalogProjectDomain,
  type FolderCatalogResource,
  type FolderCatalogStoreContext,
  type FolderCurrentBookProjectManifest,
  type OpenFolderCatalogProjectResult,
  type RegistryProject,
  type UnregisterFolderCatalogProjectInput,
  type UnregisterFolderCatalogProjectResult,
  type UpdateFolderBookInput
} from "./types";
import {
  bumpRegistry,
  ensureRegistry,
  findRegistration,
  mutate,
  readAfterWrites,
  registerProject,
  writeRegistry
} from "./registry";
import { aggregateSnapshot } from "./snapshot";
import {
  readCurrentBookManifest,
  readManifest,
  readProject,
  writeNewResourceProject
} from "./manifest";
import {
  atomicWriteJson,
  cleanupNewProjectDirectories,
  removeEmptyOrPartialProject,
  secureProjectRoot
} from "./paths-io";
import {
  readOrCreateWritingContext,
  writeWritingContextFile
} from "./writing-context";

export const DEFAULT_SHORT_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["worldbuilding", "世界观"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["narrative_perspective", "叙事视角"],
  ["outline", "大纲"]
] as const;

export const DEFAULT_SCRIPT_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["worldbuilding", "世界观"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["narrative_perspective", "叙事视角"],
  ["outline", "大纲"]
] as const;

export function linkedMaterialIdsFromInput(
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

export function linkedSkillIdsFromInput(
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

export function duplicateBookResource(
  source: Book,
  title: string,
  now: string
): Book {
  const { projectRevision: _projectRevision, ...copyable } = source;
  return BookSchema.parse({
    ...structuredClone(copyable),
    id: createCatalogId("book"),
    title,
    createdAt: now,
    updatedAt: now
  });
}

export function duplicateLibraryResource(
  source: MaterialLibrary,
  title: string,
  now: string
): MaterialLibrary;
export function duplicateLibraryResource(
  source: SkillLibrary,
  title: string,
  now: string
): SkillLibrary;
export function duplicateLibraryResource(
  source: MaterialLibrary | SkillLibrary,
  title: string,
  now: string
): MaterialLibrary | SkillLibrary;
export function duplicateLibraryResource(
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

export async function createShortBook(
  store: FolderCatalogStoreContext,
  rawInput: CreateShortBookInput | CreateShortBookAtDirectoryInput,
  parentDirectory?: string
): Promise<OpenFolderCatalogProjectResult<ShortBook>> {
  const wrapped = isCreateAtDirectoryInput(rawInput);
  const input = CreateShortBookInputSchema.parse(
    wrapped ? rawInput.input : rawInput
  );
  const parent =
    (wrapped ? rawInput.parentDirectory : parentDirectory)?.trim() ||
    store.defaultProjectParents.book;
  return await createBookProject(
    store,
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

export async function createScriptBook(
  store: FolderCatalogStoreContext,
  rawInput: CreateScriptBookInput | CreateScriptBookAtDirectoryInput,
  parentDirectory?: string
): Promise<OpenFolderCatalogProjectResult<ScriptBook>> {
  const wrapped = isCreateScriptAtDirectoryInput(rawInput);
  const input = CreateScriptBookInputSchema.parse(
    wrapped ? rawInput.input : rawInput
  );
  const parent =
    (wrapped ? rawInput.parentDirectory : parentDirectory)?.trim() ||
    store.defaultProjectParents.book;
  return await createBookProject(store, parent, (now) =>
    ScriptBookSchema.parse({
      id: createCatalogId("book"),
      title: input.title,
      bookType: "script",
      genre: input.genre,
      status: "editing",
      linkedMaterialIdsByKind: linkedMaterialIdsFromInput(
        input.linkedMaterialIdsByKind
      ),
      linkedSkillIdsByKind: linkedSkillIdsFromInput(input.linkedSkillIdsByKind),
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

export async function createBookProject<Resource extends Book>(
  store: FolderCatalogStoreContext,
  parentDirectory: string,
  createBook: (now: string) => Resource,
  defaultPlotStageIds?: readonly string[]
): Promise<OpenFolderCatalogProjectResult<Resource>> {
  return await mutate(store, async () => {
    const now = store.now();
    const registry = await ensureRegistry(store);
    const book = applyGlobalPlotStagesToNewBook(
      createBook(now),
      registry.creativePlotStages,
      defaultPlotStageIds
    );
    const snapshot = await aggregateSnapshot(store, registry);
    assertBookLibraryReferences(book, snapshot);
    const projectDirectory = await writeNewResourceProject(
      store,
      "book",
      parentDirectory,
      book
    );
    try {
      await registerProject(store, registry, {
        id: book.id,
        domain: "book",
        projectDirectory,
        registeredAt: now
      });
    } catch (error: unknown) {
      await cleanupNewProjectDirectories([projectDirectory]);
      throw error;
    }
    return (await readProject(
      store,
      projectDirectory,
      "book"
    )) as OpenFolderCatalogProjectResult<Resource>;
  });
}

export async function createLibrary(
  store: FolderCatalogStoreContext,
  rawInput: CreateFolderLibraryInput
): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>> {
  const input = CreateLibraryInputSchema.parse(rawInput);
  const parentDirectory =
    rawInput.parentDirectory?.trim() ||
    store.defaultProjectParents[
      input.domain === "material" ? "material-library" : "skill-library"
    ];
  return await mutate(store, async () => {
    const now = store.now();
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
    const projectDirectory = await writeNewResourceProject(
      store,
      projectDomain,
      parentDirectory,
      resource
    );
    try {
      const registry = await ensureRegistry(store);
      await registerProject(store, registry, {
        id: resource.id,
        domain: projectDomain,
        projectDirectory,
        registeredAt: now
      });
    } catch (error: unknown) {
      await cleanupNewProjectDirectories([projectDirectory]);
      throw error;
    }
    return (await readProject(
      store,
      projectDirectory,
      projectDomain
    )) as OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>;
  });
}

export async function updateLibrary(
  store: FolderCatalogStoreContext,
  rawInput: UpdateLibraryInput
): Promise<MaterialLibrary | SkillLibrary> {
  const input = UpdateLibraryInputSchema.parse(rawInput);
  return await mutate(store, async () => {
    const registry = await ensureRegistry(store);
    const projectDirectory = await secureProjectRoot(
      findRegistration(
        registry,
        input.libraryId,
        libraryProjectDomain(input.domain)
      ).projectDirectory
    );
    const manifest = await readManifest(
      store,
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
    const now = store.now();
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
      store.maxManifestBytes
    );
    await bumpRegistry(store, registry, now);
    return (
      await readProject(
        store,
        projectDirectory,
        libraryProjectDomain(input.domain)
      )
    ).resource as MaterialLibrary | SkillLibrary;
  });
}

export async function createLibraryGroup(
  store: FolderCatalogStoreContext,
  rawInput: CreateFolderLibraryGroupInput
): Promise<
  OpenFolderCatalogProjectResult<MaterialLibraryGroup | SkillLibraryGroup>
> {
  const input = CreateLibraryGroupInputSchema.parse(rawInput);
  const projectDomain =
    input.domain === "material" ? "material-group" : "skill-group";
  const parentDirectory =
    rawInput.parentDirectory?.trim() ||
    store.defaultProjectParents[projectDomain];
  return await mutate(store, async () => {
    const registry = await ensureRegistry(store);
    const snapshot = await aggregateSnapshot(store, registry);
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
        assertLibraryNotInAnotherGroup(snapshot.skillGroups, libraryId, "技能");
      }
    }

    const now = store.now();
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
    const projectDirectory = await writeNewResourceProject(
      store,
      projectDomain,
      parentDirectory,
      resource
    );
    try {
      await registerProject(store, registry, {
        id: resource.id,
        domain: projectDomain,
        projectDirectory,
        registeredAt: now
      });
    } catch (error: unknown) {
      await cleanupNewProjectDirectories([projectDirectory]);
      throw error;
    }
    return (await readProject(
      store,
      projectDirectory,
      projectDomain
    )) as OpenFolderCatalogProjectResult<
      MaterialLibraryGroup | SkillLibraryGroup
    >;
  });
}

export async function importLegacyBook(
  store: FolderCatalogStoreContext,
  input: ImportedLegacyBook,
  parentDirectory?: string
): Promise<OpenFolderCatalogProjectResult<ShortBook>> {
  const parent = parentDirectory?.trim() || store.defaultProjectParents.book;
  return await mutate(store, async () => {
    const now = store.now();
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
    const projectDirectory = await writeNewResourceProject(
      store,
      "book",
      parent,
      book
    );
    try {
      const registry = await ensureRegistry(store);
      await registerProject(store, registry, {
        id: book.id,
        domain: "book",
        projectDirectory,
        registeredAt: now
      });
    } catch (error: unknown) {
      await cleanupNewProjectDirectories([projectDirectory]);
      throw error;
    }
    return (await readProject(
      store,
      projectDirectory,
      "book"
    )) as OpenFolderCatalogProjectResult<ShortBook>;
  });
}

export async function openCatalogProject(
  store: FolderCatalogStoreContext,
  projectDirectory: string,
  expectedDomain?: FolderCatalogProjectDomain,
  register = true
): Promise<OpenFolderCatalogProjectResult> {
  if (!register) {
    return await readAfterWrites(store, () =>
      readProject(store, projectDirectory, expectedDomain)
    );
  }
  return await mutate(store, async () => {
    const opened = await readProject(store, projectDirectory, expectedDomain);
    const registry = await ensureRegistry(store);
    await registerProject(store, registry, {
      id: opened.resource.id,
      domain: opened.domain,
      projectDirectory: opened.projectDirectory,
      registeredAt: store.now()
    });
    return opened;
  });
}

export async function openBookProject(
  store: FolderCatalogStoreContext,
  projectDirectory: string,
  register = true
): Promise<OpenFolderCatalogProjectResult<Book>> {
  return (await openCatalogProject(
    store,
    projectDirectory,
    "book",
    register
  )) as OpenFolderCatalogProjectResult<Book>;
}

export async function openMaterialProject(
  store: FolderCatalogStoreContext,
  projectDirectory: string,
  register = true
): Promise<OpenFolderCatalogProjectResult<MaterialLibrary>> {
  return (await openCatalogProject(
    store,
    projectDirectory,
    "material-library",
    register
  )) as OpenFolderCatalogProjectResult<MaterialLibrary>;
}

export async function openSkillProject(
  store: FolderCatalogStoreContext,
  projectDirectory: string,
  register = true
): Promise<OpenFolderCatalogProjectResult<SkillLibrary>> {
  return (await openCatalogProject(
    store,
    projectDirectory,
    "skill-library",
    register
  )) as OpenFolderCatalogProjectResult<SkillLibrary>;
}

export async function updateBook(
  store: FolderCatalogStoreContext,
  rawInput: UpdateFolderBookInput
): Promise<Book> {
  const input = UpdateBookInputSchema.parse(rawInput);
  if (input.baseProjectRevision !== undefined) {
    assertProjectRevision(input.baseProjectRevision);
  }
  return await mutate(store, async () => {
    const registry = await ensureRegistry(store);
    const registration = findRegistration(registry, input.bookId, "book");
    const opened = await readProject(
      store,
      registration.projectDirectory,
      "book",
      input.bookId
    );
    const manifest = await readCurrentBookManifest(
      store,
      opened.projectDirectory,
      input.bookId
    );
    if (!input.force) {
      assertBaseRevision(input.baseProjectRevision, manifest.revision);
    }
    const now = store.now();
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
    const snapshot = await aggregateSnapshot(store, registry);
    assertBookLibraryReferences(validated, snapshot);
    await atomicWriteJson(
      join(opened.projectDirectory, MANIFEST_FILE),
      validated,
      store.maxManifestBytes
    );
    await bumpRegistry(store, registry, now);
    return (await readProject(store, opened.projectDirectory, "book"))
      .resource as Book;
  });
}

export async function updateLibraryGroup(
  store: FolderCatalogStoreContext,
  rawInput: UpdateLibraryGroupInput
): Promise<MaterialLibraryGroup | SkillLibraryGroup> {
  const input = UpdateLibraryGroupInputSchema.parse(rawInput);
  return await mutate(store, async () => {
    const registry = await ensureRegistry(store);
    const projectDomain =
      input.domain === "material" ? "material-group" : "skill-group";
    const registration = findRegistration(
      registry,
      input.groupId,
      projectDomain
    );
    const opened = await readProject(
      store,
      registration.projectDirectory,
      projectDomain,
      input.groupId
    );
    const manifest = await readManifest(
      store,
      opened.projectDirectory,
      input.domain === "material"
        ? "deepwrite.material-group"
        : "deepwrite.skill-group",
      input.groupId
    );
    if (!input.force) {
      assertBaseRevision(input.baseProjectRevision, manifest.revision);
    }

    const snapshot = await aggregateSnapshot(store, registry);
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

    const now = store.now();
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
      store.maxManifestBytes
    );
    await bumpRegistry(store, registry, now);
    return (await readProject(store, opened.projectDirectory, projectDomain))
      .resource as MaterialLibraryGroup | SkillLibraryGroup;
  });
}

export async function unregisterProject(
  store: FolderCatalogStoreContext,
  rawInput: UnregisterFolderCatalogProjectInput
): Promise<UnregisterFolderCatalogProjectResult> {
  const projectId = parseId(rawInput.projectId);
  const domain = parseUnregisterDomain(rawInput.domain);
  const registryDomain = registryDomainForUnregister(domain);
  return await mutate(store, async () => {
    const registry = await ensureRegistry(store);
    const projects = registry.projects.filter(
      (project) =>
        !(project.id === projectId && project.domain === registryDomain)
    );
    const unregistered = projects.length !== registry.projects.length;
    if (unregistered) {
      const now = store.now();
      await writeRegistry(store, {
        ...registry,
        revision: registry.revision + 1,
        updatedAt: now,
        projects
      });
    }
    return { projectId, domain, unregistered };
  });
}

export async function deleteProject(
  store: FolderCatalogStoreContext,
  rawInput: DeleteFolderCatalogProjectInput
): Promise<DeleteFolderCatalogProjectResult> {
  const projectId = parseId(rawInput.projectId);
  const domain = parseDeletableProjectDomain(rawInput.domain);
  const registryDomain = registryDomainForUnregister(domain);
  return await mutate(store, async () => {
    const registry = await ensureRegistry(store);
    const registration = registry.projects.find(
      (project) => project.id === projectId && project.domain === registryDomain
    );
    if (!registration) {
      return { projectId, domain, deleted: false };
    }

    const projectDirectory = await secureProjectRoot(
      registration.projectDirectory
    );
    await readProject(store, projectDirectory, registryDomain, projectId);

    const stagedDeletion = join(
      dirname(projectDirectory),
      `.deepwrite-deleting-${randomHex8()}`
    );
    await rename(projectDirectory, stagedDeletion);
    try {
      const now = store.now();
      await writeRegistry(store, {
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

export async function duplicateProject(
  store: FolderCatalogStoreContext,
  rawInput: DuplicateCatalogProjectInput
): Promise<DuplicateCatalogProjectResult> {
  const input = DuplicateCatalogProjectInputSchema.parse(rawInput);
  return await mutate(store, async () => {
    const registry = await ensureRegistry(store);
    const snapshot = await aggregateSnapshot(store, registry);
    const now = store.now();
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
          input.domain === "skill" && "isBuiltin" in source && source.isBuiltin
            ? store.defaultProjectParents["skill-library"]
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
          const library = snapshot.materials.find(({ id }) => id === libraryId);
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
              ? store.defaultProjectParents["skill-library"]
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
        const projectDirectory = await writeNewResourceProject(
          store,
          plan.domain,
          plan.parentDirectory,
          plan.resource
        );
        if (plan.writingContext !== undefined) {
          await writeWritingContextFile(projectDirectory, plan.writingContext);
        }
        createdProjectDirectories.push(projectDirectory);
        registrations.push({
          id: plan.resource.id,
          domain: plan.domain,
          projectDirectory,
          registeredAt: now
        });
      }
      await writeRegistry(store, {
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

export async function removeBook(
  store: FolderCatalogStoreContext,
  bookId: string
): Promise<{ bookId: string; deleted: boolean }> {
  const result = await unregisterProject(store, {
    projectId: bookId,
    domain: "book"
  });
  return { bookId: result.projectId, deleted: result.unregistered };
}
