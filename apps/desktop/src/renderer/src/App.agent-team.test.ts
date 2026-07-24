import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App agent-team integration", () => {
  it("opens agent-team management from the workspace sidebar", () => {
    expect(source).toContain('@open-agent-teams="openAgentTeams"');
    expect(source).toContain('workspaceMainView.value = "agent-team"');
    expect(source).toContain('type WorkspaceMainView = "conversation" | "directory" | "models" | "imitation" | "agent-team"');
    expect(source).toContain("<AgentTeamSettingsPanel");
    expect(source).toContain("class=\"agent-team-main-view\"");
  });

  it("keeps agent-team persistence in App instead of SettingsPage", () => {
    expect(source).toContain('window.deepwrite.agentTeams.list("short")');
    expect(source).toContain("window.deepwrite.agentTeams.save(settings)");
    expect(source).toContain('@save="saveAgentTeamSettings"');
    expect(source).not.toContain(':agent-team-settings="agentTeamSettings"');
    expect(source).not.toContain('@save-agent-teams="saveAgentTeamSettings"');
  });

  it("keeps unsaved team drafts mounted and does not reload them on every click", () => {
    expect(source).toContain('v-show="workspaceMainView === \'agent-team\'"');
    expect(source).toContain('v-show="workspaceMainView === \'conversation\'"');
    expect(source).toContain("!agentTeamLoaded.value");
    expect(source).toContain(':load-error="agentTeamLoadError"');
    expect(source).toContain('@retry="loadAgentTeamSettings"');
  });

  it("returns to the writing workspace when a document or new conversation is selected", () => {
    expect(source.match(/workspaceMainView\.value = "conversation"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("workspaceMainView === 'conversation' && !rightCollapsed");
  });

  it("keeps workspace utilities beside agent-team as full main views", () => {
    expect(source).toContain('class="workspace-settings-main-view"');
    expect(source).toContain('class="learning-imitation-main-view"');
    expect(source).toContain(':active-primary-feature="activePrimaryFeature"');
  });
});
