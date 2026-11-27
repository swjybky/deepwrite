import {
  ErrorPayloadSchema,
  type AcademicBookSubtype,
  type AcademicCitationStyle,
  type AcademicFrameworkMutation,
  type AcademicManuscriptMutation,
  type AcademicReferenceCardType,
  type CatalogIndexBook,
  type DeepWriteApi
} from "@deepwrite/contracts/renderer";
import { academicT } from "../components/academic/academicLabels";
import { formatError } from "../i18n/errors";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import {
  academicExportPending,
  academicMutationPending,
  getAcademicLifecyclePort
} from "../stores/academicWorkspaceDialog";
import {
  createAcademicManuscriptExportInput,
  listAcademicManuscriptExportTree,
  type AcademicExportSourceBook,
  type AcademicManuscriptExportRequest
} from "../utils/academicManuscriptExport";
import { uiMessage } from "../ui-feedback";
import { deepwriteApi } from "../api/deepwrite";

export type AcademicCatalogIndexBook = Extract<
  CatalogIndexBook,
  { bookType: "academic" }
>;

export function findAcademicIndexBook(
  bookId: string
): AcademicCatalogIndexBook | undefined {
  const store = useCatalogIndexStore();
  const found = store.snapshot?.books.find((book) => book.id === bookId);
  return found && found.bookType === "academic" ? found : undefined;
}

function resolveCatalogApi(): DeepWriteApi["catalog"] | undefined {
  return getAcademicLifecyclePort()?.api() ?? deepwriteApi()?.catalog;
}

function isCiteKeyConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  if (candidate.code === "catalog.academic_cite_key_conflict") return true;
  const parsed = ErrorPayloadSchema.safeParse(error);
  if (
    parsed.success &&
    parsed.data.code === "catalog.academic_cite_key_conflict"
  )
    return true;
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  return (
    message.includes("catalog.academic_cite_key_conflict") ||
    message.includes("Duplicate citeKey") ||
    message.includes("已被本作品其他卡片使用")
  );
}

async function prepareAndResolveRevision(bookId: string): Promise<{
  api: DeepWriteApi["catalog"];
  baseProjectRevision?: number;
} | null> {
  const api = resolveCatalogApi();
  if (!api) return null;
  const port = getAcademicLifecyclePort();
  if (port) {
    const ready = await port.prepareBookMutation(bookId);
    if (!ready) return null;
  }
  const indexBook = findAcademicIndexBook(bookId);
  const portBook = port?.book(bookId);
  const baseProjectRevision =
    indexBook?.projectRevision ?? portBook?.projectRevision;
  return {
    api,
    ...(baseProjectRevision !== undefined ? { baseProjectRevision } : {})
  };
}

async function refreshAfterAcademicMutation(): Promise<void> {
  const port = getAcademicLifecyclePort();
  if (port) {
    await port.refresh();
    return;
  }
  const api = resolveCatalogApi();
  if (api) {
    await useCatalogIndexStore().ensureSnapshot(() => api.index());
  }
}

function selectAcademicNodeAfterRefresh(resourceId: string): void {
  const port = getAcademicLifecyclePort();
  const store = useCatalogIndexStore();
  if (!port || !store.resourceNodeById.has(resourceId)) return;
  port.selectedResourceId.value = resourceId;
  port.activeCreationResourceId.value = resourceId;
}

function selectAcademicSectionAfterRefresh(
  bookId: string,
  sectionId: string
): void {
  const port = getAcademicLifecyclePort();
  const store = useCatalogIndexStore();
  if (!port) return;
  const directory = store.draftDirectoryByWorkspaceId.get(bookId);
  const sectionResourceId = `academic:node:${encodeURIComponent(bookId)}:section:${encodeURIComponent(sectionId)}`;
  if (directory) {
    port.selectedExpertSectionIds.value = {
      ...port.selectedExpertSectionIds.value,
      [directory.id]: sectionId
    };
    port.selectedDraftFileKinds.value = {
      ...port.selectedDraftFileKinds.value,
      [directory.id]: "body"
    };
  }
  if (store.resourceNodeById.has(sectionResourceId)) {
    port.selectedResourceId.value = sectionResourceId;
    port.activeCreationResourceId.value = sectionResourceId;
  }
}

