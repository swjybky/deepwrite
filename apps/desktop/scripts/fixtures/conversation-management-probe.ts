import { createApp, h, nextTick, ref } from "vue";
import { createPinia } from "pinia";
import {
  createDefaultAppearanceSettings,
  type ConversationExportApi
} from "@deepwrite/contracts/renderer";
import ConversationHistoryMenu from "../../src/renderer/src/components/ConversationHistoryMenu.vue";
import ConversationSaveStatus from "../../src/renderer/src/components/ConversationSaveStatus.vue";
import { useConversationStore } from "../../src/renderer/src/stores/conversationStore";
import {
  useAgentConversation,
  type AgentConversationPersistenceRecord
} from "../../src/renderer/src/composables/useAgentConversation";
import type { ConversationHistoryItem } from "../../src/renderer/src/types/conversation";
import { conversationHistoryPersistenceKey } from "../../src/renderer/src/utils/conversationPersistenceKeys";
import { uiMessageItems } from "../../src/renderer/src/ui-feedback";
import { applyAppearanceThemeToDocument } from "../../src/renderer/src/composables/appearanceThemeRuntime";
import "../../src/renderer/src/styles.css";
const frame = () => new Promise(requestAnimationFrame);
async function until(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!condition()) {
    if (performance.now() > deadline)
      throw new Error("Probe state did not settle");
    await frame();
  }
}
const click = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing probe element: ${selector}`);
  element.click();
};
const item = (sessionId: string, current = false): ConversationHistoryItem => ({
  sessionId,
  current,
  title: current ? "当前测试对话" : "可恢复的测试对话",
  preview: "完全虚构的测试正文",
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  messageCount: 2,
  turnCount: 1
});
(window as typeof window & Record<string, unknown>).runManagementProbe =
  async () => {
    const pinia = createPinia();
    const store = useConversationStore(pinia);
    const active = item("current", true),
      older = item("older");
    const records = new Map(
      [active, older].map((summary) => [
        summary.sessionId,
        {
          sessionId: summary.sessionId,
          messages: [
            {
              id: `user-${summary.sessionId}`,
              role: "user",
              content: summary.title,
              createdAt: summary.createdAt,
              status: "completed"
            },
            {
              id: `assistant-${summary.sessionId}`,
              role: "assistant",
              content: summary.preview,
              createdAt: summary.createdAt,
              status: "completed"
            }
          ],
          draft: "",
          approvalMode: "request-approval",
          temperature: 0.7,
          createdAt: summary.createdAt,
          updatedAt: summary.updatedAt
        } as AgentConversationPersistenceRecord
      ])
    );
    const deleted = ref<ConversationHistoryItem[]>([]);
    let acknowledge: (() => void) | undefined;
    let refuse = false;
    let mutationCalls = 0;
    const controller = useAgentConversation({
      api: () => undefined,
      flushPersistence: () => store.flushPersistence(key),
      loadHistoryRecord: async (id) => records.get(id)!,
      historyManagement: {
        listDeleted: async () => deleted.value,
        async delete(id: string) {
          mutationCalls += 1;
          if (refuse) throw new Error("测试：仍有待处理提案");
          await new Promise<void>((resolve) => {
            acknowledge = resolve;
          });
          deleted.value = [
            ...deleted.value,
            [active, older].find((entry) => entry.sessionId === id)!
          ];
        },
        async restore(id: string) {
          deleted.value = deleted.value.filter(
            (entry) => entry.sessionId !== id
          );
          return records.get(id)!;
        }
      }
    });
    await controller.restorePersistenceHistory({
      activeSessionId: active.sessionId,
      active: records.get(active.sessionId)!,
      items: [active, older]
    });
    const history = controller.history;
    controller.draft.value = "尚未保存的测试草稿";
    const exportChunks: string[] = [];
    let exportCount = 0;
    const conversationExport: ConversationExportApi = {
      async begin() {
        return {
          canceled: false,
          token: "9836e2d4-7172-4a1a-b26a-1cfda9d4533a"
        };
      },
      async append({ seq, text }) {
        exportChunks[seq] = text;
        return {
          nextSeq: seq + 1,
          bytes: new TextEncoder().encode(text).byteLength
        };
      },
      async finish() {
        exportCount += 1;
        return {
          fileName: "fixture.json",
          bytes: exportChunks.join("").length
        };
      },
      async cancel() {}
    };
    Object.defineProperty(window, "deepwrite", {
      configurable: true,
      value: { ...window.deepwrite, conversationExport }
    });
    store.controllers = new Map([["probe-owner", controller]]);
    const key = conversationHistoryPersistenceKey("probe-owner");
    const app = createApp({
      render: () =>
        h(
          "div",
          {
            style:
              "display:flex;justify-content:flex-end;gap:16px;padding:32px;"
          },
          [
            h(ConversationSaveStatus, {
              sessionId: controller.sessionId.value
            }),
            h(ConversationHistoryMenu, {
              conversationHistory: history.value,
              currentSessionId: controller.sessionId.value,
              responding: controller.isBusy.value,
              bookScoped: false
            })
          ]
        )
    });
    app.use(pinia);
    app.mount("#app");
    await nextTick();
    let saveResolve: (() => void) | undefined;
    let saveReject: ((reason: Error) => void) | undefined;
    store.configurePersistenceAdapter(
      {
        load: async () => undefined,
        save: async () =>
          new Promise<void>((resolve, reject) => {
            saveResolve = resolve;
            saveReject = reject;
          })
      },
      { debounceMs: 500 }
    );
    const widths: number[] = [];
    const saveLabels: string[] = [];
    async function recordSaveStatus(expected: string) {
      await nextTick();
      const label = document
        .querySelector(".conversation-save-label")!
        .textContent!.trim();
      if (label !== expected)
        throw new Error(`Expected ${expected}, received ${label}`);
      saveLabels.push(label);
      widths.push(
        document
          .querySelector(".conversation-save-status")!
          .getBoundingClientRect().width
      );
    }
    store.schedulePersistence(key, { fixture: true });
    await recordSaveStatus("等待保存");
    const firstFlush = store.flushPersistence(key).catch(() => undefined);
    await recordSaveStatus("正在保存");
    await nextTick();
    saveReject!(new Error("测试保存失败"));
    await firstFlush;
    await recordSaveStatus("保存失败");
    click(".conversation-save-label");
    if (uiMessageItems.value.at(-1)?.content !== "测试保存失败")
      throw new Error("Missing save error feedback");
    click(".conversation-save-export");
    await until(() => exportCount === 1);
    const exported = JSON.parse(exportChunks.join(""));
    const unsavedExport =
      exported.record.draft === "尚未保存的测试草稿" &&
      exported.record.messages.length === 2 &&
      exported.includesUnconfirmedChanges === true &&
      exported.unknownDatabaseFieldsIncluded === false;
    await recordSaveStatus("保存失败");
    click(".conversation-save-retry");
    await recordSaveStatus("保存失败");
    await nextTick();
    saveResolve!();
    await frame();
    await recordSaveStatus("已保存");
    click("[aria-label='历史对话']");
    await nextTick();
    click(".conversation-history-export button");
    await until(() => exportCount === 2);
    click("[aria-label='删除对话：可恢复的测试对话']");
    await until(() => !!document.querySelector("[role='alertdialog']"));
    const confirmationFirst =
      mutationCalls === 0 && !!document.querySelector("[role='alertdialog']");
    click(".conversation-delete-dialog .is-danger");
    await nextTick();
    click(".conversation-delete-dialog .is-danger");
    for (let count = 0; count < 5 && !acknowledge; count += 1) await frame();
    if (!acknowledge)
      throw new Error(
        `Delete did not reach backend: ${uiMessageItems.value.at(-1)?.content}`
      );
    const retainedBeforeAck = history.value.length === 2 && mutationCalls === 1;
    acknowledge!();
    await nextTick();
    await nextTick();
    await frame();
    const deletedAfterAck =
      history.value.length === 1 &&
      !document.querySelector("[role='alertdialog']");
    click(".conversation-history-tabs button:nth-child(2)");
    await nextTick();
    await nextTick();
    await frame();
    click("[aria-label='恢复对话：可恢复的测试对话']");
    await nextTick();
    await nextTick();
    await frame();
    const restored = history.value.length === 2 && deleted.value.length === 0;
    click(".conversation-history-tabs button:first-child");
    await nextTick();
    refuse = true;
    click("[aria-label='删除对话：可恢复的测试对话']");
    await nextTick();
    click(".conversation-delete-dialog .is-danger");
    await nextTick();
    await nextTick();
    await frame();
    const refusalRetained =
      history.value.length === 2 &&
      !!document.querySelector("[role='alertdialog']") &&
      uiMessageItems.value.at(-1)?.content === "测试：仍有待处理提案";
    const themes = [];
    const settings = createDefaultAppearanceSettings();
    for (const scheme of ["light", "dark"] as const)
      for (const size of [10, 14, 24]) {
        applyAppearanceThemeToDocument({
          scheme,
          theme: { ...settings[scheme], uiFontSize: size, accent: "#8B5CF6" },
          uiFontFamily: settings.uiFontFamily,
          editorFontFamily: settings.editorFontFamily
        });
        await frame();
        const dialog = document.querySelector<HTMLElement>(
          ".conversation-delete-dialog"
        )!;
        const panel = document.querySelector<HTMLElement>(
          ".conversation-history-panel"
        )!;
        themes.push({
          scheme,
          size,
          background: getComputedStyle(dialog).backgroundColor,
          text: getComputedStyle(dialog).color,
          clipped:
            dialog.scrollWidth > dialog.clientWidth ||
            panel.scrollWidth > panel.clientWidth
        });
      }
    const result = {
      confirmationFirst,
      retainedBeforeAck,
      deletedAfterAck,
      restored,
      refusalRetained,
      unsavedExport,
      exportCount,
      saveStatusWidths: widths,
      saveLabels,
      themes
    };
    if (
      !confirmationFirst ||
      !retainedBeforeAck ||
      !deletedAfterAck ||
      !restored ||
      !refusalRetained ||
      !unsavedExport ||
      exportCount !== 2 ||
      new Set(widths).size !== 1 ||
      themes.some((theme) => theme.clipped)
    )
      throw new Error(`Management UI regression: ${JSON.stringify(result)}`);
    return result;
  };
