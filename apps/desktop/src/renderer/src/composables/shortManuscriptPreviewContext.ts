import type { Book } from "@deepwrite/contracts";
import type { InjectionKey, Ref } from "vue";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";

/** Read-only access to the same live manuscript used by the export command. */
export interface ShortManuscriptPreviewContext {
  book(): Book | undefined;
  documents: Readonly<Ref<readonly WorkspaceDocument[]>>;
  drafts: Readonly<Ref<Readonly<Record<string, EditorDraftState>>>>;
  ensureDocumentsLoaded(
    documents: readonly WorkspaceDocument[]
  ): Promise<boolean>;
  reportError(message: string): void;
}

export const SHORT_MANUSCRIPT_PREVIEW_KEY: InjectionKey<ShortManuscriptPreviewContext> =
  Symbol("deepwrite-short-manuscript-preview");
