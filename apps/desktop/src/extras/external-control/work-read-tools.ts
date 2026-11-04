import {
  CatalogIndexSnapshotSchema,
  CatalogReadDocumentResultSchema,
  LongBookIdSchema,
  LongListBooksResultSchema,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  listLongWorkspaceFiles,
  type CatalogIndexBook,
  type CatalogIndexSnapshot,
  type LongBookMetadata
} from "@deepwrite/contracts";
import {
  EXTERNAL_DEFAULT_PAGE_CHARACTERS,
  ExternalDocumentPageSchema,
  ExternalListWorksResultSchema,
  ExternalWorkDetailSchema,
  type ExternalGetWorkInput,
  type ExternalListWorksInput,
  type ExternalReadDocumentInput
} from "@deepwrite/contracts/external-control";
import { readCore, type CoreRequest } from "./core-client";
import { pageText } from "./document-page";
import { ExternalControlError } from "./errors";

const DOCUMENT_NOT_FOUND = "找不到这个文档。请用 get_work 重新确认文档 ID。";

export function isLongWorkId(id: string): boolean {
  return LongBookIdSchema.safeParse(id).success;
}

export function readCatalogIndex(
  core: CoreRequest
): Promise<CatalogIndexSnapshot> {
  return readCore(core, "catalog.index", {}, CatalogIndexSnapshotSchema);
}

function workNotFound(): ExternalControlError {
  return new ExternalControlError(
    "external.not_found",
    "找不到这部作品。请用 list_works 重新确认作品 ID。"
  );
}

function summary(work: CatalogIndexBook | LongBookMetadata) {
  return {
    id: work.id,
    type: work.bookType,
    title: work.title,
    genre: work.genre,
    status: work.status,
    updatedAt: work.updatedAt
  };
}

function linkedIds(idsByKind: Record<string, readonly string[] | undefined>) {
  return [...new Set(Object.values(idsByKind).flatMap((ids) => ids ?? []))];
}

function linkedLibraries(work: CatalogIndexBook | LongBookMetadata) {
  return {
    linkedMaterialLibraryIds: linkedIds(work.linkedMaterialIdsByKind),
    linkedSkillLibraryIds: linkedIds(work.linkedSkillIdsByKind)
  };
}

export async function listWorks(
  core: CoreRequest,
  input: ExternalListWorksInput
) {
  const [index, long] = await Promise.all([
    readCatalogIndex(core),
    readCore(core, "long.list", {}, LongListBooksResultSchema)
  ]);
  const works = [...index.books, ...long.books]
    .filter((work) => !input.type || work.bookType === input.type)
    .map(summary);
  return ExternalListWorksResultSchema.parse({
    works,
    unavailableWorkIds: [
      ...(index.projectDiagnostics ?? [])
        .filter(({ kind }) => kind === "deepwrite.book")
        .map(({ projectId }) => projectId),
      ...(long.diagnostics ?? []).map(({ bookId }) => bookId)
    ]
  });
}

/** Every readable text of a short or script work, in reading order. */
export function catalogWorkDocuments(book: CatalogIndexBook) {
  const stageIds = new Set(book.plotStages.map(({ id }) => id));
  return [
    ...book.documents.map((document) => ({
      id: document.id,
      title: document.title,
      group: stageIds.has(document.id) ? "stage" : "document",
      bytes: document.contentBytes,
      updatedAt: document.updatedAt
    })),
    ...book.draft.sections.flatMap((section) => [
      {
        id: section.body.id,
        title: `${section.title} · 正文`,
        group: "draft",
        bytes: section.body.contentBytes,
        updatedAt: section.body.updatedAt
      },
      {
        id: section.characterState.id,
        title: `${section.title} · 人物状态`,
        group: "draft",
        bytes: section.characterState.contentBytes,
        updatedAt: section.characterState.updatedAt
      }
    ])
  ];
}

async function longMetadata(
  core: CoreRequest,
  bookId: string,
  metadata: LongBookMetadata | undefined
): Promise<LongBookMetadata> {
  if (metadata) return metadata;
  const { books } = await readCore(
    core,
    "long.list",
    {},
    LongListBooksResultSchema
  );
  const found = books.find(({ id }) => id === bookId);
  if (!found) throw workNotFound();
  return found;
}

async function getLongWork(core: CoreRequest, bookId: string) {
  const { workspaceIndex, metadata } = await readCore(
    core,
    "long.getWorkspaceIndex",
    { bookId },
    LongWorkspaceIndexResultSchema,
    "找不到这部作品。请用 list_works 重新确认作品 ID。"
  );
  const book = await longMetadata(core, bookId, metadata);
  return ExternalWorkDetailSchema.parse({
    ...summary(book),
    documents: listLongWorkspaceFiles(workspaceIndex).map(
      ({ file, root, title }) => ({
        id: file.id,
        title,
        group: root,
        updatedAt: file.updatedAt
      })
    ),
    ...linkedLibraries(book)
  });
}

export async function getWork(core: CoreRequest, input: ExternalGetWorkInput) {
  if (isLongWorkId(input.workId)) return getLongWork(core, input.workId);
  const index = await readCatalogIndex(core);
  const book = index.books.find(({ id }) => id === input.workId);
  if (!book) throw workNotFound();
  return ExternalWorkDetailSchema.parse({
    ...summary(book),
    stages: book.plotStages.map(({ id, title, enabled }) => ({
      id,
      title,
      enabled
    })),
    documents: catalogWorkDocuments(book),
    ...linkedLibraries(book)
  });
}

export async function readDocument(
  core: CoreRequest,
  input: ExternalReadDocumentInput
) {
  const { workId, documentId } = input;
  if (isLongWorkId(workId)) {
    const page = await readCore(
      core,
      "long.readDocument",
      {
        bookId: workId,
        fileId: documentId,
        offset: input.offset ?? 0,
        maxCharacters: input.maxCharacters ?? EXTERNAL_DEFAULT_PAGE_CHARACTERS
      },
      LongReadDocumentResultSchema,
      DOCUMENT_NOT_FOUND
    );
    return ExternalDocumentPageSchema.parse({
      workId,
      documentId,
      title: page.file.path,
      content: page.content,
      offset: page.offset,
      totalCharacters: page.totalCharacters,
      nextOffset: page.nextOffset,
      revision: page.file.updatedAt
    });
  }
  const document = await readCore(
    core,
    "catalog.readDocument",
    { projectId: workId, target: "document", documentId },
    CatalogReadDocumentResultSchema,
    DOCUMENT_NOT_FOUND
  );
  return ExternalDocumentPageSchema.parse({
    workId,
    documentId,
    title: document.title,
    revision: document.revision,
    ...pageText(document.content, input.offset, input.maxCharacters)
  });
}
