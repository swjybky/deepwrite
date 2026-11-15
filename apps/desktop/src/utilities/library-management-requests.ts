import {
  createShortWorkspaceContentRevision,
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  LIBRARY_MANAGEMENT_DIRECTORY_MAX_ENTRIES,
  type CatalogIndexSnapshot,
  type LibraryAgentDomain,
  type LibraryManagementDocument,
  type LibraryManagementQueryResult,
  type LibraryManagementRequest,
  type LibraryManagementSearchResult,
  type LibraryStructureOperation,
  type LibraryManagementScope
} from "@deepwrite/contracts";
import type { FolderCatalogStore } from "./folder-catalog-store";

type IndexLibrary =
  | CatalogIndexSnapshot["materials"][number]
  | CatalogIndexSnapshot["skills"][number];

/** A library bound to the work, as the management service resolves it. */
export interface LibraryManagementSource {
  library: IndexLibrary;
  domain: LibraryAgentDomain;
  readOnly: boolean;
}

/** Preview and save use the same work bindings and write permissions. */
export function assertManagementStructureTargets(
  domain: LibraryAgentDomain,
  sources: readonly LibraryManagementSource[],
  operations: readonly LibraryStructureOperation[]
): void {
  const bound = (id: string, write: boolean) => {
    const source = sources.find(
      (item) => item.domain === domain && item.library.id === id
    );
    if (!source) throw new Error("目标资料库未绑定到当前作品或已不存在。");
    if (write && source.readOnly) throw new Error("只读资料库不能写入。");
  };
  for (const operation of operations) {
    switch (operation.action) {
      case "copy-entries":
      case "move-entries":
        bound(operation.libraryId, operation.action === "move-entries");
        if (operation.target.kind !== "library")
          throw new Error("只能整理到当前作品绑定的库。");
        bound(operation.target.libraryId, true);
        break;
      case "archive-entries":
      case "restore-entries":
        bound(operation.libraryId, true);
        break;
      default:
        throw new Error("创作空间只能整理当前作品绑定库的条目。");
    }
  }
}

type Catalog = Pick<
  FolderCatalogStore,
  "readDocument" | "previewLibraryStructure"
>;

/** Stable ids the window uses to find a library document for review. */
export function libraryAgentDocumentId(
  domain: LibraryAgentDomain,
  target: "entry" | "overview",
  libraryId: string,
  entryId?: string
): string {
  return [
    "catalog",
    ...[`${domain}-${target}`, libraryId, ...(entryId ? [entryId] : [])].map(
      encodeURIComponent
    )
  ].join(":");
}

function cut(content: string) {
  const text = content.slice(0, LIBRARY_AGENT_ENTRY_MAX_CHARACTERS);
  return {
    content: text,
    revision: createShortWorkspaceContentRevision(content),
    ...(text.length < content.length
      ? { truncated: true, originalLength: content.length }
      : {})
  };
}

