import {
  CatalogReadDocumentResultSchema,
  LongSearchResultSchema
} from "@deepwrite/contracts";
import {
  EXTERNAL_DEFAULT_SEARCH_LIMIT,
  ExternalSearchResultSchema,
  type ExternalSearchTextInput
} from "@deepwrite/contracts/external-control";
import { readCore, type CoreRequest } from "./core-client";
import { ExternalControlError } from "./errors";
import { findLibrary } from "./library-read-tools";
import {
  catalogWorkDocuments,
  isLongWorkId,
  readCatalogIndex
} from "./work-read-tools";

const SNIPPET_RADIUS = 80;
/** Returns what it has and a cursor before the bridge's call timeout. */
const SCAN_BUDGET_MS = 25_000;

interface SearchableDocument {
  id: string;
  title: string;
  bytes: number;
}

interface SearchHit {
  documentId: string;
  title: string;
  offset: number;
  snippet: string;
}

interface ScanPosition {
  documentIndex: number;
  textIndex: number;
}

function parseCursor(cursor: string | undefined): ScanPosition {
  if (cursor === undefined) return { documentIndex: 0, textIndex: 0 };
  const match = /^(\d+):(\d+)$/u.exec(cursor);
  if (!match) {
    throw new ExternalControlError(
      "external.invalid_input",
      "cursor 无效。请使用上一页返回的 nextCursor。"
    );
  }
  return { documentIndex: Number(match[1]), textIndex: Number(match[2]) };
}

function queryPattern(query: string): RegExp {
  const escaped = query
    .normalize("NFC")
    .replace(/[.*+?^${}()|[\]\\/-]/gu, "\\$&");
  return new RegExp(escaped, "giu");
}

function snippetAround(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start - SNIPPET_RADIUS), end + SNIPPET_RADIUS);
}

/** Reads one document at a time and stops at the limit, so a large library
 * never has to be held in memory to answer one search. */
async function scanDocuments(
  documents: readonly SearchableDocument[],
  read: (id: string) => Promise<string>,
  input: ExternalSearchTextInput,
  now: () => number
) {
  const limit = input.limit ?? EXTERNAL_DEFAULT_SEARCH_LIMIT;
  const pattern = queryPattern(input.query);
  const deadline = now() + SCAN_BUDGET_MS;
  const start = parseCursor(input.cursor);
  const hits: SearchHit[] = [];

  for (let index = start.documentIndex; index < documents.length; index += 1) {
    if (now() > deadline) return { hits, nextCursor: `${index}:0` };
    const document = documents[index];
    if (!document || document.bytes === 0) continue;
    const text = await read(document.id);
    pattern.lastIndex = index === start.documentIndex ? start.textIndex : 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const end = match.index + match[0].length;
      hits.push({
        documentId: document.id,
        title: document.title,
        offset: Array.from(text.slice(0, match.index)).length,
        snippet: snippetAround(text, match.index, end)
      });
      if (hits.length === limit) {
        return { hits, nextCursor: `${index}:${end}` };
      }
    }
  }
  return { hits, nextCursor: null };
}

async function searchLong(
  core: CoreRequest,
  input: ExternalSearchTextInput,
  bookId: string
) {
  const result = await readCore(
    core,
    "long.search",
    {
      bookId,
      query: input.query,
      limit: input.limit ?? EXTERNAL_DEFAULT_SEARCH_LIMIT,
      ...(input.cursor ? { cursor: input.cursor } : {})
    },
    LongSearchResultSchema,
    "找不到这部作品，或 cursor 已失效。请用 list_works 重新确认后重新搜索。"
  );
  return ExternalSearchResultSchema.parse({
    query: input.query,
    hits: result.hits.map((hit) => ({
      documentId: hit.fileId,
      title: hit.title,
      offset: hit.start,
      snippet: hit.snippet
    })),
    nextCursor: result.nextCursor
  });
}

export async function searchText(
  core: CoreRequest,
  input: ExternalSearchTextInput,
  now: () => number = Date.now
) {
  const { workId, libraryId } = input;
  if ((workId === undefined) === (libraryId === undefined)) {
    throw new ExternalControlError(
      "external.invalid_input",
      "search_text 需要且只能传 workId 或 libraryId 其中一个。"
    );
  }
  if (workId && isLongWorkId(workId)) return searchLong(core, input, workId);

  const index = await readCatalogIndex(core);
  let projectId: string;
  let documents: SearchableDocument[];
  if (workId) {
    const book = index.books.find(({ id }) => id === workId);
    if (!book) {
      throw new ExternalControlError(
        "external.not_found",
        "找不到这部作品。请用 list_works 重新确认作品 ID。"
      );
    }
    projectId = workId;
    documents = catalogWorkDocuments(book);
  } else {
    const library = findLibrary(index, libraryId as string);
    projectId = library.value.id;
    documents = library.value.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      bytes: entry.contentBytes
    }));
  }
  const scanned = await scanDocuments(
    documents,
    async (documentId) =>
      (
        await readCore(
          core,
          "catalog.readDocument",
          { projectId, target: "document", documentId },
          CatalogReadDocumentResultSchema
        )
      ).content,
    input,
    now
  );
  return ExternalSearchResultSchema.parse({ query: input.query, ...scanned });
}
