import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID,
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  createDefaultBookCharacterStructure,
  MutateCharacterStructureInputSchema,
  type Book,
  type MutateCharacterStructureInput
} from "@deepwrite/contracts";
import { createCatalogId } from "@deepwrite/shared";
import { assertBaseRevision } from "./assertions";
import {
  bumpRegistry,
  ensureRegistry,
  findRegistration,
  mutate
} from "./registry";
import {
  manifestContentItems,
  readCurrentBookManifest,
  readProject
} from "./manifest";
import {
  atomicWriteJson,
  atomicWriteText,
  commitProjectMarkdownUpdate,
  portableContentPathKey,
  readProjectMarkdown,
  readRequiredUtf8File,
  secureExistingProjectPath,
  secureProjectRoot,
  secureWritableProjectPath,
  uniqueRelativeMarkdownPath
} from "./paths-io";
import {
  FolderCurrentBookProjectManifestSchema,
  MANIFEST_FILE,
  type FolderCatalogStoreContext
} from "./types";

export async function mutateCharacterStructure(
  store: FolderCatalogStoreContext,
  rawInput: MutateCharacterStructureInput
): Promise<Book> {
  const input = MutateCharacterStructureInputSchema.parse(rawInput);
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
          await readProject(store, projectDirectory, "book", input.bookId)
        ).resource as Book;
      }
      if (mutation.format === "list") {
        const original = await readRequiredUtf8File(
          overviewPath,
          store.maxMarkdownBytes,
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
            store.maxMarkdownBytes,
            store.maxManifestBytes
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
          store.maxMarkdownBytes,
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
          const document = manifest.documents.find(({ id }) => id === item.id);
          if (!document) throw new Error(`人物条目 ${item.id} 缺少文件。`);
          return { item, document };
        });
        for (const { item, document } of itemDocuments) {
          const content = await readProjectMarkdown(
            projectDirectory,
            document.path,
            store.maxMarkdownBytes
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
          store.maxMarkdownBytes,
          store.maxManifestBytes
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
      const documents = manifest.documents.map((document) => ({ ...document }));
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
              await readProject(store, projectDirectory, "book", input.bookId)
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
          store.maxMarkdownBytes,
          store.maxManifestBytes
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
          store.maxManifestBytes
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
    await bumpRegistry(store, registry, now);
    return (await readProject(store, projectDirectory, "book", input.bookId))
      .resource as Book;
  });
}
