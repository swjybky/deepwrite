import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ChatAssistantRuntimeSnapshot } from "@deepwrite/contracts";
import {
  defineTool,
  jsonResult,
  textResult,
  normalizedQuery,
  page
} from "./chat-tool-helpers";
function projectSummaries(context: ChatAssistantRuntimeSnapshot) {
  const shortAndScript = context.catalog.books.map((book) => ({
    project_type: book.bookType,
    project_id: book.id,
    title: book.title,
    genre: book.bookType === "academic" ? book.subtype : book.genre,
    status: book.status,
    stage_count:
      book.bookType === "academic"
        ? book.frameworkStages.filter((stage) => stage.enabled).length + 2
        : book.plotStages.filter((stage) => stage.enabled).length + 2,
    updated_at: book.updatedAt
  }));
  const long = context.longBooks.map((book) => ({
    project_type: "long" as const,
    project_id: book.id,
    title: book.title,
    genre: book.genre,
    status: book.status,
    stage_count: 5,
    updated_at: book.updatedAt
  }));
  return [...shortAndScript, ...long];
}

function librarySummaries(
  context: ChatAssistantRuntimeSnapshot,
  domain: "material" | "skill"
) {
  const libraries =
    domain === "material" ? context.catalog.materials : context.catalog.skills;
  return libraries.map((library) => ({
    library_id: library.id,
    title: library.title,
    kind: "materialKind" in library ? library.materialKind : library.skillKind,
    library_type:
      "materialType" in library ? library.materialType : library.skillType,
    entry_count: library.entries.length,
    read_only: "readOnly" in library ? library.readOnly === true : false,
    updated_at: library.updatedAt
  }));
}

