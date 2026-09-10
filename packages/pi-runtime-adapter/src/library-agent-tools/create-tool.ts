import {
  type BuildLibraryAgentToolsInput,
  type LibraryDomain,
  type MutableLibraryEntry
} from "./types";
import { type AgentTool } from "@earendil-works/pi-agent-core";
import { libraryId, libraryTitle } from "./workspace";
import {
  defineTool,
  MAX_ENTRY_CONTENT_CHARACTERS,
  textResult,
  normalizedName,
  stageLabel
} from "./shared";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import {
  createShortWorkspaceContentRevision,
  parseSkillMarkdown,
  updateMaterialMarkdownMetadata,
  updateSkillMarkdownMetadata
} from "@deepwrite/contracts";
import { mutationResult } from "./mutations";

export function buildCreateTool(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  entries: MutableLibraryEntry[],
  stages: readonly string[],
  accessedEntryIds: Set<string>
): AgentTool {
  const noun = domain === "material" ? "素材" : "技能";
  const currentLibraryId = libraryId(input.workspace);
  return defineTool({
    name: `create_${domain}_entry`,
    label: `创建${noun}条目`,
    description: `在当前${noun}库的允许栏目中创建一个条目。name 和 description 写入 Markdown 顶部 --- 说明头部，缺失则补充，已存在则覆盖，不新增 JSON 清单字段；body 保留正式正文与其他头部字段。只提交变更，保存状态以客户端为准；同分组其它库只读。`,
    parameters: Type.Object({
      stage_id: StringEnum(stages),
      title: Type.String({
        minLength: 1,
        maxLength: 256,
        description: "资料库目录中的条目标题，通常与 name 相同。"
      }),
      name: Type.String({
        minLength: 1,
        maxLength: 256,
        description: `Markdown 头部的${noun}名称；以此参数覆盖 body 中已有的 name。`
      }),
      description: Type.String({
        minLength: 1,
        maxLength: 1_000,
        description: `简要说明${noun}的用途、适用场景和何时使用；以此参数覆盖 body 中已有的 description。`
      }),
      body: Type.Optional(
        Type.String({ maxLength: MAX_ENTRY_CONTENT_CHARACTERS })
      )
    }),
    execute: async (toolCallId, params) => {
      const stageId = String(params.stage_id ?? "");
      if (!stages.includes(stageId)) {
        return textResult(`未创建：当前${noun}库不允许写入栏目 ${stageId}。`);
      }
      const title = String(params.title ?? "").trim();
      if (!title) return textResult("未创建：title 不能为空。");
      const name = normalizedName(String(params.name ?? ""));
      const description = normalizedName(String(params.description ?? ""));
      if (!name || !description) {
        return textResult("未创建：name 和 description 均不能为空。");
      }
      if (
        title.length > 256 ||
        name.length > 256 ||
        description.length > 1_000
      ) {
        return textResult(
          "未创建：title、name 最多 256 个字符，description 最多 1,000 个字符。"
        );
      }
      if (
        entries.some(
          (entry) =>
            entry.isCurrentLibrary &&
            entry.stageId === stageId &&
            normalizedName(entry.title) === normalizedName(title)
        )
      ) {
        return textResult(
          `未创建：栏目「${stageLabel(domain, stageId)}」中已存在同名条目「${title}」。`
        );
      }
      const body = String(params.body ?? "");
      const result = (
        domain === "skill"
          ? updateSkillMarkdownMetadata
          : updateMaterialMarkdownMetadata
      )(body, { name, description });
      if (!result.updated) return textResult(`未创建：${result.message}`);
      const content = result.content;
      if (domain === "skill") {
        const parsed = parseSkillMarkdown(content);
        if (!parsed.valid) return textResult(`未创建：${parsed.message}`);
      }
      if (content.length > MAX_ENTRY_CONTENT_CHARACTERS) {
        return textResult(
          `未创建：补齐 name 和 description 后正文超过 ${MAX_ENTRY_CONTENT_CHARACTERS.toLocaleString("zh-CN")} 个字符。请缩短内容后重试。`
        );
      }
      const safeCallId = toolCallId
        .replace(/[^A-Za-z0-9._-]/gu, "-")
        .slice(0, 180);
      const entry: MutableLibraryEntry = {
        entryId: `pending:${safeCallId || "entry"}`,
        documentId: `pending:${domain}:${safeCallId || "entry"}`,
        stageId,
        title,
        content,
        revision: createShortWorkspaceContentRevision(content),
        truncated: false,
        readOnly: false,
        pendingCreate: true,
        sourceLibraryId: currentLibraryId,
        sourceLibraryTitle: libraryTitle(input.workspace),
        isCurrentLibrary: true
      };
      entries.push(entry);
      accessedEntryIds.add(entry.entryId);
      return mutationResult(
        input,
        "create",
        entry,
        createShortWorkspaceContentRevision(""),
        `已生成创建${noun}条目「${title}」的变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}
