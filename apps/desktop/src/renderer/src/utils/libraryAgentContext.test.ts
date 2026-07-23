import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "@deepwrite/contracts";
import type { WorkspaceDocument } from "../types/workspace";
import { buildLibraryAgentWorkspaceContext } from "./libraryAgentContext";

const now = "2026-07-23T00:00:00.000Z";

function snapshot(): CatalogSnapshot {
  return {
    schemaVersion: 1,
    revision: 1,
    updatedAt: now,
    books: [],
    materials: [
      {
        id: "material-1",
        title: "人物素材",
        materialType: "short",
        materialKind: "character",
        parentGenre: "",
        subGenre: "",
        overview: "库介绍",
        projectRevision: 3,
        createdAt: now,
        updatedAt: now,
        entries: [
          {
            id: "entry-1",
            stageId: "character",
            title: "甲",
            body: "磁盘内容",
            createdAt: now,
            updatedAt: now
          }
        ]
      }
    ],
    materialGroups: [],
    skills: [
      {
        id: "skill-1",
        title: "官方技能",
        skillType: "short",
        skillKind: "general",
        overview: "说明",
        isBuiltin: true,
        createdAt: now,
        updatedAt: now,
        entries: [
          {
            id: "skill-entry-1",
            stageId: "outline",
            title: "列大纲",
            body: "方法",
            createdAt: now,
            updatedAt: now
          }
        ]
      }
    ],
    skillGroups: [],
    projectDiagnostics: []
  };
}

function document(overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    id: "catalog:material-entry:material-1:entry-1",
    domain: "material",
    title: "甲（草稿）",
    eyebrow: "素材",
    path: ["人物素材", "甲"],
    content: "实时草稿",
    libraryId: "material-1",
    catalogEntryId: "entry-1",
    stageCategoryId: "character",
    ...overrides
  };
}

describe("buildLibraryAgentWorkspaceContext", () => {
  it("只复制当前资料库并优先使用实时编辑器内容", () => {
    const active = document();
    const result = buildLibraryAgentWorkspaceContext(snapshot(), active, [active]);

    expect(result).toMatchObject({
      domain: "material",
      libraryId: "material-1",
      activeEntryId: "entry-1",
      projectRevision: 3,
      entries: [{ id: "entry-1", title: "甲（草稿）", content: "实时草稿" }]
    });
    expect(JSON.stringify(result)).not.toContain("列大纲");
  });

  it("官方技能库的所有条目保持只读", () => {
    const active = document({
      id: "catalog:skill-entry:skill-1:skill-entry-1",
      domain: "skill",
      title: "列大纲",
      content: "方法",
      libraryId: "skill-1",
      catalogEntryId: "skill-entry-1",
      stageCategoryId: "outline",
      readOnly: true
    });
    const result = buildLibraryAgentWorkspaceContext(snapshot(), active, [active]);

    expect(result?.readOnly).toBe(true);
    expect(result?.entries[0]?.readOnly).toBe(true);
  });

  it("不为创作文档构造资料库上下文", () => {
    const creationDocument: WorkspaceDocument = {
      id: "book-outline",
      domain: "creation",
      title: "大纲",
      eyebrow: "短篇",
      path: ["书籍", "大纲"],
      content: ""
    };
    expect(
      buildLibraryAgentWorkspaceContext(
        snapshot(),
        creationDocument,
        []
      )
    ).toBeUndefined();
  });
});
