import { createHash } from "node:crypto";
import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  LONG_MATERIAL_ENTRY_STATUSES,
  LONG_MATERIAL_KINDS,
  LONG_MATERIAL_LIBRARY_NAMES,
  planLongMaterialPack,
  type LongMaterialConvertInput,
  type LongMaterialConvertResult,
  type LongMaterialGuideSubmission,
  type LongMaterialPackOptions,
  type LongMaterialPackRecord,
  type LongMaterialPackRequest,
  type LongMaterialPackSummary,
  type LongMaterialProgressPayload,
  type LongMaterialStatusCounts,
  type MaterialKind
} from "@deepwrite/contracts";
import type { FolderCatalogStore } from "../folder-catalog-store";
import type { ManagedLibraryState } from "../folder-catalog-store/managed-batch";
import type { LongWorkspaceService } from "../long-workspace-service";
import {
  plannedLibraryIds,
  prepareLongMaterialTarget,
  type LongMaterialTargetPaths
} from "./library-target";
import { LongMaterialPackStore } from "./pack-store";
import {
  NO_DECISIONS,
  reconcileLongMaterial,
  type LongMaterialDecisions,
  type ReconciledEntry
} from "./reconcile";
import { readLongMaterialSource } from "./source-reader";
import { writeReconciledLibraries } from "./library-writes";

export interface LongMaterialServiceDeps {
  workspaceDirectory: string;
  paths: LongMaterialTargetPaths;
  longs: LongWorkspaceService;
  catalog: FolderCatalogStore;
  progress?(payload: Omit<LongMaterialProgressPayload, "operationId">): void;
}

export function longMaterialPackId(operationId: string): string {
  return `lmpack_${createHash("sha256").update(operationId).digest("hex").slice(0, 24)}`;
}

export function statusCounts(
  entries: readonly { status: ReconciledEntry["status"] }[]
): LongMaterialStatusCounts {
  const counts = Object.fromEntries(
    LONG_MATERIAL_ENTRY_STATUSES.map((status) => [status, 0])
  ) as LongMaterialStatusCounts;
  for (const { status } of entries) counts[status] += 1;
  return counts;
}

/** Reuses the 章纲 grouping only while the user keeps the same choice. */
function keptGrouping(
  record: LongMaterialPackRecord | undefined,
  options: LongMaterialPackOptions
) {
  return record?.options.chapterGrouping === options.chapterGrouping
    ? record.chaptersPerEntry
    : undefined;
}

export class LongMaterialPackService {
  readonly store: LongMaterialPackStore;
  constructor(private readonly deps: LongMaterialServiceDeps) {
    this.store = new LongMaterialPackStore(deps.workspaceDirectory);
  }

  async states(libraryIds: readonly string[]) {
    const snapshot = await this.deps.catalog.indexSnapshot();
    const states = new Map<string, ManagedLibraryState>();
    for (const id of libraryIds)
      if (snapshot.materials.some((library) => library.id === id))
        states.set(id, await this.deps.catalog.readManagedLibrary(id));
    return states;
  }

  async summaries(bookId?: string): Promise<LongMaterialPackSummary[]> {
    const records = (await this.store.list()).filter(
      (record) => !bookId || record.bookId === bookId
    );
    const snapshot = await this.deps.catalog.indexSnapshot();
    return records.map((record) =>
      this.summary(record, snapshot.materialGroups)
    );
  }

  summary(
    record: LongMaterialPackRecord,
    groups: readonly { id: string; title: string }[]
  ): LongMaterialPackSummary {
    const groupTitle = groups.find(({ id }) => id === record.groupId)?.title;
    return {
      id: record.id,
      bookId: record.bookId,
      bookTitle: record.bookTitle,
      groupId: record.groupId,
      ...(groupTitle ? { groupTitle } : {}),
      entryCount: Object.values(record.entries).filter(
        ({ deleted }) => !deleted
      ).length,
      ...(record.guide ? { guideGeneratedAt: record.guide.generatedAt } : {}),
      ...(record.convertedAt ? { convertedAt: record.convertedAt } : {}),
      updatedAt: record.updatedAt
    };
  }

  async readRecord(request: LongMaterialPackRequest) {
    if (request.target.action !== "update") return undefined;
    const record = await this.store.read(request.target.packId);
    if (record.bookId !== request.bookId)
      throw new Error("所选转换记录不属于这本长篇。");
    return record;
  }

