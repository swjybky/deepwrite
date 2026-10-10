import {
  LONG_MATERIAL_KINDS,
  renderLibraryOverview,
  type LongMaterialLibraryIds,
  type LongMaterialPlannedEntry
} from "@deepwrite/contracts";
import type { FolderCatalogStore } from "../folder-catalog-store";
import {
  replaceOverviewBlock,
  type ManagedLibraryState
} from "../folder-catalog-store/managed-batch";
import type { ReconciledEntry } from "./reconcile";

export const longMaterialOverviewMarker = (packId: string) =>
  `deepwrite-long-material:${packId}`;

/**
 * One transaction per library: entry writes, confirmed removals, plan order
 * and the generated block of the library introduction.
 */
export async function writeReconciledLibraries(
  catalog: FolderCatalogStore,
  input: {
    packId: string;
    bookTitle: string;
    libraryIds: LongMaterialLibraryIds;
    states: ReadonlyMap<string, ManagedLibraryState>;
    reconciled: readonly ReconciledEntry[];
    plan: readonly LongMaterialPlannedEntry[];
    onLibrary?(done: number, total: number): void;
  }
): Promise<void> {
  const byKey = new Map(input.reconciled.map((entry) => [entry.key, entry]));
  let done = 0;
  for (const kind of LONG_MATERIAL_KINDS) {
    const libraryId = input.libraryIds[kind];
    const state = input.states.get(libraryId);
    if (!state) throw new Error("转换目标素材库不存在。");
    const own = input.reconciled.filter(
      (entry) => entry.libraryId === libraryId
    );
    const planned = input.plan
      .filter((entry) => entry.kind === kind)
      .flatMap((entry) => {
        const reconciled = byKey.get(entry.key);
        return reconciled && reconciled.status !== "deleted"
          ? [reconciled]
          : [];
      });
    const kept = own.filter(
      (entry) => entry.status === "stale" && !entry.remove
    );
    const order = [...planned, ...kept].map(({ entryId }) => entryId);
    const overview = replaceOverviewBlock(
      state.manifest.overview,
      longMaterialOverviewMarker(input.packId),
      renderLibraryOverview(
        kind,
        input.bookTitle,
        planned.map(({ key, view }) => ({
          key,
          kind,
          title: view.title,
          description:
            input.plan.find((entry) => entry.key === key)?.description ?? ""
        }))
      )
    );
    const writes = own.flatMap((entry) =>
      entry.write
        ? [
            {
              entryId: entry.entryId,
              title: entry.write.title,
              stageId: entry.view.stageId,
              content: entry.write.content,
              expectedSha256: entry.write.expectedSha256
            }
          ]
        : []
    );
    const removals = own.flatMap((entry) =>
      entry.remove ? [{ entryId: entry.entryId, ...entry.remove }] : []
    );
    const present = new Set(state.manifest.entries.map(({ id }) => id));
    const managed = new Set(order);
    const currentOrder = state.manifest.entries
      .map(({ id }) => id)
      .filter((id) => managed.has(id));
    const reordered =
      currentOrder.join("\n") !==
      order.filter((id) => present.has(id)).join("\n");
    if (
      writes.length ||
      removals.length ||
      reordered ||
      overview !== state.manifest.overview
    )
      await catalog.writeManagedEntries({
        libraryId,
        manifestSha256: state.manifestSha256,
        writes,
        removals,
        order,
        overview
      });
    input.onLibrary?.(++done, LONG_MATERIAL_KINDS.length);
  }
}
