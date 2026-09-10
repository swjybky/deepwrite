import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../test-utils/sourceText";
import source from "./WorkspaceShell.vue?raw";
import featureModulesSource from "./components/WorkspaceFeatureModules.vue?raw";
import featureHostSource from "./composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import coordinatorSource from "./composables/useSettingsFeatureCoordinator.ts?raw";
import lifecycleSource from "./composables/useWorkspaceLifecycleCoordinator.ts?raw";
import layoutSource from "./stores/layoutFeatureNavigation.ts?raw";
import settingsSource from "./stores/settingsStore.ts?raw";

describe("App agent-team integration", () => {
  it("opens agent-team management through the feature-host boundary", () => {
    expect(source).toContain('@open-agent-teams="featureHost.openAgentTeams"');
    expect(source).toContain("useWorkspaceFeatureHostCoordinator({");
    expect(featureHostSource).toContain(
      'options.view.workspaceMain.value = "agent-team"'
    );
    expect(layoutSource).toContain("export type WorkspaceMainView =");
    expect(layoutSource).toContain('| "agent-team"');
    expect(layoutSource).toContain('| "marketplace"');
    expect(featureModulesSource).toContain("<AgentTeamSettingsPanel");
    expect(featureModulesSource).toContain(':models="module.models"');
    expect(featureModulesSource).toContain('class="agent-team-main-view"');
  });

  it("keeps agent-team persistence in the settings coordinator", () => {
    expect(source).toContain("useSettingsFeatureCoordinator({");
    expect(source).toContain("loadAgentTeamSettings,");
    expect(source).toContain("saveAgentTeamSettings,");
    expect(coordinatorSource).toContain("api.agentTeams.list()");
    expect(coordinatorSource).toContain("api.agentTeams.save(input)");
    expect(source).toContain('@save-agent-team="saveAgentTeamSettings"');
    expect(featureModulesSource).toContain(
      "@save=\"emit('saveAgentTeam', $event)\""
    );
    expect(source).not.toContain(':agent-team-settings="agentTeamSettings"');
  });

  it("retains controller state without retaining inactive feature DOM", () => {
    expect(source).not.toContain("<KeepAlive>");
    expect(featureModulesSource).toContain(
      "v-else-if=\"module.kind === 'agent-team'\""
    );
    expect(source).toContain("v-if=\"activeFeature === 'conversation'\"");
    expect(featureModulesSource).not.toContain("v-show=");
    expect(featureHostSource).toContain("!settingsStore.agentTeamLoaded");
    expect(featureModulesSource).toContain(':load-error="module.loadError"');
    expect(featureModulesSource).toContain("@retry=\"emit('retryAgentTeam')\"");
  });

  it("returns to the writing workspace when a resource or conversation is selected", () => {
    expect(featureHostSource).toContain("function showConversation(): void");
    expect(featureHostSource).toContain(
      'options.view.workspaceMain.value = "conversation"'
    );
    expect(
      source.match(/^\s+showConversation: featureHost\.showConversation,$/gm)
        ?.length ?? 0
    ).toBeGreaterThanOrEqual(4);
    expect(source).toContain("<WritingWorkspaceModule");
    expect(source).toContain("activeFeature === 'conversation'");
    expect(source).toContain(':conversation-controller="activeConversation"');
  });

  it("keeps workspace utilities beside agent-team as full main views", () => {
    expect(featureModulesSource).toContain(
      'class="workspace-settings-main-view"'
    );
    expect(featureModulesSource).toContain(
      'class="learning-imitation-main-view"'
    );
    expectSourceToContain(
      source,
      ":active-primary-feature=\"chatAssistant.active.value ? 'chat-assistant' : activePrimaryFeature\""
    );
  });

  it("loads and saves all workspace team settings through one catalog", () => {
    expect(settingsSource).toContain("const agentTeamCatalog = shallowRef");
    expect(coordinatorSource).toContain("settingsStore.ensureAgentTeamsLoaded");
    expect(coordinatorSource).toContain("api.agentTeams.setEnabled(input)");
    expect(featureModulesSource).toContain(':catalog="module.catalog"');
    expect(featureModulesSource).toContain(
      "@set-enabled=\"emit('setAgentTeamEnabled', $event)\""
    );
  });

  it("loads and saves long agent profiles independently from short and script", () => {
    expect(settingsSource).toContain("const longAgentLoading = ref(false)");
    expect(settingsSource).toContain("const longAgentSaving = ref(false)");
    expect(coordinatorSource).toContain("loadShortAndScriptAgentSettings()");
    expect(coordinatorSource).toContain("loadLongAgentSettings()");
    expect(featureModulesSource).toContain(
      ':long-agent-loading="module.longAgentLoading"'
    );
    expect(featureModulesSource).toContain(
      ':long-agent-saving="module.longAgentSaving"'
    );
    expect(settingsSource).toContain(
      "const longAgentLoadError = ref<string | null>(null)"
    );
    expect(coordinatorSource).toContain("settingsStore.ensureLongAgentsLoaded");
    expect(coordinatorSource).toContain("ensureLongAgentSettingsLoaded()");
    expect(source).toContain('@retry-long-agents="loadLongAgentSettings"');
  });

  it("routes agent-setting feedback through top-centered uiMessage", () => {
    expect(source).toContain('import { uiMessage } from "./ui-feedback"');
    expect(source).toContain("notifications: uiMessage");
    expect(coordinatorSource).toContain("uiMessage.success(");
    expect(coordinatorSource).toContain("保存创作空间智能体设置失败。");
    expect(coordinatorSource).toContain("保存长篇智能体设置失败。");
    expect(source).not.toContain("function showWorkspaceAgentFeedback");
    expect(source).not.toContain("function showLongAgentFeedback");
    expect(featureModulesSource).toContain(
      ':long-agent-error="module.longAgentError"'
    );
  });

  it("keeps feature-only settings outside the writing startup critical path", () => {
    expect(lifecycleSource).toContain(
      "options.ensureFeatureDependencies(options.activeFeature.value)"
    );
    expect(featureHostSource).toContain('feature === "conversation"');
    expect(featureHostSource).toContain(
      "options.loaders.loadShortAndScriptAgentSettings()"
    );
    expect(featureHostSource).toContain(
      "options.loaders.ensureLongAgentSettingsLoaded()"
    );
    expect(lifecycleSource).not.toContain(
      "loadShortAndScriptAgentTeamSettings"
    );
    expect(lifecycleSource).not.toContain("loadLearningImitationSettings");
    expect(lifecycleSource).not.toContain("loadWorkspaceDirectory");
    expect(
      lifecycleSource.indexOf("options.scheduleDirtyDraftAutoSave()")
    ).toBeLessThan(lifecycleSource.indexOf("options.loadLongBookList()"));

    const focusRefresh =
      source
        .split("async function refreshWorkspaceOnWindowFocus()")[1]
        ?.split("watch(\n  activeRightPanePreferenceKey")[0] ?? "";
    expect(focusRefresh).toContain("if (bookId)");
    expect(focusRefresh).toContain("loadLongBookList({ notify: true })");
    expect(focusRefresh).toContain("await Promise.allSettled(tasks)");
    expect(lifecycleSource).toContain("DEFAULT_FOCUS_REFRESH_INTERVAL_MS");
    expect(lifecycleSource).toContain("focusRefreshPromise");
  });
});
