import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App learning-imitation integration", () => {
  it("owns one long-lived controller and routes runtime events to it", () => {
    expect(source).toContain("const learningImitation = useLearningImitation");
    expect(source).toContain("learningImitation.handleEvent(event)");
    expect(source).toContain(":controller=\"learningImitation\"");
  });

  it("opens learning imitation as a persistent workspace page", () => {
    expect(source).toContain('@open-dialog="openWorkspaceDialog"');
    expect(source).toContain("workspaceMainView.value = mode");
    expect(source).toContain("workspaceMainView === 'imitation'");
    expect(source).toContain(':active="workspaceMainView === \'imitation\'"');
    expect(source).toContain('class="learning-imitation-main-view"');
    expect(source).not.toContain("learningImitationOpen");
  });

  it("shows a sidebar background marker and disposes only with App", () => {
    expect(source).toContain(':imitation-running="learningImitationRunning"');
    expect(source).toContain("learningImitation.dispose();");
  });
});
