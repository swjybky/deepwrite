import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  getDefaultLongAgentProfile,
  type Book,
  type LongBookSummary
} from "@deepwrite/contracts";
import {
  buildLongWorkspaceTools,
  type LongCommandExecutor
} from "../../long-agent-tools";
import {
  defineTool,
  jsonResult,
  textResult,
  normalizedQuery
} from "./chat-tool-helpers";
function bookTextSources(book: Book) {
  if (book.bookType === "academic") {
    return [
      {
        id: book.foundation.thesisOverview.id,
        title: book.foundation.thesisOverview.title,
        kind: "foundation" as const,
        content: book.foundation.thesisOverview.content
      },
      {
        id: book.foundation.terminology.id,
        title: book.foundation.terminology.title,
        kind: "foundation" as const,
        content: book.foundation.terminology.content
      },
      ...book.foundation.cards.map((card) => ({
        id: card.document.id,
        title: `[${card.citeKey}] ${card.title}`,
        kind: "reference_card" as const,
        content: card.document.content
      })),
      ...book.documents.map((document) => ({
        id: document.id,
        title: document.title,
        kind: "stage" as const,
        content: document.content
      })),
      ...book.manuscript.sections.flatMap((section) => [
        {
          id: section.brief.id,
          title: section.brief.title,
          kind: "section-brief" as const,
          content: section.brief.content
        },
        {
          id: section.body.id,
          title: `${section.title} · 正文`,
          kind: "draft-body" as const,
          content: section.body.content
        },
        {
          id: section.state.id,
          title: section.state.title,
          kind: "section-state" as const,
          content: section.state.content
        }
      ])
    ];
  }
  return [
    ...book.documents.map((document) => ({
      id: document.id,
      title: document.title,
      kind: "stage" as const,
      content: document.content
    })),
    ...book.draft.sections.flatMap((section) => [
      {
        id: section.body.id,
        title: `${section.title} · 正文`,
        kind: "draft-body" as const,
        content: section.body.content
      },
      {
        id: section.characterState.id,
        title: `${section.title} · 人物状态`,
        kind: "draft-character-state" as const,
        content: section.characterState.content
      }
    ])
  ];
}

function readPage(content: string, offset: number, maxCharacters: number) {
  const safeOffset = Math.min(content.length, Math.max(0, offset));
  const size = Math.min(32_768, Math.max(1, maxCharacters));
  const end = Math.min(content.length, safeOffset + size);
  return {
    offset: safeOffset,
    content: content.slice(safeOffset, end),
    next_offset: end < content.length ? end : null,
    total_characters: content.length
  };
}

