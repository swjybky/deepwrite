import type { CatalogLibraryTransactionsContext } from "./useCatalogLibraryTransactionsCoordinator";
import type { CatalogResourceNodeActionPayload } from "../types/workspace";
import { formatError } from "../i18n/errors";

export async function organizeCatalogEntries(
  context: CatalogLibraryTransactionsContext,
  payload: CatalogResourceNodeActionPayload
) {
  const operation = payload.organizationOperation;
  const api = context.api();
  if (!api || !operation || operation.action !== "move-entries") return;
  const ids = new Set([
    operation.libraryId,
    ...(operation.target.kind === "library" ? [operation.target.libraryId] : [])
  ]);
  const entryId = operation.entryIds[0];
  if (!(await context.prepareProjectsForDuplicate(ids))) return;
  try {
    const plan = await api.previewLibraryStructure({
      domain: payload.domain,
      requestId: crypto.randomUUID(),
      operations: [operation]
    });
    await api.applyLibraryStructure(plan);
    await context.refreshCatalog();
    const target = context.documents.value.find(
      (document) =>
        document.domain === payload.domain &&
        document.catalogEntryId === entryId &&
        document.libraryId !== operation.libraryId
    );
    if (target) context.selectDocument(target.id, true);
  } catch (error) {
    await context.refreshCatalog();
    context.notifications.error(formatError(error, ""));
  }
}
