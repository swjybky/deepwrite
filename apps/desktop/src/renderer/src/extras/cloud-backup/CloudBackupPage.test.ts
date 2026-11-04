import { describe, expect, it } from "vitest";
import messages from "../../i18n/messages/extras/zh-CN";
import source from "./CloudBackupPage.vue?raw";
import previewDialogSource from "./CloudBackupPreviewDialog.vue?raw";
import appSource from "../../WorkspaceShell.vue?raw";
import sidebarViewSource from "../../components/LeftSidebar.vue?raw";
import sidebarCatalogSource from "../../components/sidebarMoreFeatures.ts?raw";
const sidebarSource = `${sidebarViewSource}\n${sidebarCatalogSource}`;
import featureModulesSource from "../../components/WorkspaceFeatureModules.vue?raw";
import featureHostCoordinatorSource from "../../composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import featureHostModuleSource from "../../composables/workspaceFeatureHostModule.ts?raw";

const featureHostSource = `${featureHostCoordinatorSource}\n${featureHostModuleSource}`;

describe("CloudBackupPage", () => {
  it("lives under more features and reuses marketplace sign-in", () => {
    expect(source).toContain("cloudBackup.cloudBackup");
    expect(messages.cloudBackup.cloudBackupDescription).toContain(
      "同一账号登录"
    );
    expect(source).toContain("cloudBackup.localBackupKey");
    expect(source).not.toContain("password");
    expect(source).not.toContain("authMode");
    expect(sidebarSource).toContain('id: "cloud-backup"');
    expect(sidebarSource).toContain('emit("openCloudBackup")');
    expect(appSource).toContain(
      '@open-cloud-backup="featureHost.openCloudBackup"'
    );
    expect(featureHostSource).toContain('case "cloud-backup":');
    expect(featureHostSource).toContain('return { kind: "cloud-backup" };');
    expect(featureHostSource).toContain(
      'options.view.workspaceMain.value = "cloud-backup"'
    );
    expect(featureModulesSource).toContain(
      "v-else-if=\"module.kind === 'cloud-backup'\""
    );
  });

  it("requires a confirmation dialog before backup or restore writes data", () => {
    expect(previewDialogSource).toContain("confirmContents");
    expect(previewDialogSource).toContain("fileOverview");
    expect(previewDialogSource).toContain("totalFiles");
    expect(source).toContain("confirmPreview");
    expect(previewDialogSource).toContain("danger-button");
    expect(messages.cloudBackup.uploadDescription).toContain("100 MB");
  });

  it("keeps status in the shared settings store and coalesces first-entry loading", () => {
    expect(source).toContain("useSettingsStore");
    expect(source).toContain("ensureCloudBackupLoaded");
    expect(source).toContain('invalidate("cloudBackup")');
    expect(source).not.toContain("onMounted");
  });
});
