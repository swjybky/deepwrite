import { describe, expect, it } from "vitest";
import source from "./TreeNodeItem.vue?raw";

describe("TreeNodeItem expert draft actions", () => {
  it("places add on the draft parent and delete in each section menu", () => {
    expect(source).toContain('props.node.shortAgentId === "expert_draft_coordinator"');
    expect(source).toContain('props.node.shortAgentId === "expert_section_writer"');
    expect(source).toContain("emit(\"createExpertSection\", props.node)");
    expect(source).toContain("emit(\"removeExpertSection\", props.node)");
    expect(source).toContain('title="新建小节"');
    expect(source).toContain("<span>删除小节</span>");
  });
});
