import "./analysis-probe-i18n";
import { createApp, h, nextTick, reactive, ref } from "vue";
import { createPinia } from "pinia";
import type {
  DeepWriteApi,
  DocumentVersionSummary,
  DocumentVersionsApi
} from "@deepwrite/contracts";
import DocumentVersionDialog from "../../src/renderer/src/components/DocumentVersionDialog.vue";
import GeneralSettingsPanel from "../../src/renderer/src/components/GeneralSettingsPanel.vue";
import EditorTextTools from "../../src/renderer/src/components/EditorTextTools.vue";
import ToastHost from "../../src/renderer/src/components/ToastHost.vue";
import { useGeneralSettingsCoordinator } from "../../src/renderer/src/composables/useGeneralSettingsCoordinator";
import {
  applyAppearanceThemeToDocument,
  defaultAppearanceTheme
} from "../../src/renderer/src/composables/appearanceThemeRuntime";
import { createDefaultGeneralSettings } from "@deepwrite/contracts/renderer";
import "../../src/renderer/src/styles.css";
import {
  uiMessageItems,
  dismissUiMessage
} from "../../src/renderer/src/ui-feedback";

const original =
  "# 第三章\n\n林晚推开旧木门，雨声落在她身后。\n她停下脚步，望向空荡的庭院。";
const amended =
  "# 第三章\n\n林晚猛地推开旧木门，雨水溅上她的衣袖。\n庭院里，一盏灯还亮着。\n她握紧了袖中的信。";
