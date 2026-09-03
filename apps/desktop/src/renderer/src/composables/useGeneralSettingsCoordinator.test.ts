import {
  createDefaultGeneralSettings,
  type DeepWriteApi,
  type GeneralSettings
} from "@deepwrite/contracts";
import { ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useGeneralSettingsCoordinator } from "./useGeneralSettingsCoordinator";

type GeneralSettingsApi = Pick<
  DeepWriteApi["generalSettings"],
  "list" | "save"
>;

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function storage(fails = false): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key) => values.get(key) ?? null),
    key: vi.fn((index) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key) => values.delete(key)),
    setItem: vi.fn((key, value) => {
      if (fails) throw new Error("storage unavailable");
      values.set(key, value);
    })
  };
}

function harness(
  overrides: {
    api?: GeneralSettingsApi | null;
    legacyAutoSave?: boolean;
    storage?: Storage;
  } = {}
) {
  const settings = shallowRef<GeneralSettings>(createDefaultGeneralSettings());
  const autoSaveEnabled = ref(false);
  const applyApprovalMode = vi.fn();
  const scheduleDirtyAutoSave = vi.fn();
  const cancelAutoSave = vi.fn();
  const resumeAutomaticAgentEdits = vi.fn();
  const warning = vi.fn();
  const publishLoaded = vi.fn((loaded: GeneralSettings) => {
    settings.value = loaded;
  });
  const root = { lang: "", dataset: {} as DOMStringMap };
  const api: GeneralSettingsApi | undefined =
    overrides.api === null
      ? undefined
      : (overrides.api ?? {
          list: vi.fn(async () => ({
            persisted: true,
            settings: createDefaultGeneralSettings()
          })),
          save: vi.fn(async () => ({
            persisted: true,
            settings: createDefaultGeneralSettings()
          }))
        });
  const coordinator = useGeneralSettingsCoordinator({
    settings,
    autoSaveEnabled,
    api: () => api,
    publishLoaded,
    legacyAutoSave: overrides.legacyAutoSave ?? false,
    storage: overrides.storage ?? storage(),
    documentRoot: root,
    browserLanguage: () => "zh-Hans-CN",
    applyApprovalMode,
    scheduleDirtyAutoSave,
    cancelAutoSave,
    resumeAutomaticAgentEdits,
    notifications: { warning }
  });
  return {
    api,
    applyApprovalMode,
    autoSaveEnabled,
    cancelAutoSave,
    coordinator,
    resumeAutomaticAgentEdits,
    root,
    publishLoaded,
    scheduleDirtyAutoSave,
    settings,
    warning
  };
}

