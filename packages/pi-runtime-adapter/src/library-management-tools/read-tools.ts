import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  LIBRARY_MANAGEMENT_READ_MAX_ENTRIES,
  LIBRARY_MANAGEMENT_SEARCH_MAX_MATCHES,
  type LibraryAgentDomain
} from "@deepwrite/contracts";
import {
  clampInteger,
  defineTool,
  normalizedName,
  stageLabel,
  textResult
} from "../library-agent-tools/shared";
import type { LibraryManagementSession, ManagedLibrary } from "./session";

const NOUN: Record<LibraryAgentDomain, string> = {
  material: "素材库",
  skill: "技能库"
};
const LIST_DEFAULT_LIMIT = 200;

export function libraryIdParameter(session: LibraryManagementSession) {
  const ids = session.candidates.map((library) => library.libraryId);
  const options = { description: "已绑定库的 id，见 library_list。" };
  return ids.length ? StringEnum(ids, options) : Type.String(options);
}

function failure(error: unknown) {
  return textResult(error instanceof Error ? error.message : String(error));
}

function entryLine(library: ManagedLibrary, index: number) {
  const entry = library.entries[index]!;
  const size =
    entry.content === undefined
      ? `${entry.contentBytes} 字节`
      : `${entry.content.length} 字`;
  return `${index + 1}. ${entry.title}｜栏目：${stageLabel(library.candidate.domain, entry.stageId)}（${entry.stageId}）｜entry_id=${entry.entryId}｜${size}${entry.creationId ? "｜本轮新建待保存" : ""}`;
}

/** Resolves ids or exact titles; a title shared by several entries needs an id. */
export function resolveEntryIds(
  library: ManagedLibrary,
  entryIds: readonly string[],
  titles: readonly string[]
): string[] {
  const ids = [...entryIds];
  for (const title of titles) {
    const matches = library.entries.filter(
      (entry) => normalizedName(entry.title) === normalizedName(title)
    );
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? `标题「${title}」对应多个条目，请改用 entry_id：${matches.map((entry) => entry.entryId).join("、")}`
          : `目标库中没有标题为「${title}」的条目。`
      );
    ids.push(matches[0]!.entryId);
  }
  for (const id of ids)
    if (!library.entries.some((entry) => entry.entryId === id))
      throw new Error(
        `条目 ${id} 不在目标库中，请先用 library_list 查看目录。`
      );
  return [...new Set(ids)];
}

