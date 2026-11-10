import { reconcileLibraryOrder } from "@deepwrite/contracts/renderer";
import type { CatalogLibraryTransactionsContext } from "./useCatalogLibraryTransactionsCoordinator";
import type { CatalogResourceNodeActionPayload } from "../types/workspace";
import { formatError } from "../i18n/errors";

export async function reorderCatalogLibrary(
  context: CatalogLibraryTransactionsContext,
  payload: CatalogResourceNodeActionPayload
) {
  const snapshot = context.snapshot.value;
  const api = context.api();
  const id =
    payload.node.catalogNodeType === "group"
      ? payload.node.groupId
      : payload.node.libraryId;
  if (!api || !snapshot || !id) return;
  const groups =
    payload.domain === "material"
      ? snapshot.materialGroups
      : snapshot.skillGroups;
  const libraries =
    payload.domain === "material" ? snapshot.materials : snapshot.skills;
  const group =
    payload.node.catalogNodeType === "library"
      ? groups.find((item) => Object.values(item.members).includes(id))
      : undefined;
  const grouped = new Set(
    groups.flatMap((item) => Object.values(item.members))
  );
  const organization = snapshot.libraryOrganization;
  const available = group
    ? Object.values(group.members).filter((id): id is string => !!id)
    : [
        ...groups.map(({ id }) => id),
        ...libraries
          .filter(
            ({ id }) =>
              !grouped.has(id) && !organization?.unboundLibraryIds.includes(id)
          )
          .map(({ id }) => id)
      ];
  const order = reconcileLibraryOrder(
    available,
    (group ? organization?.groups[group.id] : organization?.[payload.domain]) ??
      []
  );
  const position =
    payload.position ??
    (payload.action === "library-move-up" ? "before" : "after");
  const anchorId =
    payload.anchorId ??
    order[order.indexOf(id) + (position === "before" ? -1 : 1)];
  if (!anchorId) return;
  try {
    await api.reorderLibrary({
      domain: payload.domain,
      id,
      anchorId,
      position,
      baseRevision: organization?.revision ?? 0,
      ...(group ? { groupId: group.id } : {})
    });
    await context.refreshCatalog();
  } catch (error) {
    await context.refreshCatalog();
    context.notifications.error(formatError(error, ""));
  }
}