export function buildShortProjectTools(book: Book): AgentTool[] {
  const sources = bookTextSources(book);
  const listTool = defineTool({
    name: "list_workspace_content",
    label: "列出项目阶段",
    description:
      "列出当前短篇或剧本的阶段、人物文件和正文小节目录，不返回正文。",
    parameters: Type.Object({}),
    execute: async () =>
      book.bookType === "academic"
        ? jsonResult({
            project_id: book.id,
            project_type: "academic",
            title: book.title,
            subtype: book.subtype,
            citation_style: book.citationStyle,
            foundation: {
              thesis_overview: {
                id: book.foundation.thesisOverview.id,
                title: book.foundation.thesisOverview.title
              },
              terminology: {
                id: book.foundation.terminology.id,
                title: book.foundation.terminology.title
              },
              cards: book.foundation.cards.map((card) => ({
                id: card.id,
                cite_key: card.citeKey,
                card_type: card.cardType,
                title: card.title,
                document_id: card.document.id
              }))
            },
            framework_stages: book.frameworkStages,
            chapters: book.manuscript.chapters,
            sections: book.manuscript.sections.map((section) => ({
              id: section.id,
              chapter_id: section.chapterId ?? null,
              title: section.title,
              word_count_requirement: section.wordCountRequirement,
              brief_document_id: section.brief.id,
              body_document_id: section.body.id,
              state_document_id: section.state.id
            }))
          })
        : jsonResult({
            project_id: book.id,
            project_type: book.bookType,
            title: book.title,
            plot_stages: book.plotStages,
            stage_documents: book.documents.map((item) => ({
              id: item.id,
              title: item.title
            })),
            characters:
              book.characterStructure.format === "list"
                ? book.characterStructure.items
                : [{ id: "character_design", title: "人物设计" }],
            draft_sections: book.draft.sections.map((section) => ({
              id: section.id,
              title: section.title,
              word_count_requirement: section.wordCountRequirement,
              body_document_id: section.body.id,
              character_state_document_id: section.characterState.id
            }))
          })
  });
  const searchTool = defineTool({
    name: "search_workspace_text",
    label: "搜索项目文本",
    description: "在当前锁定的短篇或剧本全部阶段中搜索原文，只返回定位片段。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 600 }),
      document_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
    }),
    execute: async (_id, params) => {
      const query = String(params.query);
      const limit = Math.min(50, Math.max(1, Number(params.max_matches ?? 10)));
      const matches: unknown[] = [];
      for (const source of sources) {
        if (params.document_id && source.id !== params.document_id) continue;
        let cursor = 0;
        while (matches.length < limit) {
          const index = source.content.indexOf(query, cursor);
          if (index < 0) break;
          matches.push({
            document_id: source.id,
            title: source.title,
            kind: source.kind,
            offset: index,
            snippet: source.content.slice(
              Math.max(0, index - 80),
              index + query.length + 80
            )
          });
          cursor = index + Math.max(1, query.length);
        }
        if (matches.length >= limit) break;
      }
      return jsonResult({ project_id: book.id, query, matches });
    }
  });
  const readTool = defineTool({
    name: "read_workspace_content",
    label: "读取项目内容",
    description:
      "按目录返回的 document_id 分页读取当前锁定项目的阶段、人物或正文文件。",
    parameters: Type.Object({
      document_id: Type.String({ minLength: 1, maxLength: 512 }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_characters: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 32_768 })
      )
    }),
    execute: async (_id, params) => {
      const source = sources.find(
        (candidate) => candidate.id === params.document_id
      );
      if (!source) return textResult("指定文档不属于当前项目或不存在。");
      return jsonResult({
        project_id: book.id,
        document_id: source.id,
        title: source.title,
        kind: source.kind,
        ...readPage(
          source.content,
          Number(params.offset ?? 0),
          Number(params.max_characters ?? 12_000)
        )
      });
    }
  });
  const characters =
    book.bookType === "academic"
      ? []
      : book.characterStructure.format === "list"
        ? book.characterStructure.items
        : [{ id: "character_design", title: "人物设计", order: 1 }];
  const listCharacters = defineTool({
    name: "list_characters",
    label: "列出人物",
    description: "列出当前项目的人物目录。",
    parameters: Type.Object({}),
    execute: async () => jsonResult({ project_id: book.id, characters })
  });
  const searchCharacters = defineTool({
    name: "search_characters",
    label: "搜索人物",
    description: "按姓名或人物正文搜索当前项目人物。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 300 })
    }),
    execute: async (_id, params) => {
      const query = normalizedQuery(params.query);
      const matches = characters.filter((character) => {
        const body =
          sources.find((source) => source.id === character.id)?.content ?? "";
        return (
          character.title.toLocaleLowerCase().includes(query) ||
          body.toLocaleLowerCase().includes(query)
        );
      });
      return jsonResult({ project_id: book.id, matches });
    }
  });
  const readCharacter = defineTool({
    name: "read_character",
    label: "读取人物",
    description: "分页读取当前项目指定人物正文。",
    parameters: Type.Object({
      character_id: Type.String({ minLength: 1, maxLength: 512 }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_characters: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 32_768 })
      )
    }),
    execute: async (_id, params) => {
      if (!characters.some((item) => item.id === params.character_id)) {
        return textResult("指定人物不属于当前项目。");
      }
      const source = sources.find((item) => item.id === params.character_id);
      if (!source) return textResult("人物正文不存在。");
      return jsonResult({
        project_id: book.id,
        character_id: params.character_id,
        title: source.title,
        ...readPage(
          source.content,
          Number(params.offset ?? 0),
          Number(params.max_characters ?? 12_000)
        )
      });
    }
  });
  const readDraft = defineTool({
    name: "read_draft_sections",
    label: "读取正文小节",
    description: "分页读取当前项目指定正文小节的正文或人物状态文件。",
    parameters: Type.Object({
      section_id: Type.String({ minLength: 1, maxLength: 512 }),
      file: StringEnum(["brief", "body", "state", "character_state"] as const),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_characters: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 32_768 })
      )
    }),
    execute: async (_id, params) => {
      if (book.bookType === "academic") {
        const section = book.manuscript.sections.find(
          (item) => item.id === params.section_id
        );
        if (!section) return textResult("指定正文小节不属于当前项目。");
        const document =
          params.file === "brief"
            ? section.brief
            : params.file === "body"
              ? section.body
              : section.state;
        return jsonResult({
          project_id: book.id,
          section_id: section.id,
          title: section.title,
          file: params.file,
          ...readPage(
            document.content,
            Number(params.offset ?? 0),
            Number(params.max_characters ?? 12_000)
          )
        });
      }
      const section = book.draft.sections.find(
        (item) => item.id === params.section_id
      );
      if (!section) return textResult("指定正文小节不属于当前项目。");
      const document =
        params.file === "body" ? section.body : section.characterState;
      return jsonResult({
        project_id: book.id,
        section_id: section.id,
        title: section.title,
        file: params.file,
        ...readPage(
          document.content,
          Number(params.offset ?? 0),
          Number(params.max_characters ?? 12_000)
        )
      });
    }
  });
  return [
    listTool,
    searchTool,
    readTool,
    listCharacters,
    searchCharacters,
    readCharacter,
    readDraft
  ];
}

const LONG_QUERY_TOOL_NAMES = new Set(["list", "read"]);

/** Read-only long-form tools, bound to the chat's project book. */
export function buildLongProjectTools(input: {
  runId: string;
  sessionId: string;
  book: LongBookSummary;
  executor?: LongCommandExecutor | undefined;
}): AgentTool[] {
  return buildLongWorkspaceTools({
    workspace: {
      bookId: input.book.id,
      title: input.book.title,
      activeRoot: "plot_design",
      activeAgentId: "long",
      navigation: input.book.navigation
    },
    profile: getDefaultLongAgentProfile("long"),
    sessionId: input.sessionId,
    runId: input.runId,
    ...(input.executor ? { executor: input.executor } : {})
  }).filter((tool) => LONG_QUERY_TOOL_NAMES.has(tool.name));
}
