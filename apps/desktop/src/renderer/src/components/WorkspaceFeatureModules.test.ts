import { describe, expect, it } from "vitest";
import lazyComponentsSource from "./lazyAppComponents.ts?raw";
import typesSource from "./WorkspaceFeatureModules.types.ts?raw";
import source from "./WorkspaceFeatureModules.vue?raw";

describe("WorkspaceFeatureModules boundary", () => {
  it("owns the mutually exclusive non-writing feature branches", () => {
    for (const kind of [
      "settings",
      "agent-team",
      "directory",
      "models",
      "imitation",
      "marketplace",
      "cloud-backup",
      "zhuque-detection"
    ]) {
      expect(source).toContain(`module.kind === '${kind}'`);
    }
    expect(source).toContain("<SettingsPage");
    expect(source).toContain("<AgentTeamSettingsPanel");
    expect(source).toContain("<WorkspaceDirectoryFeature");
    expect(source).toContain("<ModelSettingsFeature");
    expect(source).toContain("<LearningImitationDialog");
    expect(source).toContain("<SkillMarketplacePage");
    expect(source).toContain("<CloudBackupPage");
    expect(source).toContain("<ZhuqueDetectionPage");
    expect(source).not.toContain("v-show");
    expect(source).not.toContain("KeepAlive");
  });

  it("keeps feature pages behind the existing lazy component registry", () => {
    expect(source).toContain('from "./lazyAppComponents"');
    expect(source).not.toMatch(
      /import\s+\w+\s+from\s+"\.\/(?:SettingsPage|AgentTeamSettingsPanel|WorkspaceDirectoryFeature|ModelSettingsFeature|LearningImitationDialog|SkillMarketplacePage)\.vue"/u
    );
    expect(source).not.toContain(
      'from "../extras/cloud-backup/CloudBackupPage.vue"'
    );
    expect(lazyComponentsSource).toContain(
      '() => import("./WorkspaceFeatureModules.vue")'
    );
  });

  it("uses one typed low-frequency module input without absorbing writing state", () => {
    expect(typesSource).toContain("export type WorkspaceFeatureModule =");
    expect(source).toContain("module: WorkspaceFeatureModule");
    expect(typesSource).toContain(
      "authoring: SubagentAuthoringController | null"
    );
    expect(typesSource).toContain(
      "controller: LearningImitationController | null"
    );
    expect(source).not.toMatch(/\bany\b/u);
    expect(typesSource).not.toMatch(/\bany\b/u);
    expect(source).not.toContain("$attrs");
    expect(source).not.toContain("conversationController");
    expect(source).not.toContain("WritingWorkspaceModule");
    expect(source).not.toContain("LongWorkspaceModule");
    expect(source).not.toContain("LeftSidebar");
    expect(source).not.toContain("DialogHost");
  });

  it("keeps settings whole and reads authoring refs below the shell boundary", () => {
    expect(source).toContain("v-if=\"module.kind === 'settings'\"");
    expect(source).toContain(':initial-category="module.initialCategory"');
    expect(source).toContain(
      ':authoring-generating="module.authoring.isBusy.value"'
    );
    expect(source).toContain(':authoring-draft="module.authoring.draft.value"');
    expect(source).toContain(
      "generateWorkspaceFeatureSubagent(module, $event)"
    );
  });
});
