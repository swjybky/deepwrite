import {
  createDefaultGeneralSettings,
  type DeepWriteApi,
  type GeneralPermissionMode,
  type GeneralSettings,
  type TextViewMode,
  type WorkspacePaneLayout
} from "@deepwrite/contracts";
import type { Ref } from "vue";
import { saveGeneralPreferences } from "../utils/generalPreferences";

type GeneralSettingsApi = Pick<
  DeepWriteApi["generalSettings"],
  "list" | "save"
>;

export interface GeneralSettingsNotifications {
  warning(message: string): void;
}

export interface GeneralSettingsDocumentRoot {
  lang: string;
  dataset: DOMStringMap;
}

export interface GeneralSettingsCoordinatorOptions {
  settings: Ref<GeneralSettings>;
  autoSaveEnabled: Ref<boolean>;
  api(): GeneralSettingsApi | undefined;
  publishLoaded(settings: GeneralSettings): void;
  legacyAutoSave: boolean;
  storage: Storage;
  documentRoot: GeneralSettingsDocumentRoot;
  browserLanguage(): string;
  applyApprovalMode(permissionMode: GeneralPermissionMode): void;
  scheduleDirtyAutoSave(): void;
  cancelAutoSave(): void;
  resumeAutomaticAgentEdits(): void;
  notifications: GeneralSettingsNotifications;
}

/** Owns general-setting initialization, serialized persistence, and side effects. */
export function useGeneralSettingsCoordinator(
  options: GeneralSettingsCoordinatorOptions
) {
  options.settings.value = {
    ...createDefaultGeneralSettings(),
    autoSave: options.legacyAutoSave
  };
  options.autoSaveEnabled.value = options.settings.value.autoSave;
  let saveChain: Promise<void> = Promise.resolve();
  let disposed = false;
  let loading = false;
  let saveRequestedWhileLoading = false;
  let localPatch: Partial<GeneralSettings> = {};

  function applyLanguage(language: GeneralSettings["language"]): void {
    const browserLanguage = options.browserLanguage();
    const resolvedLanguage =
      language === "auto" && browserLanguage.toLowerCase().startsWith("zh")
        ? browserLanguage
        : "zh-CN";
    options.documentRoot.lang = resolvedLanguage;
    options.documentRoot.dataset.appLanguage = language;
  }

  function queueSave(): void {
    if (loading) {
      saveRequestedWhileLoading = true;
      return;
    }
    const api = options.api();
    if (!api || disposed) return;
    const snapshot = { ...options.settings.value };
    const operation = saveChain
      .catch(() => undefined)
      .then(async () => {
        await api.save(snapshot);
      });
    saveChain = operation.catch((error: unknown) => {
      options.notifications.warning(
        error instanceof Error
          ? `常规设置已在本次运行中生效，但写入本机失败：${error.message}`
          : "常规设置已在本次运行中生效，但暂时无法写入本机"
      );
    });
  }

  function applyLocalPatch(patch: Partial<GeneralSettings>): void {
    localPatch = { ...localPatch, ...patch };
    options.settings.value = { ...options.settings.value, ...patch };
  }

  async function load(): Promise<void> {
    const api = options.api();
    if (!api) {
      applyLanguage(options.settings.value.language);
      options.applyApprovalMode(options.settings.value.permissionMode);
      options.publishLoaded(options.settings.value);
      return;
    }
    loading = true;
    try {
      let shouldPersistLegacyAutoSave = false;
      const snapshot = await api.list();
      shouldPersistLegacyAutoSave =
        !snapshot.persisted && options.legacyAutoSave;
      const settings = shouldPersistLegacyAutoSave
        ? { ...snapshot.settings, autoSave: true }
        : snapshot.settings;
      if (disposed) {
        loading = false;
        return;
      }
      const effectiveSettings = { ...settings, ...localPatch };
      const shouldSave =
        shouldPersistLegacyAutoSave || saveRequestedWhileLoading;
      loading = false;
      saveRequestedWhileLoading = false;
      localPatch = {};
      options.settings.value = effectiveSettings;
      options.autoSaveEnabled.value = effectiveSettings.autoSave;
      options.publishLoaded(effectiveSettings);
      applyLanguage(effectiveSettings.language);
      options.applyApprovalMode(effectiveSettings.permissionMode);
      if (shouldSave) queueSave();
    } catch (error: unknown) {
      loading = false;
      const shouldSave = saveRequestedWhileLoading;
      saveRequestedWhileLoading = false;
      if (disposed) return;
      applyLanguage(options.settings.value.language);
      options.applyApprovalMode(options.settings.value.permissionMode);
      options.notifications.warning(
        error instanceof Error
          ? error.message
          : "加载常规设置失败，已使用默认设置"
      );
      options.publishLoaded(options.settings.value);
      if (shouldSave) queueSave();
    }
  }

  function updatePermissionMode(permissionMode: GeneralPermissionMode): void {
    applyLocalPatch({ permissionMode });
    options.applyApprovalMode(permissionMode);
    queueSave();
    if (permissionMode === "auto-approve") {
      queueMicrotask(() => {
        if (!disposed) options.resumeAutomaticAgentEdits();
      });
    }
  }

  function updateAutoApproveCrossStageOperations(enabled: boolean): void {
    applyLocalPatch({ autoApproveCrossStageOperations: enabled });
    queueSave();
  }

  function updateAutoSave(enabled: boolean): void {
    options.autoSaveEnabled.value = enabled;
    applyLocalPatch({ autoSave: enabled });
    if (!saveGeneralPreferences(options.storage, { autoSave: enabled })) {
      options.notifications.warning(
        "自动保存设置已生效，但暂时无法写入本机配置"
      );
    }
    queueSave();
    if (enabled) options.scheduleDirtyAutoSave();
    else options.cancelAutoSave();
  }

  function updateLanguage(language: GeneralSettings["language"]): void {
    applyLocalPatch({ language });
    applyLanguage(language);
    queueSave();
  }

  function updateShowInMenuBar(enabled: boolean): void {
    applyLocalPatch({ showInMenuBar: enabled });
    queueSave();
  }

  function updateUseNetworkProxy(enabled: boolean): void {
    applyLocalPatch({ useNetworkProxy: enabled });
    queueSave();
  }

  function updateShowContextUsage(enabled: boolean): void {
    applyLocalPatch({ showContextUsage: enabled });
    queueSave();
  }

  function updateWorkspacePaneLayout(layout: WorkspacePaneLayout): void {
    applyLocalPatch({ workspacePaneLayout: layout });
    queueSave();
  }

  function updateDefaultTextViewMode(mode: TextViewMode): void {
    applyLocalPatch({ defaultTextViewMode: mode });
    queueSave();
  }

  async function drain(): Promise<void> {
    await saveChain;
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    await drain();
  }

  return {
    applyLanguage,
    dispose,
    drain,
    load,
    updateAutoApproveCrossStageOperations,
    updateAutoSave,
    updateDefaultTextViewMode,
    updateLanguage,
    updatePermissionMode,
    updateShowContextUsage,
    updateShowInMenuBar,
    updateUseNetworkProxy,
    updateWorkspacePaneLayout
  };
}

export type GeneralSettingsCoordinator = ReturnType<
  typeof useGeneralSettingsCoordinator
>;
