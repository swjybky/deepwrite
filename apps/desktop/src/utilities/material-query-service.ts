import {
  MaterialQueryInputSchema,
  materialPreview,
  MaterialQueryResultSchema,
  parseMaterialMarkdown,
  resolveMaterialMetadata,
  type MaterialCatalogEntry,
  type MaterialQueryInput,
  type MaterialQueryResult,
  type MaterialReadScope
} from "@deepwrite/contracts";
import type { FolderCatalogStore } from "./folder-catalog-store";
import type { LongWorkspaceService } from "./long-workspace-service";
import {
  scopedMaterialCandidates,
  type MaterialCandidate
} from "./material-query-scope";

interface CachedMetadata {
  stamp: string;
  entryTitle: string;
  entry: MaterialCatalogEntry;
  configuredName?: string;
  hasBody: boolean;
}

/** Rebuildable metadata only: manuscript bodies are never retained in this cache. */
export class MaterialQueryService {
  private readonly metadata = new Map<string, CachedMetadata>();

  constructor(
    private readonly catalog: Pick<
      FolderCatalogStore,
      "indexSnapshot" | "readDocument"
    >,
    private readonly long: Pick<LongWorkspaceService, "open">
  ) {}

  private async candidates(
    scope: MaterialReadScope,
    notices: string[] = []
  ): Promise<MaterialCandidate[]> {
    const index = await this.catalog.indexSnapshot();
    const longBook =
      scope.bookType === "long"
        ? (await this.long.open({ bookId: scope.bookId })).summary
        : undefined;
    return scopedMaterialCandidates(index, scope, longBook, notices);
  }

  private cache(
    candidate: MaterialCandidate,
    content: string,
    revision: string
  ): CachedMetadata {
    const configuredName = parseMaterialMarkdown(content).name;
    const value: CachedMetadata = {
      stamp: candidate.stamp,
      entryTitle: candidate.entryTitle,
      entry: {
        id: candidate.id,
        title: candidate.title,
        libraryId: candidate.libraryId,
        entryId: candidate.entryId,
        kind: candidate.kind,
        revision,
        metadata: resolveMaterialMetadata({
          id: candidate.entryId,
          title: candidate.entryTitle,
          content
        })
      },
      ...(configuredName && configuredName.length <= 512
        ? { configuredName }
        : {}),
      hasBody: Boolean(content.trim())
    };
    const key = `${candidate.libraryId}\0${candidate.entryId}`;
    this.metadata.delete(key);
    this.metadata.set(key, value);
    if (this.metadata.size > 16_384)
      this.metadata.delete(this.metadata.keys().next().value!);
    return value;
  }

  private async read(candidate: MaterialCandidate) {
    const document = await this.catalog.readDocument({
      projectId: candidate.libraryId,
      target: "document",
      documentId: candidate.entryId
    });
    return {
      content: document.content,
      cached: this.cache(candidate, document.content, document.revision)
    };
  }

  private async indexed(candidate: MaterialCandidate): Promise<CachedMetadata> {
    const cached = this.metadata.get(
      `${candidate.libraryId}\0${candidate.entryId}`
    );
    if (
      cached?.stamp === candidate.stamp &&
      cached.entryTitle === candidate.entryTitle
    ) {
      return {
        ...cached,
        entry: {
          ...cached.entry,
          id: candidate.id,
          title: candidate.title,
          kind: candidate.kind
        }
      };
    }
    return (await this.read(candidate)).cached;
  }

  async query(rawInput: MaterialQueryInput): Promise<MaterialQueryResult> {
    const input = MaterialQueryInputSchema.parse(rawInput);
    const notices: string[] = [];
    const candidates = (await this.candidates(input.scope, notices)).filter(
      (item) => !input.material_kind || item.kind === input.material_kind
    );
    if (input.mode === "read")
      return this.readQuery(input, candidates, notices);
    const matches: MaterialCatalogEntry[] = [];
    for (const candidate of candidates) {
      try {
        if (input.mode === "search" && input.query?.trim()) {
          const { content, cached } = await this.read(candidate);
          if (
            cached.hasBody &&
            [
              content,
              candidate.title,
              cached.configuredName ?? "",
              cached.entry.metadata.description
            ].some((text) => text.includes(input.query!.trim()))
          ) {
            const start = Math.max(
              0,
              content.indexOf(input.query!.trim()) - 40
            );
            matches.push({
              ...cached.entry,
              matchSnippet: materialPreview(
                content.slice(start, start + 220),
                220
              )
            });
          }
        } else {
          const cached = await this.indexed(candidate);
          if (cached.hasBody) matches.push(cached.entry);
        }
      } catch {
        if (notices.length < 20)
          notices.push(
            `素材「${candidate.title}」暂时无法读取，请刷新后重试。`
          );
      }
    }
    const start = input.cursor ?? 0;
    const end = start + input.limit;
    return MaterialQueryResultSchema.parse({
      status: "ok",
      entries: matches.slice(start, end),
      total: matches.length,
      ...(end < matches.length ? { nextCursor: end } : {}),
      notices
    });
  }

  private async readQuery(
    input: MaterialQueryInput,
    candidates: MaterialCandidate[],
    notices: string[]
  ): Promise<MaterialQueryResult> {
    let found: MaterialCandidate[] = [];
    if (input.entry_id)
      found = candidates.filter((item) => item.id === input.entry_id);
    else {
      const name = (input.entry_name ?? input.query ?? "").trim();
      if (name) {
        const tiers = [
          candidates.filter((item) => item.title === name),
          candidates.filter((item) => item.id === name),
          candidates.filter((item) => {
            const separator = item.title.lastIndexOf(" · ");
            return (
              (separator < 0
                ? item.title
                : item.title.slice(separator + 3).trim() || item.title) === name
            );
          }),
          candidates.filter((item) => item.entryTitle === name)
        ];
        found = tiers.find((tier) => tier.length) ?? [];
        if (!found.length) {
          for (const item of candidates) {
            try {
              const cached = await this.indexed(item);
              if (
                cached.configuredName === name ||
                cached.entry.metadata.name === name
              )
                found.push(item);
            } catch {
              if (notices.length < 20)
                notices.push(
                  `素材「${item.title}」暂时无法读取，请刷新后重试。`
                );
            }
          }
        }
      }
    }
    if (!found.length)
      return { status: "not_found", entries: [], total: 0, notices };
    if (found.length > 1) {
      const start = input.cursor ?? 0;
      const end = start + input.limit;
      const entries = await Promise.all(
        found
          .slice(start, end)
          .map(async (item) => (await this.indexed(item)).entry)
      );
      return {
        status: "ambiguous",
        entries,
        total: found.length,
        ...(end < found.length ? { nextCursor: end } : {}),
        notices
      };
    }
    const candidate = found[0]!;
    const { content, cached } = await this.read(candidate);
    // Check the live association again after IO, including a concurrent unbind.
    const stillReadable = (await this.candidates(input.scope)).some(
      (item) =>
        item.id === candidate.id &&
        item.libraryId === candidate.libraryId &&
        item.entryId === candidate.entryId
    );
    if (!stillReadable)
      return { status: "not_found", entries: [], total: 0, notices };
    return MaterialQueryResultSchema.parse({
      status: "ok",
      entries: [cached.entry],
      total: 1,
      content,
      revisionChanged: Boolean(
        input.expected_revision &&
        input.expected_revision !== cached.entry.revision
      ),
      notices
    });
  }
}