export function buildLibraryReadTools(
  session: LibraryManagementSession
): AgentTool[] {
  const libraryId = libraryIdParameter(session);
  const domain = Type.Optional(StringEnum(["material", "skill"] as const));
  const list = defineTool({
    name: "library_list",
    label: "列出资料库",
    description:
      "列出当前作品可管理的绑定库，可用 domain 筛选素材库或技能库。传 library_id 则列出该库目录（标题、栏目、entry_id、大小），可按 stage_id 筛选并用 offset 翻页。",
    parameters: Type.Object({
      domain,
      library_id: Type.Optional(libraryId),
      stage_id: Type.Optional(Type.String({ maxLength: 120 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 }))
    }),
    execute: async (_id, params, signal) => {
      try {
        if (!params.library_id) {
          const candidates = session.candidates.filter(
            (library) => !params.domain || library.domain === params.domain
          );
          if (!candidates.length)
            return textResult("当前范围内没有绑定可管理的资料库。");
          return textResult(
            candidates
              .map(
                (library) =>
                  `${NOUN[library.domain]}｜${library.title}｜library_id=${library.libraryId}｜${library.entryCount ?? "?"} 条｜${library.readOnly ? "只读" : "可写"}`
              )
              .join("\n")
          );
        }
        const library = await session.library(
          params.library_id,
          signal,
          params.domain
        );
        const indexes = library.entries
          .map((entry, index) => ({ entry, index }))
          .filter(
            ({ entry }) => !params.stage_id || entry.stageId === params.stage_id
          )
          .map(({ index }) => index);
        const offset = params.offset ?? 0;
        const limit = clampInteger(params.limit, LIST_DEFAULT_LIMIT, 1, 500);
        const page = indexes.slice(offset, offset + limit);
        const more = offset + page.length < indexes.length;
        return textResult(
          [
            `${NOUN[library.candidate.domain]}《${library.candidate.title}》｜共 ${indexes.length} 条${library.candidate.readOnly ? "｜只读" : ""}`,
            ...page.map((index) => entryLine(library, index)),
            ...(page.length ? [] : ["暂无条目。"]),
            ...(more
              ? [`还有后续条目，用 offset=${offset + page.length} 继续。`]
              : [])
          ].join("\n")
        );
      } catch (error) {
        return failure(error);
      }
    }
  });
  const read = defineTool({
    name: "library_read",
    label: "读取资料库条目",
    description: `读取目标库条目全文，一次最多 ${LIBRARY_MANAGEMENT_READ_MAX_ENTRIES} 条；按 entry_ids 或精确 titles 指定，include=overview 同时读取库介绍。修改条目前必须先读取或搜索到它。`,
    parameters: Type.Object({
      library_id: libraryId,
      domain,
      entry_ids: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
          maxItems: LIBRARY_MANAGEMENT_READ_MAX_ENTRIES
        })
      ),
      titles: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
          maxItems: LIBRARY_MANAGEMENT_READ_MAX_ENTRIES
        })
      ),
      include: Type.Optional(
        StringEnum(["overview"], { description: "overview 同时读取库介绍。" })
      )
    }),
    execute: async (_id, params, signal) => {
      try {
        if (Object.hasOwn(params, "overview"))
          return textResult("读取库介绍请使用 include=overview。");
        const library = await session.library(
          params.library_id,
          signal,
          params.domain
        );
        const ids = resolveEntryIds(
          library,
          params.entry_ids ?? [],
          params.titles ?? []
        );
        if (ids.length > LIBRARY_MANAGEMENT_READ_MAX_ENTRIES)
          return textResult(
            `一次最多读取 ${LIBRARY_MANAGEMENT_READ_MAX_ENTRIES} 条。`
          );
        const includeOverview = params.include === "overview";
        if (!ids.length && !includeOverview)
          return textResult(
            "请提供 entry_ids、titles，或设置 include=overview。"
          );
        await session.load(library, ids, includeOverview, signal);
        const parts: string[] = [];
        if (includeOverview && library.overview)
          parts.push(
            `【库介绍】《${library.candidate.title}》${library.overview.truncated ? "（过长已截断，不能修改）" : ""}\n${library.overview.content || "暂无库介绍。"}`
          );
        for (const id of ids) {
          const entry = library.entries.find((item) => item.entryId === id)!;
          session.markRead(library.candidate.libraryId, id, entry.revision);
          parts.push(
            [
              `【${entry.title}】栏目：${stageLabel(library.candidate.domain, entry.stageId)}（${entry.stageId}）｜entry_id=${entry.entryId}${entry.creationId ? "｜本轮新建待保存" : ""}${entry.truncated ? "｜过长已截断，不能修改" : ""}`,
              entry.content || "该条目暂无正文。"
            ].join("\n")
          );
        }
        return textResult(parts.join("\n\n"));
      } catch (error) {
        return failure(error);
      }
    }
  });
  const search = defineTool({
    name: "library_search",
    label: "搜索资料库",
    description:
      "在已绑定库的标题与正文中搜索文本，返回命中条目、位置与上下文。不传 library_id 时搜索全部可管理的库；结果基于已保存内容，命中的条目视为已读取。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 600 }),
      library_id: Type.Optional(libraryId),
      stage_id: Type.Optional(Type.String({ maxLength: 120 })),
      domain,
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_matches: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: LIBRARY_MANAGEMENT_SEARCH_MAX_MATCHES
        })
      ),
      context_chars: Type.Optional(Type.Integer({ minimum: 10, maximum: 500 }))
    }),
    execute: async (_id, params, signal) => {
      try {
        const targets = params.library_id
          ? [session.candidate(params.library_id, params.domain)]
          : session.candidates.filter(
              (item) => !params.domain || params.domain === item.domain
            );
        const maxMatches = clampInteger(
          params.max_matches,
          20,
          1,
          LIBRARY_MANAGEMENT_SEARCH_MAX_MATCHES
        );
        const lines: string[] = [];
        let limited = false;
        for (const domain of [...new Set(targets.map((item) => item.domain))]) {
          const { search: result } = await session.query(
            domain,
            params.library_id,
            {
              kind: "search",
              query: params.query,
              offset: params.offset ?? 0,
              ...(params.stage_id ? { stageId: params.stage_id } : {}),
              maxMatches,
              contextChars: clampInteger(params.context_chars, 80, 10, 500)
            },
            signal
          );
          limited ||= result?.limited === true;
          if (result?.nextOffset !== undefined)
            lines.push(
              `还有后续命中：domain=${domain}，offset=${result.nextOffset}，使用相同查询继续。`
            );
          for (const entry of result?.entries ?? []) {
            session.markRead(entry.libraryId, entry.entryId);
            const title = session.candidates.find(
              (item) => item.libraryId === entry.libraryId
            )?.title;
            lines.push(
              `【${entry.title}】《${title}》library_id=${entry.libraryId}｜entry_id=${entry.entryId}｜${stageLabel(domain, entry.stageId)}${entry.titleHit ? "｜标题命中" : ""}`,
              ...entry.hits.map(
                (hit) => `L${hit.line}:C${hit.column} ${hit.excerpt}`
              )
            );
          }
        }
        if (!lines.length) return textResult(`没有找到「${params.query}」。`);
        if (limited)
          lines.push(
            `本页最多 ${maxMatches} 处命中；按上方 offset 继续，或缩小范围。`
          );
        return textResult(lines.join("\n"));
      } catch (error) {
        return failure(error);
      }
    }
  });
  return [list, read, search];
}
