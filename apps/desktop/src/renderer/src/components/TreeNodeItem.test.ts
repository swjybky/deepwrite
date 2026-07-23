import { describe, expect, it } from "vitest";
import source from "./TreeNodeItem.vue?raw";

describe("TreeNodeItem actions", () => {
  it("places add on the draft parent and delete in each section menu", () => {
    expect(source).toContain('props.node.shortAgentId === "expert_draft_coordinator"');
    expect(source).toContain('props.node.shortAgentId === "expert_section_writer"');
    expect(source).toContain("emit(\"createExpertSection\", props.node)");
    expect(source).toContain("emit(\"removeExpertSection\", props.node)");
    expect(source).toContain('title="新建小节"');
    expect(source).toContain("<span>删除小节</span>");
  });

  it("raises the whole action area while its menu is open", () => {
    expect(source).toContain(":class=\"{ 'is-menu-open': actionMenuOpen }\"");
    expect(source).toMatch(
      /\.tree-node-action-area\.is-menu-open\s*\{\s*z-index:\s*30;\s*\}/
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
});
