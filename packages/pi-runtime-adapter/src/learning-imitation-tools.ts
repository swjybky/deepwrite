import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import {
  LEARNING_IMITATION_RESULT_FIELD_MAX_CHARACTERS,
  LEARNING_IMITATION_STAGE_IDS,
  LEARNING_IMITATION_STAGE_LABELS,
  LearningImitationWritePayloadSchema,
  applyLearningImitationWrite,
  type LearningImitationDocument,
  type LearningImitationRuntimeContext,
  type LearningImitationStageId,
  type LearningImitationWritePayload
} from "@deepwrite/contracts";

const LEARNING_DOCUMENT_CHUNK_SIZE = 12_000;

export type LearningImitationToolDetails = {
  kind: "learning-imitation-result-update";
  stageId: LearningImitationStageId;
  update: LearningImitationWritePayload;
};

type LearningImitationToolResultDetails =
  | { kind: "none" }
  | LearningImitationToolDetails;

function textResult(
  text: string,
  details: LearningImitationToolResultDetails = { kind: "none" }
): AgentToolResult<LearningImitationToolResultDetails> {
  return { content: [{ type: "text", text }], details };
}

function primitiveTypeOf(value: unknown): string | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

function sanitizeToolSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolSchemaForGemini(item));
  }
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    output[key] = sanitizeToolSchemaForGemini(child);
  }

  for (const unionKey of ["anyOf", "oneOf"]) {
    const union = output[unionKey];
    if (!Array.isArray(union) || union.length === 0) continue;
    const branches = union as Array<Record<string, unknown>>;
    const values = branches.map((branch) => {
      if (
        branch &&
        typeof branch === "object" &&
        Object.prototype.hasOwnProperty.call(branch, "const")
      ) {
        return { matched: true, value: branch.const };
      }
      if (Array.isArray(branch?.enum) && branch.enum.length === 1) {
        return { matched: true, value: branch.enum[0] };
      }
      return { matched: false, value: undefined };
    });
    if (values.every((value) => value.matched)) {
      const enumValues = values.map((value) => value.value);
      delete output[unionKey];
      output.enum = enumValues;
      if (!output.type) {
        const types = [
          ...new Set(enumValues.map(primitiveTypeOf).filter(Boolean))
        ];
        if (types.length === 1) output.type = types[0];
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(output, "const")) {
    output.enum = [output.const];
    if (!output.type) output.type = primitiveTypeOf(output.const);
    delete output.const;
  }
  return output;
}

function defineTool<T extends ReturnType<typeof Type.Object>>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<LearningImitationToolResultDetails>>;
}): AgentTool<T, LearningImitationToolResultDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: sanitizeToolSchemaForGemini(definition.parameters) as T,
    execute: definition.execute
  };
}

function splitDocument(document: LearningImitationDocument): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < document.text.length; index += LEARNING_DOCUMENT_CHUNK_SIZE) {
    chunks.push(document.text.slice(index, index + LEARNING_DOCUMENT_CHUNK_SIZE));
  }
  return chunks;
}

function documentFormat(document: LearningImitationDocument): string {
  return document.extension || document.mediaType || "文本";
}

function documentTruncationNote(document: LearningImitationDocument): string {
  if (!document.truncated) return "";
  const originalLength = document.originalLength
    ? `，原文约 ${document.originalLength} 字符`
    : "";
  return `\n注意：该样本只保留了可分析的前段正文${originalLength}。`;
}

function buildListLearningDocumentsTool(
  context: LearningImitationRuntimeContext
): AgentTool {
  return defineTool({
    name: "list_learning_documents",
    label: "列出学习样本",
    description: "列出当前上传的小说正文样本，包括文档 id、文件名、字数和分块数量。",
    parameters: Type.Object({}),
    execute: async () =>
      textResult(
        context.documents.map((document, index) => {
          const chunks = splitDocument(document);
          const truncated = document.truncated ? "\n状态：正文已截断" : "";
          return [
            `${index + 1}. id=${document.id}`,
            `文件：${document.name}`,
            `格式：${documentFormat(document)}`,
            `字数：${document.charCount}`,
            `分块：${chunks.length}`
          ].join("\n") + truncated;
        }).join("\n\n") || "（暂无可用样本）"
      )
  });
}

function buildReadLearningDocumentTool(
  context: LearningImitationRuntimeContext
): AgentTool {
  return defineTool({
    name: "read_learning_document",
    label: "读取学习样本",
    description:
      "读取指定小说样本文本。文档较长时请按 chunk_index 分块读取，chunk_index 从 1 开始。",
    parameters: Type.Object({
      document_id: Type.String({ minLength: 1, maxLength: 120 }),
      chunk_index: Type.Optional(Type.Integer({ minimum: 1 }))
    }),
    execute: async (_toolCallId, params) => {
      const document = context.documents.find((item) => item.id === params.document_id);
      if (!document) return textResult(`未找到文档：${params.document_id}`);

      const chunks = splitDocument(document);
      const chunkIndex = Math.max(1, Number(params.chunk_index ?? 1));
      const chunk = chunks[chunkIndex - 1];
      if (chunk === undefined) {
        return textResult(`${document.name} 没有第 ${chunkIndex} 个分块`);
      }

      const heading = chunks.length > 1
        ? `（${document.name} 共 ${chunks.length} 块，当前第 ${chunkIndex} 块）`
        : `（${document.name} 全文）`;
      return textResult(`${heading}${documentTruncationNote(document)}\n\n${chunk}`);
    }
  });
}