async function withAcademicMutationLock<T>(
  operation: () => Promise<T>
): Promise<T | null> {
  const port = getAcademicLifecyclePort();
  if (academicMutationPending.value || port?.catalogMutationPending.value) {
    return null;
  }
  academicMutationPending.value = true;
  if (port) port.catalogMutationPending.value = true;
  try {
    return await operation();
  } finally {
    academicMutationPending.value = false;
    if (port) port.catalogMutationPending.value = false;
  }
}

export async function executeAcademicFrameworkMutation(
  bookId: string,
  mutation: AcademicFrameworkMutation
): Promise<boolean> {
  const result = await withAcademicMutationLock(async () => {
    const prepared = await prepareAndResolveRevision(bookId);
    if (!prepared) return false;
    try {
      await prepared.api.mutateAcademicFramework({
        bookId,
        ...(prepared.baseProjectRevision !== undefined
          ? { baseProjectRevision: prepared.baseProjectRevision }
          : {}),
        mutation
      });
      await refreshAfterAcademicMutation();
      return true;
    } catch (error: unknown) {
      uiMessage.error(formatError(error, academicT("frameworkSaveFailed")));
      return false;
    }
  });
  return result === true;
}

export async function executeUpdateAcademicBookSettings(
  bookId: string,
  patch: {
    subtype?: AcademicBookSubtype;
    citationStyle?: AcademicCitationStyle;
  }
): Promise<boolean> {
  const result = await withAcademicMutationLock(async () => {
    const prepared = await prepareAndResolveRevision(bookId);
    if (!prepared) return false;
    try {
      await prepared.api.updateBook({
        bookId,
        ...(prepared.baseProjectRevision !== undefined
          ? { baseProjectRevision: prepared.baseProjectRevision }
          : {}),
        ...(patch.subtype ? { subtype: patch.subtype } : {}),
        ...(patch.citationStyle ? { citationStyle: patch.citationStyle } : {})
      });
      await refreshAfterAcademicMutation();
      uiMessage.success(academicT("settingsSavedToast"));
      return true;
    } catch (error: unknown) {
      uiMessage.error(formatError(error, academicT("settingsSaveFailed")));
      return false;
    }
  });
  return result === true;
}

export async function executeCreateAcademicCard(input: {
  bookId: string;
  citeKey: string;
  cardType: AcademicReferenceCardType;
  title: string;
  content?: string;
}): Promise<boolean> {
  const result = await withAcademicMutationLock(async () => {
    const prepared = await prepareAndResolveRevision(input.bookId);
    if (!prepared) return false;
    try {
      const created = await prepared.api.createAcademicReferenceCard({
        bookId: input.bookId,
        citeKey: input.citeKey,
        cardType: input.cardType,
        title: input.title,
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(prepared.baseProjectRevision !== undefined
          ? { baseProjectRevision: prepared.baseProjectRevision }
          : {})
      });
      await refreshAfterAcademicMutation();
      const cardResourceId = `academic:node:${encodeURIComponent(input.bookId)}:card:${encodeURIComponent(created.card.id)}`;
      selectAcademicNodeAfterRefresh(cardResourceId);
      uiMessage.success(academicT("cardSavedToast"));
      return true;
    } catch (error: unknown) {
      if (isCiteKeyConflictError(error)) {
        uiMessage.warning(
          academicT("duplicateCiteKeyError", { citeKey: input.citeKey })
        );
        return false;
      }
      uiMessage.error(formatError(error, academicT("cardSaveFailed")));
      return false;
    }
  });
  return result === true;
}

export async function executeUpdateAcademicCard(input: {
  bookId: string;
  cardId: string;
  citeKey: string;
  cardType: AcademicReferenceCardType;
  title: string;
}): Promise<boolean> {
  const result = await withAcademicMutationLock(async () => {
    const prepared = await prepareAndResolveRevision(input.bookId);
    if (!prepared) return false;
    try {
      await prepared.api.updateAcademicReferenceCard({
        bookId: input.bookId,
        cardId: input.cardId,
        citeKey: input.citeKey,
        cardType: input.cardType,
        title: input.title,
        ...(prepared.baseProjectRevision !== undefined
          ? { baseProjectRevision: prepared.baseProjectRevision }
          : {})
      });
      await refreshAfterAcademicMutation();
      uiMessage.success(academicT("cardSavedToast"));
      return true;
    } catch (error: unknown) {
      if (isCiteKeyConflictError(error)) {
        uiMessage.warning(
          academicT("duplicateCiteKeyError", { citeKey: input.citeKey })
        );
        return false;
      }
      uiMessage.error(formatError(error, academicT("cardSaveFailed")));
      return false;
    }
  });
  return result === true;
}

