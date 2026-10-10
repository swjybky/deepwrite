import {
  updateMaterialMarkdownMetadata,
  type LongMaterialEntryStatus,
  type LongMaterialEntryView,
  type LongMaterialPackRecord,
  type LongMaterialPlannedEntry,
  type LongMaterialRecordEntry,
  type MaterialKind
} from "@deepwrite/contracts";
import { decompositionResourceId } from "../long-book-decomposition/identity";
import { decompositionSha } from "../long-book-decomposition/content-guard";
import type { ManagedLibraryState } from "../folder-catalog-store/managed-batch";

export interface LongMaterialDecisions {
  overwrite: ReadonlySet<string>;
  remove: ReadonlySet<string>;
  regenerate: ReadonlySet<string>;
}
export const NO_DECISIONS: LongMaterialDecisions = {
  overwrite: new Set(),
  remove: new Set(),
  regenerate: new Set()
};

export interface ReconciledEntry {
  key: string;
  status: LongMaterialEntryStatus;
  libraryId: string;
  entryId: string;
  /** Present when this conversion writes the entry. */
  write?: { title: string; content: string; expectedSha256: string | null };
  remove?: { expectedSha256: string };
  /** What the record keeps for this key afterwards; absent drops the key. */
  record?: LongMaterialRecordEntry;
  view: LongMaterialEntryView;
}

export function plannedContent(entry: LongMaterialPlannedEntry): string {
  const result = updateMaterialMarkdownMetadata(entry.body, {
    name: entry.title,
    description: entry.description
  });
  if (!result.updated) throw new Error(result.message);
  return result.content;
}

/**
 * Compares the plan with the libraries and what this pack wrote before.
 * Content is "ours" when it matches the recorded or pending hash; anything
 * else is a user edit and is kept unless the user chose to overwrite it.
 */
export function reconcileLongMaterial(input: {
  packId: string;
  record?: Pick<LongMaterialPackRecord, "entries" | "pending">;
  libraryIds: Record<MaterialKind, string>;
  states: ReadonlyMap<string, ManagedLibraryState>;
  entries: readonly LongMaterialPlannedEntry[];
  decisions?: LongMaterialDecisions;
  /** Libraries re-created because they went missing: write everything. */
  recreated?: ReadonlySet<string>;
}): ReconciledEntry[] {
  const decisions = input.decisions ?? NO_DECISIONS;
  const previous = input.record?.entries ?? {};
  const pending = input.record?.pending ?? {};
  const result: ReconciledEntry[] = [];
  for (const entry of input.entries) {
    const known = previous[entry.key];
    const libraryId = input.libraryIds[entry.kind];
    const entryId =
      known?.libraryId === libraryId
        ? known.entryId
        : decompositionResourceId("material-entry", input.packId, entry.key);
    const state = input.states.get(libraryId);
    const listed = state?.manifest.entries.find(({ id }) => id === entryId);
    const current = state?.entrySha256[entryId];
    const content = plannedContent(entry);
    const sha256 = decompositionSha(content);
    const record: LongMaterialRecordEntry = {
      entryId,
      libraryId,
      kind: entry.kind,
      stageId: entry.stageId,
      title: entry.title,
      description: entry.description,
      sha256
    };
    const view = {
      key: entry.key,
      kind: entry.kind,
      stageId: entry.stageId,
      title: listed?.title ?? entry.title,
      characters: content.length,
      ...(entry.enhanced ? { enhanced: true } : {}),
      libraryId,
      entryId
    };
    // Keep a title the user changed; follow ours otherwise.
    const title =
      listed && known && listed.title !== known.title
        ? listed.title
        : entry.title;
    const push = (
      status: LongMaterialEntryStatus,
      extra: Partial<ReconciledEntry>
    ) =>
      result.push({
        key: entry.key,
        status,
        libraryId,
        entryId,
        view: { ...view, status },
        ...extra
      });
    if (!listed || current === undefined) {
      const deletedByUser =
        (known?.deleted || (known && !pending[entry.key])) &&
        !decisions.regenerate.has(entry.key) &&
        !input.recreated?.has(libraryId);
      if (deletedByUser)
        push("deleted", { record: { ...(known ?? record), deleted: true } });
      else
        push("new", {
          write: { title, content, expectedSha256: null },
          record: { ...record, title }
        });
      continue;
    }
    if (current === sha256 && title === listed.title) {
      push("unchanged", { record: { ...record, title } });
      continue;
    }
    const ours = current === known?.sha256 || current === pending[entry.key];
    if (ours || current === sha256 || decisions.overwrite.has(entry.key))
      push("updated", {
        write: { title, content, expectedSha256: current },
        record: { ...record, title }
      });
    // A conflicting entry keeps its last recorded hash, so it stays "theirs".
    else push("conflict", { ...(known ? { record: known } : {}) });
  }
  const planned = new Set(input.entries.map(({ key }) => key));
  for (const [key, known] of Object.entries(previous)) {
    if (planned.has(key)) continue;
    const state = input.states.get(known.libraryId);
    const current = state?.entrySha256[known.entryId];
    if (current === undefined || known.deleted) continue;
    const view = {
      key,
      kind: known.kind,
      stageId: known.stageId,
      title:
        state?.manifest.entries.find(({ id }) => id === known.entryId)?.title ??
        known.title,
      characters: 0,
      libraryId: known.libraryId,
      entryId: known.entryId
    };
    if (decisions.remove.has(key))
      result.push({
        key,
        status: "stale",
        libraryId: known.libraryId,
        entryId: known.entryId,
        remove: { expectedSha256: current },
        view: { ...view, status: "stale" }
      });
    else
      result.push({
        key,
        status: "stale",
        libraryId: known.libraryId,
        entryId: known.entryId,
        record: known,
        view: { ...view, status: "stale" }
      });
  }
  return result;
}
