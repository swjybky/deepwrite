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
      resolveAgentActivityDescriptor("library:skill", sources)
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

  it("locates a plot-design chapter-card run at the manuscript chapter node", () => {
    const bookId = "longbook_plot";
    const chapterCardId = "chapter-two";
    const chapterId = longNavigationNodeId(bookId, `chapter:${chapterCardId}`);
    const resourceTree = createResourceTreeLookup([
      {
        id: "creation",
        label: "创作",
        icon: "book",
        nodes: [
          {
            id: chapterId,
            label: "第二章",
            longBookId: bookId,
            workspaceType: "long",
            longWorkspaceSelection: {
              key: `chapter:${chapterCardId}`,
              root: "draft",
              chapterCardId,
              title: "第二章",
              breadcrumbs: [],
              files: [],
              preferredRole: "body"
            }
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
    const conversationKey = `long:${bookId}:plot_design:${chapterCardId}`;
    expect(
      resolveAgentActivityDescriptor(conversationKey, sources)
    ).toMatchObject({
      targetResourceId: chapterId,
      chapterCardId,
      chapterCardView: "card"
    });
    for (const key of [conversationKey, `long:${bookId}:chat`]) {
      expect(
        resolveAgentActivityNavigationNode(
          {
            conversationKey: key,
            targetResourceId: longNavigationNodeId(
              bookId,
              "plot-design:chapter-cards:volume-one"
            ),
            chapterCardId
          },
          sources
        )?.id
      ).toBe(chapterId);
    }
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
