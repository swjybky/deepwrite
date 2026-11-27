import { join } from "node:path";
import {
  ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT,
  ACADEMIC_MAX_CHAPTERS,
  ACADEMIC_MAX_REFERENCE_CARDS,
  ACADEMIC_MAX_SECTIONS,
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  AcademicFrameworkStagesSchema,
  CreateAcademicReferenceCardInputSchema,
  CreateAcademicReferenceCardResultSchema,
  CurrentAcademicBookProjectManifestSchema,
  DeleteAcademicReferenceCardInputSchema,
  DeleteAcademicReferenceCardResultSchema,
  MutateAcademicFrameworkInputSchema,
  MutateAcademicManuscriptInputSchema,
  MutateAcademicManuscriptResultSchema,
  SaveDocumentResultSchema,
  UpdateAcademicReferenceCardInputSchema,
  UpdateAcademicReferenceCardResultSchema,
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createShortWorkspaceContentRevision,
  isBuiltinAcademicFrameworkStageId,
  parseAcademicCardDocumentId,
  parseAcademicSectionDocumentId,
  type AcademicBook,
  type BookProjectDocumentManifest,
  type CreateAcademicReferenceCardInput,
  type CreateAcademicReferenceCardResult,
  type CurrentAcademicBookProjectManifest,
  type DeleteAcademicReferenceCardInput,
  type DeleteAcademicReferenceCardResult,
  type MutateAcademicFrameworkInput,
  type MutateAcademicManuscriptInput,
  type MutateAcademicManuscriptResult,
  type SaveDocumentInput,
  type SaveDocumentResult,
  type UpdateAcademicReferenceCardInput,
  type UpdateAcademicReferenceCardResult
} from "@deepwrite/contracts";
import { createCatalogId, reorderItemsByAnchor } from "@deepwrite/shared";
import {
  captureDocumentVersions,
  DocumentVersionStore
} from "../document-versions/version-store";
import {
  commitProjectTransaction,
  type ProjectTransactionFileOperation
} from "../project-transaction";
import {
  writeBoundedProjectJson,
  commitProjectMarkdownUpdate,
  portableContentPathKey,
  readProjectMarkdown,
  secureProjectRoot,
  secureWritableProjectPath,
  uniqueRelativeMarkdownPath,
  uniqueRelativeMarkdownPathWithSuffix
} from "./paths-io";
import type { FolderCatalogRegistry } from "./registry-types";

const MANIFEST_FILE = "deepwrite.json";
const CATALOG_TITLE_MAX_LENGTH = 256;
const ACADEMIC_BRIEF_SUFFIX = " · 写作指引";
const ACADEMIC_STATE_SUFFIX = " · 节末状态";

export class FolderCatalogAcademicCiteKeyConflictError extends Error {
  readonly code = "catalog.academic_cite_key_conflict" as const;

  constructor(readonly citeKey: string) {
    super(`文献与证据卡引用键“${citeKey}”在当前作品中已存在。`);
    this.name = "FolderCatalogAcademicCiteKeyConflictError";
  }
}

export function academicSectionBriefTitle(sectionTitle: string): string {
  const limit = CATALOG_TITLE_MAX_LENGTH - ACADEMIC_BRIEF_SUFFIX.length;
  return `${sectionTitle.slice(0, limit)}${ACADEMIC_BRIEF_SUFFIX}`;
}

export function academicSectionStateTitle(sectionTitle: string): string {
  const limit = CATALOG_TITLE_MAX_LENGTH - ACADEMIC_STATE_SUFFIX.length;
  return `${sectionTitle.slice(0, limit)}${ACADEMIC_STATE_SUFFIX}`;
}

export function academicManifestContentItems(
  manifest: CurrentAcademicBookProjectManifest
): Array<BookProjectDocumentManifest> {
  return [
    manifest.foundation.thesisOverview,
    manifest.foundation.terminology,
    ...manifest.foundation.cards.map((card) => card.document),
    ...manifest.documents,
    ...manifest.manuscript.sections.flatMap((section) => [
      section.brief,
      section.body,
      section.state
    ])
  ];
}

function serializeManifest(
  manifest: CurrentAcademicBookProjectManifest,
  maxManifestBytes: number
): string {
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > maxManifestBytes) {
    throw new Error(`JSON content exceeds the ${maxManifestBytes} byte limit.`);
  }
  return serialized;
}

export interface AcademicMutationDriver {
  now(): string;
  maxMarkdownBytes: number;
  maxManifestBytes: number;
  assertBaseRevision(expected: number | undefined, actual: number): void;
  createConflictError(
    expected: string | number,
    actual: string | number
  ): Error;
  readAcademicBook(
    projectDirectory: string,
    bookId: string
  ): Promise<AcademicBook>;
  bumpRegistry(registry: FolderCatalogRegistry, now: string): Promise<void>;
}

