import {
  type BuildLibraryAgentToolsInput,
  type LibraryDomain,
  type MutableLibraryEntry
} from "./types";
import { omittedEntryCount, workspaceShape, libraryTitle } from "./workspace";
import { type AgentTool } from "@earendil-works/pi-agent-core";
import {
  defineTool,
  textResult,
  stageLabel,
  countTextCharacters,
  resolveEntry,
  clampInteger,
  lineColumnAt
} from "./shared";
import { Type, StringEnum } from "@earendil-works/pi-ai";

export const MAX_SEARCH_QUERY_CHARACTERS = 600;

export const MIN_SEARCH_CONTEXT_CHARACTERS = 10;

export const DEFAULT_SEARCH_CONTEXT_CHARACTERS = 80;

export const MAX_SEARCH_CONTEXT_CHARACTERS = 500;

export const DEFAULT_SEARCH_MATCHES = 10;

export const MAX_SEARCH_MATCHES = 200;

export function buildListTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  libraries: readonly { libraryId: string; title: string }[]
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  const libraryIds = libraries.map((library) => library.libraryId);
  const withPeers = libraries.length > 1;
  return defineTool({
    name: `list_${domain}_entries`,
    label: `列出${noun}条目`,
    description: withPeers
      ? `列出当前${noun}库及同分组其它成员库中的条目名称、栏目、来源库、entry_id 和字数；可用 library_id 只看某一个成员库。写入仍只针对当前库。`
      : `列出当前${noun}库中的条目名称、栏目、entry_id 和字数；不会读取其它资料库。`,
    parameters: Type.Object({
      stage_id: Type.Optional(StringEnum(stages)),
      ...(withPeers
        ? { library_id: Type.Optional(StringEnum(libraryIds)) }
        : {})
    }),
    execute: async (_toolCallId, params) => {
      const stageId = String(params.stage_id ?? "");
      const libraryIdFilter = String(params.library_id ?? "").trim();
      const scoped = entries.filter((entry) => {
        if (stageId && entry.stageId !== stageId) return false;
        if (libraryIdFilter && entry.sourceLibraryId !== libraryIdFilter)
          return false;
        return true;
      });
      const omitted = omittedEntryCount(input.workspace);
      const group = workspaceShape(input.workspace);
      const groupNote =
        group.groupTitle && withPeers
          ? `｜分组：《${group.groupTitle}》｜可读 ${libraries.length} 个成员库`
          : "";
      const header = `${noun}库：《${libraryTitle(input.workspace)}》｜当前快照 ${scoped.length} 条${groupNote}${omitted ? `｜另有 ${omitted} 条因容量限制未载入` : ""}`;
      if (!scoped.length) return textResult(`${header}\n\n暂无${noun}条目。`);
      return textResult(
        [
          header,
          "",
          ...scoped.map((entry, index) => {
            const source =
              withPeers || !entry.isCurrentLibrary
                ? `｜来源库：${entry.sourceLibraryTitle}（${entry.sourceLibraryId}）${entry.isCurrentLibrary ? "｜当前库" : "｜只读"}`
                : "";
            return `${index + 1}. ${entry.title}｜栏目：${stageLabel(domain, entry.stageId)}（${entry.stageId}）${source}｜entry_id=${entry.entryId}｜字数=${countTextCharacters(entry.content)}${entry.truncated ? "｜正文已截断" : ""}${entry.readOnly && entry.isCurrentLibrary ? "｜只读" : ""}`;
          })
        ].join("\n")
      );
    }
  });
}

export function buildReadTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  libraries: readonly { libraryId: string; title: string }[],
  accessedEntryIds: Set<string>
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  const libraryIds = libraries.map((library) => library.libraryId);
  const withPeers = libraries.length > 1;
  return defineTool({
    name: `read_${domain}_entry`,
    label: `读取${noun}条目`,
    description: withPeers
      ? `按 entry_id 或精确标题读取当前${noun}库或同分组其它成员库中的一个条目全文；可用 Catalog 裸 entry_id，跨库时建议同时传 library_id；也兼容 list 返回的 libraryId/entryId。`
      : `按 entry_id 或精确标题读取当前${noun}库中的一个条目全文；重名时必须补充栏目或 entry_id。`,
    parameters: Type.Object({
      entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      stage_id: Type.Optional(StringEnum(stages)),
      ...(withPeers
        ? { library_id: Type.Optional(StringEnum(libraryIds)) }
        : {})
    }),
    execute: async (_toolCallId, params) => {
      const resolved = resolveEntry(entries, domain, params);
      if ("error" in resolved) {
        const omitted = omittedEntryCount(input.workspace);
        return textResult(
          `${resolved.error}${omitted ? `\n注意：当前快照另有 ${omitted} 条因容量限制未载入。` : ""}`
        );
      }
      const entry = resolved.entry;
      accessedEntryIds.add(entry.entryId);
      const truncation = entry.truncated
        ? `\n\n注意：本轮只提供前 ${entry.content.length.toLocaleString("zh-CN")} 个字符，原文共 ${entry.originalLength?.toLocaleString("zh-CN") ?? "更多"} 个字符；该条目不可由智能体写入。`
        : "";
      const peerNote = entry.isCurrentLibrary
        ? ""
        : `\n来源：同分组成员库《${entry.sourceLibraryTitle}》（只读）`;
      return textResult(
        [
          `${noun}库：《${entry.sourceLibraryTitle}》${entry.isCurrentLibrary ? "（当前库）" : "（同分组只读）"}`,
          `条目：${entry.title}`,
          `栏目：${stageLabel(domain, entry.stageId)}（${entry.stageId}）`,
          `entry_id：${entry.entryId}`,
          `document_id：${entry.documentId}`,
          `当前字数：${countTextCharacters(entry.content).toLocaleString("zh-CN")}`,
          `版本：${entry.revision}${peerNote}`,
          "",
          entry.content || "该条目暂无正文。"
        ].join("\n") + truncation
      );
    }
  });
}

