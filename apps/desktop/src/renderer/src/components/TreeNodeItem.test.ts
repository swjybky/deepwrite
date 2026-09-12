import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import styles from "virtual:deepwrite-renderer-styles";
import source from "./TreeNodeItem.vue?raw";
import longMenuSource from "./LongBookActionMenu.vue?raw";

describe("TreeNodeItem actions", () => {
  it("uses the shared neutral badge style for every workspace type", () => {
    expect(source).toContain('class="tree-badge"');
    expect(source).not.toContain(
      "'is-script': node.workspaceType === 'script'"
    );
  });

  it("places the expand chevron after number and text/list badges", () => {
    expect(source.indexOf('class="tree-badge"')).toBeGreaterThan(-1);
    expect(source.indexOf('class="tree-chevron"')).toBeGreaterThan(
      source.indexOf('class="tree-badge"')
    );
    expect(source).not.toContain("catalogNodeType !== 'book'");
  });

  it("selects a selectable branch immediately whether it opens or collapses", () => {
    expect(source).toContain("open.value = !open.value;");
    expect(source).toContain("if (props.node.selectableBranch)");
    expect(source).not.toContain("opening && props.node.selectableBranch");
  });

  it("offers adding a manuscript section from each long draft volume", () => {
    expect(source).toContain("Boolean(props.node.longDraftVolumeId)");
    expect(source).toContain("isLongDraftVolume");
    expect(source).toContain("'新增小节'");
    expect(source).toContain("`在${node.label}新增小节`");
    expect(source).toContain("createLongDraftSection()");
    expect(source).toContain('emit("createLongDraftSection", props.node)');
    expect(source).not.toContain("<span>新增小节</span>");
  });

  it("mirrors chapter-card move and delete actions on each long draft section", () => {
    expect(source).toContain("isLongDraftSection");
    expect(source).toContain(
      'props.node.longWorkspaceSelection?.root === "draft"'
    );
    expect(source).toContain(
      "Boolean(props.node.longWorkspaceSelection?.chapterCardId)"
    );
    expect(source).toContain("longDraftSectionAction('move-up')");
    expect(source).toContain("longDraftSectionAction('move-down')");
    expect(source).toContain("longDraftSectionAction('delete')");
    expect(source).toContain(':disabled="longDraftSectionMoveUpDisabled"');
    expect(source).toContain(':disabled="longDraftSectionMoveDownDisabled"');
    expect(source).toContain(
      'emit("longDraftSectionAction", action, props.node)'
    );
  });

  it("places add on the draft parent and ordering plus delete in each section menu", () => {
    expect(source).toContain('props.node.stageCategoryId === "draft"');
    expect(source).toContain("!props.node.expertSectionId");
    expect(source).toContain("Boolean(props.node.expertSectionId)");
    expect(source).toContain('emit("createExpertSection", props.node)');
    expect(source).toContain('emit("removeExpertSection", props.node)');
    expect(source).toContain("expertSectionAction('move-up')");
    expect(source).toContain("expertSectionAction('move-down')");
    expect(source).toContain(':disabled="expertSectionMoveUpDisabled"');
    expect(source).toContain(':disabled="expertSectionMoveDownDisabled"');
    expect(source).toContain(
      'props.node.workspaceType === "script" ? "剧集" : "小节"'
    );
    expect(source).toContain("isCharacterDirectory");
    expect(source).toContain("`新建${draftUnitLabel}`");
    expect(source).toContain("<span>删除{{ draftUnitLabel }}</span>");
  });

  it("provides character item creation and ordered item actions", () => {
    expect(source).toContain("createCharacterItem");
    expect(source).toContain("characterItemAction('rename')");
    expect(source).toContain("characterItemAction('move-up')");
    expect(source).toContain("characterItemAction('move-down')");
    expect(source).toContain("characterItemAction('delete')");
  });

  it("uses parent add and a fixed three-action menu for long left-tree items", () => {
    expect(source).toContain("isLongTreeCollection");
    expect(source).toContain("createLongTreeItem()");
    expect(source).toContain('emit("createLongTreeItem", props.node)');
    expect(source).toContain("isLongTreeItem");
    const itemMenu = source.slice(
      source.indexOf('<template v-else-if="isLongTreeItem">'),
      source.indexOf('<template v-else-if="isLongDraftSection">')
    );
    expect(itemMenu).toContain("longTreeItemAction('move-up')");
    expect(itemMenu).toContain("longTreeItemAction('move-down')");
    expect(itemMenu).toContain("longTreeItemAction('delete')");
    expect(itemMenu).toContain("@click.stop");
    expect(itemMenu).toContain("<span>上移</span>");
    expect(itemMenu).toContain("<span>下移</span>");
    expect(itemMenu).toContain("<span>删除</span>");
    expect(itemMenu).not.toContain("修改名称");
    expect(source).toContain("isFirstLongTreeItem(child)");
    expect(source).toContain("isLastLongTreeItem(child)");
    expect(source).toContain(
      ':disabled="longTreeActionsDisabled || longTreeItemMoveUpDisabled"'
    );
    expect(source).toContain(
      ':disabled="longTreeActionsDisabled || longTreeItemMoveDownDisabled"'
    );
  });

  it("offers deletion on every ledger row and disables older records", () => {
    expect(source).toContain("isLongLedgerCommit");
    expect(source).toContain("Boolean(props.node.longLedgerCommit)");
    expect(source).toContain('emit("deleteLongLedgerCommit", props.node)');
    const menu = source.slice(
      source.indexOf('<template v-if="isLongLedgerCommit">'),
      source.indexOf('<template v-else-if="isLongTreeItem">')
    );
    expect(menu).toContain("<span>{{");
    expect(menu).toContain('"删除记录"');
    expect(menu).toContain('"删除记录（请先删除最后一条）"');
    expect(menu).toContain("!node.longLedgerCommit?.deletable");
    expect(menu).toContain("请先删除最后一条提交记录");
    expect(menu).toContain("is-danger");
  });

  it("keeps long character creation out of the resource tree", () => {
    expect(source).not.toContain("isLongCharacterGroup");
    expect(source).not.toContain('title="新增人物"');
    expect(source).not.toContain("createLongCharacter");
  });

  it("hides row chevron and action icons until the row or action area is hovered", () => {
    expect(styles).toContain(".tree-row:hover .tree-chevron,");
    expect(styles).toContain(".tree-row:focus-visible .tree-chevron,");
    expectSourceToContain(
      styles,
      ".tree-node:has(> .tree-node-action-area:is(:hover, :focus-within, .is-menu-open)) > .tree-row .tree-chevron"
    );
    expect(styles).toContain(
      ".tree-row:hover ~ .tree-node-action-area .tree-node-action,"
    );
    expectSourceToContain(
      styles,
      ".tree-node-action-area:is(:hover, :focus-within, .is-menu-open) .tree-node-action"
    );
    expect(styles).not.toContain(".section-action { opacity: 0");
    expect(styles).not.toContain(".section-toggle-chevron { opacity: 0");
  });

  it("raises the whole action area while its menu is open", () => {
    expect(source).toContain(":class=\"{ 'is-menu-open': actionMenuOpen }\"");
    expect(source).toMatch(
      /\.tree-node-action-area\.is-menu-open\s*\{\s*z-index:\s*30;\s*\}/
    );
  });

  it("opens the action menu upward when the sidebar has more room above", () => {
    expect(source).toContain('area.closest<HTMLElement>(".sidebar-scroll")');
    expect(source).toContain(
      "menuHeight > availableBelow && availableAbove > availableBelow"
    );
    expect(source).toContain(
      ":class=\"{ 'opens-upward': actionMenuOpensUpward }\""
    );
    expect(source).toMatch(
      /\.tree-node-action-menu\.opens-upward\s*\{\s*top:\s*auto;\s*bottom:\s*calc\(100% \+ 3px\);\s*\}/
    );
  });

  it("opens the manuscript export dialog below material binding without an inline format list", () => {
    expect(source).toContain("<span>导出正文</span>");
    expect(source).not.toContain("['docx', 'txt', 'epub'] as const");
    expect(source).toContain('emit("exportBook", props.node)');
    expect(source.indexOf("<span>导出正文</span>")).toBeGreaterThan(
      source.indexOf("<span>素材库绑定</span>")
    );
  });

  it("offers copy on library entries and paste on writable libraries", () => {
    expect(source).toContain("activateResourceNodeAction('copy-entry')");
    expect(source).toContain("<span>复制</span>");
    expect(source).toContain("activateResourceNodeAction('paste-entry')");
    expect(source).toContain("<span>粘贴</span>");
    expect(source).toContain("canPasteLibraryEntry");
    expect(source).toContain("libraryEntryClipboardDomain");
    expect(source).toContain("<span>删除条目文件</span>");
  });

  it("offers library and entry rename plus same-domain drag and drop", () => {
    expect(source).toContain("rename-library");
    expect(source).toContain("rename-entry");
    expect(source).toContain("application/x-deepwrite-library-entry-");
    expect(source).toContain("moveLibraryEntry");
    expect(source).toContain("beforeEntryId");
  });

  it("enables native row dragging for both catalog entries and creation books", () => {
    expect(source).toContain("creationBookDraggable?: boolean");
    expect(source).toContain(
      ':draggable="canDragLibraryEntry || creationBookDraggable"'
    );
  });

  it("uses an independent action event for long-book nodes", () => {
    expect(source).toContain('props.node.catalogNodeType === "long-book"');
    expect(source).toContain(
      'node: node as LongBookResourceNodeActionPayload["node"]'
    );
    for (const action of [
      "resolve-conflicts",
      "sync-legacy",
      "manage-structure",
      "rename",
      "duplicate",
      "bind-skill",
      "bind-material",
      "unregister",
      "delete"
    ]) {
      expect(longMenuSource).toContain(`activateLongBookAction('${action}')`);
    }
    const longActionFunction = source.slice(
      source.indexOf("function activateLongBookAction"),
      source.indexOf("function activateResourceNodeAction")
    );
    expect(longActionFunction).not.toContain('emit("bookAction"');
  });

  it("offers direct project duplication for books, libraries and groups", () => {
    expect(source).toContain("openBookAction('duplicate')");
    expect(longMenuSource).toContain("activateLongBookAction('duplicate')");
    expect(source).toContain("activateResourceNodeAction('duplicate-library')");
    expect(source).toContain("activateResourceNodeAction('duplicate-group')");
    expect(source).toContain('v-if="!node.unavailable"');
  });

  it("keeps reversible catalog actions neutral and marks disk deletion dangerous", () => {
    const longMenu = longMenuSource;
    expect(longMenu).toContain("<span>结构管理</span>");
    expect(longMenu).toContain("<span>同步旧版本</span>");
    expect(longMenu.indexOf("<span>同步旧版本</span>")).toBeGreaterThan(
      longMenu.indexOf("<span>导出</span>")
    );
    expect(longMenu).toContain("<span>技能库绑定</span>");
    expect(longMenu).toContain("<span>素材库绑定</span>");
    expect(longMenu).not.toContain("导出可迁移项目");
    expect(longMenu).toContain("activateLongBookAction('unregister')");
    expect(longMenu).toContain("activateLongBookAction('delete')");
    expect(longMenu.match(/is-danger/gu)).toHaveLength(1);
  });

  it("keeps long-form content operations out of the resource tree menu", () => {
    expect(source).not.toContain("isLongStructureItem");
    expect(source).not.toContain("activateLongStructureAction");
    expect(source).not.toContain("longStructureAction");
  });
});