export function buildNormalTools(
  context: ChatAssistantRuntimeSnapshot
): AgentTool[] {
  const listProjects = defineTool({
    name: "list_creation_projects",
    label: "列出创作项目",
    description: "列出本机登记的短篇、剧本和长篇项目元数据，不返回任何正文。",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ maxLength: 200 })),
      project_type: Type.Optional(
        StringEnum(["short", "script", "long", "academic"] as const)
      ),
      cursor: Type.Optional(Type.String({ maxLength: 32 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
    }),
    execute: async (_id, params) => {
      const query = normalizedQuery(params.query);
      const values = projectSummaries(context).filter(
        (item) =>
          (!params.project_type || item.project_type === params.project_type) &&
          (!query || item.title.toLocaleLowerCase().includes(query))
      );
      return jsonResult(page(values, params.cursor, params.limit));
    }
  });
  const getProject = defineTool({
    name: "get_creation_project_summary",
    label: "查看项目摘要",
    description: "读取指定创作项目的结构摘要和阶段目录；普通模式不返回正文。",
    parameters: Type.Object({
      project_type: StringEnum([
        "short",
        "script",
        "long",
        "academic"
      ] as const),
      project_id: Type.String({ minLength: 1, maxLength: 512 })
    }),
    execute: async (_id, params) => {
      if (params.project_type === "long") {
        const book = context.longBooks.find(
          (candidate) => candidate.id === params.project_id
        );
        if (!book) return textResult("未找到指定长篇项目。");
        return jsonResult({
          project_type: "long",
          project_id: book.id,
          title: book.title,
          genre: book.genre,
          status: book.status,
          updated_at: book.updatedAt,
          navigation: book.navigation,
          linked_material_ids_by_kind: book.linkedMaterialIdsByKind,
          linked_skill_ids_by_kind: book.linkedSkillIdsByKind
        });
      }
      const book = context.catalog.books.find(
        (candidate) =>
          candidate.id === params.project_id &&
          candidate.bookType === params.project_type
      );
      if (!book) return textResult("未找到指定创作项目。");
      if (book.bookType === "academic") {
        return jsonResult({
          project_type: "academic",
          project_id: book.id,
          title: book.title,
          subtype: book.subtype,
          citation_style: book.citationStyle,
          status: book.status,
          updated_at: book.updatedAt,
          framework_stages: book.frameworkStages,
          card_count: book.foundation.cards.length,
          chapters: book.manuscript.chapters,
          sections: book.manuscript.sections.map((section) => ({
            id: section.id,
            chapter_id: section.chapterId ?? null,
            title: section.title,
            word_count_requirement: section.wordCountRequirement
          })),
          linked_material_ids: book.linkedMaterialIds,
          linked_skill_ids: book.linkedSkillIds
        });
      }
      return jsonResult({
        project_type: book.bookType,
        project_id: book.id,
        title: book.title,
        genre: book.genre,
        status: book.status,
        updated_at: book.updatedAt,
        plot_stages: book.plotStages,
        character_format: book.characterStructure.format,
        documents: book.documents.map((document) => ({
          id: document.id,
          title: document.title,
          content_bytes: document.contentBytes,
          updated_at: document.updatedAt
        })),
        draft_sections: book.draft.sections.map((section) => ({
          id: section.id,
          title: section.title,
          word_count_requirement: section.wordCountRequirement,
          body_bytes: section.body.contentBytes,
          character_state_bytes: section.characterState.contentBytes
        })),
        linked_material_ids_by_kind: book.linkedMaterialIdsByKind,
        linked_skill_ids_by_kind: book.linkedSkillIdsByKind
      });
    }
  });

  const libraryTools = (["material", "skill"] as const).flatMap((domain) => {
    const domainLabel = domain === "material" ? "素材" : "技能";
    return [
      defineTool({
        name: `list_${domain}_libraries`,
        label: `列出${domainLabel}库`,
        description: `列出本机${domainLabel}库的元数据和条目数量，不返回库介绍或条目正文。`,
        parameters: Type.Object({
          query: Type.Optional(Type.String({ maxLength: 200 })),
          cursor: Type.Optional(Type.String({ maxLength: 32 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_id, params) => {
          const query = normalizedQuery(params.query);
          const values = librarySummaries(context, domain).filter(
            (item) => !query || item.title.toLocaleLowerCase().includes(query)
          );
          return jsonResult(page(values, params.cursor, params.limit));
        }
      }),
      defineTool({
        name: `get_${domain}_library_summary`,
        label: `查看${domainLabel}库摘要`,
        description: `读取指定${domainLabel}库的元数据和条目目录，不返回正文。`,
        parameters: Type.Object({
          library_id: Type.String({ minLength: 1, maxLength: 512 })
        }),
        execute: async (_id, params) => {
          const libraries =
            domain === "material"
              ? context.catalog.materials
              : context.catalog.skills;
          const library = libraries.find(
            (candidate) => candidate.id === params.library_id
          );
          if (!library) return textResult(`未找到指定${domainLabel}库。`);
          return jsonResult({
            library_id: library.id,
            title: library.title,
            kind:
              "materialKind" in library
                ? library.materialKind
                : library.skillKind,
            library_type:
              "materialType" in library
                ? library.materialType
                : library.skillType,
            updated_at: library.updatedAt,
            entries: library.entries.map((entry) => ({
              id: entry.id,
              title: entry.title,
              stage_id: entry.stageId,
              content_bytes: entry.contentBytes,
              updated_at: entry.updatedAt
            }))
          });
        }
      })
    ];
  });

  const modelTool = defineTool({
    name: "query_model_configs",
    label: "查询模型配置",
    description:
      "查询已配置模型的脱敏信息。不会返回 API Key、Base URL、请求路由或其它凭据。",
    parameters: Type.Object({
      model_id: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
    }),
    execute: async (_id, params) =>
      jsonResult({
        default_model_id: context.defaultModelId,
        models: params.model_id
          ? context.models.filter((model) => model.id === params.model_id)
          : context.models
      })
  });
  const usageTool = defineTool({
    name: "query_model_usage",
    label: "查询模型用量",
    description:
      "查询发送本轮消息前生成的模型用量汇总；当前尚未完成的调用不包含在内。",
    parameters: Type.Object({
      period: StringEnum(["today", "7d", "30d", "all"] as const),
      model_config_ids: Type.Optional(
        Type.Array(Type.String({ maxLength: 120 }), { maxItems: 100 })
      ),
      modules: Type.Optional(
        Type.Array(Type.String({ maxLength: 120 }), { maxItems: 20 })
      )
    }),
    execute: async (_id, params) => {
      const dashboard = context.usage[params.period];
      const modelIds = params.model_config_ids?.length
        ? new Set(params.model_config_ids)
        : undefined;
      const modules = params.modules?.length
        ? new Set(params.modules)
        : undefined;
      return jsonResult({
        period: params.period,
        generated_at: dashboard.generatedAt,
        totals: dashboard.totals,
        trend_granularity: dashboard.trendGranularity,
        trend: dashboard.trend,
        models: dashboard.models.filter(
          (item) => !modelIds || modelIds.has(item.model.configId)
        ),
        modules: dashboard.modules.filter(
          (item) => !modules || modules.has(item.module)
        ),
        recent_calls: dashboard.recentCalls.filter(
          (item) =>
            (!modelIds || modelIds.has(item.model.configId)) &&
            (!modules || modules.has(item.module))
        )
      });
    }
  });
  return [listProjects, getProject, ...libraryTools, modelTool, usageTool];
}
