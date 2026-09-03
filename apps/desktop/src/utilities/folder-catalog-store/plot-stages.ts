import {
  BookPlotStagesSchema,
  createDefaultCreativePlotStages,
  CreativePlotStagesSchema,
  DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS,
  isBuiltinCreativePlotStageId,
  MutatePlotStructureInputSchema,
  type Book,
  type BookPlotStage,
  type CreativePlotStage,
  type MutatePlotStructureInput
} from "@deepwrite/contracts";
import { createCatalogId, randomHex8 } from "@deepwrite/shared";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { assertBaseRevision, assertProjectRevision } from "./assertions";
import {
  manifestContentItems,
  readCurrentBookManifest,
  readProject
} from "./manifest";
import {
  assertJsonByteLength,
  atomicWriteJson,
  commitProjectMarkdownUpdate,
  portableContentPathKey,
  secureExistingProjectPath,
  secureProjectRoot,
  secureWritableProjectPath,
  uniqueRelativeMarkdownPath,
  unlinkOptional
} from "./paths-io";
import {
  bumpRegistry,
  ensureRegistry,
  findRegistration,
  mutate
} from "./registry";
import {
  FolderCurrentBookProjectManifestSchema,
  MANIFEST_FILE,
  type FolderCatalogRegistry,
  type FolderCatalogStoreContext
} from "./types";

export function mergeCreativePlotStageDefinitions(
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

export function sameCreativePlotStageDefinitions(
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

export function applyGlobalPlotStagesToNewBook<Resource extends Book>(
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

export async function mutatePlotStructure(
  store: FolderCatalogStoreContext,
  rawInput: MutatePlotStructureInput
): Promise<Book> {
  const input = MutatePlotStructureInputSchema.parse(rawInput);
  if (input.baseProjectRevision !== undefined) {
    assertProjectRevision(input.baseProjectRevision);
  }
  return await mutate(store, async () => {
    const registry = await ensureRegistry(store);
    const registration = findRegistration(registry, input.bookId, "book");
    const projectDirectory = await secureProjectRoot(
      registration.projectDirectory
    );
    const manifest = await readCurrentBookManifest(
      store,
      projectDirectory,
      input.bookId
    );
    if (!input.force) {
      assertBaseRevision(input.baseProjectRevision, manifest.revision);
    }

    const now = store.now();
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
      await applyGlobalPlotStageOrder(store, registry, now);
      await bumpRegistry(store, registry, now);
      return (await readProject(store, projectDirectory, "book", input.bookId))
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
        store.maxManifestBytes
      );
      await bumpRegistry(store, registry, now);
      return (await readProject(store, projectDirectory, "book", input.bookId))
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
            await readProject(store, projectDirectory, "book", input.bookId)
          ).resource as Book;
        }
        if (existingStage || existingDocument) {
          throw new Error("剧情结构创建记录不完整，无法安全重放本次创建。");
        }
        await applyGlobalPlotStageCreate(
          store,
          registry,
          existingDefinition,
          input.bookId,
          now
        );
        await bumpRegistry(store, registry, now);
        return (
          await readProject(store, projectDirectory, "book", input.bookId)
        ).resource as Book;
      }
      if (globalStages.length >= 32) {
        throw new Error("剧情结构最多支持 32 项。");
      }
      assertUniqueGlobalTitle(title);
      const ids = new Set(globalStages.map(({ id }) => id));
      if (mutation.stageId && ids.has(mutation.stageId)) {
        throw new Error(`剧情结构标识“${mutation.stageId}”已被其他结构占用。`);
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
      await applyGlobalPlotStageCreate(
        store,
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
      await applyGlobalPlotStageUpdate(
        store,
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
      await applyGlobalPlotStageDelete(store, registry, mutation.stageId, now);
    }

    await bumpRegistry(store, registry, now);
    return (await readProject(store, projectDirectory, "book", input.bookId))
      .resource as Book;
  });
}

export async function applyGlobalPlotStageOrder(
  store: FolderCatalogStoreContext,
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
    const manifest = await readCurrentBookManifest(
      store,
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
      store.maxManifestBytes
    );
  }
}

export async function applyGlobalPlotStageCreate(
  store: FolderCatalogStoreContext,
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
    const manifest = await readCurrentBookManifest(
      store,
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
      store.maxMarkdownBytes,
      store.maxManifestBytes
    );
  }
}

export async function applyGlobalPlotStageUpdate(
  store: FolderCatalogStoreContext,
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
    const manifest = await readCurrentBookManifest(
      store,
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
      store.maxManifestBytes
    );
  }
}

export async function applyGlobalPlotStageDelete(
  store: FolderCatalogStoreContext,
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
    const manifest = await readCurrentBookManifest(
      store,
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
      assertJsonByteLength(nextManifest, store.maxManifestBytes);
      await rename(target, backup);
      try {
        await atomicWriteJson(
          join(projectDirectory, MANIFEST_FILE),
          nextManifest,
          store.maxManifestBytes
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
        store.maxManifestBytes
      );
    }
  }
}
