import {
  DEFAULT_LIBRARY_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_SETTINGS,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  type LongBookSummary
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import type {
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";
import { createResourceTreeLookup } from "./resourceTreeLookup";
import { longBookResourceId } from "../types/longWorkspace";
import { longNavigationNodeId } from "./longWorkspaceResourceTree";
import {
  resolveAgentActivityDescriptor,
  resolveAgentActivityNavigationNode
} from "./agentActivityDescriptors";

const emptyTree = createResourceTreeLookup([]);
const defaults = {
  workspaceAgents: [
    DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
    DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS
  ],
  longAgents: DEFAULT_LONG_AGENT_SETTINGS,
  libraryAgents: DEFAULT_LIBRARY_AGENT_SETTINGS,
  longBooks: [] as LongBookSummary[]
};

describe("resolveAgentActivityDescriptor", () => {
  it("maps short-form and library controllers back to visible resources", () => {
    const character: WorkspaceDocument = {
      id: "character-overview",
      domain: "creation",
      title: "人物概览",
      eyebrow: "短篇",
      path: ["测试短篇", "人物", "概览"],
      content: "",
      workspaceId: "book-one",
      workspaceType: "short",
      workspaceTitle: "测试短篇",
      stageId: "character_design"
    };
    const skill: WorkspaceDocument = {
      id: "skill-entry",
      domain: "skill",
      title: "节奏控制",
      eyebrow: "技能",
      path: ["写作技能库", "节奏控制"],
      content: "",
      libraryId: "skill-library"
    };
    const sections: ResourceTreeSection[] = [
      {
        id: "creation",
        label: "创作",
        icon: "book",
        nodes: [
          {
            id: "character-node",
            label: "人物概览",
            targetDocumentId: character.id
          }
        ]
      },
      {
        id: "skill",
        label: "技能",
        icon: "library",
        nodes: [
          {
            id: "skill-node",
            label: "节奏控制",
            targetDocumentId: skill.id
          }
        ]
      }
    ];
    const sources = {
      ...defaults,
      documents: [character, skill],
      resourceTree: createResourceTreeLookup(sections)
    };

    expect(
      resolveAgentActivityDescriptor("book-one:chat", sources)
    ).toMatchObject({
      agentLabel: "短篇智能体",
      contextLabel: "测试短篇",
      targetResourceId: "character-node"
    });
    expect(
      resolveAgentActivityDescriptor("library:skill:skill-library", sources)
    ).toMatchObject({
      agentLabel: "技能库管理智能体",
      contextLabel: "写作技能库 · 节奏控制",
      targetResourceId: "skill-node"
    });
  });

  it("navigates a unified long conversation to its book without a stage label", () => {
    const bookId = "long:shared-book";
    const bookNode = {
      id: longBookResourceId(bookId),
      label: "统一长篇",
      longBookId: bookId,
      workspaceType: "long" as const
    };
    const sources = {
      ...defaults,
      documents: [],
      longBooks: [{ id: bookId, title: "统一长篇" } as LongBookSummary],
      resourceTree: createResourceTreeLookup([
        { id: "creation", label: "创作", icon: "book", nodes: [bookNode] }
      ])
    };
    const conversationKey = `long:${encodeURIComponent(bookId)}:chat`;
    const descriptor = resolveAgentActivityDescriptor(conversationKey, sources);
    expect(descriptor).toMatchObject({
      agentLabel: "长篇智能体",
      contextLabel: "统一长篇",
      targetResourceId: bookNode.id
    });
    expect(
      resolveAgentActivityNavigationNode(
        { conversationKey, targetResourceId: "removed-node" },
        sources
      )?.id
    ).toBe(bookNode.id);
  });

  it("resolves automatic long-form runs to their chapter or root", () => {
    const bookId = "long book";
    const rootId = longNavigationNodeId(bookId, "root:draft");
    const chapterId = longNavigationNodeId(bookId, "draft:chapter-one");
    const resourceTree = createResourceTreeLookup([
      {
        id: "creation",
        label: "创作",
        icon: "book",
        nodes: [
          {
            id: rootId,
            label: "正文",
            longBookId: bookId,
            workspaceType: "long",
            longWorkspaceSelection: {
              key: "root:draft",
              root: "draft",
              title: "正文",
              breadcrumbs: ["测试长篇", "正文"],
              files: [],
              preferredRole: "content",
              description: ""
            },
            children: [
              {
                id: chapterId,
                label: "第一章",
                longBookId: bookId,
                workspaceType: "long",
                longWorkspaceSelection: {
                  key: "draft:chapter-one",
                  root: "draft",
                  title: "第一章",
                  breadcrumbs: ["测试长篇", "正文", "第一章"],
                  files: [],
                  preferredRole: "content",
                  description: "",
                  chapterCardId: "chapter-one"
                }
              }
            ]
          }
        ]
      }
    ]);
    const descriptor = resolveAgentActivityDescriptor(
      [
        "long",
        encodeURIComponent(bookId),
        "draft",
        encodeURIComponent("__book__")
      ].join(":"),
      {
        ...defaults,
        documents: [],
        resourceTree,
        longBooks: [{ id: bookId, title: "测试长篇" } as LongBookSummary]
      }
    );

    expect(descriptor).toMatchObject({
      agentLabel: "长篇智能体",
      contextLabel: "测试长篇 · 正文",
      targetResourceId: rootId
    });
  });

  it("keeps plot-design chapter-card runs on the chapter card instead of worldbuilding", () => {
    const bookId = "longbook_plot";
    const worldRootId = longNavigationNodeId(bookId, "root:worldbuilding");
    const rulesId = longNavigationNodeId(bookId, "worldbuilding:world_rules");
    const plotRootId = longNavigationNodeId(bookId, "root:plot_design");
    const chapterCardsId = longNavigationNodeId(
      bookId,
      "root:plot-chapter-cards"
    );
    const volumeId = longNavigationNodeId(
      bookId,
      "plot-design:chapter-cards:volume-one"
    );
    const resourceTree = createResourceTreeLookup([
      {
        id: "creation",
        label: "创作",
        icon: "book",
        nodes: [
          {
            id: longBookResourceId(bookId),
            label: "测试长篇",
            longBookId: bookId,
            workspaceType: "long",
            children: [
              {
                id: worldRootId,
                label: "世界观",
                longBookId: bookId,
                workspaceType: "long",
                longWorkspaceSelection: {
                  key: "root:worldbuilding",
                  root: "worldbuilding",
                  title: "世界观",
                  breadcrumbs: ["测试长篇", "世界观"],
                  files: [],
                  preferredRole: "content"
                },
                children: [
                  {
                    id: rulesId,
                    label: "规则",
                    longBookId: bookId,
                    workspaceType: "long",
                    longWorkspaceSelection: {
                      key: "worldbuilding:world_rules",
                      root: "worldbuilding",
                      title: "规则",
                      breadcrumbs: ["测试长篇", "世界观", "规则"],
                      files: [],
                      preferredRole: "content"
                    }
                  }
                ]
              },
              {
                id: plotRootId,
                label: "剧情设计",
                longBookId: bookId,
                workspaceType: "long",
                longWorkspaceSelection: {
                  key: "root:plot_design",
                  root: "plot_design",
                  title: "剧情设计",
                  breadcrumbs: ["测试长篇", "剧情设计"],
                  files: [],
                  preferredRole: "content"
                },
                children: [
                  {
                    id: chapterCardsId,
                    label: "章卡",
                    longBookId: bookId,
                    workspaceType: "long",
                    longWorkspaceSelection: {
                      key: "root:plot-chapter-cards",
                      root: "plot_design",
                      title: "章卡",
                      breadcrumbs: ["测试长篇", "剧情设计", "章卡"],
                      files: [],
                      preferredRole: "book-line"
                    },
                    children: [
                      {
                        id: volumeId,
                        label: "第一卷",
                        longBookId: bookId,
                        workspaceType: "long",
                        longWorkspaceSelection: {
                          key: "plot-design:chapter-cards:volume-one",
                          root: "plot_design",
                          title: "第二章",
                          breadcrumbs: [
                            "测试长篇",
                            "剧情设计",
                            "章卡",
                            "第一卷",
                            "第二章"
                          ],
                          files: [],
                          preferredRole: "card",
                          chapterCardVolumeId: "volume-one",
                          chapterCardId: "chapter-one",
                          chapterCardTabs: [
                            { id: "chapter-one", label: "第一章" },
                            { id: "chapter-two", label: "第二章" }
                          ]
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    const sources = {
      ...defaults,
      documents: [],
      resourceTree,
      longBooks: [{ id: bookId, title: "测试长篇" } as LongBookSummary]
    };
    const conversationKey = [
      "long",
      encodeURIComponent(bookId),
      "plot_design",
      encodeURIComponent("__book__")
    ].join(":");

    expect(
      resolveAgentActivityDescriptor(conversationKey, sources)
    ).toMatchObject({
      contextLabel: "测试长篇 · 剧情设计",
      targetResourceId: plotRootId
    });
    expect(
      resolveAgentActivityNavigationNode(
        {
          conversationKey,
          targetResourceId: rulesId,
          chapterCardId: "chapter-two"
        },
        sources
      )?.id
    ).toBe(volumeId);
  });

  it("returns no descriptor for unknown non-workspace controllers", () => {
    expect(
      resolveAgentActivityDescriptor("general", {
        ...defaults,
        documents: [],
        resourceTree: emptyTree
      })
    ).toBeUndefined();
  });
});
