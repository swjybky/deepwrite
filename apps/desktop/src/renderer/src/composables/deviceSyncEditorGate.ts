import type { Ref } from "vue";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import type {
  EditorPersistOutcome,
  EditorSavePayload
} from "./useEditorAutoSaveCoordinator";

interface DeviceSyncEditorGateOptions {
  documents: Readonly<Ref<readonly Pick<WorkspaceDocument, "id">[]>>;
  drafts: Readonly<Ref<Record<string, EditorDraftState>>>;
  drain(): Promise<void>;
  save(
    payload: EditorSavePayload,
    announce: boolean
  ): Promise<EditorPersistOutcome>;
  saveLong(): Promise<boolean>;
}

export async function prepareDeviceSyncEditors(
  options: DeviceSyncEditorGateOptions
): Promise<boolean> {
  await options.drain();
  if (!(await options.saveLong())) return false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const documentIds = new Set(options.documents.value.map(({ id }) => id));
    const dirty = Object.entries(options.drafts.value).filter(
      // Recovery can retain drafts for removed or disconnected projects.
      // Keep them intact, but only save documents in the current workspace.
      ([id, draft]) => draft.dirty && documentIds.has(id)
    );
    if (!dirty.length) return true;
    for (const [id, draft] of dirty) {
      if (
        (await options.save(
          { id, title: draft.title, content: draft.content },
          true
        )) !== "saved"
      )
        return false;
    }
  }
  return false;
}
