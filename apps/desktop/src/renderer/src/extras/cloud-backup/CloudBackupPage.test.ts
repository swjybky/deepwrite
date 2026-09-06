import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../../test-utils/sourceText";
import source from "./CloudBackupPage.vue?raw";
import previewDialogSource from "./CloudBackupPreviewDialog.vue?raw";
import appSource from "../../WorkspaceShell.vue?raw";
import sidebarSource from "../../components/LeftSidebar.vue?raw";
import featureModulesSource from "../../components/WorkspaceFeatureModules.vue?raw";
import featureHostCoordinatorSource from "../../composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import featureHostModuleSource from "../../composables/workspaceFeatureHostModule.ts?raw";

const featureHostSource = `${featureHostCoordinatorSource}\n${featureHostModuleSource}`;

describe("CloudBackupPage", () => {
  it("lives under more features and never asks the user to log in", () => {
    expect(source).toContain("云端备份");
    expect(source).toContain("无需登录");
    expect(source).toContain("本机备份密钥");
    expect(source).not.toContain("password");
    expect(source).not.toContain("authMode");
    expectSourceToContain(
      sidebarSource,
      '{ id: "cloud-backup", label: "云端备份"'
    );
    expect(sidebarSource).toContain('emit("openCloudBackup")');
    expect(appSource).toContain('@open-cloud-backup="openCloudBackup"');
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
    expect(previewDialogSource).toContain("确认同步内容");
    expect(previewDialogSource).toContain("文件列表概览");
    expect(previewDialogSource).toContain("文件总数");
    expect(source).toContain("confirmPreview");
    expect(previewDialogSource).toContain("danger-button");
    expect(source).toContain("100 MB");
  });

  it("keeps status in the shared settings store and coalesces first-entry loading", () => {
    expect(source).toContain("useSettingsStore");
    expect(source).toContain("ensureCloudBackupLoaded");
    expect(source).toContain('invalidate("cloudBackup")');
    expect(source).not.toContain("onMounted");
  });
});
