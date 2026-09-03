import { ref, shallowRef, type Ref } from "vue";
import { defineStore } from "pinia";
import type {
  CloudBackupStatus,
  AgentTeamCatalogSnapshot,
  GeneralSettings,
  LearningImitationSettings,
  LibraryAgentSettings,
  LongAgentSettings,
  ModelSettings,
  ModelUsageDashboard,
  ModelUsageQueryInput,
  OfficialModelBalance,
  SiteOfficialQuota,
  WorkspaceAgentSettings,
  WorkspaceDirectorySettings
} from "@deepwrite/contracts";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_LONG_AGENT_SETTINGS,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  createDefaultGeneralSettings
} from "@deepwrite/contracts";

export type SettingsLoadDomain =
  | "general"
  | "models"
  | "officialModels"
  | "workspaceAgents"
  | "longAgents"
  | "agentTeams"
  | "libraryAgents"
  | "learningImitation"
  | "workspaceDirectory"
  | "cloudBackup";

export interface OfficialModelsSnapshot {
  settings: ModelSettings;
  usageDashboard: ModelUsageDashboard | null;
  balance: OfficialModelBalance | null;
}

export interface SettingsDomainValueMap {
  general: GeneralSettings;
  models: ModelSettings;
  officialModels: OfficialModelsSnapshot;
  workspaceAgents: WorkspaceAgentSettings[];
  longAgents: LongAgentSettings;
  agentTeams: AgentTeamCatalogSnapshot;
  libraryAgents: LibraryAgentSettings;
  learningImitation: LearningImitationSettings;
  workspaceDirectory: WorkspaceDirectorySettings;
  cloudBackup: CloudBackupStatus;
}

export type SettingsLoader<Domain extends SettingsLoadDomain> = () => Promise<
  SettingsDomainValueMap[Domain]
>;

interface DomainLoadState {
  loaded: Ref<boolean>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
}

function cloneDefaultWorkspaceAgentSettings(): WorkspaceAgentSettings[] {
  return [
    structuredClone(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS),
    structuredClone(DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS)
  ];
}

function cloneDefaultLibraryAgentSettings(): LibraryAgentSettings {
  return {
    agents: DEFAULT_LIBRARY_AGENT_PROFILES.map((agent) => ({
      ...agent,
      readAccess: {
        skills: agent.readAccess.skills.map((skill) => ({ ...skill }))
      }
    }))
  };
}

function settingsLoadError(error: unknown): string {
  return error instanceof Error ? error.message : "加载设置失败。";
}

