import type { Ref } from "vue";
import type { EditorDraftState } from "../types/workspace";
import type {
  EditorPersistOutcome,
  EditorSavePayload
} from "./useEditorAutoSaveCoordinator";

export async function prepareDeviceSyncEditors(options: {
  drafts: Readonly<Ref<Record<string, EditorDraftState>>>;
  drain(): Promise<void>;
  save(
    payload: EditorSavePayload,
    announce: boolean
  ): Promise<EditorPersistOutcome>;
  saveLong(): Promise<boolean>;
}): Promise<boolean> {
  await options.drain();
  if (!(await options.saveLong())) return false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const dirty = Object.entries(options.drafts.value).filter(
      ([, draft]) => draft.dirty
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