export function buildSearchTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  libraries: readonly { libraryId: string; title: string }[],
  accessedEntryIds: Set<string>
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  const libraryIds = libraries.map((library) => library.libraryId);
  const withPeers = libraries.length > 1;
  return defineTool({
    name: `search_${domain}_entries`,
    label: `搜索${noun}条目`,
    description: withPeers
      ? `在当前${noun}库及同分组其它成员库的标题和正文中搜索文本，只返回命中位置与少量上下文；可用 library_id 限定范围。`
      : `在当前${noun}库的标题和正文中搜索文本，只返回命中位置与少量上下文。`,
    parameters: Type.Object({
      query: Type.String({
        minLength: 1,
        maxLength: MAX_SEARCH_QUERY_CHARACTERS
      }),
      stage_id: Type.Optional(StringEnum(stages)),
      ...(withPeers
        ? { library_id: Type.Optional(StringEnum(libraryIds)) }
        : {}),
      max_matches: Type.Optional(
        Type.Integer({ minimum: 1, maximum: MAX_SEARCH_MATCHES })
      ),
      context_chars: Type.Optional(
        Type.Integer({
          minimum: MIN_SEARCH_CONTEXT_CHARACTERS,
          maximum: MAX_SEARCH_CONTEXT_CHARACTERS
        })
      )
    }),
    execute: async (_toolCallId, params) => {
      const query = String(params.query ?? "").trim();
      if (!query) return textResult("搜索文本不能为空。");
      const stageId = String(params.stage_id ?? "");
      const libraryIdFilter = String(params.library_id ?? "").trim();
      const scoped = entries.filter((entry) => {
        if (stageId && entry.stageId !== stageId) return false;
        if (libraryIdFilter && entry.sourceLibraryId !== libraryIdFilter)
          return false;
        return true;
      });
      const maxMatches = clampInteger(
        params.max_matches,
        DEFAULT_SEARCH_MATCHES,
        1,
        MAX_SEARCH_MATCHES
      );
      const contextCharacters = clampInteger(
        params.context_chars,
        DEFAULT_SEARCH_CONTEXT_CHARACTERS,
        MIN_SEARCH_CONTEXT_CHARACTERS,
        MAX_SEARCH_CONTEXT_CHARACTERS
      );
      const output = [
        `${noun}库：《${libraryTitle(input.workspace)}》${withPeers ? "及同分组成员库" : ""}`,
        `搜索：${query}`
      ];
      const normalizedQuery = query.toLocaleLowerCase();
      let total = 0;
      for (const entry of scoped) {
        const titleHit = entry.title
          .toLocaleLowerCase()
          .includes(normalizedQuery);
        const bodyLower = entry.content.toLocaleLowerCase();
        const matches: number[] = [];
        let cursor = 0;
        while (matches.length + total < maxMatches) {
          const index = bodyLower.indexOf(normalizedQuery, cursor);
          if (index < 0) break;
          matches.push(index);
          cursor = index + Math.max(1, query.length);
        }
        if (!titleHit && matches.length === 0) continue;
        accessedEntryIds.add(entry.entryId);
        const source =
          withPeers || !entry.isCurrentLibrary
            ? `｜${entry.sourceLibraryTitle}`
            : "";
        output.push(
          "",
          `【${stageLabel(domain, entry.stageId)}】${entry.title}（entry_id=${entry.entryId}）${source}${titleHit ? "｜标题命中" : ""}`
        );
        for (const [index, start] of matches.entries()) {
          const end = start + query.length;
          const contextStart = Math.max(0, start - contextCharacters);
          const contextEnd = Math.min(
            entry.content.length,
            end + contextCharacters
          );
          const location = lineColumnAt(entry.content, start);
          output.push(
            `${index + 1}. L${location.line}:C${location.column} chars ${start}-${end}`,
            `${contextStart > 0 ? "…" : ""}${entry.content.slice(contextStart, contextEnd)}${contextEnd < entry.content.length ? "…" : ""}`
          );
          total += 1;
        }
        if (entry.truncated)
          output.push("注意：该条目仅搜索了本轮可见的截断快照。");
        if (total >= maxMatches) break;
      }
      if (output.length === 2) {
        const hasTruncatedEntries = scoped.some((entry) => entry.truncated);
        const omitted = omittedEntryCount(input.workspace);
        return textResult(
          `未在当前${noun}库${withPeers ? "及同分组成员库" : ""}${hasTruncatedEntries || omitted ? "可见快照" : ""}中找到「${query}」。${hasTruncatedEntries ? "存在截断条目，不能据此判断完整原文没有匹配。" : ""}${omitted ? `另有 ${omitted} 条因容量限制未载入。` : ""}`
        );
      }
      const omitted = omittedEntryCount(input.workspace);
      if (omitted)
        output.push(`注意：另有 ${omitted} 条因容量限制未载入，未参与搜索。`);
      output.push("", `已返回 ${total} 处正文匹配。`);
      return textResult(output.join("\n"));
    }
  });
}
