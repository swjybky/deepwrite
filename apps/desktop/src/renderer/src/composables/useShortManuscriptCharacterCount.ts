import { computed, ref, watch } from "vue";
import { countNonWhitespaceCharacters } from "../utils/boundedTextHistory";
import { createShortManuscriptExportInput } from "../utils/shortManuscriptExport";
import type { ShortManuscriptPreviewContext } from "./shortManuscriptPreviewContext";

export function useShortManuscriptCharacterCount(
  source: ShortManuscriptPreviewContext | null,
  isOpen: () => boolean
) {
  const book = computed(() => (isOpen() ? source?.book() : undefined));
  const loading = ref(false);
  const pendingDocuments = computed(() => {
    const currentBook = book.value;
    if (!currentBook || !source) return [];
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
          source.reportError("读取全文字数失败，请重新打开导出窗口。");
      } finally {
        if (current) loading.value = false;
      }
    },
    { immediate: true }
  );

  const characterCount = computed(() => {
    if (!book.value || !source || pendingDocuments.value.length) return null;
    const manuscript = createShortManuscriptExportInput(
      book.value,
      source.documents.value,
      source.drafts.value,
      "txt"
    );
    return manuscript.sections.reduce(
      (total, section) => total + countNonWhitespaceCharacters(section.content),
      0
    );
  });

  return { characterCount, loading };
}
