import {
  CommandEnvelopeSchema,
  createEnvelope,
  LibraryManagementQueryResultSchema,
  type LibraryAgentDomain,
  type LibraryManagementCandidate,
  type LibraryManagementQueryResult,
  type LibraryManagementRequest,
  type LibraryManagementOrganizeOperation
} from "@deepwrite/contracts";
import type { AgentRunInput } from "../runtime-types";
import type { LibraryManagementCommandExecutor } from "../library-management-runtime";

/** One entry as this run knows it: listed, read, or proposed. */
export interface ManagedEntry {
  entryId: string;
  documentId: string;
  title: string;
  stageId: string;
  contentBytes: number;
  /** Full text once read; after a proposal, the proposed text. */
  content?: string;
  revision?: string;
  truncated?: boolean;
  /** Present for an entry this run proposed to create. */
  creationId?: string;
}

export interface ManagedLibrary {
  candidate: LibraryManagementCandidate;
  projectRevision?: number;
  overviewDocumentId: string;
  entries: ManagedEntry[];
  overview?: { content: string; revision: string; truncated: boolean };
}

/** Per-run view of the work's bound libraries, filled lazily from Core. */
export class LibraryManagementSession {
  readonly candidates: LibraryManagementCandidate[];
  private readonly libraries = new Map<string, ManagedLibrary>();
  /** Entries the agent has seen, with the text revision it saw (search hits: unknown). */
  private readonly accessed = new Map<string, string | undefined>();
  private sequence = 0;

  constructor(private readonly input: AgentRunInput) {
    const context = input.libraryManagement;
    const domains = new Set(context?.managers.map((item) => item.domain));
    this.candidates = (context?.libraries ?? []).filter((library) =>
      domains.has(library.domain)
    );
  }

  /**
   * After a review the saved text is the authority again. Reads with a known
   * revision survive; a later write checks them against the saved text.
   */
  reset(): void {
    this.libraries.clear();
    for (const [key, revision] of this.accessed)
      if (revision === undefined) this.accessed.delete(key);
    this.sequence++;
  }

  get writeApprovalMode() {
    return this.input.writeApprovalMode ?? "request-approval";
  }

  candidate(
    libraryId: string,
    domain?: LibraryAgentDomain
  ): LibraryManagementCandidate {
    const candidate = this.candidates.find(
      (item) => item.libraryId === libraryId
    );
    if (!candidate)
      throw new Error("目标库未绑定到当前作品，或不在已开启的管理领域内。");
    if (domain && candidate.domain !== domain)
      throw new Error("目标库与指定的 domain 不一致。");
    return candidate;
  }

  markRead(libraryId: string, entryId: string, revision?: string): void {
    const key = `${libraryId}\u0000${entryId}`;
    if (revision !== undefined || !this.accessed.has(key))
      this.accessed.set(key, revision);
  }

  wasRead(libraryId: string, entryId: string): boolean {
    return this.accessed.has(`${libraryId}\u0000${entryId}`);
  }

  /** False when the saved text differs from what the agent last saw. */
  readIsCurrent(
    libraryId: string,
    entryId: string,
    revision?: string
  ): boolean {
    const seen = this.accessed.get(`${libraryId}\u0000${entryId}`);
    return seen === undefined || seen === revision;
  }

