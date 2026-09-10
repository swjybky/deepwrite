import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import sidebarSource from "./LeftSidebar.vue?raw";
import profileSource from "./SidebarProfileMenu.vue?raw";
const source = `${sidebarSource}\n${profileSource}`;

describe("LeftSidebar account controls", () => {
  it("separates the account menu from the settings-page button", () => {
    expect(source).toContain('@click="toggleAccountMenu"');
    expect(source).toContain('aria-label="打开设置"');
    expect(source).toContain('@click="openSettings"');
    expect(source).not.toContain("@click=\"emit('openSettings')\"");
  });

  it("offers settings, updates and author contact without local name editing", () => {
    expect(source).toContain("<span>设置</span>");
    expect(source).toContain('@click="openSettings"');
    expect(source).toContain("<span>版本更新</span>");
    expect(source).toContain("联系作者");
    expect(source).toContain('profileDialog.value = "contact"');
    expect(source).not.toContain("<span>姓名</span>");
    expect(source).not.toContain("openNameDialog");
    expect(source).not.toContain("设置姓名");
  });

  it("shows the requested author contact without local name persistence", () => {
    expect(source).not.toContain("USER_NAME_STORAGE_KEY");
    expect(source).not.toContain("saveUserName");
    expect(source).not.toContain("userNameDraft");
    expect(source).toContain(
      "如果你有任何反馈，或者想体验最新版本，请添加作者微信并加入交流群。"
    );
    expect(source).toContain("deepseekwrite");
  });

  it("prefers the signed-in marketplace display name", () => {
    expect(source).toContain("marketplaceDisplayName?: string | undefined");
    expect(source).toContain(
      "props.marketplaceDisplayName?.trim() || DEFAULT_USER_NAME"
    );
    expectSourceToContain(source, "{{ displayedUserName }}");
  });

  it("shows a background-running marker for learning imitation", () => {
    expect(source).toContain("imitationRunning");
    expect(source).toContain("nav-background-status");
    expect(source).toContain("后台中");
  });

  it("turns the top action into create-book instead of a new conversation", () => {
    expect(source).toContain('label: "新建书籍"');
    expect(source).toContain('id: "create-book"');
    expect(source).toContain('aria-label="新建书籍"');
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

  it("moves learning imitation into more features and keeps its state feedback", () => {
    const primaryFeatures = source.slice(
      source.indexOf("const navItems"),
      source.indexOf("const moreFeatures")
    );
    const moreFeatures = source.slice(
      source.indexOf("const moreFeatures"),
      source.indexOf("function activateMoreFeature")
    );

    expect(primaryFeatures).not.toContain('label: "短篇学习仿写"');
    expectSourceToContain(
      moreFeatures,
      '{ id: "imitation", label: "短篇学习仿写"'
    );
    expect(source).toContain('emit("openDialog", "imitation")');
    expect(source).toContain("feature.id === props.activePrimaryFeature");
    expect(source).toContain(
      "feature.id === 'imitation' && props.imitationRunning"
    );
  });

  it("adds the skill marketplace to more features while keeping runtime settings", () => {
    expectSourceToContain(
      source,
      '{ id: "skill-marketplace", label: "技能广场"'
    );
    expect(source).toContain('emit("openMarketplace")');
    expectSourceToContain(source, '{ id: "cloud-backup", label: "云端备份"');
    expect(source).toContain('emit("openCloudBackup")');
    expectSourceToContain(
      source,
      '{ id: "zhuque-detection", label: "朱雀检测"'
    );
    expect(source).toContain('emit("openZhuqueDetection")');
    expectSourceToContain(source, '{ id: "runtime", label: "运行设置"');
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
    expect(source).toContain("正在安全退出并准备安装…");
    expect(source).toContain(':disabled="updateInstalling"');
    expect(source).toContain("正在安装…");
  });
});
