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

  it("keeps books and libraries below the three top-level sections", () => {
    expect(resourceSections[0]?.nodes.map((node) => node.label)).toEqual([
      "雾港回声 · 短篇",
      "雾港来信"
    ]);
    expect(resourceSections[0]?.nodes[0]?.children?.map((node) => node.label)).toEqual([
      "人物",
      "剧情",
      "大纲",
      "正文"
    ]);
    expect(resourceSections[0]?.nodes[1]?.children?.map((node) => node.label)).toEqual([
      "世界观",
      "人物",
      "剧情",
      "长篇正文",
      "状态账本"
    ]);
    expect(resourceSections[1]?.nodes.map((node) => node.label)).toEqual([
      "官方通用技能库",
      "我的技能库"
    ]);
    expect(resourceSections[2]?.nodes.map((node) => node.label)).toEqual([
      "雾港素材库",
      "写作摘录"
    ]);
  });

  it("resolves selected tree leaves to right-pane content", () => {
    expect(findWorkspaceDocument("short-mist:draft")).toMatchObject({
      title: "正文",
      domain: "creation",
      workspaceType: "short",
      stageId: "draft"
    });
    expect(findWorkspaceDocument("chapter-3")).toMatchObject({
      title: "第三章 雨夜回声",
      domain: "creation"
    });
    expect(findWorkspaceDocument("skill-continue")?.readOnly).toBe(true);
  });
});
