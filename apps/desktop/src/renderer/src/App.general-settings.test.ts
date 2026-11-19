import { describe, expect, it } from "vitest";
import source from "./WorkspaceShell.vue?raw";
import longWorkspaceSource from "./components/LongWorkspaceModule.vue?raw";
import writingWorkspaceSource from "./components/WritingWorkspaceModule.vue?raw";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import stylesSource from "virtual:deepwrite-renderer-styles";
import coordinatorSource from "./composables/useGeneralSettingsCoordinator.ts?raw";

describe("App general settings integration", () => {
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
});
