import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import sidebarSource from "./LeftSidebar.vue?raw";
import resourceListSource from "./SidebarResourceList.vue?raw";
import source from "./TreeSection.vue?raw";

describe("TreeSection resource actions", () => {
  it("offers legacy library import from the skill and material add menus", () => {
    expect(source).toContain('id: "import-legacy-library"');
    expect(source).toContain("label: `导入旧版${resourceName}`");
    expect(source).toContain('icon: "archive"');
    expect(source).toContain('id: "import-external-library"');
    expect(source).toContain("从文件或文件夹导入");
    expect(source.indexOf('id: "import-external-library"')).toBeGreaterThan(
      source.indexOf('id: "import-legacy-library"')
    );
  });

  it("uses unified creation, opening, and importing entries", () => {
    expect(source).toContain('props.section.id === "creation" ? "新建作品"');
    expect(source).not.toContain('id: "create-long-book"');
    expect(source).toContain(
      'id: props.section.id === "creation" ? "choose-open-book" : "import"'
    );
    expect(source).toContain('"打开已有作品"');
    expect(source).toContain('id: "choose-import-book"');
    expect(source).toContain('label: "导入已有作品"');
    expect(source).not.toContain('label: "打开已存在长篇"');
    expect(source).not.toContain('label: "导入 DeepWrite 长篇工程"');
    expect(source).not.toContain('label: "迁移 Write Claw 长篇"');
    expect(source).not.toContain('label: "导入旧版书籍"');
  });

  it("forwards the independent long-book node action through the sidebar", () => {
    expect(source).toContain(
      "@long-book-action=\"emit('longBookAction', $event)\""
    );
    expect(resourceListSource.match(/@long-book-action=/gu)).toHaveLength(2);
    expect(source).not.toContain("longStructureAction");
    expect(sidebarSource).not.toContain("longStructureAction");
    expect(sidebarSource).toContain(
      "longBookAction: [payload: LongBookResourceNodeActionPayload]"
    );
  });

  it("forwards long draft section creation through the sidebar tree", () => {
    expect(source).toContain(
      "createLongDraftSection: [node: ResourceTreeNode]"
    );
    expect(source).toContain(
      "@create-long-draft-section=\"emit('createLongDraftSection', $event)\""
    );
    expect(sidebarSource).toContain(
      "createLongDraftSection: [node: ResourceTreeNode]"
    );
    expect(
      resourceListSource.match(/@create-long-draft-section=/gu)
    ).toHaveLength(2);
  });

  it("forwards long draft section move and delete actions through the sidebar tree", () => {
    expectSourceToContain(
      source,
      'longDraftSectionAction: [action: "move-up" | "move-down" | "delete", node: ResourceTreeNode]'
    );
    expectSourceToContain(
      source,
      "@long-draft-section-action=\"(action, sectionNode) => emit('longDraftSectionAction', action, sectionNode)\""
    );
    expectSourceToContain(
      sidebarSource,
      'longDraftSectionAction: [action: "move-up" | "move-down" | "delete", node: ResourceTreeNode]'
    );
    expect(
      resourceListSource.match(/@long-draft-section-action=/gu)
    ).toHaveLength(2);
  });

  it("forwards draft section ordering actions through the normal resource tree", () => {
    expectSourceToContain(
      source,
      'expertSectionAction: [action: "move-up" | "move-down", node: ResourceTreeNode]'
    );
    expectSourceToContain(
      source,
      "@expert-section-action=\"(action, sectionNode) => emit('expertSectionAction', action, sectionNode)\""
    );
    expect(resourceListSource.match(/@expert-section-action=/gu)).toHaveLength(
      2
    );
  });
});