const current = `${amended}\n\n手写补充：远处传来脚步声。`;
const target = {
  workspace: "catalog",
  bookId: "probe-book",
  documentId: "probe-document"
} as const;
const state = reactive({
  shown: true,
  settings: false,
  busy: false,
  content: current,
  sha: "3".repeat(64),
  unsaved: false
});
let records: DocumentVersionSummary[] = [];
let contents = new Map<string, string>();
let reads: string[] = [];
let restores = 0;
const version = (
  seq: number,
  content: string,
  kind: DocumentVersionSummary["kind"]
): DocumentVersionSummary => ({
  id: `v${seq}-${String(seq).padStart(8, "0")}`,
  seq,
  kind,
  createdAt: "2026-11-11T12:32:00.000Z",
  updatedAt: "2026-11-11T12:33:00.000Z",
  sha256: String(seq).repeat(64),
  charCount: content.length,
  ...(kind === "conversation"
    ? {
        origin: {
          sessionId: "probe-session",
          runId: "probe-run",
          summary: "把第三章的开场改得更紧凑"
        }
      }
    : {}),
  ...(kind === "restore" ? { restoredFromSeq: 1 } : {})
});
function reset(empty = false) {
  records = empty
    ? []
    : [
        version(2, amended, "conversation"),
        version(1, original, "pre_conversation")
      ];
  contents = new Map(
    records.map((entry) => [entry.id, entry.seq === 1 ? original : amended])
  );
  state.content = empty ? "" : current;
  state.sha = "3".repeat(64);
  state.busy = false;
  state.unsaved = false;
  reads = [];
}
reset();
const api: DocumentVersionsApi = {
  list: async () => ({
    versions: [...records],
    current: { sha256: state.sha, charCount: state.content.length }
  }),
  read: async ({ versionId }) => {
    reads.push(versionId);
    return {
      version: records.find(({ id }) => id === versionId)!,
      content: contents.get(versionId)!
    };
  },
  restore: async ({ versionId, expectedCurrentSha256 }) => {
    if (expectedCurrentSha256 !== state.sha)
      throw { code: "version.conflict", message: "Changed" };
    const chosen = records.find(({ id }) => id === versionId)!;
    const next = version(
      records.length + 1,
      contents.get(versionId)!,
      "restore"
    );
    next.restoredFromSeq = chosen.seq;
    records.unshift(next);
    contents.set(next.id, contents.get(versionId)!);
    state.sha = next.sha256;
    restores++;
    return {
      workspace: "catalog",
      version: next,
      current: { sha256: next.sha256, charCount: next.charCount },
      document: {
        id: target.documentId,
        title: "第三章",
        content: contents.get(versionId)!,
        projectRevision: restores + 1,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt
      }
    };
  }
};
window.deepwrite = { versions: api } as DeepWriteApi;
const settings = ref(createDefaultGeneralSettings());
const autoSaveEnabled = ref(false);
const coordinator = useGeneralSettingsCoordinator({
  settings,
  autoSaveEnabled,
  api: () => ({
    list: async () => ({
      persisted: true,
      settings: createDefaultGeneralSettings()
    }),
    save: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { persisted: true, settings: input };
    }
  }),
  publishLoaded: () => {},
  legacyAutoSave: false,
  storage: localStorage,
  documentRoot: document.documentElement,
  browserLanguage: () => "zh-CN",
  applyApprovalMode: () => {},
  scheduleDirtyAutoSave: () => {},
  cancelAutoSave: () => {},
  resumeAutomaticAgentEdits: () => {},
  notifications: { warning: () => {} }
});
createApp({
  render: () =>
    h("main", { style: "padding: 24px; color: var(--text-primary);" }, [
      h(ToastHost),
      state.settings
        ? h(GeneralSettingsPanel, {
            permissionMode: "request-approval",
            autoApproveCrossStageOperations: false,
            autoSaveEnabled: false,
            versionHistoryEnabled: settings.value.versionHistoryEnabled,
            language: "zh-CN",
            showInMenuBar: false,
            taskNotification: false,
            useNetworkProxy: false,
            workspacePaneLayout: "agent-editor",
            onUpdateVersionHistoryEnabled:
              coordinator.generalSwitchEvents.updateVersionHistoryEnabled
          })
        : h("div", { style: "display:flex;" }, [
            h(EditorTextTools, {
              canUndo: false,
              canRedo: false,
              findPanelOpen: false,
              findPanelMode: "find",
              versionVisible: true,
              onVersions: () => {
                state.shown = true;
              }
            })
          ]),
      state.shown && !state.settings
        ? h(DocumentVersionDialog, {
            target,
            title: "第三章",
            currentContent: state.content,
            busy: state.busy,
            unsaved: state.unsaved,
            autoSave: true,
            prepareRestore: async () => true,
            applyRestore: (result) => {
              if (result.workspace === "catalog")
                state.content = result.document.content;
            },
            onClose: () => {
              state.shown = false;
            }
          })
        : null
    ])
})
  .use(createPinia())
  .mount("#app");