export const useSettingsStore = defineStore("settings", () => {
  const generalSettings = shallowRef<GeneralSettings>(
    createDefaultGeneralSettings()
  );
  const editorAutoSaveEnabled = ref(generalSettings.value.autoSave);
  const generalSettingsLoaded = ref(false);
  const generalSettingsLoading = ref(false);
  const generalSettingsSaving = ref(false);
  const generalSettingsLoadError = ref<string | null>(null);

  const modelSettings = shallowRef<ModelSettings | null>(null);
  const modelLoading = ref(false);
  const modelSaving = ref(false);
  const modelsLoaded = ref(false);
  const freeModelsRefreshing = ref(false);
  const freeModelsSaving = ref(false);
  const siteOfficialModelsRefreshing = ref(false);
  const siteOfficialModelsSaving = ref(false);
  const siteOfficialQuota = shallowRef<SiteOfficialQuota | null>(null);
  const modelError = ref<string | null>(null);
  const modelTestMessage = ref<string | null>(null);
  const testingModelId = ref<string | null>(null);
  const lastModelTestCapacity = shallowRef<{
    modelId: string;
    contextWindow: number;
    maxTokens: number;
  } | null>(null);
  const modelAlertMessages = shallowRef<string[]>([
    "官方模型已经上线！直连厂商！软件整体用量越多，折扣会越大！"
  ]);
  const startupAlertMessages = shallowRef<string[]>([]);
  const startupAlertRevision = ref("");
  const modelUsageDashboard = shallowRef<ModelUsageDashboard | null>(null);
  const modelUsageLoading = ref(false);
  const modelUsageError = ref<string | null>(null);
  const modelUsageQuery = shallowRef<ModelUsageQueryInput>({});

  const officialModelUsageDashboard = shallowRef<ModelUsageDashboard | null>(
    null
  );
  const officialModelBalance = shallowRef<OfficialModelBalance | null>(null);
  const officialModelsLoading = ref(false);
  const officialModelsSaving = ref(false);
  const officialModelsLoaded = ref(false);
  const officialModelsLoadError = ref<string | null>(null);

  const workspaceAgentSettings = shallowRef<WorkspaceAgentSettings[]>(
    cloneDefaultWorkspaceAgentSettings()
  );
  const workspaceAgentLoading = ref(false);
  const workspaceAgentSaving = ref(false);
  const workspaceAgentsLoaded = ref(false);
  const workspaceAgentLoadError = ref<string | null>(null);

  const longAgentSettings = shallowRef<LongAgentSettings>(
    structuredClone(DEFAULT_LONG_AGENT_SETTINGS)
  );
  const longAgentLoading = ref(false);
  const longAgentSaving = ref(false);
  const longAgentLoaded = ref(false);
  const longAgentLoadError = ref<string | null>(null);

  const agentTeamCatalog = shallowRef<AgentTeamCatalogSnapshot | null>(null);
  const agentTeamLoading = ref(false);
  const agentTeamSaving = ref(false);
  const agentTeamLoaded = ref(false);
  const agentTeamLoadError = ref<string | null>(null);

  const libraryAgentSettings = shallowRef<LibraryAgentSettings>(
    cloneDefaultLibraryAgentSettings()
  );
  const libraryAgentLoading = ref(false);
  const libraryAgentSaving = ref(false);
  const libraryAgentsLoaded = ref(false);
  const libraryAgentLoadError = ref<string | null>(null);

  const learningImitationSettings =
    shallowRef<LearningImitationSettings | null>(null);
  const learningImitationLoading = ref(false);
  const learningImitationSaving = ref(false);
  const learningImitationLoaded = ref(false);
  const learningImitationLoadError = ref<string | null>(null);

  const workspaceDirectorySettings =
    shallowRef<WorkspaceDirectorySettings | null>(null);
  const workspaceDirectoryPath = ref<string | null>(null);
  const workspaceDirectoryLoading = ref(false);
  const workspaceDirectoryLoaded = ref(false);
  const workspaceDirectoryLoadError = ref<string | null>(null);

  const cloudBackupStatus = shallowRef<CloudBackupStatus | null>(null);
  const cloudBackupLoading = ref(false);
  const cloudBackupLoaded = ref(false);
  const cloudBackupLoadError = ref<string | null>(null);

  const domainStates: Record<SettingsLoadDomain, DomainLoadState> = {
    general: {
      loaded: generalSettingsLoaded,
      loading: generalSettingsLoading,
      error: generalSettingsLoadError
    },
    models: {
      loaded: modelsLoaded,
      loading: modelLoading,
      error: modelError
    },
    officialModels: {
      loaded: officialModelsLoaded,
      loading: officialModelsLoading,
      error: officialModelsLoadError
    },
    workspaceAgents: {
      loaded: workspaceAgentsLoaded,
      loading: workspaceAgentLoading,
      error: workspaceAgentLoadError
    },
    longAgents: {
      loaded: longAgentLoaded,
      loading: longAgentLoading,
      error: longAgentLoadError
    },
    agentTeams: {
      loaded: agentTeamLoaded,
      loading: agentTeamLoading,
      error: agentTeamLoadError
    },
    libraryAgents: {
      loaded: libraryAgentsLoaded,
      loading: libraryAgentLoading,
      error: libraryAgentLoadError
    },
    learningImitation: {
      loaded: learningImitationLoaded,
      loading: learningImitationLoading,
      error: learningImitationLoadError
    },
    workspaceDirectory: {
      loaded: workspaceDirectoryLoaded,
      loading: workspaceDirectoryLoading,
      error: workspaceDirectoryLoadError
    },
    cloudBackup: {
      loaded: cloudBackupLoaded,
      loading: cloudBackupLoading,
      error: cloudBackupLoadError
    }
  };

  const loadPromises = new Map<SettingsLoadDomain, Promise<unknown>>();
  const loadEpochs: Record<SettingsLoadDomain, number> = {
    general: 0,
    models: 0,
    officialModels: 0,
    workspaceAgents: 0,
    longAgents: 0,
    agentTeams: 0,
    libraryAgents: 0,
    learningImitation: 0,
    workspaceDirectory: 0,
    cloudBackup: 0
  };

  function valueFor<Domain extends SettingsLoadDomain>(
    domain: Domain
  ): SettingsDomainValueMap[Domain] {
    switch (domain) {
      case "general":
        return generalSettings.value as SettingsDomainValueMap[Domain];
      case "models":
        return modelSettings.value as SettingsDomainValueMap[Domain];
      case "officialModels":
        return {
          settings: modelSettings.value,
          usageDashboard: officialModelUsageDashboard.value,
          balance: officialModelBalance.value
        } as SettingsDomainValueMap[Domain];
      case "workspaceAgents":
        return workspaceAgentSettings.value as SettingsDomainValueMap[Domain];
      case "longAgents":
        return longAgentSettings.value as SettingsDomainValueMap[Domain];
      case "agentTeams":
        return agentTeamCatalog.value as SettingsDomainValueMap[Domain];
      case "libraryAgents":
        return libraryAgentSettings.value as SettingsDomainValueMap[Domain];
      case "learningImitation":
        return learningImitationSettings.value as SettingsDomainValueMap[Domain];
      case "workspaceDirectory":
        return workspaceDirectorySettings.value as SettingsDomainValueMap[Domain];
      case "cloudBackup":
        return cloudBackupStatus.value as SettingsDomainValueMap[Domain];
    }
  }

  function applyValue<Domain extends SettingsLoadDomain>(
    domain: Domain,
    value: SettingsDomainValueMap[Domain]
  ): void {
    switch (domain) {
      case "general": {
        const settings = value as SettingsDomainValueMap["general"];
        generalSettings.value = settings;
        editorAutoSaveEnabled.value = settings.autoSave;
        break;
      }
      case "models":
        modelSettings.value = value as SettingsDomainValueMap["models"];
        break;
      case "officialModels": {
        const snapshot = value as SettingsDomainValueMap["officialModels"];
        // Official refreshes also return the complete model configuration.
        // Supersede an older in-flight models request so it cannot overwrite
        // the newer official snapshot when it resolves late.
        markLoaded("models", snapshot.settings);
        officialModelUsageDashboard.value = snapshot.usageDashboard;
        officialModelBalance.value = snapshot.balance;
        break;
      }
      case "workspaceAgents":
        workspaceAgentSettings.value =
          value as SettingsDomainValueMap["workspaceAgents"];
        break;
      case "longAgents":
        longAgentSettings.value = value as SettingsDomainValueMap["longAgents"];
        break;
      case "agentTeams":
        agentTeamCatalog.value = value as SettingsDomainValueMap["agentTeams"];
        break;
      case "libraryAgents":
        libraryAgentSettings.value =
          value as SettingsDomainValueMap["libraryAgents"];
        break;
      case "learningImitation":
        learningImitationSettings.value =
          value as SettingsDomainValueMap["learningImitation"];
        break;
      case "workspaceDirectory": {
        const settings = value as SettingsDomainValueMap["workspaceDirectory"];
        workspaceDirectorySettings.value = settings;
        workspaceDirectoryPath.value = settings.path;
        break;
      }
      case "cloudBackup":
        cloudBackupStatus.value =
          value as SettingsDomainValueMap["cloudBackup"];
        break;
    }
  }

  function ensureLoaded<Domain extends SettingsLoadDomain>(
    domain: Domain,
    loader: SettingsLoader<Domain>
  ): Promise<SettingsDomainValueMap[Domain]> {
    const state = domainStates[domain];
    if (state.loaded.value) {
      return Promise.resolve(valueFor(domain));
    }
    const existing = loadPromises.get(domain);
    if (existing) {
      return existing as Promise<SettingsDomainValueMap[Domain]>;
    }

    const epoch = loadEpochs[domain];
    state.loading.value = true;
    state.error.value = null;
    const pending = loader()
      .then((value) => {
        if (loadEpochs[domain] === epoch) {
          applyValue(domain, value);
          state.loaded.value = true;
        }
        return value;
      })
      .catch((error: unknown) => {
        if (loadEpochs[domain] === epoch) {
          state.loaded.value = false;
          state.error.value = settingsLoadError(error);
        }
        throw error;
      })
      .finally(() => {
        if (loadPromises.get(domain) === pending) {
          loadPromises.delete(domain);
          state.loading.value = false;
        }
      });
    loadPromises.set(domain, pending);
    return pending;
  }

  function invalidate(domain: SettingsLoadDomain): void {
    loadEpochs[domain] += 1;
    loadPromises.delete(domain);
    const state = domainStates[domain];
    state.loaded.value = false;
    state.loading.value = false;
    state.error.value = null;
  }

  function markLoaded<Domain extends SettingsLoadDomain>(
    domain: Domain,
    value?: SettingsDomainValueMap[Domain]
  ): void {
    loadEpochs[domain] += 1;
    loadPromises.delete(domain);
    if (value !== undefined) {
      applyValue(domain, value);
    }
    const state = domainStates[domain];
    state.loaded.value = true;
    state.loading.value = false;
    state.error.value = null;
  }

  function ensureModelsLoaded(loader: SettingsLoader<"models">) {
    return ensureLoaded("models", loader);
  }

  function ensureOfficialModelsLoaded(
    loader: SettingsLoader<"officialModels">
  ) {
    return ensureLoaded("officialModels", loader);
  }

  function ensureWorkspaceAgentsLoaded(
    loader: SettingsLoader<"workspaceAgents">
  ) {
    return ensureLoaded("workspaceAgents", loader);
  }

  function ensureLongAgentsLoaded(loader: SettingsLoader<"longAgents">) {
    return ensureLoaded("longAgents", loader);
  }

  function ensureAgentTeamsLoaded(loader: SettingsLoader<"agentTeams">) {
    return ensureLoaded("agentTeams", loader);
  }

  function ensureLibraryAgentsLoaded(loader: SettingsLoader<"libraryAgents">) {
    return ensureLoaded("libraryAgents", loader);
  }

  function ensureLearningImitationLoaded(
    loader: SettingsLoader<"learningImitation">
  ) {
    return ensureLoaded("learningImitation", loader);
  }

  function ensureWorkspaceDirectoryLoaded(
    loader: SettingsLoader<"workspaceDirectory">
  ) {
    return ensureLoaded("workspaceDirectory", loader);
  }

  function ensureCloudBackupLoaded(loader: SettingsLoader<"cloudBackup">) {
    return ensureLoaded("cloudBackup", loader);
  }

  return {
    generalSettings,
    editorAutoSaveEnabled,
    generalSettingsLoaded,
    generalSettingsLoading,
    generalSettingsSaving,
    generalSettingsLoadError,
    modelSettings,
    modelLoading,
    modelSaving,
    modelsLoaded,
    freeModelsRefreshing,
    freeModelsSaving,
    siteOfficialModelsRefreshing,
    siteOfficialModelsSaving,
    siteOfficialQuota,
    modelError,
    modelTestMessage,
    testingModelId,
    lastModelTestCapacity,
    modelAlertMessages,
    startupAlertMessages,
    startupAlertRevision,
    modelUsageDashboard,
    modelUsageLoading,
    modelUsageError,
    modelUsageQuery,
    officialModelUsageDashboard,
    officialModelBalance,
    officialModelsLoading,
    officialModelsSaving,
    officialModelsLoaded,
    officialModelsLoadError,
    workspaceAgentSettings,
    workspaceAgentLoading,
    workspaceAgentSaving,
    workspaceAgentsLoaded,
    workspaceAgentLoadError,
    longAgentSettings,
    longAgentLoading,
    longAgentSaving,
    longAgentLoaded,
    longAgentLoadError,
    agentTeamCatalog,
    agentTeamLoading,
    agentTeamSaving,
    agentTeamLoaded,
    agentTeamLoadError,
    libraryAgentSettings,
    libraryAgentLoading,
    libraryAgentSaving,
    libraryAgentsLoaded,
    libraryAgentLoadError,
    learningImitationSettings,
    learningImitationLoading,
    learningImitationSaving,
    learningImitationLoaded,
    learningImitationLoadError,
    workspaceDirectorySettings,
    workspaceDirectoryPath,
    workspaceDirectoryLoading,
    workspaceDirectoryLoaded,
    workspaceDirectoryLoadError,
    cloudBackupStatus,
    cloudBackupLoading,
    cloudBackupLoaded,
    cloudBackupLoadError,
    ensureLoaded,
    ensureModelsLoaded,
    ensureOfficialModelsLoaded,
    ensureWorkspaceAgentsLoaded,
    ensureLongAgentsLoaded,
    ensureAgentTeamsLoaded,
    ensureLibraryAgentsLoaded,
    ensureLearningImitationLoaded,
    ensureWorkspaceDirectoryLoaded,
    ensureCloudBackupLoaded,
    invalidate,
    markLoaded
  };
});
