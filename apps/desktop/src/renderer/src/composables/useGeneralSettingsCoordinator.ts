import {
  type BodyTextFormatChange,
  type DeepWriteApi,
  type GeneralPermissionMode,
  type GeneralSettings,
  type MoreFeaturesSettings,
  type TextViewMode,
  type WorkspacePaneLayout
} from "@deepwrite/contracts";
import {
  createDefaultGeneralSettings,
  MoreFeaturesSettingsSchema,
  maxTextAttachmentCharactersForBudget
} from "@deepwrite/contracts/renderer";
import type { Ref } from "vue";
import { locale, setAppLanguage, createScopedTranslator } from "../i18n";
import { takeInitialGeneralSettings } from "../i18n/bootstrap";
import { saveGeneralPreferences } from "../utils/generalPreferences";

const t = createScopedTranslator("foundation");

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

function capTextAttachmentLimit(settings: GeneralSettings): GeneralSettings {
  return {
    ...settings,
    textAttachmentMaxCharacters: Math.min(
      settings.textAttachmentMaxCharacters,
      maxTextAttachmentCharactersForBudget(
        settings.contextCompaction.budgetTokens
      )
    )
  };
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
  let saveFailed = false;
  let disposed = false;
  let loading = false;
  let saveRequestedWhileLoading = false;
  let localPatch: Partial<GeneralSettings> = {};
  let bodyTextPatch: Partial<GeneralSettings["bodyTextFormats"]> = {};
  let savedMoreFeatures = options.settings.value.moreFeatures;
  let moreFeaturesRevision = 0;
  let savedMoreFeaturesRevision = 0;
  let saveRevision = 0;

  function applyLanguage(language: GeneralSettings["language"]): void {
    setAppLanguage(language, options.browserLanguage());
    options.documentRoot.lang = locale.value;
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
    const featureRevision = moreFeaturesRevision;
    const revision = ++saveRevision;
    const operation = saveChain
      .catch(() => undefined)
      .then(async () => {
        const saved = await api.save(snapshot);
        savedMoreFeatures = saved.settings.moreFeatures;
        savedMoreFeaturesRevision = featureRevision;
        if (featureRevision > 0 && revision === saveRevision) {
          applyLocalPatch({ moreFeatures: savedMoreFeatures });
        }
        saveFailed = false;
      });
    saveChain = operation.catch((error: unknown) => {
      saveFailed = true;
      const restoredMoreFeatures =
        revision === saveRevision &&
        featureRevision > savedMoreFeaturesRevision;
      if (restoredMoreFeatures) {
        applyLocalPatch({ moreFeatures: savedMoreFeatures });
        savedMoreFeaturesRevision = featureRevision;
      }
      options.notifications.warning(
        error instanceof Error
          ? t(
              restoredMoreFeatures
                ? "moreFeaturesSaveFailedDetail"
                : "saveFailedDetail",
              { message: error.message }
            )
          : t(restoredMoreFeatures ? "moreFeaturesSaveFailed" : "saveFailed")
      );
    });
  }

  function applyLocalPatch(patch: Partial<GeneralSettings>): void {
    localPatch = { ...localPatch, ...patch };
    const next = { ...options.settings.value, ...patch };
    const bounded =
      patch.contextCompaction !== undefined ||
      patch.textAttachmentMaxCharacters !== undefined
        ? capTextAttachmentLimit(next)
        : next;
    if (patch.textAttachmentMaxCharacters !== undefined) {
      localPatch.textAttachmentMaxCharacters =
        bounded.textAttachmentMaxCharacters;
    }
    options.settings.value = bounded;
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
      const snapshot = takeInitialGeneralSettings() ?? (await api.list());
      shouldPersistLegacyAutoSave =
        !snapshot.persisted && options.legacyAutoSave;
      const settings = shouldPersistLegacyAutoSave
        ? { ...snapshot.settings, autoSave: true }
        : snapshot.settings;
      savedMoreFeatures = settings.moreFeatures;
      if (disposed) {
        loading = false;
        return;
      }
      const effectiveSettings = capTextAttachmentLimit({
        ...settings,
        ...localPatch,
        bodyTextFormats: { ...settings.bodyTextFormats, ...bodyTextPatch }
      });
      const shouldSave =
        shouldPersistLegacyAutoSave || saveRequestedWhileLoading;
      loading = false;
      saveRequestedWhileLoading = false;
      localPatch = {};
      bodyTextPatch = {};
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
        error instanceof Error ? error.message : t("loadFailed")
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
      options.notifications.warning(t("autoSaveFailed"));
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

  function updateTaskNotification(enabled: boolean): void {
    applyLocalPatch({ taskNotification: enabled });
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

  function updateTextAttachmentMaxCharacters(value: number): void {
    applyLocalPatch({ textAttachmentMaxCharacters: value });
    queueSave();
  }

  function updateContextCompaction(
    contextCompaction: GeneralSettings["contextCompaction"]
  ): void {
    applyLocalPatch({ contextCompaction });
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

  function updateBodyTextFormat({ kind, format }: BodyTextFormatChange): void {
    bodyTextPatch = { ...bodyTextPatch, [kind]: format };
    applyLocalPatch({
      bodyTextFormats: {
        ...options.settings.value.bodyTextFormats,
        [kind]: format
      }
    });
    queueSave();
  }

  function updateMoreFeatures(moreFeatures: MoreFeaturesSettings): void {
    moreFeaturesRevision += 1;
    applyLocalPatch({
      moreFeatures: MoreFeaturesSettingsSchema.parse(moreFeatures)
    });
    queueSave();
  }

  async function drain(input: { strict?: boolean } = {}): Promise<void> {
    if (input.strict && loading) {
      throw new Error(t("settingsStillLoading"));
    }
    if (input.strict && saveFailed) queueSave();
    let pending: Promise<void>;
    do {
      pending = saveChain;
      await pending;
    } while (pending !== saveChain);
    if (input.strict && saveFailed) {
      throw new Error(t("settingsNotSaved"));
    }
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
    updateBodyTextFormat,
    updateMoreFeatures,
    updateLanguage,
    updatePermissionMode,
    updateShowContextUsage,
    updateTextAttachmentMaxCharacters,
    updateContextCompaction,
    updateShowInMenuBar,
    updateTaskNotification,
    updateUseNetworkProxy,
    updateWorkspacePaneLayout
  };
}

export type GeneralSettingsCoordinator = ReturnType<
  typeof useGeneralSettingsCoordinator
>;
