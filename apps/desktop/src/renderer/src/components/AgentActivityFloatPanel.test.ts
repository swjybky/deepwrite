import { describe, expect, it } from "vitest";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import rendererStyles from "virtual:deepwrite-renderer-styles";
import conversationSource from "./AgentConversation.vue?raw";
import panelSource from "./AgentActivityFloatPanel.vue?raw";
import workspaceSource from "../WorkspaceShell.vue?raw";

describe("agent activity floating panel", () => {
  it("renders the status list outside normal conversation layout", () => {
    expect(panelSource).toContain("agentActivityList");
    expect(panelSource).toContain("agent-activity-spinner");
    expect(panelSource).toContain("item.status");
    expect(panelSource).toContain("completedAwaitingReview");
    expect(panelSource).toContain("noAgentsAreRunning");
    expect(rendererStyles).toContain(".agent-activity-panel {");
    expect(rendererStyles).toContain("position: absolute;");
    expect(rendererStyles).toContain("max-height: min(40vh, 420px);");
    expect(rendererStyles).toContain(
      "grid-template-rows: auto minmax(0, 1fr);"
    );
    const listStart = rendererStyles.indexOf(".agent-activity-list {");
    const listEnd = rendererStyles.indexOf("}", listStart);
    const listStyles = rendererStyles.slice(listStart, listEnd);
    expect(listStyles).toContain("min-height: 0;");
    expect(listStyles).toContain("overflow-y: auto;");
    expect(listStyles).toContain("overscroll-behavior: contain;");
    expect(panelSource).toContain("@wheel.stop");
  });

  it("adds a persistent header toggle and a collapsed activity badge", () => {
    expect(conversationSource).toContain("expandAgentActivityList");
    expect(conversationSource).toContain("collapseAgentActivityList");
    expect(conversationSource).toContain("agent-activity-toggle-badge");
    expect(conversationSource).toContain('name="panel-top"');
    expect(conversationSource).toContain("<AgentActivityFloatPanel");
    expect(conversationSource).not.toContain(
      "!agentActivityCollapsed && agentActivityItems.length"
    );
    expect(rendererStyles).toContain(
      ".agent-activity-toggle.is-collapsed .agent-activity-toggle-icon"
    );
  });

  it("injects one workspace-level coordinator without changing IPC", () => {
    expect(workspaceSource).toContain("useAgentActivityCoordinator({");
    expect(workspaceSource).toContain(
      "provide(AGENT_ACTIVITY_CONTEXT_KEY, agentActivity.context)"
    );
    expect(workspaceSource).toContain(
      "resolveAgentActivityDescriptor(conversationKey"
    );
    expect(workspaceSource).toMatch(
      /resolveAgentActivityNavigationNode\(\s*item/u
    );
    expect(workspaceSource).toContain(
      "selectLongChapterCardTab(item.chapterCardId)"
    );
    expect(workspaceSource).toContain("preferCenteredReveal()");
    expect(workspaceSource).toContain(
      "await leftSidebar.value?.revealSelection()"
    );
    expect(workspaceSource).toContain('return "missing"');
  });

  it("honors reduced-motion preferences for the running spinner", () => {
    expect(rendererStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(rendererStyles).toContain(".agent-activity-spinner {");
  });
});
