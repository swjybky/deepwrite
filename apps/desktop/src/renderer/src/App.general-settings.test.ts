import { describe, expect, it } from "vitest";
import source from "./WorkspaceShell.vue?raw";
import longWorkspaceSource from "./components/LongWorkspaceModule.vue?raw";
import writingWorkspaceSource from "./components/WritingWorkspaceModule.vue?raw";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import stylesSource from "virtual:deepwrite-renderer-styles";
import coordinatorSource from "./composables/useGeneralSettingsCoordinator.ts?raw";
import lifecycleSource from "./composables/useWorkspaceLifecycleCoordinator.ts?raw";
import runtimeRegistrySource from "./composables/useConversationRuntimeRegistryCoordinator.ts?raw";
import shortConversationSource from "./composables/useShortConversationCoordinator.ts?raw";
import longConversationSource from "./composables/useLongConversationCoordinator.ts?raw";

describe("App general settings integration", () => {
  it("loads and persists general settings through the desktop runtime", () => {
    expect(source).toContain("loadGeneralSettings,");
    expect(lifecycleSource).toContain("options.loadGeneralSettings()");
    expect(source).toContain("window.deepwrite?.generalSettings");
    expect(source).toContain("useGeneralSettingsCoordinator({");
    expect(coordinatorSource).toContain("await api.save(snapshot);");
  });

  it("uses the configured permission as every agent's default approval mode", () => {
    expect(source).toContain(
      "permissionMode: () => generalSettings.value.permissionMode"
    );
    expect(runtimeRegistrySource).toContain(
      "conversation.selectApprovalMode(options.permissionMode())"
    );
    expect(runtimeRegistrySource).toContain(
      "conversation.selectApprovalMode(permissionMode)"
    );
    expect(source).toContain("applyApprovalMode: applyDefaultApprovalMode");
    expect(coordinatorSource).toContain(
      "options.applyApprovalMode(permissionMode)"
    );
    expect(shortConversationSource).toContain(
      "options.settings.updatePermissionMode(mode)"
    );
    expect(longConversationSource).toContain(
      "options.settings.updatePermissionMode(mode)"
    );
    expect(longWorkspaceSource).toContain(
      ':approval-mode="conversationController.approvalMode.value"'
    );
    expect(source).toContain('@update-permission-mode="updatePermissionMode"');
  });

  it("applies language and menu-bar setting changes", () => {
    expect(source).toContain("documentRoot: document.documentElement");
    expect(coordinatorSource).toContain(
      "options.documentRoot.lang = resolvedLanguage"
    );
    expect(coordinatorSource).toContain(
      "function updateUseNetworkProxy(enabled: boolean)"
    );
    expect(source).toContain('@update-language="updateAppLanguage"');
    expect(source).toContain('@update-show-in-menu-bar="updateShowInMenuBar"');
    expect(source).toContain(
      '@update-use-network-proxy="updateUseNetworkProxy"'
    );
  });

  it("persists the context usage indicator visibility", () => {
    expect(coordinatorSource).toContain(
      "function updateShowContextUsage(enabled: boolean)"
    );
    expect(source).toContain(
      '@update-show-context-usage="updateShowContextUsage"'
    );
  });

  it("persists and applies the selected creative-workspace pane layout", () => {
    expect(coordinatorSource).toContain(
      "function updateWorkspacePaneLayout(layout: WorkspacePaneLayout)"
    );
    expect(source).toContain(
      '@update-workspace-pane-layout="updateWorkspacePaneLayout"'
    );
    expect(source).toContain("'is-editor-agent-layout'");
    expect(source).toContain(
      ':pane-layout="generalSettings.workspacePaneLayout"'
    );
    expect(writingWorkspaceSource).toContain(
      "paneLayout === 'editor-agent' || !rightPane.collapsed"
    );
    expect(longWorkspaceSource).toContain(
      "paneLayout === 'editor-agent' || !rightPane.collapsed"
    );
    expect(stylesSource).toContain(
      ".desktop-shell.is-editor-agent-layout > .conversation-pane"
    );
    expect(stylesSource).toContain(
      ".desktop-shell.is-editor-agent-layout > .editor-pane"
    );
    const swappedLayoutStyles = stylesSource.slice(
      stylesSource.indexOf(
        ".desktop-shell.is-editor-agent-layout > .conversation-pane"
      ),
      stylesSource.indexOf(".long-workspace-loading-state strong")
    );
    expect(swappedLayoutStyles.match(/grid-row:\s*1/g)).toHaveLength(2);
  });

  it("persists and applies the default text view mode to every editor", () => {
    expect(coordinatorSource).toContain(
      "function updateDefaultTextViewMode(mode: TextViewMode)"
    );
    expect(source).toContain(
      '@update-default-text-view-mode="updateDefaultTextViewMode"'
    );
    expect(source).toContain(
      "defaultViewMode: generalSettings.value.defaultTextViewMode"
    );
    expect(source).toContain(
      ':default-text-view-mode="generalSettings.defaultTextViewMode"'
    );
    expect(writingWorkspaceSource).toContain('| "defaultViewMode"');
    expect(longWorkspaceSource).toContain(
      ':default-view-mode="defaultTextViewMode"'
    );
  });

  it("reveals text without expanding a collapsed right-side agent", () => {
    expect(source).toContain("function revealTextPane(): void");
    expect(source).toContain(
      'generalSettings.value.workspacePaneLayout === "agent-editor"'
    );
    expect(source).toContain('layoutStore.setPaneCollapsed("right", false)');
    expect(source).not.toContain("rightCollapsed.value = false");
  });
});
