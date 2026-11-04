import type { Ref } from "vue";
import { createScopedTranslator } from "../i18n";
import type { WorkspaceDocument } from "../types/workspace";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.workspaceShell");

interface LibraryProjectState {
  documents: Readonly<Ref<readonly WorkspaceDocument[]>>;
  editorDrafts: Readonly<
    Ref<
      Record<
        string,
        { dirty: boolean; title: string; content: string } | undefined
      >
    >
  >;
  saveConflict: Readonly<Ref<{ documentId: string } | null | undefined>>;
}

interface LibraryProjectActions {
  drainEditorSaves(): Promise<unknown>;
  cancelEditorAutoSave(documentId: string): void;
  persistEditorDocument(
    document: { id: string; title: string; content: string },
    notify: boolean
  ): Promise<boolean>;
}

/** Saves a library's open drafts so a copy or export sees the current text. */
export async function prepareLibraryProjects(
  state: LibraryProjectState,
  actions: LibraryProjectActions,
  libraryIds: ReadonlySet<string>,
  operation: "duplicate" | "export"
): Promise<boolean> {
  await actions.drainEditorSaves();
  const scopedDocuments = state.documents.value.filter(
    (document) => document.libraryId && libraryIds.has(document.libraryId)
  );
  if (
    state.saveConflict.value &&
    scopedDocuments.some(
      ({ id }) => id === state.saveConflict.value?.documentId
    )
  ) {
    uiMessage.warning(t("resolveTheLibrarySSaveConflictsFirst"));
    return false;
  }
  for (const document of scopedDocuments) {
    if (document.readOnly) continue;
    const draft = state.editorDrafts.value[document.id];
    if (!draft?.dirty) continue;
    actions.cancelEditorAutoSave(document.id);
    const saved = await actions.persistEditorDocument(
      { id: document.id, title: draft.title, content: draft.content },
      false
    );
    if (!saved) {
      uiMessage.warning(
        t(
          operation === "export"
            ? "someLibraryDraftsCannotBeSavedSafelyExportWas"
            : "someLibraryDraftsCannotBeSavedSafelyCopyingWas"
        )
      );
      return false;
    }
  }
  return true;
}
