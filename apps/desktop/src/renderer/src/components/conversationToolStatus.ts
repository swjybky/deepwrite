import type { AgentToolTrace } from "../types/conversation";
import type { IconName } from "../types/workspace";
import { writeToolText } from "../utils/agentWriteToolPreview";

export function workspaceToolLabel(name: string): string {
  const labels: Record<string, string> = {
    list_creation_projects: "列出创作项目",
    get_creation_project_summary: "查看项目摘要",
    list_material_libraries: "列出素材库",
    get_material_library_summary: "查看素材库摘要",
    list_skill_libraries: "列出技能库",
    get_skill_library_summary: "查看技能库摘要",
    query_model_configs: "查询模型配置",
    query_model_usage: "查询模型用量",
    list_workspace_content: "列出项目阶段",
    read_workspace_content: "读取工作区内容",
    search_workspace_text: "搜索工作区文本",
    query_linked_material_entries: "查询关联素材",
    load_skill: "加载技能",
    switch_storyline_stage: "切换剧情方向",
    write_workspace_editor: "写入阶段编辑器",
    replace_current_stage_text: "替换阶段文本",
    create_draft_sections: "创建章节文件",
    read_draft_sections: "读取正文章节",
    write_draft_section: "写入正文章节",
    replace_draft_section_text: "替换正文章节文本",
    rename_draft_section: "修改章节名称",
    delete_draft_section: "删除章节",
    list: "列出范围细节",
    read: "读取对象正文",
    create: "新建对象",
    edit: "写入或修改",
    delete: "删除对象",
    propose_continuity_commit: "提交连续性记录",
    search_continuity_files: "搜索连续性文件",
    create_setting: "创建设定",
    write_setting: "写入设定",
    edit_setting: "编辑设定",
    list_worldbuilding: "列出世界观",
    read_worldbuilding: "读取世界观",
    search_worldbuilding: "搜索世界观",
    read_worldbuilding_file: "读取世界观文件",
    create_worldbuilding_file: "创建世界观文件",
    write_worldbuilding_file: "写入世界观文件",
    edit_worldbuilding_file: "编辑世界观文件",
    create_worldbuilding_files: "创建世界观文件",
    read_worldbuilding_content: "读取世界观文件",
    create_worldbuilding_items: "创建世界观文件",
    write_worldbuilding_content: "写入世界观文件",
    replace_worldbuilding_text: "编辑世界观文件",
    list_characters: "列出人物",
    search_characters: "搜索人物",
    read_character: "读取人物",
    write_character_overview: "写入人物概览",
    edit_character_overview: "编辑人物概览",
    create_character: "创建人物",
    write_character_file: "写入人物文件",
    create_character_file: "创建人物文件",
    edit_character_file: "编辑人物文件",
    rename_character_item: "修改人物名称",
    move_character_item: "移动人物条目",
    delete_character_file: "删除人物文件",
    web_search: "智能搜索"
  };
  return labels[name] ?? name;
}

type ToolKind = "read" | "command" | "write" | "web" | "other";

const WRITE_TOOL_NAMES = new Set([
  "write_workspace_editor",
  "replace_current_stage_text",
  "create_draft_sections",
  "write_draft_section",
  "replace_draft_section_text",
  "rename_draft_section",
  "delete_draft_section",
  "create_setting",
  "write_setting",
  "edit_setting",
  "create_worldbuilding_file",
  "write_worldbuilding_file",
  "edit_worldbuilding_file",
  "create_worldbuilding_items",
  "write_worldbuilding_content",
  "replace_worldbuilding_text",
  "create_character",
  "create_character_file",
  "write_character_file",
  "edit_character_file",
  "rename_character_item",
  "move_character_item",
  "delete_character_file",
  "write_character_overview",
  "edit_character_overview",
  "create",
  "edit",
  "delete"
]);

const CREATE_FILE_TOOL_NAMES = new Set([
  "create",
  "create_draft_sections",
  "create_setting",
  "create_worldbuilding_file",
  "create_worldbuilding_files",
  "create_worldbuilding_items",
  "create_character",
  "create_character_file"
]);

const DIRECT_WRITE_TOOL_NAMES = new Set([
  "write_workspace_editor",
  "create_draft_sections",
  "write_draft_section",
  "rename_draft_section",
  "delete_draft_section",
  "write_setting",
  "write_worldbuilding_file",
  "write_worldbuilding_content",
  "write_character_file",
  "write_character_overview"
]);

/** The unified `edit` tool writes chapter bodies when it targets `document=body`. */
function isLongChapterBodyTool(tool: AgentToolTrace): boolean {
  if (tool.name !== "edit" && tool.name !== "create") return false;
  const args = tool.args as Record<string, unknown> | undefined;
  return (
    typeof args?.id === "string" &&
    args.id.startsWith("chapter_") &&
    args.document === "body"
  );
}

export function isWriteTool(tool: AgentToolTrace): boolean {
  return WRITE_TOOL_NAMES.has(tool.name) || toolKind(tool.name) === "write";
}

