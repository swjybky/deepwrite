import type { MarketplaceSession } from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import type { DialogMode } from "../types/workspace";
import type {
  ActiveFeature,
  WorkspaceFeatureHostCoordinator,
  WorkspaceFeatureHostCoordinatorOptions
} from "./workspaceFeatureHostTypes";
import { buildWorkspaceFeatureModule } from "./workspaceFeatureHostModule";
import type { buildSettingsFeatureModule } from "./settingsFeatureModule";
export type {
  ActiveFeature,
  WorkspaceFeatureHostApi,
  WorkspaceFeatureHostCoordinator,
  WorkspaceFeatureHostCoordinatorOptions,
  WorkspaceFeatureHostNotifications
} from "./workspaceFeatureHostTypes";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Owns navigation and render descriptors for the mutually exclusive workspace
 * feature pages. Loader/action ports are deliberately invoked only from public
 * methods so the shell can pass thunks for coordinators declared later.
 */
export function useWorkspaceFeatureHostCoordinator(
  options: WorkspaceFeatureHostCoordinatorOptions
): WorkspaceFeatureHostCoordinator {
  const { settingsStore } = options;
  const marketplaceDisplayName = ref<string>();
  const agentTeamNavigationEpoch = ref(0);
  const knownMarketplaceSession = ref<MarketplaceSession | null>(null);
  let active = true;
  let navigationGeneration = 0;
  let marketplaceRevision = 0;
  let marketplaceRequestGeneration = 0;
  let directoryChooseGeneration = 0;
  let directoryChoosePending = false;
  let buildSettingsModule: typeof buildSettingsFeatureModule | undefined;

  const isLongWorkspaceActive = computed(
    () =>
      options.view.workspaceMain.value === "conversation" &&
      options.view.activeLongBookId.value !== null
  );
  const activeFeature = computed<ActiveFeature>(() =>
    options.view.current.value === "settings"
      ? "settings"
      : isLongWorkspaceActive.value
        ? "long-workspace"
        : options.view.workspaceMain.value
  );

  const workspaceFeatureModule = computed(() =>
    buildWorkspaceFeatureModule(
      activeFeature.value,
      options,
      agentTeamNavigationEpoch.value,
      knownMarketplaceSession.value,
      buildSettingsModule
    )
  );

  const stopLearningErrorWatch = watch(
    () =>
      options.features.learningImitation.controller.value?.error.value ?? null,
    (message) => {
      if (active && message) options.notifications.error(message);
    }
  );
  const stopAuthoringErrorWatch = watch(
    () =>
      options.features.subagentAuthoring.controller.value?.error.value ?? null,
    (message) => {
      if (active && message) options.notifications.error(message);
    }
  );
  const stopLongBookAnalysisErrorWatch = watch(
    () =>
      options.features.longBookAnalysis.controller.value?.error.value ?? null,
    (message) => {
      if (active && message) options.notifications.error(message);
    }
  );

  function beginNavigation(): number {
    return ++navigationGeneration;
  }

  function navigationIsCurrent(generation: number): boolean {
    return active && generation === navigationGeneration;
  }

  function issueBackground(task: () => Promise<unknown>): void {
    try {
      void task().catch(() => undefined);
    } catch {
      // Background loaders own their visible feedback. This guard also keeps a
      // synchronous port failure from escaping a void UI event handler.
    }
  }

  async function canApplyNavigation(generation: number): Promise<boolean> {
    const saved = await options.actions.saveActiveLongEditorBeforeLeaving();
    return saved && navigationIsCurrent(generation);
  }

  function newConversation(): void {
    beginNavigation();
    if (!active) return;
    if (options.view.activeLongBookId.value !== null) {
      options.actions.newLongConversation();
      return;
    }
    options.actions.newShortConversation();
  }

  function showConversation(): void {
    beginNavigation();
    if (active) options.view.workspaceMain.value = "conversation";
  }

  async function openWorkspaceDialog(mode: DialogMode): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    if (mode === "imitation" || mode === "long-book-analysis") {
      try {
        await (mode === "imitation"
          ? options.features.learningImitation.ensureLoaded()
          : options.features.longBookAnalysis.ensureLoaded());
      } catch (error: unknown) {
        if (navigationIsCurrent(generation)) {
          options.notifications.error(
            errorMessage(
              error,
              mode === "imitation"
                ? "加载学习仿写模块失败。"
                : "加载长篇拆书模块失败。"
            )
          );
        }
        return;
      }
      if (!navigationIsCurrent(generation)) return;
    }
    options.view.workspaceMain.value = mode;
    if (mode === "directory" && options.api()) {
      issueBackground(loadWorkspaceDirectory);
    }
    if (
      (mode === "models" ||
        mode === "imitation" ||
        mode === "long-book-analysis" ||
        mode === "style-comparison") &&
      !settingsStore.modelSettings &&
      options.api()
    ) {
      issueBackground(options.loaders.loadModelSettings);
    }
  }

  async function openSettings(initialCategory = "general"): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    try {
      const { loadSettingsFeature } =
        await import("../components/loadSettingsFeature");
      const buildSettings = await loadSettingsFeature();
      if (!navigationIsCurrent(generation)) return;
      buildSettingsModule = buildSettings;
    } catch {
      if (navigationIsCurrent(generation)) {
        options.notifications.error(
          "设置页面加载失败，请稍后重试或重新启动应用。"
        );
      }
      return;
    }
    options.view.settingsInitialCategory.value = initialCategory;
    options.view.current.value = "settings";
    if (!options.api()) return;
    if (initialCategory === "official-models") {
      issueBackground(options.loaders.loadOfficialModels);
    } else if (!settingsStore.modelSettings) {
      issueBackground(options.loaders.loadModelSettings);
    }
    issueBackground(options.loaders.loadWorkspaceAgentSettings);
    issueBackground(options.loaders.loadLibraryAgentSettings);
    issueBackground(options.loaders.loadLearningImitationSettings);
  }

  function openOfficialModelsSettings(): void {
    issueBackground(() => openSettings("official-models"));
  }

  async function openAgentTeams(): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    try {
      await options.features.subagentAuthoring.ensureLoaded();
    } catch (error: unknown) {
      if (navigationIsCurrent(generation)) {
        options.notifications.error(
          errorMessage(error, "加载智能体团队模块失败。")
        );
      }
      return;
    }
    if (!navigationIsCurrent(generation)) return;
    agentTeamNavigationEpoch.value += 1;
    options.view.workspaceMain.value = "agent-team";
    if (options.api() && !settingsStore.agentTeamLoaded) {
      issueBackground(options.loaders.loadAgentTeamSettings);
    }
    if (options.api() && !settingsStore.modelSettings) {
      issueBackground(options.loaders.loadModelSettings);
    }
    if (options.api() && !options.catalogSnapshot.value) {
      issueBackground(options.loaders.loadCatalogSnapshot);
    }
  }

  async function openMarketplace(): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    options.view.workspaceMain.value = "marketplace";
    if (options.api() && !options.catalogSnapshot.value) {
      issueBackground(options.loaders.loadCatalogSnapshot);
    }
  }

  async function openDeviceSync(): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    options.view.workspaceMain.value = "device-sync";
  }

  async function openCloudBackup(): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    options.view.workspaceMain.value = "cloud-backup";
  }

  async function openZhuqueDetection(): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    options.view.workspaceMain.value = "zhuque-detection";
  }

  async function loadWorkspaceDirectory(): Promise<void> {
    const api = options.api();
    if (!active || !api) return;
    try {
      await settingsStore.ensureWorkspaceDirectoryLoaded(() =>
        api.workspaceDirectory.list()
      );
    } catch (error: unknown) {
      if (active) {
        options.notifications.error(errorMessage(error, "加载工作目录失败。"));
      }
    }
  }

  async function chooseWorkspaceDirectory(): Promise<void> {
    const api = options.api();
    if (
      !active ||
      !api ||
      directoryChoosePending ||
      settingsStore.workspaceDirectoryLoading
    ) {
      return;
    }
    const generation = ++directoryChooseGeneration;
    directoryChoosePending = true;
    settingsStore.workspaceDirectoryLoading = true;
    try {
      const settings = await api.workspaceDirectory.choose();
      if (!active || generation !== directoryChooseGeneration || !settings) {
        return;
      }
      settingsStore.markLoaded("workspaceDirectory", settings);
      options.notifications.success("工作目录已切换；现有项目保持原位置不变");
    } catch (error: unknown) {
      if (active && generation === directoryChooseGeneration) {
        options.notifications.error(errorMessage(error, "切换工作目录失败。"));
      }
    } finally {
      if (generation === directoryChooseGeneration) {
        directoryChoosePending = false;
        settingsStore.workspaceDirectoryLoading = false;
      }
    }
  }

  function closeSettings(): void {
    beginNavigation();
    if (active) options.view.current.value = "workspace";
  }

  function applyMarketplaceSession(session: MarketplaceSession): void {
    if (!active) return;
    marketplaceRevision += 1;
    knownMarketplaceSession.value = session;
    marketplaceDisplayName.value = session.authenticated
      ? session.user?.displayName
      : undefined;
  }

  async function loadMarketplaceSession(): Promise<void> {
    const api = options.api()?.marketplace;
    if (!active || !api) return;
    const requestRevision = marketplaceRevision;
    const requestGeneration = ++marketplaceRequestGeneration;
    try {
      const session = await api.session();
      if (
        !active ||
        requestRevision !== marketplaceRevision ||
        requestGeneration !== marketplaceRequestGeneration
      ) {
        return;
      }
      applyMarketplaceSession(session);
    } catch {
      // Startup session discovery is best-effort. The marketplace page owns
      // visible feedback when the user explicitly opens it.
    }
  }

  async function ensureActiveFeatureDependencies(
    feature: ActiveFeature
  ): Promise<void> {
    if (!active || !options.api()) return;
    if (feature === "conversation") {
      await Promise.all([
        options.loaders.loadModelSettings(),
        options.loaders.loadShortAndScriptAgentSettings(),
        options.loaders.loadAgentTeamSettings()
      ]);
      return;
    }
    if (feature === "long-workspace") {
      await Promise.all([
        options.loaders.loadModelSettings(),
        options.loaders.ensureLongAgentSettingsLoaded(),
        options.loaders.loadAgentTeamSettings()
      ]);
      return;
    }
    if (feature === "models") {
      await options.loaders.loadModelSettings();
    }
  }

  function dispose(): void {
    if (!active) return;
    active = false;
    navigationGeneration += 1;
    marketplaceRevision += 1;
    marketplaceRequestGeneration += 1;
    directoryChooseGeneration += 1;
    if (directoryChoosePending) {
      directoryChoosePending = false;
      settingsStore.workspaceDirectoryLoading = false;
    }
    stopLearningErrorWatch();
    stopAuthoringErrorWatch();
    stopLongBookAnalysisErrorWatch();
  }

  return {
    isLongWorkspaceActive,
    activeFeature,
    workspaceFeatureModule,
    marketplaceDisplayName,
    showConversation,
    newConversation,
    openWorkspaceDialog,
    openSettings,
    openOfficialModelsSettings,
    openAgentTeams,
    openMarketplace,
    openDeviceSync,
    openCloudBackup,
    openZhuqueDetection,
    loadWorkspaceDirectory,
    chooseWorkspaceDirectory,
    closeSettings,
    applyMarketplaceSession,
    loadMarketplaceSession,
    ensureActiveFeatureDependencies,
    dispose
  };
}
