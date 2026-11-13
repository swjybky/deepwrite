import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentVersionTarget } from "@deepwrite/contracts";
import { useEditorDocumentVersions } from "./useEditorDocumentVersions";
import { useSettingsStore } from "../stores/settingsStore";
import { useConversationStore } from "../stores/conversationStore";

beforeEach(() => setActivePinia(createPinia()));
describe("editor version visibility", () => {
  it("requires an enabled setting and a work document, then closes when either changes", async () => {
    const state = reactive<{ target: DocumentVersionTarget | null }>({
      target: { workspace: "catalog", bookId: "book", documentId: "doc" }
    });
    const scope = effectScope();
    const history = scope.run(() =>
      useEditorDocumentVersions({
        target: () => state.target,
        content: () => "正文",
        title: () => "标题",
        unsaved: () => false,
        autoSave: () => false,
        locked: () => false,
        prepareRestore: async () => true,
        applyRestore: () => {}
      })
    )!;
    const settings = useSettingsStore();
    expect(history.visible.value).toBe(false);
    settings.generalSettings = {
      ...settings.generalSettings,
      versionHistoryEnabled: true
    };
    await nextTick();
    expect(history.visible.value).toBe(true);
    history.open.value = true;
    state.target = null;
    await nextTick();
    expect(history.visible.value).toBe(false);
    expect(history.open.value).toBe(false);
    state.target = { workspace: "long", bookId: "novel", fileId: "chapter" };
    await nextTick();
    history.open.value = true;
    settings.generalSettings = {
      ...settings.generalSettings,
      versionHistoryEnabled: false
    };
    await nextTick();
    expect(history.open.value).toBe(false);
    scope.stop();
  });

  it("checks all conversations for the same work", () => {
    const busy = reactive({ value: false });
    const conversations = useConversationStore();
    vi.spyOn(conversations, "controllersForScope").mockImplementation(
      (scope) => (scope === "long:novel" ? ([{ isBusy: busy }] as never) : [])
    );
    const scope = effectScope();
    const history = scope.run(() =>
      useEditorDocumentVersions({
        target: () => ({
          workspace: "long",
          bookId: "novel",
          fileId: "chapter"
        }),
        content: () => "",
        title: () => "",
        unsaved: () => false,
        autoSave: () => false,
        locked: () => false,
        prepareRestore: async () => true,
        applyRestore: () => {}
      })
    )!;
    expect(history.dialogProps.value.busy).toBe(false);
    busy.value = true;
    expect(history.dialogProps.value.busy).toBe(true);
    scope.stop();
  });
});