export async function executeDeleteAcademicCard(
  bookId: string,
  cardId: string
): Promise<boolean> {
  const result = await withAcademicMutationLock(async () => {
    const prepared = await prepareAndResolveRevision(bookId);
    if (!prepared) return false;
    try {
      await prepared.api.deleteAcademicReferenceCard({
        bookId,
        cardId,
        ...(prepared.baseProjectRevision !== undefined
          ? { baseProjectRevision: prepared.baseProjectRevision }
          : {})
      });
      await refreshAfterAcademicMutation();
      uiMessage.success(academicT("cardDeletedToast"));
      return true;
    } catch (error: unknown) {
      uiMessage.error(formatError(error, academicT("cardSaveFailed")));
      return false;
    }
  });
  return result === true;
}

export async function executeImportAcademicCardsFromMaterials(
  bookId: string,
  items: ReadonlyArray<{
    libraryId: string;
    entryId: string;
    title: string;
    citeKey: string;
    cardType: AcademicReferenceCardType;
  }>
): Promise<boolean> {
  if (!items.length) return false;
  const result = await withAcademicMutationLock(async () => {
    const prepared = await prepareAndResolveRevision(bookId);
    if (!prepared) return false;
    let currentRevision = prepared.baseProjectRevision;
    let importedCount = 0;
    let lastCardId: string | undefined;
    try {
      for (const item of items) {
        const read = await prepared.api.readDocument({
          projectId: item.libraryId,
          target: "document",
          documentId: item.entryId
        });
        const created = await prepared.api.createAcademicReferenceCard({
          bookId,
          citeKey: item.citeKey,
          cardType: item.cardType,
          title: item.title,
          content: read.content,
          ...(currentRevision !== undefined
            ? { baseProjectRevision: currentRevision }
            : {})
        });
        currentRevision = created.book.projectRevision;
        lastCardId = created.card.id;
        importedCount += 1;
      }
      await refreshAfterAcademicMutation();
      if (lastCardId) {
        const cardResourceId = `academic:node:${encodeURIComponent(bookId)}:card:${encodeURIComponent(lastCardId)}`;
        selectAcademicNodeAfterRefresh(cardResourceId);
      }
      uiMessage.success(
        academicT("importedCardsToast", { count: importedCount })
      );
      return true;
    } catch (error: unknown) {
      if (importedCount > 0) {
        await refreshAfterAcademicMutation();
      }
      if (isCiteKeyConflictError(error)) {
        const failedKey = items[importedCount]?.citeKey ?? "";
        uiMessage.warning(
          academicT("duplicateCiteKeyError", { citeKey: failedKey })
        );
        return false;
      }
      uiMessage.error(formatError(error, academicT("importCardsFailed")));
      return false;
    }
  });
  return result === true;
}

export async function executeAcademicManuscriptMutation(
  bookId: string,
  mutation: AcademicManuscriptMutation
): Promise<boolean> {
  const result = await withAcademicMutationLock(async () => {
    const prepared = await prepareAndResolveRevision(bookId);
    if (!prepared) return false;
    try {
      const updated = await prepared.api.mutateAcademicManuscript({
        bookId,
        ...(prepared.baseProjectRevision !== undefined
          ? { baseProjectRevision: prepared.baseProjectRevision }
          : {}),
        mutation
      });
      await refreshAfterAcademicMutation();
      if (mutation.type === "create-section" && updated.sectionId) {
        selectAcademicSectionAfterRefresh(bookId, updated.sectionId);
      }
      return true;
    } catch (error: unknown) {
      uiMessage.error(formatError(error, academicT("manuscriptSaveFailed")));
      return false;
    }
  });
  return result === true;
}

export async function loadAcademicWritingContext(
  bookId: string
): Promise<string | null> {
  const api = resolveCatalogApi();
  if (!api) return null;
  const response = await api.readWritingContext({ bookId });
  return response.content;
}

export async function saveAcademicWritingContext(
  bookId: string,
  content: string
): Promise<boolean> {
  const api = resolveCatalogApi();
  if (!api) return false;
  try {
    await api.writeWritingContext({ bookId, content });
    return true;
  } catch (error: unknown) {
    uiMessage.error(formatError(error, academicT("settingsSaveFailed")));
    return false;
  }
}

