import {
  MATERIAL_METADATA_AUTHORING_GUIDANCE,
  MATERIAL_METADATA_AUTHORING_GUIDANCE_EN,
  type LibraryAgentProfile,
  type PromptLocale,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

import { writeApprovalBoundary } from "./write-approval";
import type { AgentRunInput } from "./runtime-types";

type LibraryWorkspace = NonNullable<
  WorkspaceRuntimeContext["libraryWorkspace"]
>;

function libraryIndex(workspace: LibraryWorkspace, english: boolean): string {
  return (workspace.readableLibraries ?? [])
    .map((library) =>
      english
        ? `${library.title} | id=${library.libraryId} | ${library.kind} | ${library.entryCount} entries | ${library.groupTitle ?? "ungrouped"} | ${library.readOnly ? "read-only" : "writable"}`
        : `${library.title}｜id=${library.libraryId}｜${library.kind}｜${library.entryCount} 条｜${library.groupTitle ?? "未分组"}｜${library.readOnly ? "只读" : "可写"}`
    )
    .join("\n")
    .slice(0, 16_000);
}

function chineseRules(domain: "material" | "skill"): string[] {
  const noun = domain === "material" ? "素材" : "技能";
  const overview = domain === "material" ? "库介绍" : "库说明";
  return [
    "【资料库工具规则】",
    `- 查看与查重：list_${domain}_entries 列出栏目和条目，search_${domain}_entries 按内容搜索，read_${domain}_entry 读取完整条目。搜索片段只用于定位；修改前必须用 read_${domain}_entry 读取完整目标。优先用 entry_id 指定目标，重名时结合栏目或来源库区分，不要猜测。`,
    `- 新建：调用 create_${domain}_entry，提供 stage_id、title、name、description 和 body。stage_id 只能用目标库允许的栏目；title 是目录标题，通常与 name 相同；name 是${noun}名称；description 是一句话的单行说明；body 是正式的 Markdown ${noun}正文。`,
    `- 说明头部：name 和 description 由工具写进条目 Markdown 顶部以 --- 包裹的头部，缺失则补齐，已有则按参数覆盖，其它头部字段和正文保持不变。不要在 body 里重复手写这两个字段，也不要新增 JSON 清单字段。${domain === "skill" ? "技能必须有实际的方法正文，不能只有名称和说明。" : ""}`,
    `- 修改：调用 edit_${domain}_entry。局部修订用 replace_fragments，并提供唯一、精确的原文；追加用 append；只有正文为空或用户明确要求全文重写时才用 replace，覆盖非空正文须设置 allow_overwrite_existing=true。编辑工具的 name 参数用于按目录标题定位旧条目，不是设置 Markdown 名称；title 用于修改目录标题；修改名称或说明时在头部原位更新。`,
    `- ${overview}：用 edit_${domain}_library_overview 维护，不添加条目元数据头部。`,
    "- 结构整理：manage_library 管理库，manage_group 管理分组，organize_entries 整理、删除或恢复条目。同一轮的结构操作会合并为一份待审阅提案，用户接受前不能声称已经完成；不得用清空正文的方式模拟删除。",
    "- 未绑定表示条目尚未归档，创建时可以明确 target=unbound。作品绑定不在本轮工具范围内。",
    "- 只读库、只读条目、截断的条目和截断的库介绍都不能修改；当前快照没有载入或搜索不到，不代表资料不存在。",
    "- 只提交正式内容，不混入聊天分析、操作记录或工具说明。工具报错时先修正参数或内容；没有生成变更就不能称为已完成。"
  ];
}

function englishRules(domain: "material" | "skill"): string[] {
  const noun = domain;
  return [
    "[Library tool rules]",
    `- Browsing and duplicates: list_${domain}_entries lists sections and entries, search_${domain}_entries searches content and read_${domain}_entry reads a full entry. Search snippets only locate entries; read the full target with read_${domain}_entry before changing it. Prefer entry_id to name the target; when titles repeat, tell them apart by section or source library instead of guessing.`,
    `- Creating: call create_${domain}_entry with stage_id, title, name, description and body. stage_id must be a section the target library allows; title is the directory title, usually the same as name; name is the ${noun}'s name; description is a one-line summary; body is the final Markdown ${noun} text.`,
    `- Metadata header: the tool writes name and description into the --- header at the top of the entry's Markdown, adding them if missing and overwriting them from the parameters if present, while other header fields and the body stay unchanged. Do not repeat these fields in body, and do not add JSON manifest fields.${domain === "skill" ? " A skill must have a real method body, not just a name and description." : ""}`,
    `- Editing: call edit_${domain}_entry. Use replace_fragments with a unique, exact original passage for local revisions and append to add text. Use replace only when the body is empty or the user explicitly asks for a full rewrite; overwriting a non-empty body needs allow_overwrite_existing=true. The edit tool's name parameter locates an existing entry by its directory title and does not set the Markdown name; title changes the directory title; update name or description in place in the header.`,
    `- Library overview: maintain it with edit_${domain}_library_overview, without an entry metadata header.`,
    "- Reorganizing: manage_library manages libraries, manage_group manages groups and organize_entries arranges, deletes or restores entries. Structural operations in one turn are combined into a single proposal for review; never claim they are done before the user accepts, and never fake a deletion by clearing the body.",
    "- Unbound means an entry has not been filed into a library yet; pass target=unbound explicitly to create one. Binding libraries to works is outside this turn's tools.",
    "- Read-only libraries, read-only entries, truncated entries and truncated overviews cannot be changed. Content missing from the snapshot or from search results is not proof that it does not exist.",
    "- Submit only final content, with no chat analysis, operation log or tool notes mixed in. When a tool reports an error, fix the parameters or content first; without a resulting change, nothing is done."
  ];
}

export function libraryAgentHeader(
  profile: LibraryAgentProfile,
  locale: PromptLocale
): string {
  return locale === "en-US"
    ? `[Current library agent: ${profile.label} / ${profile.domain}]`
    : `【当前资料库智能体：${profile.label} / ${profile.domain}】`;
}

/** Non-editable library scope, tool rules and write approval. */
export function buildLibraryRuntimeRequirements(
  workspace: LibraryWorkspace,
  input: AgentRunInput,
  locale: PromptLocale
): string {
  const english = locale === "en-US";
  const domain = workspace.domain;
  const metadata =
    domain === "material"
      ? [
          english
            ? MATERIAL_METADATA_AUTHORING_GUIDANCE_EN
            : MATERIAL_METADATA_AUTHORING_GUIDANCE
        ]
      : [];
  if (english) {
    return [
      "[DeepWrite library scope]",
      `You can manage every ${domain} library but not other domains. [Current location] is the library the user is looking at, and tools target it by default. Pass library_id to read and write other libraries, and name the target library in your reply. Built-in skill libraries are read-only.`,
      "Read entry bodies on demand with the read and search tools listed for this turn.",
      "When you need a method for organizing, creating or initializing, load an available skill with load_skill. A skill is a method and never becomes library content by itself.",
      "",
      ...englishRules(domain),
      ...metadata,
      "",
      writeApprovalBoundary(input.writeApprovalMode, locale),
      "",
      `[Current location] "${workspace.title}" id=${workspace.libraryId} tag=${workspace.kind} group=${workspace.groupTitle ?? "none"} current entry=${workspace.activeEntryId ?? "none"}`,
      "[All libraries index]",
      libraryIndex(workspace, true),
      "The index may be truncated when it is long; call the list tool to see every library."
    ].join("\n");
  }
  return [
    "【DeepWrite 当前资料库工具边界】",
    "可管理本领域全部库，不跨领域；【当前位置】是用户正在看的库，工具默认指向它。指定 library_id 可读取和写入其它库，回复中须写明目标库名。内置技能库只读。",
    "条目正文必须通过本轮实际列出的读取和搜索工具按需取得。",
    "需要整理、创建或初始化等方法时，调用 load_skill 按需加载本轮可用技能；技能是方法，不会自动成为资料库事实。",
    "",
    ...chineseRules(domain),
    ...metadata,
    "",
    writeApprovalBoundary(input.writeApprovalMode, locale),
    "",
    `【当前位置】《${workspace.title}》 id=${workspace.libraryId} 标签=${workspace.kind} 分组=${workspace.groupTitle ?? "无"} 当前条目=${workspace.activeEntryId ?? "无"}`,
    "【全库索引】",
    libraryIndex(workspace, false),
    "索引过长时可能截断，调用 list 工具查看全库索引。"
  ].join("\n");
}