function lineColumn(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

async function readEntry(catalog: Catalog, libraryId: string, entryId: string) {
  return (
    await catalog.readDocument({
      projectId: libraryId,
      target: "document",
      documentId: entryId
    })
  ).content;
}

async function search(
  catalog: Catalog,
  sources: readonly LibraryManagementSource[],
  request: Extract<LibraryManagementRequest, { kind: "search" }>
): Promise<LibraryManagementSearchResult> {
  const query = request.query.toLocaleLowerCase();
  const entries: LibraryManagementSearchResult["entries"] = [];
  const offset = request.offset ?? 0;
  let seen = 0;
  let total = 0;
  for (const { library } of sources) {
    for (const entry of library.entries) {
      if (request.stageId && entry.stageId !== request.stageId) continue;
      const content = await readEntry(catalog, library.id, entry.id);
      const lower = content.toLocaleLowerCase();
      const titleHit = entry.title.toLocaleLowerCase().includes(query);
      const hits = [];
      let includedTitle = false;
      if (titleHit) {
        if (seen++ >= offset) {
          if (total >= request.maxMatches)
            return { entries, limited: true, nextOffset: offset + total };
          total++;
          includedTitle = true;
        }
      }
      for (
        let index = lower.indexOf(query);
        index >= 0;
        index = lower.indexOf(query, index + query.length)
      ) {
        if (seen++ < offset) continue;
        if (total >= request.maxMatches) {
          if (includedTitle || hits.length)
            entries.push({
              libraryId: library.id,
              entryId: entry.id,
              title: entry.title,
              stageId: entry.stageId,
              titleHit: includedTitle,
              hits
            });
          return { entries, limited: true, nextOffset: offset + total };
        }
        total++;
        const start = Math.max(0, index - request.contextChars);
        const end = Math.min(
          content.length,
          index + query.length + request.contextChars
        );
        hits.push({
          ...lineColumn(content, index),
          excerpt: content.slice(start, end)
        });
      }
      if (includedTitle || hits.length)
        entries.push({
          libraryId: library.id,
          entryId: entry.id,
          title: entry.title,
          stageId: entry.stageId,
          titleHit: includedTitle,
          hits
        });
    }
  }
  return { entries, limited: false };
}

/** Answers one work-scoped request against libraries Core just resolved as bound. */
export async function runLibraryManagementRequest(
  catalog: Catalog,
  domain: LibraryAgentDomain,
  sources: readonly LibraryManagementSource[],
  libraryId: string | undefined,
  request: LibraryManagementRequest,
  managementScope: LibraryManagementScope
): Promise<Omit<LibraryManagementQueryResult, "libraries">> {
  const bound = (id: string) => {
    const source = sources.find((item) => item.library.id === id);
    if (!source) throw new Error("目标资料库未绑定到当前作品或已不存在。");
    return source;
  };
  if (request.kind === "search") {
    return {
      search: await search(
        catalog,
        libraryId ? [bound(libraryId)] : sources,
        request
      )
    };
  }
  if (request.kind === "preview-structure") {
    assertManagementStructureTargets(domain, sources, request.operations);
    return {
      plan: await catalog.previewLibraryStructure({
        domain,
        requestId: request.requestId,
        managementScope,
        operations: request.operations
      })
    };
  }
  const source = bound(libraryId!);
  const { library } = source;
  if (request.kind === "directory") {
    const offset = request.offset ?? 0;
    const end = offset + LIBRARY_MANAGEMENT_DIRECTORY_MAX_ENTRIES;
    return {
      directory: {
        libraryId: library.id,
        title: library.title,
        readOnly: source.readOnly,
        projectRevision: library.projectRevision,
        overviewDocumentId: libraryAgentDocumentId(
          domain,
          "overview",
          library.id
        ),
        entries: library.entries.slice(offset, end).map((entry) => ({
          entryId: entry.id,
          documentId: libraryAgentDocumentId(
            domain,
            "entry",
            library.id,
            entry.id
          ),
          title: entry.title,
          stageId: entry.stageId,
          contentBytes: entry.contentBytes
        })),
        ...(library.entries.length > end ? { nextOffset: end } : {})
      }
    };
  }
  const documents: LibraryManagementDocument[] = [];
  for (const entryId of request.entryIds) {
    const entry = library.entries.find((item) => item.id === entryId);
    if (!entry)
      throw new Error(`条目 ${entryId} 不在目标库中，请重新列出目录。`);
    documents.push({
      target: "entry",
      entryId,
      documentId: libraryAgentDocumentId(domain, "entry", library.id, entryId),
      title: entry.title,
      stageId: entry.stageId,
      ...cut(await readEntry(catalog, library.id, entryId))
    });
  }
  if (request.overview) {
    const overview = await catalog.readDocument({
      projectId: library.id,
      target: "overview"
    });
    documents.push({
      target: "overview",
      documentId: libraryAgentDocumentId(domain, "overview", library.id),
      title: library.title,
      ...cut(overview.content)
    });
  }
  return { documents };
}
