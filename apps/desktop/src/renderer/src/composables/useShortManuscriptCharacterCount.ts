import { t } from "../i18n";
import { computed, ref, watch } from "vue";
import { countDocumentCharacters } from "../utils/bookImageText";
import { createShortManuscriptExportInput } from "../utils/shortManuscriptExport";
import type { ShortManuscriptPreviewContext } from "./shortManuscriptPreviewContext";

export function useShortManuscriptCharacterCount(
  source: ShortManuscriptPreviewContext | null,
  isOpen: () => boolean,
  loadErrorMessage: string | (() => string) = () =>
    t(
      "workspace.shortManuscriptCharacterCount.failedToReadTheFullCharacterCountReopenThe"
    )
) {
  const book = computed(() => (isOpen() ? source?.book() : undefined));
  const loading = ref(false);
  const pendingDocuments = computed(() => {
    const currentBook = book.value;
    if (!currentBook || currentBook.bookType === "academic" || !source)
      return [];
    const bodyIds = new Set(
      currentBook.draft.sections.map((section) => section.body.id)
    );
    return source.documents.value.filter(
      (document) =>
        document.workspaceId === currentBook.id &&
        document.draftFileKind === "body" &&
        bodyIds.has(document.catalogDocumentId ?? "") &&
        document.catalogContentLoaded === false &&
        !source.drafts.value[document.id]
    );
  });

  watch(
    pendingDocuments,
    async (documents, _previous, onCleanup) => {
      let current = true;
      onCleanup(() => {
        current = false;
      });
      loading.value = documents.length > 0;
      if (!documents.length || !source) return;
      try {
        await source.ensureDocumentsLoaded(documents);
      } catch {
        if (current)
          source.reportError(
            typeof loadErrorMessage === "function"
              ? loadErrorMessage()
              : loadErrorMessage
          );
      } finally {
        if (current) loading.value = false;
      }
    },
    { immediate: true }
  );

  const characterCount = computed(() => {
    if (
      !book.value ||
      book.value.bookType === "academic" ||
      !source ||
      pendingDocuments.value.length
    )
      return null;
    const manuscript = createShortManuscriptExportInput(
      book.value,
      source.documents.value,
      source.drafts.value,
      "txt"
    );
    return manuscript.sections.reduce(
      (total, section) => total + countDocumentCharacters(section.content),
      0
    );
  });

  return { characterCount, loading };
}