export function resolveAcademicExportSourceBook(
  bookId: string
): AcademicExportSourceBook | undefined {
  const indexed = findAcademicIndexBook(bookId);
  if (indexed) return indexed;
  const candidate = getAcademicLifecyclePort()?.book(bookId);
  return candidate && candidate.bookType === "academic" ? candidate : undefined;
}

export async function executeExportAcademicManuscript(
  bookId: string,
  request: AcademicManuscriptExportRequest
): Promise<boolean> {
  const port = getAcademicLifecyclePort();
  if (academicExportPending.value || port?.manuscriptExportPending?.value) {
    return false;
  }
  const manuscriptApi = port?.manuscriptApi?.() ?? deepwriteApi()?.manuscript;
  if (!manuscriptApi) return false;
  if (request.sectionIds.length === 0) {
    uiMessage.warning(academicT("exportSelectAtLeastOneSection"));
    return false;
  }

  academicExportPending.value = true;
  if (port?.manuscriptExportPending) port.manuscriptExportPending.value = true;

  try {
    const book = resolveAcademicExportSourceBook(bookId);
    if (!book) return false;
    const store = useCatalogIndexStore();
    const getDocuments = () =>
      port?.documents?.value ?? store.workspaceDocuments;
    const getDrafts = () => port?.drafts?.value ?? {};

    const initialTree = listAcademicManuscriptExportTree(
      book,
      getDocuments(),
      getDrafts()
    );
    const selectedIds = new Set(request.sectionIds);
    const currentDocs = getDocuments();
    const currentDrafts = getDrafts();
    const docById = new Map(currentDocs.map((doc) => [doc.id, doc] as const));

    const docsToLoad = initialTree.orderedSections.flatMap((option) => {
      if (!selectedIds.has(option.id) || !option.bodyWorkspaceDocumentId) {
        return [];
      }
      const doc = docById.get(option.bodyWorkspaceDocumentId);
      if (
        !doc ||
        currentDrafts[doc.id] !== undefined ||
        doc.catalogContentLoaded
      ) {
        return [];
      }
      return [doc];
    });

    const loadedOverrides = new Map<string, string>();
    if (docsToLoad.length > 0 && port?.ensureDocumentsLoaded) {
      const ok = await port.ensureDocumentsLoaded(docsToLoad);
      if (!ok) return false;
    } else {
      const catalogApi = resolveCatalogApi();
      if (catalogApi) {
        for (const option of initialTree.orderedSections) {
          if (!selectedIds.has(option.id)) continue;
          const doc = option.bodyWorkspaceDocumentId
            ? docById.get(option.bodyWorkspaceDocumentId)
            : undefined;
          if (
            doc &&
            (currentDrafts[doc.id] !== undefined || doc.catalogContentLoaded)
          ) {
            continue;
          }
          const rawSection = book.manuscript.sections.find(
            (s) => s.id === option.id
          );
          const rawBody = rawSection?.body as
            { content: string; contentBytes?: number } | undefined;
          if (
            rawBody &&
            typeof rawBody.contentBytes === "number" &&
            rawBody.contentBytes > 0
          ) {
            const read = await catalogApi.readDocument({
              projectId: bookId,
              target: "document",
              documentId: option.bodyCatalogDocumentId
            });
            loadedOverrides.set(option.bodyCatalogDocumentId, read.content);
          }
        }
      }
    }

    const latestBook = resolveAcademicExportSourceBook(bookId) ?? book;
    const exportInput = createAcademicManuscriptExportInput(
      latestBook,
      getDocuments(),
      getDrafts(),
      request,
      loadedOverrides
    );
    if (exportInput.items.length === 0) {
      uiMessage.warning(academicT("exportSelectAtLeastOneSection"));
      return false;
    }

    const result = await manuscriptApi.exportAcademic(exportInput);
    if (result.status !== "saved") {
      return false;
    }

    if (result.missingImages > 0) {
      uiMessage.warning(
        academicT("exportedWithMissingImagesToast", {
          count: result.missingImages
        })
      );
    } else {
      uiMessage.success(
        academicT(
          request.format === "docx" ? "exportedDocxToast" : "exportedMdToast",
          { title: latestBook.title }
        )
      );
    }
    return true;
  } catch (error: unknown) {
    uiMessage.error(formatError(error, academicT("exportManuscriptFailed")));
    return false;
  } finally {
    academicExportPending.value = false;
    if (port?.manuscriptExportPending) {
      port.manuscriptExportPending.value = false;
    }
  }
}