type WriteToolAction = "write" | "modify";

export function writeToolAction(tool: AgentToolTrace): WriteToolAction {
  return DIRECT_WRITE_TOOL_NAMES.has(tool.name) ||
    /(?:write|save)/i.test(tool.name)
    ? "write"
    : "modify";
}

export function writeActionLabel(action: WriteToolAction): "写入" | "修改" {
  return action === "write" ? "写入" : "修改";
}

export function toolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (
    WRITE_TOOL_NAMES.has(name) ||
    /(write|edit|replace|patch|save|apply)/.test(name)
  ) {
    return "write";
  }
  if (/(read|list|search|find|glob|file)/.test(name)) {
    return "read";
  }
  if (/(exec|shell|command|terminal|run)/.test(name)) {
    return "command";
  }
  if (/(browser|web|http|fetch|url)/.test(name)) {
    return "web";
  }
  return "other";
}

export function toolIcon(tool: AgentToolTrace): IconName {
  const kind = toolKind(tool.name);
  if (kind === "read") return "folder";
  if (kind === "command") return "terminal";
  if (kind === "write") return "file";
  if (kind === "web") return "globe";
  return "sparkles";
}

export function toolLabel(tool: AgentToolTrace): string {
  const displayName = workspaceToolLabel(tool.name);
  if (tool.status === "completed" && isWriteTool(tool)) {
    const unchanged = tool.resultSummary
      ?.trim()
      .match(/^(未修改|未写入|未覆盖|未替换)[:：]/);
    if (unchanged) return unchanged[1]!;
  }
  if (isLongChapterBodyTool(tool)) {
    if (tool.status === "error") return "正文审核生成失败";
    if (tool.status === "completed") return "当前章正文待审核";
    if (tool.status === "running") return "正在生成正文审核";
    return "正在生成当前章正文";
  }
  if (CREATE_FILE_TOOL_NAMES.has(tool.name)) {
    if (tool.status === "error") return "创建文件失败";
    if (tool.status === "completed") return "文件创建变更已生成";
    return "正在创建文件";
  }
  if (isWriteTool(tool)) {
    const action = writeActionLabel(writeToolAction(tool));
    if (tool.status === "error") return `${action}失败`;
    if (tool.status === "completed") return `${action}结果已生成`;
    return `正在${action}`;
  }
  if (tool.status === "error") return `执行 ${displayName} 时出错`;
  if (tool.status === "preparing") return `正在准备${displayName}`;
  const running = tool.status === "running";
  const kind = toolKind(tool.name);
  if (kind === "read") return running ? "正在读取文件" : "已读取文件";
  if (kind === "command") return running ? "正在运行命令" : "运行了命令";
  if (kind === "write") return running ? "正在提交文本变更" : "已生成文本变更";
  if (kind === "web") return running ? "正在访问页面" : "已访问页面";
  return `${running ? "正在执行" : "已执行"} ${displayName}`;
}

export function toolGroupIsRunning(tools: AgentToolTrace[]): boolean {
  return tools.some(
    (tool) => tool.status === "preparing" || tool.status === "running"
  );
}

export function toolGroupLabel(tools: AgentToolTrace[]): "执行中" | "执行完成" {
  return toolGroupIsRunning(tools) ? "执行中" : "执行完成";
}

function compactTrace(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

export function toolDetail(tool: AgentToolTrace): string | undefined {
  if (tool.status === "preparing") {
    const length = writeToolText(tool).length;
    return length > 0
      ? `已生成 ${length.toLocaleString("zh-CN")} 字符`
      : isWriteTool(tool)
        ? "待审阅文本生成中"
        : "参数生成中";
  }
  if (isWriteTool(tool) && tool.status === "running") {
    return `正在提交${writeActionLabel(writeToolAction(tool))}内容`;
  }
  if (tool.resultSummary?.trim()) {
    return compactTrace(tool.resultSummary);
  }
  if (!tool.args || typeof tool.args !== "object") {
    return undefined;
  }
  const args = tool.args as Record<string, unknown>;
  for (const key of ["path", "file", "command", "query", "url"]) {
    if (typeof args[key] === "string") {
      return compactTrace(args[key]);
    }
  }
  try {
    return compactTrace(JSON.stringify(args));
  } catch {
    return undefined;
  }
}

export function writeToolContentLabel(tool: AgentToolTrace): string {
  return isLongChapterBodyTool(tool) ? "待审阅正文" : "写入内容";
}

export function writeToolTarget(tool: AgentToolTrace): string | undefined {
  if (!tool.args || typeof tool.args !== "object") return undefined;
  const args = tool.args as Record<string, unknown>;
  return typeof args.target_stage_id === "string"
    ? args.target_stage_id
    : undefined;
}

export function visibleToolArguments(tool: AgentToolTrace): unknown {
  return tool.args ?? tool.argumentsText;
}

export function formatToolPayload(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const formatted =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return formatted.length > 3_000
      ? `${formatted.slice(0, 3_000)}\n…`
      : formatted;
  } catch {
    return String(value);
  }
}