function buildSearchLearningDocumentsTool(
  context: LearningImitationRuntimeContext
): AgentTool {
  return defineTool({
    name: "search_learning_documents",
    label: "搜索学习样本",
    description: "在所有上传样本文本中搜索关键词，返回包含上下文的片段。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 600 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 }))
    }),
    execute: async (_toolCallId, params) => {
      const query = String(params.query ?? "").trim();
      if (!query) return textResult("请提供搜索关键词");

      const maxResults = Math.min(20, Math.max(1, Number(params.max_results ?? 8)));
      const needle = query.toLowerCase();
      const matches: string[] = [];
      for (const document of context.documents) {
        const haystack = document.text.toLowerCase();
        let cursor = 0;
        while (matches.length < maxResults) {
          const found = haystack.indexOf(needle, cursor);
          if (found < 0) break;
          const start = Math.max(0, found - 120);
          const end = Math.min(document.text.length, found + query.length + 160);
          matches.push(
            `【${document.name}】\n${start > 0 ? "..." : ""}${document.text.slice(start, end)}${end < document.text.length ? "..." : ""}`
          );
          cursor = found + Math.max(1, query.length);
        }
        if (matches.length >= maxResults) break;
      }

      const truncatedDocumentCount = context.documents.filter(
        (document) => document.truncated
      ).length;
      const truncationNote = truncatedDocumentCount > 0
        ? `\n\n注意：${truncatedDocumentCount} 个样本正文已截断，搜索范围仅覆盖当前可读正文。`
        : "";
      return textResult(
        matches.length
          ? `${matches.join("\n\n---\n\n")}${truncationNote}`
          : `未找到：${query}${truncationNote}`
      );
    }
  });
}

function buildWriteLearningResultTool(
  context: LearningImitationRuntimeContext
): AgentTool {
  let accumulatedResult = structuredClone(context.result);
  const resultText = Type.String({
    maxLength: LEARNING_IMITATION_RESULT_FIELD_MAX_CHARACTERS
  });
  return defineTool({
    name: "write_learning_result",
    label: "写入学习结果预览",
    description: "把当前阶段的学习结果写入界面预览区。只写预览，不会直接写入素材库或技能库。",
    parameters: Type.Object({
      mode: Type.Optional(Type.Union([Type.Literal("replace"), Type.Literal("append")])),
      gimmick: Type.Optional(resultText),
      character: Type.Optional(resultText),
      pacing: Type.Optional(resultText),
      intro: Type.Optional(resultText),
      plot_refine: Type.Optional(resultText),
      draft_excerpt: Type.Optional(resultText),
      plot_design_skill: Type.Optional(resultText),
      plot_refine_skill: Type.Optional(resultText),
      style_skill_title: Type.Optional(Type.String({ maxLength: 256 })),
      style_skill_body: Type.Optional(resultText)
    }),
    execute: async (_toolCallId, params) => {
      const update = LearningImitationWritePayloadSchema.parse({
        ...params,
        mode: params.mode === "append" ? "append" : "replace"
      });
      const hasStageOutput = context.stageId === "material_split"
        ? [
            update.gimmick,
            update.character,
            update.pacing,
            update.intro,
            update.plot_refine,
            update.draft_excerpt
          ].some((value) => value?.trim())
        : context.stageId === "plot_learning"
          ? [update.plot_design_skill, update.plot_refine_skill].some(
              (value) => value?.trim()
            )
          : Boolean(update.style_skill_body?.trim());
      if (!hasStageOutput) {
        throw new Error(
          `write_learning_result 未包含「${LEARNING_IMITATION_STAGE_LABELS[context.stageId]}」阶段可用的正文结果。`
        );
      }
      try {
        accumulatedResult = applyLearningImitationWrite(
          accumulatedResult,
          context.stageId,
          update
        );
      } catch {
        throw new Error(
          `「${LEARNING_IMITATION_STAGE_LABELS[context.stageId]}」预览结果超过长度限制，请压缩结果后重新写入。`
        );
      }
      return textResult(
        `已写入「${LEARNING_IMITATION_STAGE_LABELS[context.stageId]}」预览区，等待用户确认落盘。`,
        {
          kind: "learning-imitation-result-update",
          stageId: context.stageId,
          update
        }
      );
    }
  });
}

export function buildLearningImitationTools(
  context: LearningImitationRuntimeContext
): AgentTool[] {
  return [
    buildListLearningDocumentsTool(context),
    buildReadLearningDocumentTool(context),
    buildSearchLearningDocumentsTool(context),
    buildWriteLearningResultTool(context)
  ];
}

export function isLearningImitationToolDetails(
  value: unknown
): value is LearningImitationToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const details = value as Record<string, unknown>;
  if (details.kind !== "learning-imitation-result-update") return false;
  if (
    typeof details.stageId !== "string" ||
    !LEARNING_IMITATION_STAGE_IDS.includes(
      details.stageId as LearningImitationStageId
    )
  ) {
    return false;
  }
  return LearningImitationWritePayloadSchema.safeParse(details.update).success;
}
