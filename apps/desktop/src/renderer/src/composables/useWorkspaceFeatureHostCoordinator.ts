import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { watchFeatureErrors } from "./workspaceFeatureErrors";
import type { MarketplaceSession } from "@deepwrite/contracts";
import { computed, ref } from "vue";
import type { DialogMode } from "../types/workspace";
import type {
  ActiveFeature,
  WorkspaceFeatureHostCoordinator,
  WorkspaceFeatureHostCoordinatorOptions
} from "./workspaceFeatureHostTypes";
import { buildWorkspaceFeatureModule } from "./workspaceFeatureHostModule";
import { useMarketplaceDisplayName } from "./useMarketplaceDisplayName";
import { useWorkspaceDirectorySettings } from "./useWorkspaceDirectorySettings";
import type { buildSettingsFeatureModule } from "./settingsFeatureModule";
import { longMaterialPackLaunchBookId } from "../stores/longMaterialPackActivity";

const t = createScopedTranslator("workspace.workspaceFeatureHostCoordinator");
export type {
  ActiveFeature,
  WorkspaceFeatureHostApi,
  WorkspaceFeatureHostCoordinator,
  WorkspaceFeatureHostCoordinatorOptions,
  WorkspaceFeatureHostNotifications
} from "./workspaceFeatureHostTypes";

function errorMessage(error: unknown, fallback: string): string {
  return formatError(error, fallback);
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
  const { marketplaceDisplayName, applyDisplayName } =
    useMarketplaceDisplayName();
  const agentTeamNavigationEpoch = ref(0);
  const knownMarketplaceSession = ref<MarketplaceSession | null>(null);
  let active = true;
  let navigationGeneration = 0;
  let marketplaceRevision = 0;
  let marketplaceRequestGeneration = 0;
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

  const stopFeatureErrors = watchFeatureErrors(options, () => active);
  const directorySettings = useWorkspaceDirectorySettings(options);
  const {
    loadWorkspaceDirectory,
    chooseWorkspaceDirectory,
    resetWorkspaceDirectory
  } = directorySettings;

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

  /** Opens 长篇转素材库 with a book already chosen, e.g. from decomposition. */
  async function openMaterialPack(bookId: string): Promise<void> {
    longMaterialPackLaunchBookId.value = bookId;
    await openWorkspaceDialog("long-material-pack");
  }

  async function openWorkspaceDialog(mode: DialogMode): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    if (
      mode === "long-book-analysis" ||
      mode === "long-book-decomposition" ||
      mode === "revision-analysis" ||
      mode === "short-book-analysis"
    ) {
      try {
        await (mode === "long-book-decomposition"
          ? options.features.longBookDecomposition?.ensureLoaded()
          : mode === "revision-analysis"
            ? options.features.revisionAnalysis.ensureLoaded()
            : mode === "short-book-analysis"
              ? options.features.shortBookAnalysis.ensureLoaded()
              : options.features.longBookAnalysis.ensureLoaded());
      } catch (error: unknown) {
        if (navigationIsCurrent(generation)) {
          options.notifications.error(
            errorMessage(
              error,
              mode === "revision-analysis"
                ? t("couldNotLoadTheRevisionAnalysisModule")
                : mode === "short-book-analysis"
                  ? t("couldNotLoadTheShortStoryAnalysisModule")
                  : t("couldNotLoadTheLongFormAnalysisModule")
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
      (mode === "long-book-analysis" ||
        mode === "long-book-decomposition" ||
        mode === "revision-analysis" ||
        mode === "short-book-analysis" ||
        mode === "style-comparison" ||
        mode === "long-material-pack" ||
        mode === "book-identity") &&
      (!settingsStore.modelSettings || mode === "book-identity") &&
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
          t("couldNotLoadSettingsTryAgainShortlyOrRestart")
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
    issueBackground(loadWorkspaceDirectory);
    issueBackground(options.loaders.loadWorkspaceAgentSettings);
    issueBackground(options.loaders.loadLibraryAgentSettings);
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
          errorMessage(error, t("couldNotLoadTheAgentTeamsModule"))
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

  async function openAgentTeamMarketplace(): Promise<void> {
    const generation = beginNavigation();
    if (!(await canApplyNavigation(generation))) return;
    options.view.workspaceMain.value = "agent-team-marketplace";
    if (options.api() && !settingsStore.agentTeamLoaded) {
      issueBackground(options.loaders.loadAgentTeamSettings);
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

  function closeSettings(): void {
    beginNavigation();
    if (active) options.view.current.value = "workspace";
  }

  function applyMarketplaceSession(session: MarketplaceSession): void {
    if (!active) return;
    marketplaceRevision += 1;
    knownMarketplaceSession.value = session;
    applyDisplayName(session);
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
  }

  function dispose(): void {
    if (!active) return;
    active = false;
    stopFeatureErrors();
    navigationGeneration += 1;
    marketplaceRevision += 1;
    marketplaceRequestGeneration += 1;
    directorySettings.dispose();
  }

  return {
    isLongWorkspaceActive,
    activeFeature,
    workspaceFeatureModule,
    marketplaceDisplayName,
    showConversation,
    newConversation,
    openWorkspaceDialog,
    openMaterialPack,
    openSettings,
    openOfficialModelsSettings,
    openAgentTeams,
    openMarketplace,
    openAgentTeamMarketplace,
    openDeviceSync,
    openCloudBackup,
    openZhuqueDetection,
    loadWorkspaceDirectory,
    chooseWorkspaceDirectory,
    resetWorkspaceDirectory,
    closeSettings,
    applyMarketplaceSession,
    loadMarketplaceSession,
    ensureActiveFeatureDependencies,
    dispose
  };
}
