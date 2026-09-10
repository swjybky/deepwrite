import { describe, expect, it } from "vitest";
import {
  expectSourceToContain,
  sourceTextIndexOf
} from "../../../test-utils/sourceText";
import source from "./SkillMarketplacePage.vue?raw";
import appSource from "../WorkspaceShell.vue?raw";
import featureModulesSource from "./WorkspaceFeatureModules.vue?raw";
import featureHostCoordinatorSource from "../composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import featureHostModuleSource from "../composables/workspaceFeatureHostModule.ts?raw";
import sidebarSource from "./LeftSidebar.vue?raw";

const featureHostSource = `${featureHostCoordinatorSource}\n${featureHostModuleSource}`;

describe("SkillMarketplacePage", () => {
  it("gates the marketplace behind login or registration and keeps the HTTP warning visible", () => {
    expect(source).toContain("initialSession?: MarketplaceSession | null");
    expect(source).toContain("props.initialSession ?? null");
    expect(source).toContain('v-else-if="session === null"');
    expect(source).toContain("正在恢复登录状态…");
    expect(source).toContain('v-else-if="!authenticated"');
    expect(source).toContain('authMode === "login"');
    expect(source).toContain("marketplace.register");
    expect(source).toContain("marketplace.login");
    expect(source).toContain("连接未加密");
    expect(source).toContain("用户名、密码和会话令牌在传输中可能被窃听");
  });

  it("removes Electron and marketplace error wrappers from visible feedback", () => {
    expect(source).toContain("[A-Za-z_$][\\w$]*Error");
    expect(source).toContain("Error invoking remote method");
  });

  it("supports all browse filters, details, optimistic likes and safe Markdown", () => {
    expect(source).toContain("contentTypeOptions");
    expect(source).toContain("kindOptions");
    expect(source).toContain("libraryTypeOptions");
    expect(source).toContain("sortOptions");
    expect(source).toContain("applyLikeLocally");
    expect(source).toContain("已恢复原状态");
    expect(source).toContain("<MarkdownContent");
    expect(source).not.toContain("v-html");
    expect(source).not.toContain("<select");
  });

  it("refreshes the browse results from the action immediately before search", () => {
    const refreshButton = sourceTextIndexOf(source, '@click="loadBrowse()"');
    const searchButton = sourceTextIndexOf(
      source,
      'type="submit" :disabled="loading">搜索</button>'
    );

    expect(refreshButton).toBeGreaterThan(-1);
    expect(searchButton).toBeGreaterThan(refreshButton);
    expect(source).toContain('{{ loading ? "刷新中…" : "刷新" }}');
  });

  it("loads the marketplace in server-backed pages of 20 items", () => {
    expect(source).toContain("const PAGE_SIZE = 20");
    expect(source).toContain("pageSize: PAGE_SIZE");
    expect(source).toContain('@submit.prevent="loadBrowse(1)"');
    expect(source).toContain('aria-label="技能广场分页"');
    expect(source).toContain("changeBrowsePage(browsePage + 1)");
    expect(source).toContain(
      "共 {{ browseTotal }} 条 · 每页 {{ PAGE_SIZE }} 条"
    );
  });

  it("shows only the skill-library category beside each browse card content type", () => {
    expect(source).toContain('style: "文风"');
    expectSourceToContain(source, "{{ KIND_LABELS[item.kind] }}");
    expect(source).not.toContain("{{ LIBRARY_TYPE_LABELS[item.libraryType] }}");
  });

  it("publishes, edits and deletes all three content types", () => {
    expect(source).toContain("发布单技能");
    expect(source).toContain("发布技能库");
    expect(source).toContain("发布技能组");
    expect(source).toContain("marketplace.publish");
    expect(source).toContain("marketplace.update");
    expect(source).toContain("marketplace.delete");
    expect(source).toContain("MARKETPLACE_CONTENT_MAX_CHARACTERS");
    expect(source).toContain(':maxlength="MARKETPLACE_CONTENT_MAX_CHARACTERS"');
    expect(source).not.toContain('maxlength="40000"');
    expect(source).toContain("danger-button");
    expect(source).toContain("重新进入待审核状态");
  });

  it("lets authors control plaza visibility and explains delayed deletion", () => {
    expect(source).toContain("marketplace.setEnabled");
    expect(source).toContain('role="switch"');
    expect(source).toContain("只有启用且审核通过的内容才会显示在广场");
    expectSourceToContain(source, "服务端保留 10 天后再永久清理");
    expect(source).toContain('deleted: "已删除"');
  });

  it("publishes skill groups directly from local catalog groups", () => {
    expect(source).toContain("catalogSnapshot?.skillGroups");
    expect(source).toContain("localSkillGroupOptions");
    expect(source).toContain("localLibrariesForGroup");
    expect(source).toContain("本地技能分组");
    expect(source).toContain("libraries: publishGroupLibraries.value.map");
    expect(source).toContain("loadMarketplacePublishLibraryContent");
    expect(source).toContain("hydrateLocalPublishContents");
    expect(source).toContain("catalogDocumentReader");
    expect(source).toContain("reader?.readDocument");
    expect(source).not.toContain("content: entry.body");
    expect(source).not.toContain("本人已公开发布的远程成员");
    expect(source).not.toContain("publishedGroupCandidates");
  });

  it("copies reactive collections before crossing the Electron context bridge", () => {
    expectSourceToContain(
      source,
      "entries: publishEntries.value.map(({ stageId, title: entryTitle, content })"
    );
    expect(source).toContain("libraries: publishGroupLibraries.value.map");
    expect(source).toContain("...installTypeSelections.value");
    expect(source).not.toMatch(/entries:\s*publishEntries\.value\s*[,}]/u);
    expect(source).not.toMatch(/items:\s*publishGroupItems\.value\s*[,}]/u);
  });

  it("previews grouped installation and uses PopupSelect for mixed local types", () => {
    expect(source).toContain("marketplace.previewInstall");
    expect(source).toContain("marketplace.install");
    expect(source).toContain("installTypeSelections");
    expect(source).toContain("<PopupSelect");
    expect(source).toContain("{{ installPreview.orderNotice }}");
    expect(source).toContain("installTargetLibraryOptions");
    expect(source).toContain("安装到技能库");
    expect(source).toContain("targetLibraryId: installTargetLibraryId.value");
  });

  it("keeps long detail and install content scrollable inside the modal", () => {
    expect(source).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expectSourceToContain(
      source,
      "min-height: 0; overflow-x: hidden; overflow-y: auto"
    );
  });

  it("shows library skill tabs and two-level category/skill tabs for group details", () => {
    expect(source).toContain('role="tablist"');
    expect(source).toContain('aria-label="选择技能组分类"');
    expect(source).toContain('aria-label="选择要查看的技能"');
    expect(source).toContain("detailSkillSections");
    expect(source).toContain("selectedDetailSectionId");
    expect(source).toContain("KIND_LABELS[section.kind]");
    expect(source).toContain("selectedDetailSkillId");
    expect(source).toContain("loadedDetail.items.map");
    expect(source).toContain("memberDetail.skills");
    expect(source).toContain('role="tabpanel"');
    expect(source).not.toContain('v-for="item in detailMarkdownItems"');
  });

  it("is reachable from More Features and mounted as a workspace page", () => {
    expect(sidebarSource).toContain('id: "skill-marketplace"');
    expect(sidebarSource).toContain('emit("openMarketplace")');
    expect(featureModulesSource).toContain("<SkillMarketplacePage");
    expect(appSource).toContain(
      '@open-marketplace="featureHost.openMarketplace"'
    );
  });

  it("keeps the sidebar identity synchronized with marketplace sessions", () => {
    expect(source).toContain('emit("sessionChange", nextSession)');
    expect(featureHostSource).toContain(
      "async function loadMarketplaceSession()"
    );
    expect(appSource).toContain(
      ':marketplace-display-name="marketplaceDisplayName"'
    );
    expect(featureHostCoordinatorSource).toContain(
      "knownMarketplaceSession.value"
    );
    expect(featureHostModuleSource).toContain("session: marketplaceSession");
    expect(featureModulesSource).toContain(':initial-session="module.session"');
    expect(featureModulesSource).toContain(
      "@session-change=\"emit('marketplaceSessionChange', $event)\""
    );
    expect(appSource).toContain(
      '@marketplace-session-change="featureHost.applyMarketplaceSession"'
    );
  });
});
