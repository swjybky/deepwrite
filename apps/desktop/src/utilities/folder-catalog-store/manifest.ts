import {
  BookSchema,
  CATALOG_DRAFT_DIRECTORY_ID,
  CatalogIndexBookSchema,
  type Book,
  type BookProjectDocumentManifest,
  type BookProjectDraftSectionManifest,
  type CatalogIndexSnapshot,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type SkillLibrary,
  type SkillLibraryGroup
} from "@deepwrite/contracts";
import { randomHex8 } from "@deepwrite/shared";
import { mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { projectTransactionFileIdentity } from "../project-transaction";
import { domainForKind, kindForDomain } from "./assertions";
import {
  migrateLegacyBookProject,
  migrateV2BookProject,
  migrateV3BookProject
} from "./migrations";
import {
  assertTextByteLength,
  atomicWriteJson,
  atomicWriteText,
  availableProjectDirectory,
  parseJson,
  portableContentPathKey,
  readProjectMarkdown,
  readRequiredUtf8File,
  removeEmptyOrPartialProject,
  secureDirectory,
  secureExistingProjectPath,
  secureProjectRoot,
  uniqueRelativeMarkdownPath,
  uniqueRelativeMarkdownPathWithSuffix
} from "./paths-io";
import {
  FolderCatalogProjectManifestSchema,
  FolderCurrentBookProjectManifestSchema,
  FolderMaterialGroupProjectManifestSchema,
  FolderMaterialProjectManifestSchema,
  FolderSkillGroupProjectManifestSchema,
  FolderSkillProjectManifestSchema,
  MANIFEST_FILE,
  type CatalogContentMetadata,
  type FolderBookProjectManifest,
  type FolderCatalogProjectDomain,
  type FolderCatalogProjectManifest,
  type FolderCatalogResource,
  type FolderCatalogStoreContext,
  type FolderCurrentBookProjectManifest,
  type OpenFolderCatalogProjectResult
} from "./types";
import { academicManifestContentItems } from "./academic-mutations";
import { initializeWritingContextFile } from "./writing-context";

export function manifestContentItems(
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

export function assertManifestUniqueness(
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

export async function assertManifestContentFilesUnique(
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

export function emptyContentMetadata(
  updatedAt: string
): CatalogContentMetadata {
  return {
    contentBytes: 0,
    contentStamp: `manifest-v1:0:${updatedAt}`
  };
}

export function manifestContentStamp(
  content: string,
  updatedAt: string
): string {
  return `manifest-v1:${Buffer.byteLength(content, "utf8")}:${updatedAt}`;
}

export function indexBookFromManifest(
  manifest: FolderBookProjectManifest,
  contentMetadataById: ReadonlyMap<string, CatalogContentMetadata>
): CatalogIndexSnapshot["books"][number] {
  if (manifest.bookType === "academic") {
    throw new Error(
      "Legacy split manifest helper does not index academic books."
    );
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
    throw new Error("Unexpected academic book");
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

export function indexResourceFromManifest(
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

export async function hydrateResource(
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
        throw new Error(
          "Legacy split manifest helper does not hydrate academic books."
        );
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

export async function readProjectMarkdownContents(
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

export function findDraftDocumentManifest(
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

export function findManifestDocument(
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
      return academicManifestContentItems(manifest).find(
        ({ id }) => id === documentId
      );
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

/**
 * Resolve and stat every Markdown file without opening it. The returned byte
 * counts power the metadata-only index and the inode identity check prevents
 * aliases from making two manifest entries point at the same file.
 */
export async function inspectProjectMarkdownMetadata(
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

export async function writeResourceContents(
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
      if (book.bookType === "academic") {
        throw new Error(
          "Legacy split manifest helper does not write academic books."
        );
      }
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

export async function writeNewResourceProject(
  store: FolderCatalogStoreContext,
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
    `.deepwrite-project-${process.pid}-${randomHex8()}.tmp`
  );
  await mkdir(stagingDirectory, { mode: 0o700 });
  let promoted = false;
  try {
    const manifest = await writeResourceContents(
      stagingDirectory,
      domain,
      resource,
      store.maxMarkdownBytes
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
      store.maxManifestBytes
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
export async function readManifestWithoutContent(
  store: FolderCatalogStoreContext,
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
    store.maxManifestBytes,
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
  if (expectedResourceId !== undefined && manifest.id !== expectedResourceId) {
    throw new Error("项目标识与注册信息不一致。");
  }
  return { projectDirectory, manifest };
}

export async function readManifest<
  Kind extends FolderCatalogProjectManifest["kind"]
>(
  store: FolderCatalogStoreContext,
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
    store.maxManifestBytes,
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
  if (expectedResourceId !== undefined && manifest.id !== expectedResourceId) {
    throw new Error("项目标识与注册信息不一致。");
  }
  if (manifest.kind === "deepwrite.book" && manifest.schemaVersion === 1) {
    manifest = await migrateLegacyBookProject(
      root,
      manifest,
      text,
      store.maxMarkdownBytes,
      store.maxManifestBytes
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
      store.maxManifestBytes
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
      store.maxManifestBytes
    );
    assertManifestUniqueness(manifest);
    await assertManifestContentFilesUnique(root, manifest);
  }
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

export async function readCurrentBookManifest(
  store: FolderCatalogStoreContext,
  projectDirectory: string,
  expectedResourceId?: string
): Promise<FolderCurrentBookProjectManifest> {
  const manifest = await readManifest(
    store,
    projectDirectory,
    "deepwrite.book",
    expectedResourceId
  );
  if (manifest.schemaVersion !== 4) {
    throw new Error("书籍项目未完成人物结构迁移。");
  }
  return manifest;
}

export async function readProject(
  store: FolderCatalogStoreContext,
  rawDirectory: string,
  expectedDomain?: FolderCatalogProjectDomain,
  expectedResourceId?: string
): Promise<OpenFolderCatalogProjectResult> {
  const projectDirectory = await secureProjectRoot(rawDirectory);
  const manifest = await readManifest(
    store,
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
  if (manifestBytes >= store.maxProjectContentBytes) {
    throw new Error(
      `项目 manifest 超过 ${store.maxProjectContentBytes} 字节项目预算。`
    );
  }
  const resource = await hydrateResource(
    projectDirectory,
    manifest,
    store.maxMarkdownBytes,
    store.maxProjectContentBytes - manifestBytes
  );
  return {
    domain,
    projectDirectory,
    revision: manifest.revision,
    resource
  };
}