const frame = async () => {
  await nextTick();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function button(text: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button")
  ].find((element) => element.textContent?.trim() === text);
  check(found, `Missing button: ${text}`);
  return found;
}
async function choose(seq: number) {
  const item = [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".document-version-list button"
    )
  ].find((element) => element.textContent?.trim().startsWith(`v${seq} `));
  check(item, `Missing version ${seq}`);
  item.click();
  await frame();
}
function metrics() {
  const box = document
    .querySelector<HTMLElement>(".document-version-dialog")
    ?.getBoundingClientRect();
  const overflow = [
    ...document.querySelectorAll<HTMLElement>(
      ".document-version-dialog footer button, .document-version-modes"
    )
  ].filter((element) => {
    const bounds = element.getBoundingClientRect();
    return (
      bounds.left < 0 ||
      bounds.right > innerWidth + 1 ||
      bounds.top < 0 ||
      bounds.bottom > innerHeight + 1
    );
  }).length;
  return {
    width: innerWidth,
    height: innerHeight,
    top: box?.top,
    bottom: box?.bottom,
    overflow,
    selected: document
      .querySelector(".document-version-list [aria-current=true]")
      ?.textContent?.trim()
  };
}
Object.assign(window, {
  async showDocumentVersionsProbe(
    scheme: "light" | "dark",
    size: number,
    view: string
  ) {
    state.shown = false;
    state.settings = false;
    await frame();
    reset(view === "empty" || view === "unversioned");
    if (view === "unversioned") state.content = current;
    for (const message of uiMessageItems.value) dismissUiMessage(message.id);
    applyAppearanceThemeToDocument({
      scheme,
      theme: { ...defaultAppearanceTheme(scheme), uiFontSize: size },
      uiFontFamily: "system",
      editorFontFamily: "song"
    });
    state.shown = true;
    await frame();
    await frame();
    if (view === "full" || view === "confirm") await choose(1);
    if (view === "full") {
      button("完整内容").click();
      await frame();
    }
    if (view === "confirm") {
      button("回退到此版本").click();
      await frame();
    }
    return metrics();
  },
  async runDocumentVersionsProbe() {
    state.shown = false;
    await frame();
    reset(true);
    state.content = current;
    state.shown = true;
    await frame();
    await frame();
    check(
      document
        .querySelector(".document-version-text")
        ?.textContent?.includes("暂无历史版本，无法对比当前内容。"),
      "Missing history must show an unavailable comparison instead of an empty baseline"
    );
    check(
      !document.querySelector(".document-version-text .edit-diff-line"),
      "Unversioned content must not be marked as additions"
    );
    button("完整内容").click();
    await frame();
    check(
      document.querySelector(".document-version-text pre")?.textContent ===
        current,
      "Unversioned full content must remain available"
    );
    state.shown = false;
    await frame();
    reset();
    state.shown = true;
    await frame();
    await frame();
    check(
      document
        .querySelector(".document-version-list button")
        ?.textContent?.includes("当前内容"),
      "Current must be first"
    );
    check(
      document
        .querySelector(".document-version-list button")
        ?.textContent?.includes("有尚未入版本"),
      "Unsaved disk content must be marked"
    );
    await choose(2);
    check(
      reads.slice(-2).join() === "v2-00000002,v1-00000001",
      "Read only selection and predecessor"
    );
    button("完整内容").click();
    await frame();
    check(
      document.querySelector(".document-version-text pre")?.textContent ===
        amended,
      "Full content mismatch"
    );
    state.busy = true;
    await frame();
    check(button("回退到此版本").disabled, "Busy work must block restore");
    state.busy = false;
    await choose(1);
    button("回退到此版本").click();
    await frame();
    check(
      document.querySelector('[role="alertdialog"]'),
      "Confirmation required"
    );
    button("回退").click();
    await frame();
    await frame();
    check(
      state.content === original && restores === 1,
      "Restore must refresh editor content"
    );
    check(
      document
        .querySelector(".document-version-list [aria-current=true]")
        ?.textContent?.includes("回退"),
      "Select new restore record"
    );
    state.shown = false;
    state.settings = true;
    await frame();
    const toggle = document.querySelector<HTMLInputElement>(
      'input[role="switch"]'
    )!;
    check(!toggle.checked, "History defaults off");
    const other = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    ].filter((input) => input !== toggle);
    const samples: {
      checked: boolean;
      disabled: boolean;
      opacity: string;
      height: number;
    }[] = [];
    const timer = setInterval(
      () =>
        samples.push({
          checked: toggle.checked,
          disabled: other.some((input) => input.disabled),
          opacity: getComputedStyle(toggle.closest("label")!).opacity,
          height: toggle.closest("label")!.getBoundingClientRect().height
        }),
      8
    );
    toggle.click();
    await coordinator.drain();
    await new Promise((resolve) => setTimeout(resolve, 30));
    clearInterval(timer);
    check(
      samples.length >= 8 &&
        samples.every(
          (sample) =>
            sample.checked && !sample.disabled && sample.opacity === "1"
        ),
      "Toggle must stay optimistic without disabling other controls"
    );
    check(
      new Set(samples.map(({ height }) => height)).size === 1,
      "Setting layout must stay stable"
    );
    return {
      restores,
      fullContent: true,
      adjacentReads: true,
      busyGuard: true,
      confirmation: true,
      unversionedComparison: true,
      settingSamples: samples.length,
      settingStable: true
    };
  }
});