describe("general settings coordinator", () => {
  it("applies local defaults when the desktop API is unavailable", async () => {
    const { coordinator, applyApprovalMode, root } = harness({ api: null });
    await coordinator.load();

    expect(root).toMatchObject({
      lang: "zh-Hans-CN",
      dataset: { appLanguage: "auto" }
    });
    expect(applyApprovalMode).toHaveBeenCalledWith("auto-approve");
  });

  it("migrates an enabled legacy auto-save preference exactly once", async () => {
    const api = {
      list: vi.fn(async () => ({
        persisted: false,
        settings: { ...createDefaultGeneralSettings(), autoSave: false }
      })),
      save: vi.fn(async () => ({
        persisted: true,
        settings: createDefaultGeneralSettings()
      }))
    };
    const { coordinator, settings } = harness({ api, legacyAutoSave: true });

    await coordinator.load();
    await coordinator.drain();

    expect(settings.value.autoSave).toBe(true);
    expect(api.save).toHaveBeenCalledOnce();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ autoSave: true })
    );
  });

  it("serializes immutable setting snapshots", async () => {
    const snapshots: GeneralSettings[] = [];
    const api = {
      list: vi.fn(),
      save: vi.fn(async (value: GeneralSettings) => {
        snapshots.push(value);
        return { persisted: true, settings: value };
      })
    };
    const { coordinator } = harness({ api });

    coordinator.updateLanguage("zh-CN");
    coordinator.updateShowInMenuBar(false);
    coordinator.updateUseNetworkProxy(true);
    coordinator.updateWorkspacePaneLayout("editor-agent");
    coordinator.updateDefaultTextViewMode("preview");
    await coordinator.drain();

    expect(snapshots).toHaveLength(5);
    expect(snapshots[0]).toMatchObject({
      language: "zh-CN",
      showInMenuBar: true
    });
    expect(snapshots[1]).toMatchObject({
      language: "zh-CN",
      showInMenuBar: false
    });
    expect(snapshots[2]).toMatchObject({
      language: "zh-CN",
      showInMenuBar: false,
      useNetworkProxy: true
    });
    expect(snapshots[3]).toMatchObject({
      language: "zh-CN",
      showInMenuBar: false,
      workspacePaneLayout: "editor-agent"
    });
    expect(snapshots[4]).toMatchObject({
      workspacePaneLayout: "editor-agent",
      defaultTextViewMode: "preview"
    });
  });

  it("merges updates made while the initial settings read is pending", async () => {
    const pending = deferred<{
      persisted: boolean;
      settings: GeneralSettings;
    }>();
    const api = {
      list: vi.fn(() => pending.promise),
      save: vi.fn(async (value: GeneralSettings) => ({
        persisted: true,
        settings: value
      }))
    };
    const { coordinator, publishLoaded, settings } = harness({ api });

    const loading = coordinator.load();
    coordinator.updateLanguage("zh-CN");
    coordinator.updateShowInMenuBar(false);
    expect(api.save).not.toHaveBeenCalled();

    pending.resolve({
      persisted: true,
      settings: {
        ...createDefaultGeneralSettings(),
        permissionMode: "request-approval",
        autoSave: false,
        language: "auto",
        showInMenuBar: true
      }
    });
    await loading;
    await coordinator.drain();

    expect(settings.value).toEqual({
      ...createDefaultGeneralSettings(),
      permissionMode: "request-approval",
      autoSave: false,
      language: "zh-CN",
      showInMenuBar: false
    });
    expect(api.save).toHaveBeenCalledOnce();
    expect(api.save).toHaveBeenCalledWith(settings.value);
    expect(publishLoaded).toHaveBeenLastCalledWith(settings.value);
  });

  it("coordinates auto-save side effects and warns when legacy storage fails", () => {
    const localStorage = storage(true);
    const {
      coordinator,
      autoSaveEnabled,
      cancelAutoSave,
      scheduleDirtyAutoSave,
      warning
    } = harness({ storage: localStorage });

    coordinator.updateAutoSave(false);
    expect(autoSaveEnabled.value).toBe(false);
    expect(cancelAutoSave).toHaveBeenCalledOnce();
    coordinator.updateAutoSave(true);
    expect(scheduleDirtyAutoSave).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "自动保存设置已生效，但暂时无法写入本机配置"
    );
  });

  it("resumes automatic edits only after switching to auto approval", async () => {
    const { coordinator, applyApprovalMode, resumeAutomaticAgentEdits } =
      harness();

    coordinator.updatePermissionMode("request-approval");
    await Promise.resolve();
    expect(resumeAutomaticAgentEdits).not.toHaveBeenCalled();
    coordinator.updatePermissionMode("auto-approve");
    await Promise.resolve();

    expect(applyApprovalMode).toHaveBeenLastCalledWith("auto-approve");
    expect(resumeAutomaticAgentEdits).toHaveBeenCalledOnce();
  });

  it("persists cross-stage auto approval without changing proposal approval mode", async () => {
    const { coordinator, settings, api, applyApprovalMode } = harness();

    coordinator.updateAutoApproveCrossStageOperations(true);
    await coordinator.drain();

    expect(settings.value.autoApproveCrossStageOperations).toBe(true);
    expect(settings.value.permissionMode).toBe("auto-approve");
    expect(applyApprovalMode).not.toHaveBeenCalled();
    expect(api?.save).toHaveBeenCalledWith(
      expect.objectContaining({ autoApproveCrossStageOperations: true })
    );
  });

  it("persists context usage visibility independently", async () => {
    const { coordinator, settings, api } = harness();

    coordinator.updateShowContextUsage(false);
    await coordinator.drain();

    expect(settings.value.showContextUsage).toBe(false);
    expect(api?.save).toHaveBeenCalledWith(
      expect.objectContaining({ showContextUsage: false })
    );
  });
});
