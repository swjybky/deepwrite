import type {
  DocumentVersionTarget,
  RestoreDocumentVersionResult
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { useSettingsStore } from "../stores/settingsStore";
import { useConversationStore } from "../stores/conversationStore";

export interface EditorDocumentVersionPort {
  target: DocumentVersionTarget | null;
  busy: boolean;
  prepareRestore(): Promise<boolean>;
  applyRestore(result: RestoreDocumentVersionResult): Promise<void> | void;
}

export function useEditorDocumentVersions(options: {
  target(): DocumentVersionTarget | null;
  content(): string;
  title(): string;
  unsaved(): boolean;
  autoSave(): boolean;
  locked(): boolean;
  restoreDisabledReason?(): string;
  prepareRestore(): Promise<boolean>;
  applyRestore(result: RestoreDocumentVersionResult): Promise<void> | void;
}) {
  const settings = useSettingsStore();
  const conversations = useConversationStore();
  const open = ref(false);
  const visible = computed(() =>
    Boolean(settings.generalSettings.versionHistoryEnabled && options.target())
  );
  const busy = computed(() => {
    const target = options.target();
    if (!target) return false;
    const scope = `${target.workspace === "long" ? "long" : "book"}:${target.bookId}`;
    return (
      options.locked() ||
      conversations
        .controllersForScope(scope)
        .some(({ isBusy }) => isBusy.value)
    );
  });
  watch([visible, () => JSON.stringify(options.target())], () => {
    open.value = false;
  });
  const dialogProps = computed(() => ({
    target: options.target()!,
    title: options.title(),
    currentContent: options.content(),
    busy: busy.value,
    restoreDisabledReason: options.restoreDisabledReason?.() ?? "",
    unsaved: options.unsaved(),
    autoSave: options.autoSave(),
    prepareRestore: options.prepareRestore,
    applyRestore: options.applyRestore
  }));
  return { visible, open, dialogProps };
}
