import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App learning-imitation integration", () => {
  it("owns one long-lived controller and routes runtime events to it", () => {
    expect(source).toContain("const learningImitation = useLearningImitation");
    expect(source).toContain("learningImitation.handleEvent(event)");
    expect(source).toContain(":controller=\"learningImitation\"");
  });

  it("opens a dedicated dialog and only changes visibility when it closes", () => {
    expect(source).toContain('@open-dialog="openWorkspaceDialog"');
    expect(source).toContain('if (mode === "imitation")');
    expect(source).toContain('@close="learningImitationOpen = false"');
    expect(source).not.toContain("@close=\"learningImitation.dispose");
    expect(source).not.toContain("@close=\"learningImitation.stop");
  });

  it("shows a sidebar background marker and disposes only with App", () => {
    expect(source).toContain(':imitation-running="learningImitationRunning"');
    expect(source).toContain("learningImitation.dispose();");
  });
});
