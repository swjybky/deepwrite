import {
  LibraryManagementQueryInputSchema,
  LibraryManagementQueryResultSchema,
  LibraryAgentWorkspaceSnapshotSchema,
  createShortWorkspaceContentRevision,
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  LIBRARY_AGENT_MAX_ENTRIES,
  LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS,
  LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS,
  type LibraryManagementQueryInput,
  type LibraryManagementQueryResult,
  type LibraryManagementScope,
  type LibraryAgentDomain,
  type LibraryManagementCandidate
} from "@deepwrite/contracts";
import type { FolderCatalogStore } from "./folder-catalog-store";
import type { LongWorkspaceService } from "./long-workspace-service";

/** Core-owned, live association checks. No writing-stage read filters apply here. */
export class LibraryManagementService {
  constructor(
    private readonly catalog: Pick<
      FolderCatalogStore,
      "indexSnapshot" | "readDocument"
    >,
    private readonly long: Pick<LongWorkspaceService, "open">
  ) {}

  private async sources(scope: LibraryManagementScope) {
    const index = await this.catalog.indexSnapshot();
    const book =
      scope.bookType === "long"
        ? (await this.long.open({ bookId: scope.bookId })).summary
        : index.books.find(
            (item) =>
              item.id === scope.bookId && item.bookType === scope.bookType
          );
    if (!book || book.id !== scope.bookId)
      throw new Error("资料库管理所属作品不存在。");
    const ids = (bindings: object) =>
      new Set(Object.values(bindings).flat() as string[]);
    const materialIds = ids(book.linkedMaterialIdsByKind);
    const skillIds = ids(book.linkedSkillIdsByKind);
    return [
      ...index.materials
        .filter((item) => materialIds.has(item.id))
        .map((library) => ({
          library,
          domain: "material" as const,
          kind: library.materialKind,
          readOnly: false
        })),
      ...index.skills
        .filter((item) => skillIds.has(item.id))
        .map((library) => ({
          library,
          domain: "skill" as const,
          kind: library.skillKind,
          readOnly: library.isBuiltin
        }))
    ];
  }

  async assertWritable(
    scope: LibraryManagementScope,
    domain: LibraryAgentDomain,
    libraryId: string
  ): Promise<void> {
    const target = (await this.sources(scope)).find(
      (item) => item.domain === domain && item.library.id === libraryId
    );
    if (!target || target.readOnly)
      throw new Error("目标资料库已解绑、不存在或只读，不能继续写入。");
  }

  async query(
    raw: LibraryManagementQueryInput
  ): Promise<LibraryManagementQueryResult> {
    const input = LibraryManagementQueryInputSchema.parse(raw);
    const sources = (await this.sources(input.scope)).filter(
      (item) => !input.domain || input.domain === item.domain
    );
    const libraries: LibraryManagementCandidate[] = sources.map(
      ({ library, domain, readOnly }) => ({
        libraryId: library.id,
        title: library.title,
        domain,
        readOnly
      })
    );
    if (!input.libraryId) return { libraries };
    const source = sources.find((item) => item.library.id === input.libraryId);
    if (!source) throw new Error("目标资料库未绑定到当前作品或已不存在。");
    const { library, domain, kind, readOnly } = source;
    let remaining = LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS;
    const take = (content: string, limit: number) => {
      const text = content.slice(0, Math.min(remaining, limit));
      remaining -= text.length;
      return {
        content: text,
        ...(text.length < content.length
          ? { truncated: true, originalLength: content.length }
          : {})
      };
    };
    const overviewDocument = await this.catalog.readDocument({
      projectId: library.id,
      target: "overview"
    });
    const overview = take(
      overviewDocument.content,
      LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS
    );
    const documentId = (target: "entry" | "overview", entryId?: string) =>
      [
        "catalog",
        ...[
          `${domain}-${target}`,
          library.id,
          ...(entryId ? [entryId] : [])
        ].map(encodeURIComponent)
      ].join(":");
    const entries = [];
    for (const entry of library.entries.slice(0, LIBRARY_AGENT_MAX_ENTRIES)) {
      const document = await this.catalog.readDocument({
        projectId: library.id,
        target: "document",
        documentId: entry.id
      });
      entries.push({
        id: entry.id,
        documentId: documentId("entry", entry.id),
        title: entry.title,
        stageId: entry.stageId,
        ...take(document.content, LIBRARY_AGENT_ENTRY_MAX_CHARACTERS),
        revision: createShortWorkspaceContentRevision(document.content),
        readOnly
      });
    }
    // The live registry and revision can change while the snapshot is being read.
    const current = (await this.sources(input.scope)).find(
      (item) => item.domain === domain && item.library.id === library.id
    );
    if (
      !current ||
      current.library.projectRevision !== library.projectRevision ||
      current.readOnly !== readOnly
    )
      throw new Error("资料库绑定或版本已变化，请重新读取。");
    return LibraryManagementQueryResultSchema.parse({
      libraries,
      workspace: LibraryAgentWorkspaceSnapshotSchema.parse({
        domain,
        libraryId: library.id,
        title: library.title,
        libraryType:
          "materialType" in library ? library.materialType : library.skillType,
        kind,
        readOnly,
        projectRevision: library.projectRevision,
        overviewDocumentId: documentId("overview"),
        overview: overview.content,
        overviewRevision: createShortWorkspaceContentRevision(
          overviewDocument.content
        ),
        ...(overview.truncated
          ? {
              overviewTruncated: true,
              overviewOriginalLength: overview.originalLength
            }
          : {}),
        entries,
        omittedEntryCount: Math.max(0, library.entries.length - entries.length)
      })
    });
  }
}
