import { createScopedTranslator, locale } from "../i18n";
import type { AgentToolTrace } from "../types/conversation";
import type { IconName } from "../types/workspace";
import { writeToolText } from "../utils/agentWriteToolPreview";
import {
  compactTrace,
  hasWebSources,
  isWebSearchTool,
  isWebToolName,
  webToolDetail
} from "./conversationWebTools";

const t = createScopedTranslator("components.conversationToolStatus");

export function workspaceToolLabel(name: string): string {
  const labels: Record<string, string> = {
    list_creation_projects: t("listWritingProjects"),
    get_creation_project_summary: t("viewProjectSummary"),
    list_material_libraries: t("listMaterialLibraries"),
    get_material_library_summary: t("viewMaterialLibrarySummary"),
    list_skill_libraries: t("listSkillLibraries"),
    get_skill_library_summary: t("viewSkillLibrarySummary"),
    query_model_configs: t("queryModelSettings"),
    query_model_usage: t("queryModelUsage"),
    list_workspace_content: t("listProjectStages"),
    read_workspace_content: t("readWorkspaceContent"),
    search_workspace_text: t("searchWorkspaceText"),
    query_linked_material_entries: t("queryLinkedMaterials"),
    load_skill: t("loadSkill"),
    switch_storyline_stage: t("switchPlotDirection"),
    write_workspace_editor: t("writeToStageEditor"),
    replace_current_stage_text: t("replaceStageText"),
    create_draft_sections: t("createChapterFile"),
    read_draft_sections: t("readManuscriptChapter"),
    write_draft_section: t("writeManuscriptChapter"),
    replace_draft_section_text: t("replaceManuscriptChapterText"),
    rename_draft_section: t("renameChapter"),
    delete_draft_section: t("deleteChapter"),
    list: t("listScopeDetails"),
    read: t("readObjectContent"),
    create: t("createObject"),
    edit: t("writeOrEdit"),
    delete: t("deleteObject"),
    propose_continuity_commit: t("commitContinuityRecord"),
    search_continuity_files: t("searchContinuityFiles"),
    create_setting: t("createSetting"),
    write_setting: t("writeSetting"),
    edit_setting: t("editSetting"),
    list_worldbuilding: t("listWorldbuilding"),
    read_worldbuilding: t("readWorldbuilding"),
    search_worldbuilding: t("searchWorldbuilding"),
    read_worldbuilding_file: t("readWorldbuildingFile"),
    create_worldbuilding_file: t("createWorldbuildingFile"),
    write_worldbuilding_file: t("writeWorldbuildingFile"),
    edit_worldbuilding_file: t("editWorldbuildingFile"),
    create_worldbuilding_files: t("createWorldbuildingFile"),
    read_worldbuilding_content: t("readWorldbuildingFile"),
    create_worldbuilding_items: t("createWorldbuildingFile"),
    write_worldbuilding_content: t("writeWorldbuildingFile"),
    replace_worldbuilding_text: t("editWorldbuildingFile"),
    list_characters: t("listCharacters"),
    search_characters: t("searchCharacters"),
    read_character: t("readCharacter"),
    write_character_overview: t("writeCharacterOverview"),
    edit_character_overview: t("editCharacterOverview"),
    create_character: t("createCharacter"),
    write_character_file: t("writeCharacterFile"),
    create_character_file: t("createCharacterFile"),
    edit_character_file: t("editCharacterFile"),
    rename_character_item: t("renameCharacter"),
    move_character_item: t("moveCharacterEntry"),
    delete_character_file: t("deleteCharacterFile"),
    web_search: t("webSearch"),
    web_fetch: t("webFetch")
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

export function writeActionLabel(action: WriteToolAction): string {
  return action === "write" ? t("write") : t("edit");
}

export function toolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (isWebToolName(name)) return "web";
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
  if (tool.status === "preparing" && tool.argumentsComplete) {
    return t("waitingForValue", { arg0: displayName });
  }
  if (tool.status === "completed" && isWriteTool(tool)) {
    const unchanged = tool.resultSummary
      ?.trim()
      .match(/^(未修改|未写入|未覆盖|未替换)[:：]/);
    if (unchanged) return unchanged[1]!;
  }
  if (isLongChapterBodyTool(tool)) {
    if (tool.status === "error") return t("couldNotGenerateManuscriptReview");
    if (tool.status === "completed")
      return t("currentChapterManuscriptAwaitingReview");
    if (tool.status === "running") return t("generatingManuscriptReview");
    return t("generatingCurrentChapterManuscript");
  }
  if (CREATE_FILE_TOOL_NAMES.has(tool.name)) {
    if (tool.status === "error") return t("couldNotCreateFile");
    if (tool.status === "completed") return t("fileCreationChangesGenerated");
    return t("creatingFile");
  }
  if (isWriteTool(tool)) {
    const action = writeActionLabel(writeToolAction(tool));
    if (tool.status === "error")
      return t("valueFailed", {
        arg0: action
      });
    if (tool.status === "completed")
      return t("valueResultGenerated", {
        arg0: action
      });
    return t("runningValue", {
      arg0: action
    });
  }
  if (tool.status === "error")
    return t("errorWhileRunningValue", {
      arg0: displayName
    });
  if (tool.status === "preparing")
    return t("preparingValue", {
      arg0: displayName
    });
  const running = tool.status === "running";
  const kind = toolKind(tool.name);
  if (kind === "read") return running ? t("readingFile") : t("fileRead");
  if (kind === "command")
    return running ? t("runningCommand") : t("commandExecuted");
  if (kind === "write")
    return running ? t("submittingTextChanges") : t("textChangesGenerated");
  if (kind === "web" && isWebSearchTool(tool))
    return running ? t("searchingWeb") : t("webSearched");
  if (kind === "web") return running ? t("openingPage") : t("pageOpened");
  return t("valueValue", {
    arg0: running ? t("running") : t("executed"),
    arg1: displayName
  });
}

/** Executing calls take precedence over calls waiting in the same model turn. */
export function activeToolCall(
  tools: readonly AgentToolTrace[]
): AgentToolTrace | undefined {
  let preparing: AgentToolTrace | undefined;
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index]!;
    if (tool.status === "running") return tool;
    if (tool.status === "preparing") preparing ??= tool;
  }
  return preparing;
}

export function toolGroupIsRunning(tools: readonly AgentToolTrace[]): boolean {
  return activeToolCall(tools) !== undefined;
}

export function toolGroupLabel(tools: readonly AgentToolTrace[]): string {
  const tool = activeToolCall(tools);
  if (!tool) return t("completed");
  if (tool.status === "running") return t("runningLabel");
  return tool.argumentsComplete
    ? t("waitingForExecution")
    : t("generatingArguments");
}

export function toolDetail(tool: AgentToolTrace): string | undefined {
  if (tool.status === "preparing") {
    if (tool.argumentsComplete) return t("waitingForExecution");
    const length = writeToolText(tool).length;
    return length > 0
      ? t("generatedValueCharacters", {
          arg0: length.toLocaleString(locale.value)
        })
      : isWriteTool(tool)
        ? t("generatingTextForReview")
        : t("generatingArguments");
  }
  if (isWriteTool(tool) && tool.status === "running") {
    return t("submittingValueContent", {
      arg0: writeActionLabel(writeToolAction(tool))
    });
  }
  if (hasWebSources(tool) && tool.status !== "error") {
    return webToolDetail(tool);
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
  return isLongChapterBodyTool(tool)
    ? t("manuscriptAwaitingReview")
    : t("contentToWrite");
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