  /** Plans against the current libraries; nothing is created or written. */
  async plan(
    request: LongMaterialPackRequest,
    record?: LongMaterialPackRecord
  ) {
    const source = await readLongMaterialSource(
      this.deps.longs,
      this.deps.workspaceDirectory,
      request.bookId,
      request.options.sampleChapterIds
    );
    const snapshot = await this.deps.catalog.indexSnapshot();
    const libraryIds =
      record?.libraryIds ?? plannedLibraryIds("lmpack_preview000");
    const libraryTitles = Object.fromEntries(
      LONG_MATERIAL_KINDS.map((kind) => [
        kind,
        snapshot.materials.find(({ id }) => id === libraryIds[kind])?.title ??
          `《${source.title}》${LONG_MATERIAL_LIBRARY_NAMES[kind]}`
      ])
    ) as Record<MaterialKind, string>;
    const plan = planLongMaterialPack({
      source,
      options: request.options,
      libraryTitles,
      chaptersPerEntry: keptGrouping(record, request.options),
      ...(record?.guide ? { guide: record.guide.submission } : {})
    });
    const states = record
      ? await this.states(Object.values(libraryIds))
      : new Map();
    const reconciled = reconcileLongMaterial({
      packId: record?.id ?? "lmpack_preview000",
      ...(record ? { record } : {}),
      libraryIds,
      states,
      entries: plan.entries
    });
    return { source, plan, reconciled, libraryIds, libraryTitles, states };
  }

  async convert(
    input: LongMaterialConvertInput,
    extra: {
      decisions?: LongMaterialDecisions;
      guide?: { submission: LongMaterialGuideSubmission; modelLabel?: string };
    } = {}
  ): Promise<LongMaterialConvertResult> {
    const progress = this.deps.progress ?? (() => undefined);
    const now = new Date().toISOString();
    const previous = await this.readRecord(input);
    const packId = previous?.id ?? longMaterialPackId(input.operationId);
    progress({ phase: "reading", done: 0, total: 1 });
    const source = await readLongMaterialSource(
      this.deps.longs,
      this.deps.workspaceDirectory,
      input.bookId,
      input.options.sampleChapterIds,
      (done, total) => progress({ phase: "reading", done, total })
    );
    const target = await prepareLongMaterialTarget(this.deps.catalog, {
      packId,
      bookTitle: source.title,
      groupTitle:
        input.target.action === "create"
          ? input.target.title
          : `《${source.title}》仿写素材`,
      ...(previous
        ? { groupId: previous.groupId, libraryIds: previous.libraryIds }
        : {}),
      paths: this.deps.paths
    });
    const guide = extra.guide
      ? {
          generatedAt: now,
          ...(extra.guide.modelLabel
            ? { modelLabel: extra.guide.modelLabel }
            : {}),
          submission: extra.guide.submission
        }
      : previous?.guide;
    const plan = planLongMaterialPack({
      source,
      options: input.options,
      libraryTitles: target.libraryTitles,
      chaptersPerEntry: keptGrouping(previous, input.options),
      ...(guide ? { guide: guide.submission } : {})
    });
    const states = await this.states(Object.values(target.libraryIds));
    const reconciled = reconcileLongMaterial({
      packId,
      ...(previous ? { record: previous } : {}),
      libraryIds: target.libraryIds,
      states,
      entries: plan.entries,
      decisions: extra.decisions ?? NO_DECISIONS,
      recreated: target.created
    });
    for (const kind of LONG_MATERIAL_KINDS) {
      const state = states.get(target.libraryIds[kind]);
      const added = reconciled.filter(
        (entry) =>
          entry.libraryId === target.libraryIds[kind] && entry.status === "new"
      ).length;
      if (
        (state?.manifest.entries.length ?? 0) + added >
        CATALOG_PROJECT_MAX_CONTENT_ITEMS
      )
        throw new Error(
          `${target.libraryTitles[kind]}容量不足，请减少转换内容或换用新分组。`
        );
    }
    const base: LongMaterialPackRecord = {
      schemaVersion: 1,
      id: packId,
      bookId: input.bookId,
      bookTitle: source.title,
      groupId: target.groupId,
      libraryIds: target.libraryIds,
      options: input.options,
      chaptersPerEntry: plan.chaptersPerEntry,
      stats: plan.stats,
      entries: previous?.entries ?? {},
      pending: Object.fromEntries(
        reconciled.flatMap((entry) =>
          entry.write ? [[entry.key, entry.record!.sha256]] : []
        )
      ),
      ...(guide ? { guide } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      ...(previous?.convertedAt ? { convertedAt: previous.convertedAt } : {})
    };
    await this.store.save(base);
    await writeReconciledLibraries(this.deps.catalog, {
      packId,
      bookTitle: source.title,
      libraryIds: target.libraryIds,
      states,
      reconciled,
      plan: plan.entries,
      onLibrary: (done, total) => progress({ phase: "writing", done, total })
    });
    const { pending: _pending, ...rest } = base;
    const record: LongMaterialPackRecord = {
      ...rest,
      entries: Object.fromEntries(
        reconciled.flatMap((entry) =>
          entry.record ? [[entry.key, entry.record]] : []
        )
      ),
      convertedAt: now,
      updatedAt: now
    };
    await this.store.save(record);
    progress({ phase: "finished", done: 1, total: 1 });
    const snapshot = await this.deps.catalog.indexSnapshot();
    return {
      pack: this.summary(record, snapshot.materialGroups),
      libraries: LONG_MATERIAL_KINDS.map((kind) => ({
        kind,
        libraryId: target.libraryIds[kind],
        title: target.libraryTitles[kind]
      })),
      entries: reconciled.map(({ view }) => view),
      counts: statusCounts(reconciled)
    };
  }
}
