import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import moreFeaturesSource from "./sidebarMoreFeatures.ts?raw";
import sidebarSource from "./LeftSidebar.vue?raw";
import profileSource from "./SidebarProfileMenu.vue?raw";
import updateDialogSource from "./VersionUpdateDialog.vue?raw";
const source = `${sidebarSource}\n${profileSource}\n${updateDialogSource}\n${moreFeaturesSource}`;

describe("LeftSidebar account controls", () => {
  it("opens settings through the account menu", () => {
    expect(source).toContain('@click="toggleAccountMenu"');
    expect(source).toContain("openSettings");
    expect(source).toContain('@click="openSettings"');
    expect(source).not.toContain("@click=\"emit('openSettings')\"");
  });

  it("offers settings, updates and author contact without local name editing", () => {
    expect(source).toContain("settings");
    expect(source).toContain('@click="openSettings"');
    expect(source).toContain("updates");
    expect(source).toContain("contactAuthor");
    expect(source).toContain('profileDialog.value = "contact"');
    expect(source).not.toContain("<span>姓名</span>");
    expect(source).not.toContain("openNameDialog");
    expect(source).not.toContain("设置姓名");
  });

  it("shows the requested author contact without local name persistence", () => {
    expect(source).not.toContain("USER_NAME_STORAGE_KEY");
    expect(source).not.toContain("saveUserName");
    expect(source).not.toContain("userNameDraft");
    expect(source).toContain("forFeedbackOrEarlyAccessToNewVersionsAdd");
    expect(source).toContain("deepseekwrite");
  });

  it("prefers the signed-in marketplace display name", () => {
    expect(source).toContain("marketplaceDisplayName?: string | undefined");
    expect(source).toContain("props.marketplaceDisplayName?.trim()");
    expectSourceToContain(source, "{{ displayedUserName }}");
  });

  it("offers sign-in or sign-out from the avatar and gates feedback", () => {
    expect(source).toContain('v-if="!marketplaceSignedIn"');
    expect(source).toContain('@click="signIn"');
    expect(source).toContain('v-if="marketplaceSignedIn"');
    expect(source).toContain('@click="signOut"');
    expect(source).toContain(
      "requireMarketplaceLogin(props.marketplaceSignedIn === true"
    );
    expect(source).toContain(
      "@marketplace-signed-out=\"emit('marketplaceSignedOut', $event)\""
    );
  });

  it("shows a background-running marker for running analyses", () => {
    expect(source).toContain("revisionAnalysisRunning");
    expect(source).toContain("nav-background-status");
    expect(source).toContain("inBackground");
  });

  it("turns the top action into create-book instead of a new conversation", () => {
    expect(source).toContain("newBook");
    expect(source).toContain('id: "create-book"');
    expect(source).toContain("newBook");
    expect(source).toContain('emit("createBook")');
    expect(source).not.toContain('label: "新建对话"');
    expect(source).not.toContain("newConversation");
  });

  it("keeps agent-team management in the primary navigation", () => {
    expect(source).toContain('id: "agent-teams"');
    expect(source).toContain('emit("openAgentTeams")');
    expect(source).toContain("props.activePrimaryFeature");
    expect(source).toContain("'is-active'");
    expect(source).toContain("'page'");
  });

  it("no longer offers the retired learning-imitation feature", () => {
    expect(moreFeaturesSource).not.toContain("短篇学习仿写");
    expect(moreFeaturesSource).not.toContain('"imitation"');
    expect(source).not.toContain("imitation");
    expect(source).toContain("feature.id === props.activePrimaryFeature");
    expectSourceToContain(
      source,
      "feature.id === 'long-book-analysis' && props.longBookAnalysisRunning"
    );
  });

  it("includes marketplace features without the runtime settings entry", () => {
    expectSourceToContain(source, "skillMarketplace");
    expect(source).toContain('emit("openMarketplace")');
    expectSourceToContain(source, "cloudBackup");
    expect(source).toContain('emit("openCloudBackup")');
    expectSourceToContain(source, "aITextDetection");
    expect(source).toContain('emit("openZhuqueDetection")');
    expect(moreFeaturesSource).not.toContain('id: "runtime"');
    expect(moreFeaturesSource).not.toContain("运行设置");
    expect(source).not.toContain('{ id: "history", label: "版本历史"');
    expect(source).not.toContain('{ id: "search", label: "全局检索"');
    expect(source).not.toContain('{ id: "transfer", label: "导入与导出"');
    expect(source).toContain('@click="activateMoreFeature(feature.id)"');
  });

  it("shows and locks the update dialog while macOS hands off to the installer", () => {
    expectSourceToContain(
      source,
      'const updateInstalling = computed(() => updateState.value.status === "installing")'
    );
    expect(source).toContain("savingAndPreparingToInstall");
    expect(source).toContain(':disabled="updateInstalling"');
    expect(source).toContain("installing");
  });
});
