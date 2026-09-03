import type {
  MarketplaceSession,
  WorkspaceDirectorySettings
} from "@deepwrite/contracts";
import { createPinia, setActivePinia } from "pinia";
import { ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../stores/settingsStore";
import type { WorkspaceMainView } from "../stores/layoutStore";
import type { LearningImitationController } from "./useLearningImitation";
import type { LongBookAnalysisController } from "../extras/long-book-analysis/useLongBookAnalysis";
import type { SubagentAuthoringController } from "./useSubagentAuthoring";
import {
  useWorkspaceFeatureHostCoordinator,
  type WorkspaceFeatureHostApi,
  type WorkspaceFeatureHostCoordinatorOptions
} from "./useWorkspaceFeatureHostCoordinator";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function signedOutSession(): MarketplaceSession {
  return {
    authenticated: false,
    persistent: false,
    insecureTransport: false
  };
}

function signedInSession(displayName: string): MarketplaceSession {
  return {
    authenticated: true,
    persistent: true,
    insecureTransport: false,
    user: {
      id: `user-${displayName}`,
      username: displayName.toLocaleLowerCase(),
      displayName,
      avatarUrl: "",
      bio: "",
      createdAt: "2026-08-14T00:00:00.000Z"
    }
  };
}

interface HarnessOverrides {
  runtimeAvailable?: boolean;
  saveBeforeLeaving?: () => Promise<boolean>;
  ensureLearningLoaded?: () => Promise<unknown>;
  ensureAuthoringLoaded?: () => Promise<unknown>;
  loadDirectory?: () => Promise<WorkspaceDirectorySettings>;
  chooseDirectory?: () => Promise<WorkspaceDirectorySettings | null>;
  loadMarketplaceSession?: () => Promise<MarketplaceSession>;
  loaderOverrides?: Partial<WorkspaceFeatureHostCoordinatorOptions["loaders"]>;
}

function createHarness(overrides: HarnessOverrides = {}) {
  setActivePinia(createPinia());
  const currentView = ref<"workspace" | "settings">("workspace");
  const settingsInitialCategory = ref("general");
  const workspaceMainView = ref<WorkspaceMainView>("conversation");
  const activeLongBookId = ref<string | null>(null);
  const settingsStore = useSettingsStore();
  const catalogSnapshot = shallowRef(null);
  const learningController = shallowRef<LearningImitationController | null>(
    null
  );
  const longBookAnalysisController =
    shallowRef<LongBookAnalysisController | null>(null);
  const authoringController = shallowRef<SubagentAuthoringController | null>(
    null
  );
  const saveBeforeLeaving = vi.fn(
    overrides.saveBeforeLeaving ?? (async () => true)
  );
  const newShortConversation = vi.fn();
  const newLongConversation = vi.fn();
  const ensureLearningLoaded = vi.fn(
    overrides.ensureLearningLoaded ?? (async () => undefined)
  );
  const ensureAuthoringLoaded = vi.fn(
    overrides.ensureAuthoringLoaded ?? (async () => undefined)
  );
  const marketplaceSession = vi.fn(
    overrides.loadMarketplaceSession ?? (async () => signedOutSession())
  );
  const listDirectory = vi.fn(
    overrides.loadDirectory ?? (async () => ({ path: "/workspace-a" }))
  );
  const chooseDirectory = vi.fn(
    overrides.chooseDirectory ?? (async () => ({ path: "/workspace-b" }))
  );
  const api: WorkspaceFeatureHostApi = {
    marketplace: { session: marketplaceSession },
    workspaceDirectory: {
      list: listDirectory,
      choose: chooseDirectory
    }
  };
  let runtimeAvailable = overrides.runtimeAvailable ?? true;
  const loaders = {
    loadModelSettings: vi.fn(async () => undefined),
    loadOfficialModels: vi.fn(async () => undefined),
    loadShortAndScriptAgentSettings: vi.fn(async () => undefined),
    ensureLongAgentSettingsLoaded: vi.fn(async () => undefined),
    loadWorkspaceAgentSettings: vi.fn(async () => undefined),
    loadAgentTeamSettings: vi.fn(async () => undefined),
    loadLibraryAgentSettings: vi.fn(async () => undefined),
    loadLearningImitationSettings: vi.fn(async () => undefined),
    loadCatalogSnapshot: vi.fn(async () => undefined),
    ...overrides.loaderOverrides
  } satisfies WorkspaceFeatureHostCoordinatorOptions["loaders"];
  const errors: string[] = [];
  const successes: string[] = [];
  const coordinator = useWorkspaceFeatureHostCoordinator({
    api: () => (runtimeAvailable ? api : undefined),
    view: {
      current: currentView,
      settingsInitialCategory,
      workspaceMain: workspaceMainView,
      activeLongBookId
    },
    settingsStore,
    catalogSnapshot,
    features: {
      learningImitation: {
        controller: learningController,
        ensureLoaded: ensureLearningLoaded
      },
      longBookAnalysis: {
        controller: longBookAnalysisController,
        ensureLoaded: vi.fn(async () => undefined)
      },
      subagentAuthoring: {
        controller: authoringController,
        ensureLoaded: ensureAuthoringLoaded
      }
    },
    actions: {
      saveActiveLongEditorBeforeLeaving: saveBeforeLeaving,
      newShortConversation,
      newLongConversation
    },
    loaders,
    notifications: {
      error: (message) => errors.push(message),
      success: (message) => successes.push(message)
    }
  });

  return {
    activeLongBookId,
    api,
    authoringController,
    chooseDirectory,
    coordinator,
    currentView,
    ensureAuthoringLoaded,
    ensureLearningLoaded,
    errors,
    learningController,
    listDirectory,
    loaders,
    marketplaceSession,
    newLongConversation,
    newShortConversation,
    saveBeforeLeaving,
    settingsInitialCategory,
    settingsStore,
    successes,
    workspaceMainView,
    setRuntimeAvailable(value: boolean) {
      runtimeAvailable = value;
    }
  };
}

describe("useWorkspaceFeatureHostCoordinator", () => {
  it("prioritizes settings, then an open long workspace, then the selected main view", () => {
    const harness = createHarness();

    expect(harness.coordinator.activeFeature.value).toBe("conversation");
    harness.activeLongBookId.value = "long-book";
    expect(harness.coordinator.isLongWorkspaceActive.value).toBe(true);
    expect(harness.coordinator.activeFeature.value).toBe("long-workspace");
    harness.currentView.value = "settings";
    expect(harness.coordinator.activeFeature.value).toBe("settings");
    harness.workspaceMainView.value = "models";
    expect(harness.coordinator.activeFeature.value).toBe("settings");
    harness.currentView.value = "workspace";
    expect(harness.coordinator.activeFeature.value).toBe("models");
  });

  it("projects every feature descriptor and leaves both writing surfaces unwrapped", () => {
    const harness = createHarness();

    expect(harness.coordinator.workspaceFeatureModule.value).toBeNull();
    harness.activeLongBookId.value = "long-book";
    expect(harness.coordinator.workspaceFeatureModule.value).toBeNull();
    harness.activeLongBookId.value = null;

    const featureKinds = [
      "directory",
      "models",
      "imitation",
      "agent-team",
      "marketplace",
      "cloud-backup",
      "zhuque-detection"
    ] as const;
    for (const feature of featureKinds) {
      harness.workspaceMainView.value = feature;
      expect(harness.coordinator.workspaceFeatureModule.value?.kind).toBe(
        feature
      );
    }

    harness.currentView.value = "settings";
    harness.settingsInitialCategory.value = "appearance";
    const settingsModule = harness.coordinator.workspaceFeatureModule.value;
    expect(settingsModule?.kind).toBe("settings");
    expect(
      settingsModule?.kind === "settings"
        ? settingsModule.initialCategory
        : undefined
    ).toBe("appearance");
  });

  it("routes new conversations using the current long-book identity", () => {
    const harness = createHarness();

    harness.coordinator.newConversation();
    harness.activeLongBookId.value = "long-book";
    harness.coordinator.newConversation();

    expect(harness.newShortConversation).toHaveBeenCalledOnce();
    expect(harness.newLongConversation).toHaveBeenCalledOnce();
  });

  it("blocks every feature navigation and all dependent loads when saving fails", async () => {
    const harness = createHarness({
      saveBeforeLeaving: async () => false
    });

    await harness.coordinator.openWorkspaceDialog("directory");
    await harness.coordinator.openWorkspaceDialog("models");
    await harness.coordinator.openWorkspaceDialog("imitation");
    await harness.coordinator.openSettings();
    await harness.coordinator.openAgentTeams();
    await harness.coordinator.openMarketplace();
    await harness.coordinator.openCloudBackup();

    expect(harness.currentView.value).toBe("workspace");
    expect(harness.workspaceMainView.value).toBe("conversation");
    expect(harness.ensureLearningLoaded).not.toHaveBeenCalled();
    expect(harness.ensureAuthoringLoaded).not.toHaveBeenCalled();
    expect(harness.listDirectory).not.toHaveBeenCalled();
    expect(
      Object.values(harness.loaders).every(
        (loader) => vi.mocked(loader).mock.calls.length === 0
      )
    ).toBe(true);
  });

  it("does not let a late imitation or team load replace a newer page", async () => {
    const learning = deferred<void>();
    const authoring = deferred<void>();
    const harness = createHarness({
      ensureLearningLoaded: () => learning.promise,
      ensureAuthoringLoaded: () => authoring.promise
    });

    const imitationNavigation =
      harness.coordinator.openWorkspaceDialog("imitation");
    await Promise.resolve();
    await harness.coordinator.openCloudBackup();
    learning.resolve();
    await imitationNavigation;
    expect(harness.workspaceMainView.value).toBe("cloud-backup");

    const teamNavigation = harness.coordinator.openAgentTeams();
    await Promise.resolve();
    await harness.coordinator.openMarketplace();
    authoring.resolve();
    await teamNavigation;
    expect(harness.workspaceMainView.value).toBe("marketplace");
    expect(harness.loaders.loadAgentTeamSettings).not.toHaveBeenCalled();
  });

  it("does not let a lazy feature replace an external conversation navigation", async () => {
    const learning = deferred<void>();
    const harness = createHarness({
      ensureLearningLoaded: () => learning.promise
    });

    harness.workspaceMainView.value = "models";
    const imitationNavigation =
      harness.coordinator.openWorkspaceDialog("imitation");
    await Promise.resolve();
    harness.coordinator.showConversation();
    learning.resolve();
    await imitationNavigation;

    expect(harness.workspaceMainView.value).toBe("conversation");
    expect(harness.loaders.loadModelSettings).not.toHaveBeenCalled();
  });

  it("reports an active lazy-feature failure but suppresses a stale failure", async () => {
    const activeHarness = createHarness({
      ensureLearningLoaded: async () => {
        throw new Error("仿写模块不可用");
      }
    });
    await activeHarness.coordinator.openWorkspaceDialog("imitation");
    expect(activeHarness.errors).toEqual(["仿写模块不可用"]);
    expect(activeHarness.workspaceMainView.value).toBe("conversation");

    const pending = deferred<void>();
    const staleHarness = createHarness({
      ensureAuthoringLoaded: () => pending.promise
    });
    const teamNavigation = staleHarness.coordinator.openAgentTeams();
    await Promise.resolve();
    await staleHarness.coordinator.openCloudBackup();
    pending.reject(new Error("旧团队加载失败"));
    await teamNavigation;
    expect(staleHarness.errors).toEqual([]);
  });

  it("loads only the dependencies owned by conversation, long writing, and models", async () => {
    const harness = createHarness();

    await harness.coordinator.ensureActiveFeatureDependencies("conversation");
    expect(harness.loaders.loadModelSettings).toHaveBeenCalledTimes(1);
    expect(
      harness.loaders.loadShortAndScriptAgentSettings
    ).toHaveBeenCalledTimes(1);
    expect(harness.loaders.loadAgentTeamSettings).toHaveBeenCalledTimes(1);

    await harness.coordinator.ensureActiveFeatureDependencies("long-workspace");
    expect(harness.loaders.loadModelSettings).toHaveBeenCalledTimes(2);
    expect(harness.loaders.ensureLongAgentSettingsLoaded).toHaveBeenCalledTimes(
      1
    );
    expect(harness.loaders.loadAgentTeamSettings).toHaveBeenCalledTimes(2);

    await harness.coordinator.ensureActiveFeatureDependencies("models");
    await harness.coordinator.ensureActiveFeatureDependencies("directory");
    expect(harness.loaders.loadModelSettings).toHaveBeenCalledTimes(3);
  });

  it("preserves normal and official settings loading boundaries", async () => {
    const harness = createHarness();

    await harness.coordinator.openSettings("general");
    expect(harness.currentView.value).toBe("settings");
    expect(harness.loaders.loadModelSettings).toHaveBeenCalledOnce();
    expect(harness.loaders.loadOfficialModels).not.toHaveBeenCalled();
    expect(harness.loaders.loadWorkspaceAgentSettings).toHaveBeenCalledOnce();
    expect(harness.loaders.loadLibraryAgentSettings).toHaveBeenCalledOnce();
    expect(
      harness.loaders.loadLearningImitationSettings
    ).toHaveBeenCalledOnce();

    harness.coordinator.closeSettings();
    await harness.coordinator.openSettings("official-models");
    expect(harness.loaders.loadOfficialModels).toHaveBeenCalledOnce();
    expect(harness.loaders.loadModelSettings).toHaveBeenCalledOnce();
  });

  it("contains rejecting background loaders without changing the selected page", async () => {
    const harness = createHarness({
      loaderOverrides: {
        loadCatalogSnapshot: async () => {
          throw new Error("Catalog unavailable");
        }
      }
    });

    await expect(
      harness.coordinator.openMarketplace()
    ).resolves.toBeUndefined();
    await Promise.resolve();
    expect(harness.workspaceMainView.value).toBe("marketplace");
    expect(harness.errors).toEqual([]);
  });

  it("loads and chooses a workspace directory with cancellation, errors, and single-flight guards", async () => {
    const harness = createHarness();

    await harness.coordinator.loadWorkspaceDirectory();
    expect(harness.settingsStore.workspaceDirectoryPath).toBe("/workspace-a");

    await harness.coordinator.chooseWorkspaceDirectory();
    expect(harness.settingsStore.workspaceDirectoryPath).toBe("/workspace-b");
    expect(harness.successes).toEqual([
      "工作目录已切换；现有项目保持原位置不变"
    ]);

    const cancelled = createHarness({
      chooseDirectory: async () => null
    });
    await cancelled.coordinator.chooseWorkspaceDirectory();
    expect(cancelled.settingsStore.workspaceDirectoryPath).toBeNull();
    expect(cancelled.successes).toEqual([]);

    const failed = createHarness({
      loadDirectory: async () => {
        throw new Error("目录读取失败");
      },
      chooseDirectory: async () => {
        throw new Error("目录切换失败");
      }
    });
    await failed.coordinator.loadWorkspaceDirectory();
    await failed.coordinator.chooseWorkspaceDirectory();
    expect(failed.errors).toEqual(["目录读取失败", "目录切换失败"]);

    const pendingChoice = deferred<WorkspaceDirectorySettings | null>();
    const guarded = createHarness({
      chooseDirectory: () => pendingChoice.promise
    });
    const firstChoice = guarded.coordinator.chooseWorkspaceDirectory();
    await guarded.coordinator.chooseWorkspaceDirectory();
    expect(guarded.chooseDirectory).toHaveBeenCalledOnce();
    pendingChoice.resolve({ path: "/workspace-c" });
    await firstChoice;
  });

  it("projects the known marketplace session into the feature module", async () => {
    const harness = createHarness({
      loadMarketplaceSession: async () => signedInSession("Plaza User")
    });

    harness.workspaceMainView.value = "marketplace";
    expect(harness.coordinator.workspaceFeatureModule.value).toMatchObject({
      kind: "marketplace",
      session: null
    });

    await harness.coordinator.loadMarketplaceSession();
    expect(harness.coordinator.workspaceFeatureModule.value).toMatchObject({
      kind: "marketplace",
      session: signedInSession("Plaza User")
    });

    harness.coordinator.applyMarketplaceSession(signedOutSession());
    expect(harness.coordinator.workspaceFeatureModule.value).toMatchObject({
      kind: "marketplace",
      session: signedOutSession()
    });
  });

  it("lets page session events supersede startup discovery and ignores results after dispose", async () => {
    const startupSession = deferred<MarketplaceSession>();
    const harness = createHarness({
      loadMarketplaceSession: () => startupSession.promise
    });

    const startupLoad = harness.coordinator.loadMarketplaceSession();
    harness.coordinator.applyMarketplaceSession(signedInSession("Page User"));
    startupSession.resolve(signedInSession("Startup User"));
    await startupLoad;
    expect(harness.coordinator.marketplaceDisplayName.value).toBe("Page User");

    const disposedSession = deferred<MarketplaceSession>();
    const disposed = createHarness({
      loadMarketplaceSession: () => disposedSession.promise
    });
    const disposedLoad = disposed.coordinator.loadMarketplaceSession();
    disposed.coordinator.dispose();
    disposedSession.resolve(signedInSession("Late User"));
    await disposedLoad;
    expect(disposed.coordinator.marketplaceDisplayName.value).toBeUndefined();
  });

  it("keeps startup marketplace failures silent and disables work after dispose", async () => {
    const harness = createHarness({
      loadMarketplaceSession: async () => {
        throw new Error("Marketplace unavailable");
      }
    });

    await expect(
      harness.coordinator.loadMarketplaceSession()
    ).resolves.toBeUndefined();
    harness.coordinator.dispose();
    await harness.coordinator.openCloudBackup();
    harness.coordinator.applyMarketplaceSession(signedInSession("Late User"));
    expect(harness.workspaceMainView.value).toBe("conversation");
    expect(harness.coordinator.marketplaceDisplayName.value).toBeUndefined();
    expect(harness.errors).toEqual([]);
  });
});
