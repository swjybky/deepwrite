import {
  type BuildLibraryAgentToolsInput,
  type LibraryDomain,
  type MutableLibraryEntry,
  type MutableLibraryOverview
} from "./types";
import { type AgentTool } from "@earendil-works/pi-agent-core";
import {
  defineTool,
  MAX_ENTRY_CONTENT_CHARACTERS,
  resolveEntry,
  textResult,
  normalizedName,
  stageLabel
} from "./shared";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import {
  createShortWorkspaceContentRevision,
  LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS
} from "@deepwrite/contracts";
import { mutationResult, overviewMutationResult } from "./mutations";

export const MAX_REPLACEMENTS = 20;

export const MAX_ORIGINAL_FRAGMENT_CHARACTERS = 2_400;

export const MAX_NEW_FRAGMENT_CHARACTERS = 20_000;

export interface TextReplacement {
  original_text: string;
  new_text: string;
}

export function replaceFragments(
  current: string,
  replacements: readonly TextReplacement[]
): { text?: string; count: number; error?: string } {
  if (!replacements.length)
    return { count: 0, error: "replacements 不能为空。" };
  let next = current;
  let count = 0;
  for (const [index, replacement] of replacements.entries()) {
    const originalText = String(replacement.original_text ?? "");
    if (!originalText) {
      return { count, error: `第 ${index + 1} 个 original_text 不能为空。` };
    }
    const first = next.indexOf(originalText);
    if (first < 0) {
      return {
        count,
        error: `没有找到第 ${index + 1} 个原文片段：${originalText.slice(0, 80)}`
      };
    }
    if (next.indexOf(originalText, first + originalText.length) >= 0) {
      return {
        count,
        error: `第 ${index + 1} 个原文片段出现多次，请提供更长且唯一的上下文：${originalText.slice(0, 80)}`
      };
    }
    next = `${next.slice(0, first)}${replacement.new_text}${next.slice(first + originalText.length)}`;
    count += 1;
  }
  return { text: next, count };
}

