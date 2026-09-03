import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  CatalogDraftSectionSchema,
  CreateDraftSectionInputSchema,
  CreateDraftSectionsInputSchema,
  CreateDraftSectionsResultSchema,
  createShortWorkspaceContentRevision,
  DeleteDraftSectionInputSchema,
  MoveDraftSectionInputSchema,
  SaveDocumentInputSchema,
  SaveDocumentResultSchema,
  type Book,
  type BookProjectDocumentManifest,
  type BookProjectDraftSectionManifest,
  type CatalogDraftSection,
  type CreateDraftSectionInput,
  type CreateDraftSectionsInput,
  type CreateDraftSectionsResult,
  type DeleteDraftSectionInput,
  type DeleteDraftSectionResult,
  type MoveDraftSectionInput,
  type MoveDraftSectionResult,
  type SaveDocumentResult
} from "@deepwrite/contracts";
import { assertBaseRevision } from "./assertions";
import { assertTextByteLength } from "./paths-io";
import {
  bumpRegistry,
  ensureRegistry,
  findRegistration,
  mutate
} from "./registry";
import {
  findDraftDocumentManifest,
  manifestContentItems,
  readCurrentBookManifest,
  readProjectMarkdownContents
} from "./manifest";
import {
  atomicWriteJson,
  commitProjectFileCreations,
  commitProjectMarkdownUpdate,
  portableContentPathKey,
  readProjectMarkdown,
  secureExistingProjectPath,
  secureProjectRoot,
  secureWritableProjectPath,
  unlinkOptional,
  uniqueRelativeMarkdownPath,
  uniqueRelativeMarkdownPathWithSuffix
} from "./paths-io";
import {
  FolderCatalogConflictError,
  FolderCurrentBookProjectManifestSchema,
  MANIFEST_FILE,
  type FolderCatalogStoreContext,
  type FolderCurrentBookProjectManifest,
  type SaveFolderDocumentInput
} from "./types";
import { DEFAULT_SHORT_DOCUMENTS } from "./lifecycle";

const DRAFT_CHARACTER_STATE_TITLE_SUFFIX = " · 人物状态";
const CATALOG_TITLE_MAX_LENGTH = 256;

export function draftCharacterStateTitle(sectionTitle: string): string {
  const availableSectionTitleLength =
    CATALOG_TITLE_MAX_LENGTH - DRAFT_CHARACTER_STATE_TITLE_SUFFIX.length;
  return `${sectionTitle.slice(0, availableSectionTitleLength)}${DRAFT_CHARACTER_STATE_TITLE_SUFFIX}`;
}

export function isReservedDraftDocumentId(documentId: string): boolean {
  return (
    documentId.startsWith("draft-section:") &&
    (documentId.endsWith(":body") || documentId.endsWith(":character-state"))
  );
}

export function nextDraftSectionId(
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

export function chineseSectionNumber(value: number): string {
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

export function defaultDraftSectionTitle(
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

export function createDraftSectionsRequestHash(
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

export async function hydrateDraftSectionCreationResult(
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

export function defaultDocumentTitle(documentId: string): string {
  return (
    DEFAULT_SHORT_DOCUMENTS.find(([id]) => id === documentId)?.[1] ?? documentId
  );
}

export async function saveDocument(
  store: FolderCatalogStoreContext,
  rawInput: SaveFolderDocumentInput
): Promise<SaveDocumentResult> {
  const input = SaveDocumentInputSchema.parse(rawInput);
  if (input.preserveCurrentContent && input.title === undefined) {
    throw new Error("保留正文内容时必须同时提供新标题。");
  }
  if (!input.preserveCurrentContent) {
    assertTextByteLength(
      input.content,
      store.maxMarkdownBytes,
      "Markdown content"
    );
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
    const now = store.now();
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
        store.maxMarkdownBytes
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
          store.maxMarkdownBytes
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
      store.maxMarkdownBytes,
      store.maxManifestBytes
    );
    await bumpRegistry(store, registry, now);
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

export async function createDraftSection(
  store: FolderCatalogStoreContext,
  rawInput: CreateDraftSectionInput
): Promise<CatalogDraftSection> {
  const input = CreateDraftSectionInputSchema.parse(rawInput);
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
    const now = store.now();
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
      store.maxMarkdownBytes,
      store.maxManifestBytes
    );
    await bumpRegistry(store, registry, now);
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

export async function createDraftSections(
  store: FolderCatalogStoreContext,
  rawInput: CreateDraftSectionsInput
): Promise<CreateDraftSectionsResult> {
  const input = CreateDraftSectionsInputSchema.parse(rawInput);
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
        store.maxMarkdownBytes,
        store.maxProjectContentBytes
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
    const now = store.now();
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
          (target) => ({ target, content: "" })
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
      store.maxMarkdownBytes,
      store.maxManifestBytes
    );
    await bumpRegistry(store, registry, now);
    return await hydrateDraftSectionCreationResult(
      projectDirectory,
      next,
      input.operationId,
      operationSections,
      store.maxMarkdownBytes,
      store.maxProjectContentBytes
    );
  });
}

export async function deleteDraftSection(
  store: FolderCatalogStoreContext,
  rawInput: DeleteDraftSectionInput
): Promise<DeleteDraftSectionResult> {
  const input = DeleteDraftSectionInputSchema.parse(rawInput);
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
    const now = store.now();
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
      store.maxManifestBytes
    );
    // The manifest is committed first so a crash cannot leave it pointing at
    // missing files. A failed post-commit cleanup can only leave harmless,
    // unreferenced recovery files behind.
    await Promise.allSettled(
      deletedFileTargets.map(async (target) => await unlinkOptional(target))
    );
    await bumpRegistry(store, registry, now);
    return { bookId: input.bookId, sectionId: input.sectionId, deleted: true };
  });
}

export async function moveDraftSection(
  store: FolderCatalogStoreContext,
  rawInput: MoveDraftSectionInput
): Promise<MoveDraftSectionResult> {
  const input = MoveDraftSectionInputSchema.parse(rawInput);
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
    const sections = [...manifest.draft.sections];
    const sectionIndex = sections.findIndex(({ id }) => id === input.sectionId);
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
    const now = store.now();
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
      store.maxManifestBytes
    );
    await bumpRegistry(store, registry, now);
    return {
      bookId: input.bookId,
      sectionId: input.sectionId,
      direction: input.direction,
      moved: true,
      projectRevision: next.revision
    };
  });
}
