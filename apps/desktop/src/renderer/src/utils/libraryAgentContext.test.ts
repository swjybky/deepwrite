import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "@deepwrite/contracts";
import type { WorkspaceDocument } from "../types/workspace";
import {
  buildLibraryAgentWorkspaceContext,
  buildLibraryEntryComposerReferences
} from "./libraryAgentContext";

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
    expect(result?.readableLibraries).toBeUndefined();
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

  it("includes sibling libraries from the same material group as read-only peers", () => {
    const catalog = snapshot();
    catalog.materials.push({
      id: "material-plot",
      title: "剧情素材",
      materialType: "short",
      materialKind: "plot",
      parentGenre: "",
      subGenre: "",
      overview: "剧情库介绍",
      projectRevision: 1,
      createdAt: now,
      updatedAt: now,
      entries: [
        {
          id: "plot-entry-1",
          stageId: "pacing",
          title: "节奏钩子",
          body: "同分组剧情素材正文",
          createdAt: now,
          updatedAt: now
        }
      ]
    });
    catalog.materialGroups.push({
      id: "material-group-1",
      title: "雾港素材组",
      members: {
        character: "material-1",
        plot: "material-plot"
      },
      createdAt: now,
      updatedAt: now
    });
    const active = document();
    const result = buildLibraryAgentWorkspaceContext(catalog, active, [active]);

    expect(result).toMatchObject({
      groupId: "material-group-1",
      groupTitle: "雾港素材组",
      readableLibraries: [
        { libraryId: "material-1", title: "人物素材", kind: "character" },
        { libraryId: "material-plot", title: "剧情素材", kind: "plot" }
      ]
    });
    expect(result?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entry-1",
          title: "甲（草稿）",
          readOnly: false
        }),
        expect.objectContaining({
          id: "material-plot/plot-entry-1",
          title: "节奏钩子",
          content: "同分组剧情素材正文",
          readOnly: true,
          sourceLibraryId: "material-plot",
          sourceLibraryTitle: "剧情素材"
        })
      ])
    );
  });

  it("includes sibling skill libraries from the same skill group as read-only peers", () => {
    const catalog = snapshot();
    catalog.skills.push({
      id: "skill-style",
      title: "文风技能",
      skillType: "short",
      skillKind: "style",
      overview: "文风说明",
      isBuiltin: false,
      createdAt: now,
      updatedAt: now,
      entries: [
        {
          id: "style-entry-1",
          stageId: "draft",
          title: "去 AI 味",
          body: "同分组文风技能正文",
          createdAt: now,
          updatedAt: now
        }
      ]
    });
    catalog.skillGroups.push({
      id: "skill-group-1",
      title: "短篇方法组",
      members: {
        general: "skill-1",
        style: "skill-style"
      },
      createdAt: now,
      updatedAt: now
    });
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
    const result = buildLibraryAgentWorkspaceContext(catalog, active, [active]);

    expect(result).toMatchObject({
      groupId: "skill-group-1",
      groupTitle: "短篇方法组"
    });
    expect(result?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "skill-style/style-entry-1",
          title: "去 AI 味",
          content: "同分组文风技能正文",
          readOnly: true,
          sourceLibraryId: "skill-style",
          sourceLibraryTitle: "文风技能"
        })
      ])
    );
  });
});

describe("buildLibraryEntryComposerReferences", () => {
  it("lists other entries from the current library and excludes the active one", () => {
    const catalog = snapshot();
    catalog.materials[0]!.entries.push({
      id: "entry-2",
      stageId: "character",
      title: "乙",
      body: "另一条",
      createdAt: now,
      updatedAt: now
    });
    const active = document();
    const peer = document({
      id: "catalog:material-entry:material-1:entry-2",
      catalogEntryId: "entry-2",
      title: "乙",
      content: "另一条",
      path: ["人物素材", "乙"]
    });
    const context = buildLibraryAgentWorkspaceContext(catalog, active, [active, peer]);

    expect(buildLibraryEntryComposerReferences(context)).toEqual([
      {
        id: "catalog:material-entry:material-1:entry-2",
        label: "乙",
        detail: "当前素材库"
      }
    ]);
  });

  it("labels peer group library entries in the composer menu", () => {
    const catalog = snapshot();
    catalog.materials.push({
      id: "material-plot",
      title: "剧情素材",
      materialType: "short",
      materialKind: "plot",
      parentGenre: "",
      subGenre: "",
      overview: "",
      createdAt: now,
      updatedAt: now,
      entries: [
        {
          id: "plot-entry-1",
          stageId: "pacing",
          title: "节奏钩子",
          body: "正文",
          createdAt: now,
          updatedAt: now
        }
      ]
    });
    catalog.materialGroups.push({
      id: "material-group-1",
      title: "雾港素材组",
      members: {
        character: "material-1",
        plot: "material-plot"
      },
      createdAt: now,
      updatedAt: now
    });
    const active = document();
    const context = buildLibraryAgentWorkspaceContext(catalog, active, [active]);

    expect(buildLibraryEntryComposerReferences(context)).toEqual(
      expect.arrayContaining([
        {
          id: "catalog:material-entry:material-plot:plot-entry-1",
          label: "节奏钩子",
          detail: "分组 · 剧情素材"
        }
      ])
    );
  });

  it("labels skill-library entries for the composer menu", () => {
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
    const context = buildLibraryAgentWorkspaceContext(snapshot(), active, [active]);

    expect(buildLibraryEntryComposerReferences(context)).toEqual([]);
  });
});
