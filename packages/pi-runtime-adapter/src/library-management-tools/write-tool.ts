import { StringEnum, Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createShortWorkspaceContentRevision,
  LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS,
  MATERIAL_STAGE_IDS,
  parseSkillMarkdown,
  parseMaterialMarkdown,
  readSkillMarkdownMetadata,
  SKILL_STAGE_IDS,
  updateMaterialMarkdownMetadata,
  updateSkillMarkdownMetadata
} from "@deepwrite/contracts";
import {
  defineTool,
  MAX_ENTRY_CONTENT_CHARACTERS,
  normalizedName,
  stageLabel,
  textResult
} from "../library-agent-tools/shared";
import {
  MAX_NEW_FRAGMENT_CHARACTERS,
  MAX_ORIGINAL_FRAGMENT_CHARACTERS,
  MAX_REPLACEMENTS,
  replaceFragments
} from "../library-agent-tools/edit-tools";
import { approvalSummary } from "../library-agent-tools/mutations";
import type { LibraryMutationDetails } from "../library-agent-tools/types";
import { libraryIdParameter } from "./read-tools";
import type {
  LibraryManagementSession,
  ManagedEntry,
  ManagedLibrary
} from "./session";

export const LIBRARY_WRITE_MAX_OPERATIONS = 20;

const operationSchema = Type.Object({
  action: StringEnum(["create", "edit", "edit_overview"] as const),
  entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  stage_id: Type.Optional(Type.String({ maxLength: 120 })),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
  mode: Type.Optional(
    StringEnum(["replace_fragments", "append", "replace"] as const)
  ),
  body: Type.Optional(Type.String({ maxLength: MAX_ENTRY_CONTENT_CHARACTERS })),
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
});
type Operation = Static<typeof operationSchema>;

interface Draft {
  entry: ManagedEntry;
  title: string;
  content: string;
  baseRevision: string;
  creationId?: string;
}

/** Applies mode/body/replacements to a text; returns the new text or why not. */
function edited(current: string, op: Operation, limit: number): string {
  if (!op.mode) return current;
  if (op.mode === "replace_fragments") {
    const result = replaceFragments(current, op.replacements ?? []);
    if (result.error || result.text === undefined)
      throw new Error(result.error ?? "替换失败");
    if (result.text.length > limit)
      throw new Error(`修改后超过 ${limit} 字上限。`);
    return result.text;
  }
  const body = (op.body ?? "").trim();
  if (!body) throw new Error(`${op.mode} 模式需要提供 body。`);
  if (
    op.mode === "replace" &&
    current.trim() &&
    op.allow_overwrite_existing !== true
  )
    throw new Error(
      "已有正文，只有用户明确要求覆盖全文时才可设置 allow_overwrite_existing=true；普通修改请用 replace_fragments。"
    );
  const next =
    op.mode === "append"
      ? `${current}${current ? (current.endsWith("\n") ? "\n" : "\n\n") : ""}${body}`
      : body;
  if (next.length > limit)
    throw new Error(`修改后超过 ${limit.toLocaleString("zh-CN")} 字上限。`);
  return next;
}

function withMetadata(
  library: ManagedLibrary,
  content: string,
  op: Operation
): string {
  if (!op.name && !op.description) return content;
  const update =
    library.candidate.domain === "skill"
      ? updateSkillMarkdownMetadata
      : updateMaterialMarkdownMetadata;
  const previous =
    library.candidate.domain === "skill"
      ? readSkillMarkdownMetadata(content)
      : parseMaterialMarkdown(content);
  const result = update(content, {
    name: normalizedName(op.name ?? previous.name ?? ""),
    description: normalizedName(op.description ?? previous.description ?? "")
  });
  if (!result.updated) throw new Error(result.message);
  return result.content;
}

function duplicate(
  library: ManagedLibrary,
  drafts: Map<string, Draft>,
  stageId: string,
  title: string,
  self?: string
) {
  const taken = library.entries.some((entry) => {
    const draft = drafts.get(entry.entryId);
    return (
      entry.entryId !== self &&
      entry.stageId === stageId &&
      normalizedName(draft?.title ?? entry.title) === normalizedName(title)
    );
  });
  if (taken)
    throw new Error(
      `栏目「${stageLabel(library.candidate.domain, stageId)}」中已存在同名条目「${title}」。`
    );
}

