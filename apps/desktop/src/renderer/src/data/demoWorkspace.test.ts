import { describe, expect, it } from "vitest";
import { findWorkspaceDocument, resourceSections } from "./demoWorkspace";

describe("demo workspace contract", () => {
  it("keeps the three user-requested resource trees in order", () => {
    expect(resourceSections.map((section) => section.label)).toEqual([
      "创作空间",
      "技能库",
      "素材库"
    ]);
  });

  it("resolves selected tree leaves to right-pane content", () => {
    expect(findWorkspaceDocument("chapter-3")).toMatchObject({
      title: "第三章 雨夜回声",
      domain: "creation"
    });
    expect(findWorkspaceDocument("skill-continue")?.readOnly).toBe(true);
  });
});