  async query(
    domain: LibraryAgentDomain,
    libraryId: string | undefined,
    request: LibraryManagementRequest,
    signal?: AbortSignal
  ): Promise<LibraryManagementQueryResult> {
    signal?.throwIfAborted();
    const context = this.input.libraryManagement;
    const executor = this.input.libraryManagementCommandExecutor;
    if (!context || !executor) throw new Error("资料库管理通道不可用。");
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "catalog.queryLibraryManagement",
        {
          scope: context.scope,
          domain,
          ...(libraryId ? { libraryId } : {}),
          request
        },
        {
          id: `library-management:${this.input.runId}:${++this.sequence}`,
          context: {
            sessionId: this.input.sessionId,
            runId: this.input.runId,
            resourceId: context.scope.bookId
          }
        }
      )
    ) as Parameters<LibraryManagementCommandExecutor>[0];
    const result = await executor(command, signal);
    signal?.throwIfAborted();
    if (result.status !== "accepted") throw new Error(result.error.message);
    return LibraryManagementQueryResultSchema.parse(result.payload);
  }

  async library(
    libraryId: string,
    signal?: AbortSignal,
    domain?: LibraryAgentDomain
  ): Promise<ManagedLibrary> {
    const candidate = this.candidate(libraryId, domain);
    const cached = this.libraries.get(libraryId);
    if (cached) return cached;
    const { directory } = await this.query(
      candidate.domain,
      libraryId,
      { kind: "directory" },
      signal
    );
    if (!directory || directory.libraryId !== libraryId)
      throw new Error("资料库目录读取结果与请求不符。");
    const library: ManagedLibrary = {
      candidate: {
        ...candidate,
        readOnly: candidate.readOnly || directory.readOnly
      },
      ...(directory.projectRevision === undefined
        ? {}
        : { projectRevision: directory.projectRevision }),
      overviewDocumentId: directory.overviewDocumentId,
      entries: directory.entries.map((entry) => ({ ...entry }))
    };
    let offset = directory.nextOffset;
    while (offset !== undefined) {
      const page = (
        await this.query(
          candidate.domain,
          libraryId,
          { kind: "directory", offset },
          signal
        )
      ).directory;
      if (
        !page ||
        page.libraryId !== libraryId ||
        page.projectRevision !== library.projectRevision ||
        (page.nextOffset !== undefined && page.nextOffset <= offset)
      )
        throw new Error("资料库目录已变化，请重新读取。");
      library.entries.push(...page.entries);
      offset = page.nextOffset;
    }
    this.libraries.set(libraryId, library);
    return library;
  }

  /** Fills full text for entries (and the overview) not read in this run yet. */
  async load(
    library: ManagedLibrary,
    entryIds: readonly string[],
    overview: boolean,
    signal?: AbortSignal
  ): Promise<void> {
    const missing = entryIds.filter((id) => {
      const entry = library.entries.find((item) => item.entryId === id);
      return entry && !entry.creationId && entry.content === undefined;
    });
    const needOverview = overview && !library.overview;
    const batches: string[][] = [];
    for (let index = 0; index < missing.length; index += 10)
      batches.push(missing.slice(index, index + 10));
    if (needOverview && !batches.length) batches.push([]);
    for (const [index, batch] of batches.entries()) {
      const { documents } = await this.query(
        library.candidate.domain,
        library.candidate.libraryId,
        {
          kind: "read",
          entryIds: batch,
          ...(needOverview && index === 0 ? { overview: true } : {})
        },
        signal
      );
      if (
        !documents ||
        batch.some(
          (id) =>
            !documents.some(
              (doc) => doc.target === "entry" && doc.entryId === id
            )
        ) ||
        (needOverview &&
          index === 0 &&
          !documents.some((doc) => doc.target === "overview"))
      )
        throw new Error("资料库正文读取不完整，请重新读取。");
      for (const document of documents) {
        if (document.target === "overview") {
          library.overview = {
            content: document.content,
            revision: document.revision,
            truncated: document.truncated === true
          };
          continue;
        }
        const entry = library.entries.find(
          (item) => item.entryId === document.entryId
        );
        if (!entry) continue;
        Object.assign(entry, {
          title: document.title,
          content: document.content,
          revision: document.revision,
          truncated: document.truncated === true
        });
      }
    }
  }

  /** Each batch has a distinct review identity; a later batch may follow settlement. */
  structureRequest(
    domain: LibraryAgentDomain,
    operations: LibraryManagementOrganizeOperation[]
  ) {
    if (operations.length > 32)
      throw new Error("本轮整理超过 32 项，请先审阅已有提案，再分批继续。");
    return {
      requestId: `library-structure:${this.input.runId}:${domain}:${++this.sequence}`,
      operations
    };
  }
}