export function buildLibraryWriteTool(
  session: LibraryManagementSession
): AgentTool {
  return defineTool({
    name: "library_write",
    label: "写入资料库",
    description: `在一个可写库里批量提交条目变更，一次最多 ${LIBRARY_WRITE_MAX_OPERATIONS} 项，全部校验通过才提交，每个条目形成一张修改卡。action=create 需 stage_id、name、description，可给 body 与 title（缺省同 name），name/description 写入 Markdown 头部；action=edit 需 entry_id（必须本轮已读取或搜索到），用 mode 修改正文（局部用 replace_fragments，追加用 append，明确整篇覆盖才用 replace），可同时改 title，或只给 name/description 更新头部；action=edit_overview 修改库介绍。`,
    parameters: Type.Object({
      library_id: libraryIdParameter(session),
      operations: Type.Array(operationSchema, {
        minItems: 1,
        maxItems: LIBRARY_WRITE_MAX_OPERATIONS
      })
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      try {
        const library = await session.library(params.library_id, signal);
        const { domain, libraryId } = library.candidate;
        if (library.candidate.readOnly)
          return textResult("目标库只读，不能创建或修改。");
        const editIds = params.operations.flatMap((op) =>
          op.action === "edit" && op.entry_id ? [op.entry_id] : []
        );
        for (const id of editIds)
          if (!library.entries.some((entry) => entry.entryId === id))
            throw new Error(
              `条目 ${id} 不在目标库中，请先用 library_list 查看目录。`
            );
        const unread = editIds.filter((id) => !session.wasRead(libraryId, id));
        if (unread.length)
          throw new Error(
            `请先用 library_read 或 library_search 读取这些条目：${unread.join("、")}`
          );
        await session.load(
          library,
          editIds,
          params.operations.some((op) => op.action === "edit_overview"),
          signal
        );
        const changed = editIds.filter(
          (id) =>
            !session.readIsCurrent(
              libraryId,
              id,
              library.entries.find((entry) => entry.entryId === id)?.revision
            )
        );
        if (changed.length)
          throw new Error(
            `这些条目在你上次读取后已变化（例如审阅时被修改或拒绝），请先用 library_read 重新读取：${changed.join("、")}`
          );
        const drafts = new Map<string, Draft>();
        const created: ManagedEntry[] = [];
        let overview: { content: string; baseRevision: string } | undefined;
        const stages: readonly string[] =
          domain === "material" ? MATERIAL_STAGE_IDS : SKILL_STAGE_IDS;
        for (const [index, op] of params.operations.entries()) {
          try {
            if (op.action === "edit_overview") {
              const current =
                overview?.content ?? library.overview?.content ?? "";
              if (library.overview?.truncated)
                throw new Error("库介绍过长已截断，不能修改。");
              const content = edited(
                current,
                op,
                LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS
              );
              if (content === current) throw new Error("库介绍没有实际变化。");
              overview = {
                content,
                baseRevision:
                  overview?.baseRevision ??
                  library.overview?.revision ??
                  createShortWorkspaceContentRevision("")
              };
              continue;
            }
            if (op.action === "create") {
              const stageId = op.stage_id ?? "";
              if (!stages.includes(stageId))
                throw new Error(`stage_id 只能是：${stages.join("、")}`);
              if (!op.name || !op.description)
                throw new Error("create 需要 name 和 description。");
              const title = (op.title ?? op.name).trim();
              if (!title) throw new Error("条目标题不能为空。");
              duplicate(library, drafts, stageId, title);
              const content = withMetadata(library, (op.body ?? "").trim(), op);
              if (domain === "skill") {
                const parsed = parseSkillMarkdown(content);
                if (!parsed.valid) throw new Error(parsed.message);
              }
              if (content.length > MAX_ENTRY_CONTENT_CHARACTERS)
                throw new Error("正文超过单条上限。");
              const creationId = `pending:${domain}:${toolCallId.replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 160)}:${index}`;
              const entry: ManagedEntry = {
                entryId: creationId,
                documentId: creationId,
                title,
                stageId,
                contentBytes: 0,
                creationId
              };
              created.push(entry);
              library.entries.push(entry);
              drafts.set(creationId, {
                entry,
                title,
                content,
                baseRevision: createShortWorkspaceContentRevision(""),
                creationId
              });
              continue;
            }
            const entry = library.entries.find(
              (item) => item.entryId === op.entry_id
            );
            if (!entry) throw new Error("edit 需要有效的 entry_id。");
            if (entry.truncated)
              throw new Error(`「${entry.title}」过长已截断，不能写入。`);
            const draft = drafts.get(entry.entryId) ?? {
              entry,
              title: entry.title,
              content: entry.content ?? "",
              baseRevision:
                entry.revision ??
                createShortWorkspaceContentRevision(entry.content ?? ""),
              ...(entry.creationId ? { creationId: entry.creationId } : {})
            };
            const title = op.title?.trim() || draft.title;
            if (title !== draft.title)
              duplicate(library, drafts, entry.stageId, title, entry.entryId);
            const content = withMetadata(
              library,
              edited(draft.content, op, MAX_ENTRY_CONTENT_CHARACTERS),
              op
            );
            if (content.length > MAX_ENTRY_CONTENT_CHARACTERS)
              throw new Error("正文超过单条上限。");
            if (content === draft.content && title === draft.title)
              throw new Error("没有实际变化。");
            drafts.set(entry.entryId, { ...draft, title, content });
          } catch (error) {
            for (const entry of created)
              library.entries.splice(library.entries.indexOf(entry), 1);
            return textResult(
              `未提交任何变更：第 ${index + 1} 项（${op.action}）${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        const noun = domain === "material" ? "素材" : "技能";
        const items: LibraryMutationDetails[] = [];
        const lines: string[] = [];
        const common = {
          domain,
          libraryId,
          ...(library.projectRevision === undefined
            ? {}
            : { baseProjectRevision: library.projectRevision })
        };
        for (const draft of drafts.values()) {
          const summary = `已生成${draft.creationId && !draft.entry.revision ? "创建" : "修改"}${noun}条目「${draft.title}」的变更，等待用户审阅。`;
          items.push(
            draft.creationId
              ? {
                  kind: "library-entry-mutation",
                  operation: "create",
                  creationId: draft.creationId,
                  ...common,
                  stageId: draft.entry.stageId,
                  title: draft.title,
                  text: draft.content,
                  baseRevision: draft.baseRevision,
                  summary: summary.replace("，等待用户审阅。", "。")
                }
              : {
                  kind: "library-entry-mutation",
                  operation: "edit",
                  ...common,
                  entryId: draft.entry.entryId,
                  documentId: draft.entry.documentId,
                  stageId: draft.entry.stageId,
                  title: draft.title,
                  text: draft.content,
                  baseRevision: draft.baseRevision,
                  summary: summary.replace("，等待用户审阅。", "。")
                }
          );
          lines.push(approvalSummary(summary, session.writeApprovalMode));
          Object.assign(draft.entry, {
            title: draft.title,
            content: draft.content,
            revision: createShortWorkspaceContentRevision(draft.content),
            contentBytes: new TextEncoder().encode(draft.content).length
          });
          session.markRead(
            libraryId,
            draft.entry.entryId,
            draft.entry.revision
          );
        }
        if (overview && library.overview) {
          const summary = `已生成${domain === "skill" ? "技能库说明" : "素材库介绍"}的修改，等待用户审阅。`;
          items.push({
            kind: "library-overview-mutation",
            operation: "edit-overview",
            ...common,
            documentId: library.overviewDocumentId,
            title: `${library.candidate.title} · ${domain === "skill" ? "库说明" : "库介绍"}`,
            text: overview.content,
            baseRevision: overview.baseRevision,
            summary: summary.replace("，等待用户审阅。", "。")
          });
          lines.push(approvalSummary(summary, session.writeApprovalMode));
          library.overview = {
            ...library.overview,
            content: overview.content,
            revision: createShortWorkspaceContentRevision(overview.content)
          };
        }
        return textResult(
          lines.join("\n"),
          items.length === 1
            ? items[0]!
            : { kind: "library-mutation-batch", items }
        );
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  });
}