export function buildEditTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  accessedEntryIds: Set<string>
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  return defineTool({
    name: `edit_${domain}_entry`,
    label: `编辑${noun}条目`,
    description: `编辑当前${noun}库中的一个条目。必须先 read/search；局部修改用 replace_fragments，追加用 append，明确整篇覆盖才用 replace。`,
    parameters: Type.Object({
      entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      stage_id: Type.Optional(StringEnum(stages)),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      mode: StringEnum(["replace_fragments", "append", "replace"] as const),
      body: Type.Optional(
        Type.String({ maxLength: MAX_ENTRY_CONTENT_CHARACTERS })
      ),
      allow_overwrite_existing: Type.Optional(Type.Boolean()),
      replacements: Type.Optional(
        Type.Array(
          Type.Object({
            original_text: Type.String({
              minLength: 1,
              maxLength: MAX_ORIGINAL_FRAGMENT_CHARACTERS
            }),
            new_text: Type.String({ maxLength: MAX_NEW_FRAGMENT_CHARACTERS })
          }),
          { minItems: 1, maxItems: MAX_REPLACEMENTS }
        )
      )
    }),
    execute: async (_toolCallId, params) => {
      const resolved = resolveEntry(entries, domain, params);
      if ("error" in resolved) return textResult(resolved.error);
      const entry = resolved.entry;
      if (!accessedEntryIds.has(entry.entryId)) {
        return textResult(
          `未修改：请先调用 read_${domain}_entry 或 search_${domain}_entries 读取并确认「${entry.title}」的当前内容。`
        );
      }
      if (entry.pendingCreate && !input.sharedState) {
        return textResult(
          `未修改：「${entry.title}」已在本轮提交新建变更。请等待该变更保存后再编辑，或在 create_${domain}_entry 时一次提供最终正文。`
        );
      }
      if (entry.readOnly) {
        return textResult(
          entry.isCurrentLibrary
            ? `未修改：「${entry.title}」属于只读资料库。`
            : `未修改：「${entry.title}」来自同分组其它库《${entry.sourceLibraryTitle}》，只读；请先切换到该库再编辑。`
        );
      }
      if (entry.truncated) {
        return textResult(
          `未修改：「${entry.title}」超过本轮安全快照上限，无法在看不到完整原文时写入。`
        );
      }

      const baseRevision = entry.revision;
      const previousTitle = entry.title;
      const previousContent = entry.content;
      const nextTitle =
        params.title === undefined ? entry.title : String(params.title).trim();
      if (!nextTitle) return textResult("未修改：title 不能为空。");
      const mode = String(params.mode) as
        "replace_fragments" | "append" | "replace";
      let nextContent = entry.content;
      let changeDescription = "更新";
      if (mode === "replace_fragments") {
        const replacements = (params.replacements ?? []) as TextReplacement[];
        const result = replaceFragments(entry.content, replacements);
        if (result.error || result.text === undefined) {
          return textResult(`未修改：${result.error ?? "未知错误"}`);
        }
        nextContent = result.text;
        changeDescription = `${result.count} 处局部替换`;
      } else if (params.body !== undefined) {
        const body = String(params.body).trim();
        if (mode === "append") {
          if (!body) return textResult("未修改：append 模式的 body 不能为空。");
          const separator =
            entry.content.length === 0
              ? ""
              : entry.content.endsWith("\n")
                ? "\n"
                : "\n\n";
          nextContent = `${entry.content}${separator}${body}`;
          changeDescription = "正文追加";
        } else {
          if (
            entry.content.trim() &&
            params.allow_overwrite_existing !== true
          ) {
            return textResult(
              "未覆盖：该条目已有正文。只有用户明确要求覆盖全文时，才可设置 allow_overwrite_existing=true；普通修改请使用 replace_fragments。"
            );
          }
          nextContent = body;
          changeDescription = "全文覆盖";
        }
      } else if (nextTitle === entry.title) {
        return textResult(
          `未修改：${mode} 模式需要提供 body，或通过 title 修改标题。`
        );
      }

      if (nextTitle === previousTitle && nextContent === previousContent) {
        return textResult("文本和标题没有实际变化，无需提交修改。");
      }
      if (nextContent.length > MAX_ENTRY_CONTENT_CHARACTERS) {
        return textResult(
          `未修改：变更后正文共 ${nextContent.length.toLocaleString("zh-CN")} 个字符，超过单条资料库快照上限 ${MAX_ENTRY_CONTENT_CHARACTERS.toLocaleString("zh-CN")}。`
        );
      }
      if (
        nextTitle !== previousTitle &&
        entries.some(
          (candidate) =>
            candidate !== entry &&
            candidate.isCurrentLibrary &&
            candidate.stageId === entry.stageId &&
            normalizedName(candidate.title) === normalizedName(nextTitle)
        )
      ) {
        return textResult(
          `未修改：栏目「${stageLabel(domain, entry.stageId)}」中已存在同名条目「${nextTitle}」。`
        );
      }
      entry.title = nextTitle;
      entry.content = nextContent;
      entry.revision = createShortWorkspaceContentRevision(nextContent);
      return mutationResult(
        input,
        entry.pendingCreate ? "create" : "edit",
        entry,
        baseRevision,
        `已生成${noun}条目「${entry.title}」的${changeDescription}变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}

export function buildEditOverviewTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  overview: MutableLibraryOverview
): AgentTool {
  const noun = domain === "material" ? "素材库介绍" : "技能库说明";
  return defineTool({
    name: "edit_" + domain + "_library_overview",
    label: "编辑" + noun,
    description:
      "编辑当前" +
      noun +
      "。局部修改用 replace_fragments，追加用 append，明确整篇覆盖才用 replace；只提交待审阅变更。",
    parameters: Type.Object({
      mode: StringEnum(["replace_fragments", "append", "replace"] as const),
      body: Type.Optional(
        Type.String({ maxLength: LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS })
      ),
      allow_overwrite_existing: Type.Optional(Type.Boolean()),
      replacements: Type.Optional(
        Type.Array(
          Type.Object({
            original_text: Type.String({
              minLength: 1,
              maxLength: MAX_ORIGINAL_FRAGMENT_CHARACTERS
            }),
            new_text: Type.String({ maxLength: MAX_NEW_FRAGMENT_CHARACTERS })
          }),
          { minItems: 1, maxItems: MAX_REPLACEMENTS }
        )
      )
    }),
    execute: async (_toolCallId, params) => {
      if (overview.truncated) {
        const lengthDetail =
          overview.originalLength === undefined
            ? ""
            : "（原文 " +
              overview.originalLength.toLocaleString("zh-CN") +
              " 字）";
        return textResult(
          "未修改：当前" +
            noun +
            "超过本轮安全快照上限" +
            lengthDetail +
            "，无法在看不到完整原文时写入。"
        );
      }

      const baseRevision = overview.revision;
      const previousContent = overview.content;
      const mode = String(params.mode) as
        "replace_fragments" | "append" | "replace";
      let nextContent: string;
      let changeDescription: string;
      if (mode === "replace_fragments") {
        const replacements = (params.replacements ?? []) as TextReplacement[];
        const result = replaceFragments(previousContent, replacements);
        if (result.error || result.text === undefined) {
          return textResult("未修改：" + (result.error ?? "未知错误"));
        }
        nextContent = result.text;
        changeDescription = result.count + " 处局部替换";
      } else if (params.body !== undefined) {
        const body = String(params.body).trim();
        if (mode === "append") {
          if (!body) return textResult("未修改：append 模式的 body 不能为空。");
          const separator =
            previousContent.length === 0
              ? ""
              : previousContent.endsWith("\n")
                ? "\n"
                : "\n\n";
          nextContent = previousContent + separator + body;
          changeDescription = "正文追加";
        } else {
          if (
            previousContent.trim() &&
            params.allow_overwrite_existing !== true
          ) {
            return textResult(
              "未覆盖：库介绍已有正文。只有用户明确要求覆盖全文时，才可设置 allow_overwrite_existing=true；普通修改请使用 replace_fragments。"
            );
          }
          nextContent = body;
          changeDescription = "全文覆盖";
        }
      } else {
        return textResult("未修改：" + mode + " 模式需要提供 body。");
      }

      if (nextContent === previousContent) {
        return textResult("库介绍没有实际变化，无需提交修改。");
      }
      if (nextContent.length > LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS) {
        return textResult(
          "未修改：变更后正文共 " +
            nextContent.length.toLocaleString("zh-CN") +
            " 个字符，超过库介绍上限 " +
            LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS.toLocaleString("zh-CN") +
            "。"
        );
      }
      overview.content = nextContent;
      overview.revision = createShortWorkspaceContentRevision(nextContent);
      return overviewMutationResult(
        input,
        domain,
        overview,
        baseRevision,
        "已生成" + noun + "的" + changeDescription + "变更，等待用户审阅。"
      );
    },
    executionMode: "sequential"
  });
}