export async function saveAcademicDocumentWithLock(params: {
  projectDirectory: string;
  manifest: CurrentAcademicBookProjectManifest;
  input: SaveDocumentInput;
  registry: FolderCatalogRegistry;
  driver: AcademicMutationDriver;
}): Promise<SaveDocumentResult> {
  const { projectDirectory, manifest, input, registry, driver } = params;
  const now = driver.now();

  const foundation = structuredClone(manifest.foundation);
  const documents = manifest.documents.map((doc) => ({ ...doc }));
  const manuscript = structuredClone(manifest.manuscript);

  let documentManifest: BookProjectDocumentManifest | undefined;
  let updatesMetadata = false;

  if (input.documentId === foundation.thesisOverview.id) {
    if (
      input.title !== undefined &&
      input.title.trim() !== foundation.thesisOverview.title
    ) {
      throw new Error("研究立意与核心贡献名称固定，不能修改。");
    }
    documentManifest = {
      ...foundation.thesisOverview,
      updatedAt: now
    };
    foundation.thesisOverview = documentManifest;
  } else if (input.documentId === foundation.terminology.id) {
    if (
      input.title !== undefined &&
      input.title.trim() !== foundation.terminology.title
    ) {
      throw new Error("术语与符号表名称固定，不能修改。");
    }
    documentManifest = {
      ...foundation.terminology,
      updatedAt: now
    };
    foundation.terminology = documentManifest;
  } else {
    const cardIndex = foundation.cards.findIndex(
      (card) => card.document.id === input.documentId
    );
    if (cardIndex >= 0) {
      const card = foundation.cards[cardIndex]!;
      const nextTitle = input.title?.trim() ?? card.title;
      updatesMetadata = nextTitle !== card.title;
      documentManifest = {
        ...card.document,
        title: nextTitle,
        updatedAt: now
      };
      foundation.cards[cardIndex] = {
        ...card,
        title: nextTitle,
        document: documentManifest,
        updatedAt: now
      };
    } else {
      const stageDocIndex = documents.findIndex(
        (doc) => doc.id === input.documentId
      );
      if (stageDocIndex >= 0) {
        const existing = documents[stageDocIndex]!;
        if (
          input.title !== undefined &&
          input.title.trim() !== existing.title
        ) {
          throw new Error("请在论证框架管理中修改阶段名称。");
        }
        documentManifest = {
          ...existing,
          updatedAt: now
        };
        documents[stageDocIndex] = documentManifest;
      } else {
        const parsedSection = parseAcademicSectionDocumentId(input.documentId);
        if (parsedSection) {
          const sectionIndex = manuscript.sections.findIndex(
            (s) => s.id === parsedSection.sectionId
          );
          if (sectionIndex < 0) {
            throw new Error("该正文小节已删除或不存在。");
          }
          const section = manuscript.sections[sectionIndex]!;
          const kind = parsedSection.fileKind;
          if (kind === "body") {
            const nextTitle = input.title?.trim() ?? section.title;
            updatesMetadata = nextTitle !== section.title;
            documentManifest = {
              ...section.body,
              title: nextTitle,
              updatedAt: now
            };
            manuscript.sections[sectionIndex] = {
              ...section,
              title: nextTitle,
              body: documentManifest,
              brief:
                nextTitle === section.title
                  ? section.brief
                  : {
                      ...section.brief,
                      title: academicSectionBriefTitle(nextTitle),
                      updatedAt: now
                    },
              state:
                nextTitle === section.title
                  ? section.state
                  : {
                      ...section.state,
                      title: academicSectionStateTitle(nextTitle),
                      updatedAt: now
                    },
              updatedAt: now
            };
          } else {
            const existing = section[kind];
            if (
              input.title !== undefined &&
              input.title.trim() !== existing.title
            ) {
              throw new Error(
                `${kind === "brief" ? "写作指引" : "节末状态"}标题跟随小节名称，不能单独重命名。`
              );
            }
            documentManifest = {
              ...existing,
              updatedAt: now
            };
            manuscript.sections[sectionIndex] = {
              ...section,
              [kind]: documentManifest,
              updatedAt: now
            };
          }
        } else if (parseAcademicCardDocumentId(input.documentId)) {
          throw new Error("该文献或证据卡已删除或不存在。");
        }
      }
    }
  }

  if (!documentManifest) {
    throw new Error("文档不存在或不属于该学术作品。");
  }

  if (input.draftSectionChange) {
    throw new Error("学术作品请通过学术正文目录命令修改小节属性。");
  }

  if (!input.force && updatesMetadata) {
    driver.assertBaseRevision(input.baseProjectRevision, manifest.revision);
  } else if (
    !input.force &&
    input.baseProjectRevision !== undefined &&
    input.baseRevision === undefined
  ) {
    driver.assertBaseRevision(input.baseProjectRevision, manifest.revision);
  }

  const currentContent = await readProjectMarkdown(
    projectDirectory,
    documentManifest.path,
    driver.maxMarkdownBytes
  );
  if (!input.force && input.baseRevision !== undefined) {
    const actualRevision = createShortWorkspaceContentRevision(currentContent);
    if (input.baseRevision !== actualRevision) {
      throw driver.createConflictError(input.baseRevision, actualRevision);
    }
  }

  const committedContent = input.preserveCurrentContent
    ? currentContent
    : input.content;
  const target = await secureWritableProjectPath(
    projectDirectory,
    documentManifest.path
  );
  const next = CurrentAcademicBookProjectManifestSchema.parse({
    ...manifest,
    revision: manifest.revision + 1,
    foundation,
    documents,
    manuscript,
    updatedAt: now
  });

  await commitProjectMarkdownUpdate(
    target,
    committedContent,
    currentContent,
    join(projectDirectory, MANIFEST_FILE),
    next,
    driver.maxMarkdownBytes,
    driver.maxManifestBytes
  );
  await driver.bumpRegistry(registry, now);

  if (input.versionOrigin && !input.preserveCurrentContent) {
    await captureDocumentVersions(
      new DocumentVersionStore(
        projectDirectory,
        {
          workspace: "catalog",
          bookId: input.bookId,
          documentId: input.documentId
        },
        driver.maxMarkdownBytes,
        driver.now
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
}

export async function executeMutateAcademicFramework(params: {
  projectDirectory: string;
  manifest: CurrentAcademicBookProjectManifest;
  rawInput: MutateAcademicFrameworkInput;
  registry: FolderCatalogRegistry;
  driver: AcademicMutationDriver;
}): Promise<AcademicBook> {
  const { projectDirectory, manifest, rawInput, registry, driver } = params;
  const input = MutateAcademicFrameworkInputSchema.parse(rawInput);
  if (!input.force) {
    driver.assertBaseRevision(input.baseProjectRevision, manifest.revision);
  }
  const now = driver.now();
  const mutation = input.mutation;
  const stages = manifest.frameworkStages.map((stage) => ({ ...stage }));
  const documents = manifest.documents.map((doc) => ({ ...doc }));
  const operations: ProjectTransactionFileOperation[] = [];

  if (mutation.type === "create") {
    if (stages.length >= ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT) {
      throw new Error(
        `论证框架最多支持 ${ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT} 个阶段。`
      );
    }
    if (
      academicManifestContentItems(manifest).length >=
      CATALOG_PROJECT_MAX_CONTENT_ITEMS
    ) {
      throw new Error("作品文件数量已达上限，无法新增论证阶段。");
    }
    const title = mutation.title.trim();
    const description = mutation.description.trim();
    if (
      stages.some(
        (s) => s.title.toLocaleLowerCase() === title.toLocaleLowerCase()
      )
    ) {
      throw new Error(`论证框架阶段“${title}”已存在。`);
    }
    const usedIds = new Set(
      academicManifestContentItems(manifest).map(({ id }) => id)
    );
    for (const s of stages) usedIds.add(s.id);
    if (mutation.stageId && usedIds.has(mutation.stageId)) {
      throw new Error(`论证阶段标识“${mutation.stageId}”已被占用。`);
    }
    let stageId = mutation.stageId ?? createCatalogId("academic-stage");
    while (!mutation.stageId && usedIds.has(stageId)) {
      stageId = createCatalogId("academic-stage");
    }
    const usedPaths = new Set(
      academicManifestContentItems(manifest).map(({ path }) =>
        portableContentPathKey(path)
      )
    );
    const relativePath = await uniqueRelativeMarkdownPath(
      projectDirectory,
      "framework",
      stageId,
      usedPaths
    );
    stages.push({
      id: stageId,
      title,
      description,
      enabled: true
    });
    documents.push({
      id: stageId,
      title,
      path: relativePath,
      createdAt: now,
      updatedAt: now
    });
    operations.push({
      action: "write",
      path: relativePath,
      expectedSha256: null,
      content: ""
    });
  } else if (mutation.type === "update") {
    const stageIndex = stages.findIndex(({ id }) => id === mutation.stageId);
    if (stageIndex < 0) {
      throw new Error("该论证阶段已删除或不存在。");
    }
    const title = mutation.title.trim();
    const description = mutation.description.trim();
    if (
      stages.some(
        (s, idx) =>
          idx !== stageIndex &&
          s.title.toLocaleLowerCase() === title.toLocaleLowerCase()
      )
    ) {
      throw new Error(`论证框架阶段“${title}”已存在。`);
    }
    stages[stageIndex] = {
      ...stages[stageIndex]!,
      title,
      description
    };
    const docIndex = documents.findIndex(({ id }) => id === mutation.stageId);
    if (docIndex >= 0) {
      documents[docIndex] = {
        ...documents[docIndex]!,
        title,
        updatedAt: now
      };
    }
  } else if (mutation.type === "move" || mutation.type === "reorder") {
    const stageIndex = stages.findIndex(({ id }) => id === mutation.stageId);
    if (stageIndex < 0) {
      throw new Error("该论证阶段已删除或不存在。");
    }
    let targetIndex: number;
    if (mutation.type === "reorder") {
      const anchorIndex = stages.findIndex(
        ({ id }) => id === mutation.anchorId
      );
      if (anchorIndex < 0) {
        throw new Error("目标论证阶段已删除或不存在。");
      }
      targetIndex = anchorIndex;
      if (stageIndex !== anchorIndex) {
        if (mutation.position === "after") targetIndex += 1;
        if (stageIndex < anchorIndex) targetIndex -= 1;
      }
      if (targetIndex === stageIndex) {
        return await driver.readAcademicBook(projectDirectory, input.bookId);
      }
    } else {
      targetIndex = stageIndex + (mutation.direction === "up" ? -1 : 1);
    }
    if (targetIndex < 0 || targetIndex >= stages.length) {
      throw new Error("该论证阶段已经位于列表边界。");
    }
    const [moved] = stages.splice(stageIndex, 1);
    stages.splice(targetIndex, 0, moved!);
  } else if (mutation.type === "setEnabled") {
    const stageIndex = stages.findIndex(({ id }) => id === mutation.stageId);
    if (stageIndex < 0) {
      throw new Error("该论证阶段已删除或不存在。");
    }
    if (
      !mutation.enabled &&
      !stages.some((s, idx) => idx !== stageIndex && s.enabled)
    ) {
      throw new Error("至少需要保留一个启用的论证框架阶段。");
    }
    stages[stageIndex] = {
      ...stages[stageIndex]!,
      enabled: mutation.enabled
    };
  } else {
    if (isBuiltinAcademicFrameworkStageId(mutation.stageId)) {
      throw new Error("内置论证框架阶段不可删除，可将其关闭。");
    }
    const stageIndex = stages.findIndex(({ id }) => id === mutation.stageId);
    if (stageIndex < 0) {
      throw new Error("该论证阶段已删除或不存在。");
    }
    if (stages.length <= 1) {
      throw new Error("至少需要保留一个论证框架阶段。");
    }
    if (!stages.some((s, idx) => idx !== stageIndex && s.enabled)) {
      throw new Error("至少需要保留一个启用的论证框架阶段，请先启用其他阶段。");
    }
    stages.splice(stageIndex, 1);
    const docIndex = documents.findIndex(({ id }) => id === mutation.stageId);
    if (docIndex >= 0) {
      const removed = documents[docIndex]!;
      documents.splice(docIndex, 1);
      operations.push({
        action: "delete",
        path: removed.path
      });
    }
  }

  const nextManifest = CurrentAcademicBookProjectManifestSchema.parse({
    ...manifest,
    revision: manifest.revision + 1,
    frameworkStages: AcademicFrameworkStagesSchema.parse(stages),
    documents,
    updatedAt: now
  });
  operations.push({
    action: "write",
    path: MANIFEST_FILE,
    content: serializeManifest(nextManifest, driver.maxManifestBytes)
  });

  await commitProjectTransaction({
    projectRoot: projectDirectory,
    operations,
    maxFileBytes: Math.max(driver.maxMarkdownBytes, driver.maxManifestBytes)
  });
  await driver.bumpRegistry(registry, now);
  return await driver.readAcademicBook(projectDirectory, input.bookId);
}

export async function executeCreateAcademicReferenceCard(params: {
  projectDirectory: string;
  manifest: CurrentAcademicBookProjectManifest;
  rawInput: CreateAcademicReferenceCardInput;
  registry: FolderCatalogRegistry;
  driver: AcademicMutationDriver;
}): Promise<CreateAcademicReferenceCardResult> {
  const { projectDirectory, manifest, rawInput, registry, driver } = params;
  const input = CreateAcademicReferenceCardInputSchema.parse(rawInput);
  if (!input.force) {
    driver.assertBaseRevision(input.baseProjectRevision, manifest.revision);
  }
  if (manifest.foundation.cards.length >= ACADEMIC_MAX_REFERENCE_CARDS) {
    throw new Error(
      `文献与证据卡最多支持 ${ACADEMIC_MAX_REFERENCE_CARDS} 张。`
    );
  }
  if (
    academicManifestContentItems(manifest).length >=
    CATALOG_PROJECT_MAX_CONTENT_ITEMS
  ) {
    throw new Error("作品文件数量已达上限，无法新建卡片。");
  }

  const normalizedKey = input.citeKey.toLocaleLowerCase("en-US");
  if (
    manifest.foundation.cards.some(
      (card) => card.citeKey.toLocaleLowerCase("en-US") === normalizedKey
    )
  ) {
    throw new FolderCatalogAcademicCiteKeyConflictError(input.citeKey);
  }

  const usedCardIds = new Set(manifest.foundation.cards.map((c) => c.id));
  const usedDocIds = new Set(
    academicManifestContentItems(manifest).map(({ id }) => id)
  );
  if (
    input.cardId &&
    (usedCardIds.has(input.cardId) ||
      usedDocIds.has(createAcademicCardDocumentId(input.cardId)))
  ) {
    throw new Error(`卡片标识“${input.cardId}”已被占用。`);
  }
  let cardId = input.cardId ?? createCatalogId("card");
  while (
    !input.cardId &&
    (usedCardIds.has(cardId) ||
      usedDocIds.has(createAcademicCardDocumentId(cardId)))
  ) {
    cardId = createCatalogId("card");
  }

  const now = driver.now();
  const content = input.content ?? "";
  if (Buffer.byteLength(content, "utf8") > driver.maxMarkdownBytes) {
    throw new Error(
      `Markdown content exceeds the ${driver.maxMarkdownBytes} byte limit.`
    );
  }

  const usedPaths = new Set(
    academicManifestContentItems(manifest).map(({ path }) =>
      portableContentPathKey(path)
    )
  );
  const relativePath = await uniqueRelativeMarkdownPath(
    projectDirectory,
    "foundation/cards",
    cardId,
    usedPaths
  );
  const documentId = createAcademicCardDocumentId(cardId);
  const cardManifest = {
    id: cardId,
    citeKey: input.citeKey,
    cardType: input.cardType,
    title: input.title,
    document: {
      id: documentId,
      title: input.title,
      path: relativePath,
      createdAt: now,
      updatedAt: now
    },
    createdAt: now,
    updatedAt: now
  };

  const nextManifest = CurrentAcademicBookProjectManifestSchema.parse({
    ...manifest,
    revision: manifest.revision + 1,
    foundation: {
      ...manifest.foundation,
      cards: [...manifest.foundation.cards, cardManifest]
    },
    updatedAt: now
  });

  await commitProjectTransaction({
    projectRoot: projectDirectory,
    operations: [
      {
        action: "write",
        path: relativePath,
        expectedSha256: null,
        content
      },
      {
        action: "write",
        path: MANIFEST_FILE,
        content: serializeManifest(nextManifest, driver.maxManifestBytes)
      }
    ],
    maxFileBytes: Math.max(driver.maxMarkdownBytes, driver.maxManifestBytes)
  });
  await driver.bumpRegistry(registry, now);

  if (input.versionOrigin && content) {
    await captureDocumentVersions(
      new DocumentVersionStore(
        projectDirectory,
        {
          workspace: "catalog",
          bookId: input.bookId,
          documentId
        },
        driver.maxMarkdownBytes,
        driver.now
      ),
      "",
      content,
      input.versionOrigin
    );
  }

  const book = await driver.readAcademicBook(projectDirectory, input.bookId);
  const card = book.foundation.cards.find((item) => item.id === cardId)!;
  return CreateAcademicReferenceCardResultSchema.parse({ book, card });
}

export async function executeUpdateAcademicReferenceCard(params: {
  projectDirectory: string;
  manifest: CurrentAcademicBookProjectManifest;
  rawInput: UpdateAcademicReferenceCardInput;
  registry: FolderCatalogRegistry;
  driver: AcademicMutationDriver;
}): Promise<UpdateAcademicReferenceCardResult> {
  const { projectDirectory, manifest, rawInput, registry, driver } = params;
  const input = UpdateAcademicReferenceCardInputSchema.parse(rawInput);
  if (!input.force) {
    driver.assertBaseRevision(input.baseProjectRevision, manifest.revision);
  }
  const cardIndex = manifest.foundation.cards.findIndex(
    (card) => card.id === input.cardId
  );
  if (cardIndex < 0) {
    throw new Error("该文献或证据卡已删除或不存在。");
  }
  const existing = manifest.foundation.cards[cardIndex]!;
  if (input.citeKey !== undefined) {
    const normalizedKey = input.citeKey.toLocaleLowerCase("en-US");
    if (
      manifest.foundation.cards.some(
        (card, idx) =>
          idx !== cardIndex &&
          card.citeKey.toLocaleLowerCase("en-US") === normalizedKey
      )
    ) {
      throw new FolderCatalogAcademicCiteKeyConflictError(input.citeKey);
    }
  }

  const now = driver.now();
  const nextTitle = input.title ?? existing.title;
  const cards = [...manifest.foundation.cards];
  cards[cardIndex] = {
    ...existing,
    citeKey: input.citeKey ?? existing.citeKey,
    cardType: input.cardType ?? existing.cardType,
    title: nextTitle,
    document: {
      ...existing.document,
      title: nextTitle,
      updatedAt: now
    },
    updatedAt: now
  };

  const nextManifest = CurrentAcademicBookProjectManifestSchema.parse({
    ...manifest,
    revision: manifest.revision + 1,
    foundation: {
      ...manifest.foundation,
      cards
    },
    updatedAt: now
  });

  await commitProjectTransaction({
    projectRoot: projectDirectory,
    operations: [
      {
        action: "write",
        path: MANIFEST_FILE,
        content: serializeManifest(nextManifest, driver.maxManifestBytes)
      }
    ],
    maxFileBytes: Math.max(driver.maxMarkdownBytes, driver.maxManifestBytes)
  });
  await driver.bumpRegistry(registry, now);

  const book = await driver.readAcademicBook(projectDirectory, input.bookId);
  const card = book.foundation.cards.find((item) => item.id === input.cardId)!;
  return UpdateAcademicReferenceCardResultSchema.parse({ book, card });
}

export async function executeDeleteAcademicReferenceCard(params: {
  projectDirectory: string;
  manifest: CurrentAcademicBookProjectManifest;
  rawInput: DeleteAcademicReferenceCardInput;
  registry: FolderCatalogRegistry;
  driver: AcademicMutationDriver;
}): Promise<DeleteAcademicReferenceCardResult> {
  const { projectDirectory, manifest, rawInput, registry, driver } = params;
  const input = DeleteAcademicReferenceCardInputSchema.parse(rawInput);
  if (!input.force) {
    driver.assertBaseRevision(input.baseProjectRevision, manifest.revision);
  }
  const cardIndex = manifest.foundation.cards.findIndex(
    (card) => card.id === input.cardId
  );
  if (cardIndex < 0) {
    const book = await driver.readAcademicBook(projectDirectory, input.bookId);
    return DeleteAcademicReferenceCardResultSchema.parse({
      book,
      cardId: input.cardId,
      deleted: false
    });
  }
  const removed = manifest.foundation.cards[cardIndex]!;
  const now = driver.now();
  const nextManifest = CurrentAcademicBookProjectManifestSchema.parse({
    ...manifest,
    revision: manifest.revision + 1,
    foundation: {
      ...manifest.foundation,
      cards: manifest.foundation.cards.filter((c) => c.id !== input.cardId)
    },
    updatedAt: now
  });

  await commitProjectTransaction({
    projectRoot: projectDirectory,
    operations: [
      {
        action: "delete",
        path: removed.document.path
      },
      {
        action: "write",
        path: MANIFEST_FILE,
        content: serializeManifest(nextManifest, driver.maxManifestBytes)
      }
    ],
    maxFileBytes: Math.max(driver.maxMarkdownBytes, driver.maxManifestBytes)
  });
  await driver.bumpRegistry(registry, now);

  const book = await driver.readAcademicBook(projectDirectory, input.bookId);
  return DeleteAcademicReferenceCardResultSchema.parse({
    book,
    cardId: input.cardId,
    deleted: true
  });
}

function nextAcademicSectionId(
  sectionIds: readonly string[],
  usedDocumentIds: ReadonlySet<string>
): string {
  const usedSections = new Set(sectionIds);
  const highest = sectionIds.reduce((maxVal, id) => {
    const match = /^sec-(\d+)$/u.exec(id)?.[1];
    return match ? Math.max(maxVal, Number(match)) : maxVal;
  }, 0);
  let index = highest + 1;
  while (true) {
    const candidate = `sec-${index}`;
    if (
      !usedSections.has(candidate) &&
      !usedDocumentIds.has(
        createAcademicSectionDocumentId(candidate, "brief")
      ) &&
      !usedDocumentIds.has(
        createAcademicSectionDocumentId(candidate, "body")
      ) &&
      !usedDocumentIds.has(createAcademicSectionDocumentId(candidate, "state"))
    ) {
      return candidate;
    }
    index += 1;
  }
}

export async function executeMutateAcademicManuscript(params: {
  projectDirectory: string;
  manifest: CurrentAcademicBookProjectManifest;
  rawInput: MutateAcademicManuscriptInput;
  registry: FolderCatalogRegistry;
  driver: AcademicMutationDriver;
}): Promise<MutateAcademicManuscriptResult> {
  const { projectDirectory, manifest, rawInput, registry, driver } = params;
  const input = MutateAcademicManuscriptInputSchema.parse(rawInput);
  if (!input.force) {
    driver.assertBaseRevision(input.baseProjectRevision, manifest.revision);
  }
  const now = driver.now();
  const mutation = input.mutation;
  const chapters = manifest.manuscript.chapters.map((ch) => ({ ...ch }));
  const sections = structuredClone(manifest.manuscript.sections);
  const operations: ProjectTransactionFileOperation[] = [];
  let createdChapterId: string | undefined;
  let createdSectionId: string | undefined;

  if (mutation.type === "create-chapter") {
    if (chapters.length >= ACADEMIC_MAX_CHAPTERS) {
      throw new Error(`正文最多支持 ${ACADEMIC_MAX_CHAPTERS} 章。`);
    }
    const title = mutation.title.trim();
    const usedIds = new Set(chapters.map((c) => c.id));
    if (mutation.chapterId && usedIds.has(mutation.chapterId)) {
      throw new Error(`章标识“${mutation.chapterId}”已被占用。`);
    }
    let chapterId = mutation.chapterId ?? createCatalogId("ch");
    while (!mutation.chapterId && usedIds.has(chapterId)) {
      chapterId = createCatalogId("ch");
    }
    let insertAt = chapters.length;
    if (mutation.afterChapterId !== undefined) {
      const afterIdx = chapters.findIndex(
        (c) => c.id === mutation.afterChapterId
      );
      if (afterIdx < 0) {
        throw new Error(`未找到章：${mutation.afterChapterId}`);
      }
      insertAt = afterIdx + 1;
    }
    chapters.splice(insertAt, 0, {
      id: chapterId,
      title,
      createdAt: now,
      updatedAt: now
    });
    createdChapterId = chapterId;
  } else if (mutation.type === "rename-chapter") {
    const idx = chapters.findIndex((c) => c.id === mutation.chapterId);
    if (idx < 0) throw new Error("该章已删除或不存在。");
    chapters[idx] = {
      ...chapters[idx]!,
      title: mutation.title.trim(),
      updatedAt: now
    };
  } else if (mutation.type === "move-chapter") {
    const idx = chapters.findIndex((c) => c.id === mutation.chapterId);
    if (idx < 0) throw new Error("该章已删除或不存在。");
    const targetIdx = mutation.direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= chapters.length) {
      throw new Error("该章已经位于列表边界。");
    }
    const [moved] = chapters.splice(idx, 1);
    chapters.splice(targetIdx, 0, moved!);
  } else if (mutation.type === "reorder-chapter") {
    if (!chapters.some((c) => c.id === mutation.chapterId)) {
      throw new Error("该章已删除或不存在。");
    }
    if (!chapters.some((c) => c.id === mutation.anchorChapterId)) {
      throw new Error("目标章已删除或不存在。");
    }
    const reordered = reorderItemsByAnchor(
      chapters,
      mutation.chapterId,
      mutation.anchorChapterId,
      mutation.position
    );
    if (!reordered.moved) {
      return MutateAcademicManuscriptResultSchema.parse({
        book: await driver.readAcademicBook(projectDirectory, input.bookId)
      });
    }
    chapters.splice(0, chapters.length, ...reordered.items);
  } else if (mutation.type === "delete-chapter") {
    const idx = chapters.findIndex((c) => c.id === mutation.chapterId);
    if (idx < 0) throw new Error("该章已删除或不存在。");
    const childCount = sections.filter(
      (s) => s.chapterId === mutation.chapterId
    ).length;
    if (childCount > 0 && mutation.sectionAction === "reject") {
      throw new Error("该章下仍有小节，请先移出或删除小节后再删除章。");
    }
    chapters.splice(idx, 1);
    for (let i = 0; i < sections.length; i += 1) {
      if (sections[i]!.chapterId === mutation.chapterId) {
        const { chapterId: _removed, ...rest } = sections[i]!;
        sections[i] = { ...rest, updatedAt: now };
      }
    }
  } else if (mutation.type === "create-section") {
    if (sections.length >= ACADEMIC_MAX_SECTIONS) {
      throw new Error(`正文最多支持 ${ACADEMIC_MAX_SECTIONS} 个小节。`);
    }
    if (
      academicManifestContentItems(manifest).length + 3 >
      CATALOG_PROJECT_MAX_CONTENT_ITEMS
    ) {
      throw new Error("作品文件数量已达上限，无法新建小节。");
    }
    const targetChapterId =
      mutation.chapterId === null ? undefined : mutation.chapterId;
    if (
      targetChapterId !== undefined &&
      !chapters.some((c) => c.id === targetChapterId)
    ) {
      throw new Error(`所属章不存在：${targetChapterId}`);
    }
    const usedDocIds = new Set(
      academicManifestContentItems(manifest).map(({ id }) => id)
    );
    const existingSectionIds = sections.map((s) => s.id);
    let sectionId: string;
    if (mutation.sectionId) {
      if (
        existingSectionIds.includes(mutation.sectionId) ||
        usedDocIds.has(
          createAcademicSectionDocumentId(mutation.sectionId, "brief")
        ) ||
        usedDocIds.has(
          createAcademicSectionDocumentId(mutation.sectionId, "body")
        ) ||
        usedDocIds.has(
          createAcademicSectionDocumentId(mutation.sectionId, "state")
        )
      ) {
        throw new Error(`小节标识“${mutation.sectionId}”已被占用。`);
      }
      sectionId = mutation.sectionId;
    } else {
      sectionId = nextAcademicSectionId(existingSectionIds, usedDocIds);
    }

    let insertAt = sections.length;
    if (mutation.afterSectionId !== undefined) {
      const afterIdx = sections.findIndex(
        (s) => s.id === mutation.afterSectionId
      );
      if (afterIdx < 0) {
        throw new Error(`找不到插入位置对应的小节：${mutation.afterSectionId}`);
      }
      insertAt = afterIdx + 1;
    } else if (targetChapterId !== undefined) {
      let lastInChapter = -1;
      sections.forEach((s, idx) => {
        if (s.chapterId === targetChapterId) lastInChapter = idx;
      });
      if (lastInChapter >= 0) {
        insertAt = lastInChapter + 1;
      } else {
        const trailingRefIdx = sections.findIndex(
          (s) =>
            !s.chapterId && (s.title === "参考文献" || s.title === "References")
        );
        if (trailingRefIdx >= 0) {
          insertAt = trailingRefIdx;
        }
      }
    } else {
      const trailingRefIdx = sections.findIndex(
        (s) =>
          !s.chapterId && (s.title === "参考文献" || s.title === "References")
      );
      if (trailingRefIdx >= 0) {
        insertAt = trailingRefIdx;
      }
    }

    const title = mutation.title?.trim() || `新小节 ${sections.length + 1}`;
    const usedPaths = new Set(
      academicManifestContentItems(manifest).map(({ path }) =>
        portableContentPathKey(path)
      )
    );
    const briefPath = await uniqueRelativeMarkdownPathWithSuffix(
      projectDirectory,
      "manuscript/sections",
      sectionId,
      ".brief.md",
      usedPaths
    );
    usedPaths.add(portableContentPathKey(briefPath));
    const bodyPath = await uniqueRelativeMarkdownPathWithSuffix(
      projectDirectory,
      "manuscript/sections",
      sectionId,
      ".body.md",
      usedPaths
    );
    usedPaths.add(portableContentPathKey(bodyPath));
    const statePath = await uniqueRelativeMarkdownPathWithSuffix(
      projectDirectory,
      "manuscript/sections",
      sectionId,
      ".state.md",
      usedPaths
    );

    const briefContent = mutation.briefContent ?? "";
    const bodyContent = mutation.bodyContent ?? "";
    const stateContent = mutation.stateContent ?? "";
    for (const text of [briefContent, bodyContent, stateContent]) {
      if (Buffer.byteLength(text, "utf8") > driver.maxMarkdownBytes) {
        throw new Error(
          `Markdown content exceeds the ${driver.maxMarkdownBytes} byte limit.`
        );
      }
    }

    const newSection = {
      id: sectionId,
      ...(targetChapterId ? { chapterId: targetChapterId } : {}),
      title,
      wordCountRequirement: mutation.wordCountRequirement ?? "",
      brief: {
        id: createAcademicSectionDocumentId(sectionId, "brief"),
        title: academicSectionBriefTitle(title),
        path: briefPath,
        createdAt: now,
        updatedAt: now
      },
      body: {
        id: createAcademicSectionDocumentId(sectionId, "body"),
        title,
        path: bodyPath,
        createdAt: now,
        updatedAt: now
      },
      state: {
        id: createAcademicSectionDocumentId(sectionId, "state"),
        title: academicSectionStateTitle(title),
        path: statePath,
        createdAt: now,
        updatedAt: now
      },
      createdAt: now,
      updatedAt: now
    };
    sections.splice(insertAt, 0, newSection);
    createdSectionId = sectionId;
    operations.push(
      {
        action: "write",
        path: briefPath,
        expectedSha256: null,
        content: briefContent
      },
      {
        action: "write",
        path: bodyPath,
        expectedSha256: null,
        content: bodyContent
      },
      {
        action: "write",
        path: statePath,
        expectedSha256: null,
        content: stateContent
      }
    );
  } else if (mutation.type === "move-section") {
    const idx = sections.findIndex((s) => s.id === mutation.sectionId);
    if (idx < 0) throw new Error("该正文小节已删除或不存在。");
    const current = sections[idx]!;
    const nextChapterId =
      mutation.chapterId === undefined
        ? current.chapterId
        : mutation.chapterId === null
          ? undefined
          : mutation.chapterId;
    if (
      nextChapterId !== undefined &&
      !chapters.some((c) => c.id === nextChapterId)
    ) {
      throw new Error(`所属章不存在：${nextChapterId}`);
    }

    if (
      mutation.direction !== undefined &&
      mutation.chapterId === undefined &&
      mutation.afterSectionId === undefined
    ) {
      const siblingIndices = sections
        .map((s, i) => ({ s, i }))
        .filter(
          ({ s }) =>
            (s.chapterId ?? undefined) === (current.chapterId ?? undefined)
        )
        .map(({ i }) => i);
      const posInSiblings = siblingIndices.indexOf(idx);
      const targetPosInSiblings =
        mutation.direction === "up" ? posInSiblings - 1 : posInSiblings + 1;
      if (
        targetPosInSiblings >= 0 &&
        targetPosInSiblings < siblingIndices.length
      ) {
        const swapIdx = siblingIndices[targetPosInSiblings]!;
        [sections[idx], sections[swapIdx]] = [
          sections[swapIdx]!,
          sections[idx]!
        ];
      }
    } else {
      const { chapterId: _prevChapter, ...withoutChapter } = current;
      const updatedSection = {
        ...withoutChapter,
        ...(nextChapterId ? { chapterId: nextChapterId } : {}),
        updatedAt: now
      };
      sections.splice(idx, 1);
      if (mutation.afterSectionId === null) {
        const firstMatching =
          nextChapterId !== undefined
            ? sections.findIndex((s) => s.chapterId === nextChapterId)
            : 0;
        sections.splice(
          firstMatching >= 0 ? firstMatching : 0,
          0,
          updatedSection
        );
      } else if (mutation.afterSectionId !== undefined) {
        const afterIdx = sections.findIndex(
          (s) => s.id === mutation.afterSectionId
        );
        if (afterIdx < 0) {
          throw new Error(
            `找不到插入位置对应的小节：${mutation.afterSectionId}`
          );
        }
        sections.splice(afterIdx + 1, 0, updatedSection);
      } else {
        let insertAt = sections.length;
        if (nextChapterId !== undefined) {
          let lastInChapter = -1;
          sections.forEach((s, i) => {
            if (s.chapterId === nextChapterId) lastInChapter = i;
          });
          if (lastInChapter >= 0) insertAt = lastInChapter + 1;
        }
        sections.splice(insertAt, 0, updatedSection);
      }
    }
  } else if (mutation.type === "reorder-section") {
    const source = sections.find((s) => s.id === mutation.sectionId);
    if (!source) throw new Error("该正文小节已删除或不存在。");
    const anchor = sections.find((s) => s.id === mutation.anchorSectionId);
    if (!anchor) throw new Error("目标正文小节已删除或不存在。");
    if ((source.chapterId ?? undefined) !== (anchor.chapterId ?? undefined)) {
      throw new Error("只能在同级目录内调整小节顺序。");
    }
    const reordered = reorderItemsByAnchor(
      sections,
      mutation.sectionId,
      mutation.anchorSectionId,
      mutation.position
    );
    if (!reordered.moved) {
      return MutateAcademicManuscriptResultSchema.parse({
        book: await driver.readAcademicBook(projectDirectory, input.bookId)
      });
    }
    sections.splice(0, sections.length, ...reordered.items);
  } else if (mutation.type === "update-section-meta") {
    const idx = sections.findIndex((s) => s.id === mutation.sectionId);
    if (idx < 0) throw new Error("该正文小节已删除或不存在。");
    const current = sections[idx]!;
    const nextChapterId =
      mutation.chapterId === undefined
        ? current.chapterId
        : mutation.chapterId === null
          ? undefined
          : mutation.chapterId;
    if (
      nextChapterId !== undefined &&
      !chapters.some((c) => c.id === nextChapterId)
    ) {
      throw new Error(`所属章不存在：${nextChapterId}`);
    }
    const nextTitle = mutation.title?.trim() ?? current.title;
    const { chapterId: _prevChapter, ...withoutChapter } = current;
    sections[idx] = {
      ...withoutChapter,
      ...(nextChapterId ? { chapterId: nextChapterId } : {}),
      title: nextTitle,
      wordCountRequirement:
        mutation.wordCountRequirement ?? current.wordCountRequirement,
      brief:
        nextTitle === current.title
          ? current.brief
          : {
              ...current.brief,
              title: academicSectionBriefTitle(nextTitle),
              updatedAt: now
            },
      body:
        nextTitle === current.title
          ? current.body
          : {
              ...current.body,
              title: nextTitle,
              updatedAt: now
            },
      state:
        nextTitle === current.title
          ? current.state
          : {
              ...current.state,
              title: academicSectionStateTitle(nextTitle),
              updatedAt: now
            },
      updatedAt: now
    };
  } else {
    const idx = sections.findIndex((s) => s.id === mutation.sectionId);
    if (idx < 0) throw new Error("该正文小节已删除或不存在。");
    if (sections.length <= 1) {
      throw new Error("正文至少需要保留一个小节。");
    }
    const [removed] = sections.splice(idx, 1);
    operations.push(
      { action: "delete", path: removed!.brief.path },
      { action: "delete", path: removed!.body.path },
      { action: "delete", path: removed!.state.path }
    );
  }

  const nextManifest = CurrentAcademicBookProjectManifestSchema.parse({
    ...manifest,
    revision: manifest.revision + 1,
    manuscript: {
      chapters,
      sections
    },
    updatedAt: now
  });
  operations.push({
    action: "write",
    path: MANIFEST_FILE,
    content: serializeManifest(nextManifest, driver.maxManifestBytes)
  });

  await commitProjectTransaction({
    projectRoot: projectDirectory,
    operations,
    maxFileBytes: Math.max(driver.maxMarkdownBytes, driver.maxManifestBytes)
  });
  await driver.bumpRegistry(registry, now);

  if (
    mutation.type === "create-section" &&
    createdSectionId &&
    input.versionOrigin
  ) {
    const created = nextManifest.manuscript.sections.find(
      (s) => s.id === createdSectionId
    );
    if (created) {
      for (const [doc, content] of [
        [created.brief, mutation.briefContent],
        [created.body, mutation.bodyContent],
        [created.state, mutation.stateContent]
      ] as const) {
        if (content) {
          await captureDocumentVersions(
            new DocumentVersionStore(
              projectDirectory,
              {
                workspace: "catalog",
                bookId: input.bookId,
                documentId: doc.id
              },
              driver.maxMarkdownBytes,
              driver.now
            ),
            "",
            content,
            input.versionOrigin
          );
        }
      }
    }
  }

  const book = await driver.readAcademicBook(projectDirectory, input.bookId);
  return MutateAcademicManuscriptResultSchema.parse({
    book,
    ...(createdChapterId ? { chapterId: createdChapterId } : {}),
    ...(createdSectionId ? { sectionId: createdSectionId } : {})
  });
}

export async function scrubAcademicBookLibraryBindings(params: {
  registry: FolderCatalogRegistry;
  removedMaterialIds: ReadonlySet<string>;
  removedSkillIds: ReadonlySet<string>;
  readBookManifest: (
    projectDirectory: string,
    bookId: string
  ) => Promise<{ bookType: string } & Record<string, unknown>>;
  maxManifestBytes: number;
  now: string;
}): Promise<void> {
  const {
    registry,
    removedMaterialIds,
    removedSkillIds,
    readBookManifest,
    maxManifestBytes,
    now
  } = params;
  if (removedMaterialIds.size === 0 && removedSkillIds.size === 0) return;

  for (const registration of registry.projects) {
    if (registration.domain !== "book") continue;
    try {
      const projectDirectory = await secureProjectRoot(
        registration.projectDirectory
      );
      const rawManifest = await readBookManifest(
        projectDirectory,
        registration.id
      );
      if (rawManifest.bookType !== "academic") continue;
      const manifest =
        CurrentAcademicBookProjectManifestSchema.parse(rawManifest);
      const nextMaterials = manifest.linkedMaterialIds.filter(
        (id) => !removedMaterialIds.has(id)
      );
      const nextSkills = manifest.linkedSkillIds.filter(
        (id) => !removedSkillIds.has(id)
      );
      if (
        nextMaterials.length === manifest.linkedMaterialIds.length &&
        nextSkills.length === manifest.linkedSkillIds.length
      ) {
        continue;
      }
      const nextManifest = CurrentAcademicBookProjectManifestSchema.parse({
        ...manifest,
        revision: manifest.revision + 1,
        linkedMaterialIds: nextMaterials,
        linkedSkillIds: nextSkills,
        updatedAt: now
      });
      await writeBoundedProjectJson(
        join(projectDirectory, MANIFEST_FILE),
        nextManifest,
        maxManifestBytes
      );
    } catch {
      // Unreachable or externally removed book folders must not abort library removal.
    }
  }
}
