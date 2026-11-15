import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../test-utils/sourceText";
import source from "./WorkspaceShell.vue?raw";
import dialogLayerSource from "./components/WorkspaceDialogLayer.vue?raw";
import featureModulesSource from "./components/WorkspaceFeatureModules.vue?raw";
import asyncComponentsSource from "./components/lazyAppComponents.ts?raw";
import featureImportsSource from "./components/lazyFeatureImports.ts?raw";
const lazyComponentsSource = `${asyncComponentsSource}\n${featureImportsSource}`;
import featureHostSource from "./composables/useWorkspaceFeatureHostCoordinator.ts?raw";

describe("App lazy feature mounting", () => {
  it("keeps only the default writing surface in the eager component imports", () => {
    expect(source).toContain('from "./components/lazyAppComponents"');
    expectSourceToContain(lazyComponentsSource, "defineAsyncComponent");
    expect(lazyComponentsSource).toContain(
      '() => import("./SettingsPage.vue")'
    );
    expectSourceToContain(
      lazyComponentsSource,
      '() => import("./LongWorkspaceModule.vue")'
    );
    expectSourceToContain(
      lazyComponentsSource,
      '() => import("./AgentTeamCatalogFeature.vue")'
    );
    expectSourceToContain(
      lazyComponentsSource,
      '() => import("../extras/cloud-backup/CloudBackupPage.vue")'
    );
    expect(lazyComponentsSource).not.toContain("loadModelSettingsFeature");
    expectSourceToContain(
      lazyComponentsSource,
      '() => import("./WorkspaceDirectoryFeature.vue")'
    );
    expect(source).not.toContain(
      'import SettingsPage from "./components/SettingsPage.vue"'
    );
    expect(source).not.toContain(
      'import LongWorkspaceEditor from "./components/LongWorkspaceEditor.vue"'
    );
  });

  it("keeps model configuration in settings and the directory as a workspace feature", () => {
    expect(featureModulesSource).toContain("<WorkspaceDirectoryFeature\n");
    expect(featureModulesSource).not.toContain("<ModelSettingsFeature");
    expect(source).toContain("<WorkspaceFeatureModules");
    expect(source).not.toContain("<WorkspaceDirectoryFeature");
    expect(source).not.toContain("<ModelSettingsFeature");
    expect(featureModulesSource).not.toContain(
      ":mode=\"workspaceMainView === 'directory' ? 'directory' : 'models'\""
    );
  });

  it("conditionally mounts mutually exclusive feature pages and heavy dialogs", () => {
    expect(source).toContain("useWorkspaceFeatureHostCoordinator({");
    expect(featureHostSource).toContain(
      "const workspaceFeatureModule = computed"
    );
    expectSourceToContain(
      featureModulesSource,
      "v-else-if=\"module.kind === 'marketplace' || module.kind === 'agent-team-marketplace'\""
    );
    expect(featureModulesSource).toContain(
      "v-else-if=\"module.kind === 'cloud-backup'\""
    );
    expect(source).toContain("v-if=\"activeFeature === 'long-workspace'\"");
    expect(source).not.toContain("<KeepAlive>");
    expect(source).toContain(
      '<WorkspaceDialogLayer\n    v-if="workspaceDialogModule"'
    );
    expectSourceToContain(dialogLayerSource, '<DialogHost v-if="module"');
    expect(dialogLayerSource).toContain(':active-dialog="module.kind"');
    expect(dialogLayerSource).toContain(
      "<BookResourceDialog\n      v-if=\"module.kind === 'book-resource'\""
    );
    expect(dialogLayerSource).toContain(
      "<CreateBookDialog\n      v-else-if=\"module.kind === 'create-book'\""
    );
    expect(dialogLayerSource).toContain(
      "<SaveConflictDialog\n      v-else-if=\"module.kind === 'save-conflict'\""
    );
    expect(source).not.toContain("<BookResourceDialog\n");
    expect(source).not.toContain('v-show="workspaceMainView');
  });
});
