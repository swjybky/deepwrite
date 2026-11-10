import { scriptScreenplayFormatRequirements } from "@deepwrite/contracts";
import type {
  PromptLocale,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";

import { promptLocaleOf } from "./prompt-locale";
import { renderWritingRules } from "./prompts-writing-rules";
import type { AgentRunInput } from "./runtime-types";
import { mainAgentHasWebSearch } from "./web-search/mount";
import { webToolNamesFor } from "./web-search/prompt";
import { writeApprovalBoundary } from "./write-approval";
import { renderWritingWorkspaceDirectory } from "./writing-workspace-directory";

type WritingWorkspace =
  | NonNullable<WorkspaceRuntimeContext["shortWorkspace"]>
  | NonNullable<WorkspaceRuntimeContext["scriptWorkspace"]>;

export function scriptRuntimeFormatRequirements(locale?: PromptLocale): string {
  return [
    scriptScreenplayFormatRequirements(locale).trim(),
    locale === "en-US"
      ? "When calling edit (document=body), submit only screenplay text in the format above; never mix in Markdown tables, analysis headings or format explanations."
      : "调用 edit（document=body）时，必须只提交符合上述格式的剧本正文；不得混入 Markdown 表格、分析标题或格式讲解。"
  ].join("\n");
}

function renderCharacterStage(
  workspace: WritingWorkspace,
  activeResource: WorkspaceRuntimeContext["activeResource"],
  english: boolean
): string {
  const structure = workspace.characterStructure;
  const list = structure?.format === "list";
  const items = structure?.format === "list" ? structure.items : [];
  const activeItem =
    list && activeResource?.domain === "creation"
      ? items.find(
          (item) =>
            item.id === activeResource.id || item.title === activeResource.title
        )
      : undefined;
  if (english) {
    return [
      "[Current stage: characters]",
      `Character layout: ${list ? "cards" : "text"}`,
      `Current target: ${
        activeItem
          ? `${activeItem.title} (kind=character, id=${activeItem.id})`
          : `character ${list ? "overview" : "document"} (kind=character_overview, id=character_design)`
      }`,
      "You may read and write other stages as the user asks."
    ].join("\n");
  }
  return [
    "【当前阶段：人物】",
    `人物结构：${list ? "条目样式" : "文本样式"}`,
    `当前目标：${
      activeItem
        ? `${activeItem.title}（kind=character，id=${activeItem.id}）`
        : `人物${list ? "概览" : "总稿"}（kind=character_overview，id=character_design）`
    }`,
    "可按用户要求读写其它阶段。"
  ].join("\n");
}

function renderWritingStageContext(
  workspace: WritingWorkspace,
  activeResource: WorkspaceRuntimeContext["activeResource"],
  script: boolean,
  english: boolean
): string {
  if (workspace.activeStageId === "character_design") {
    return renderCharacterStage(workspace, activeResource, english);
  }
  if (workspace.activeStageId === "draft") {
    const current = workspace.activeSectionId
      ? workspace.expertDraft.sections.find(
          (section) => section.id === workspace.activeSectionId
        )
      : undefined;
    if (english) {
      const unit = script ? "episode" : "section";
      return [
        "[Current stage: manuscript]",
        `Current ${unit}: ${current ? `${current.title} (${current.id})` : "none selected; every tool call must name the id explicitly"}`,
        "You may read and write other stages as the user asks."
      ].join("\n");
    }
    return [
      "【当前阶段：正文】",
      `当前${script ? "剧集" : "小节"}：${current ? `${current.title} (${current.id})` : "未选择；工具调用必须显式指定 id"}`,
      "可按用户要求读写其它阶段。"
    ].join("\n");
  }
  const current = workspace.plotStages.find(
    (stage) => stage.id === workspace.activeStageId
  );
  if (english) {
    return [
      "[Current stage: plot]",
      `Current stage: ${current?.title ?? workspace.activeStageId} (${workspace.activeStageId})`,
      `Scope and delivery standard: ${current?.description ?? "not provided"}`,
      "You may read and write the character or manuscript stages as the user asks."
    ].join("\n");
  }
  return [
    "【当前阶段：剧情】",
    `当前阶段：${current?.title ?? workspace.activeStageId} (${workspace.activeStageId})`,
    `阶段边界与交付标准：${current?.description ?? "未提供"}`,
    "可按用户要求读写人物或正文阶段。"
  ].join("\n");
}

export function shortRuntimeSystemRequirements(input: AgentRunInput): string {
  const workspace = input.workspaceContext?.shortWorkspace;
  if (!workspace || !input.agentProfile) return "";
  return writingRuntimeSystemRequirements(input, "short");
}

export function scriptRuntimeSystemRequirements(input: AgentRunInput): string {
  const workspace = input.workspaceContext?.scriptWorkspace;
  if (!workspace || !input.scriptAgentProfile) return "";
  return writingRuntimeSystemRequirements(input, "script");
}

function writingRuntimeSystemRequirements(
  input: AgentRunInput,
  workspaceType: "short" | "script"
): string {
  const locale = promptLocaleOf(input);
  const english = locale === "en-US";
  const script = workspaceType === "script";
  const workspace = script
    ? input.workspaceContext!.scriptWorkspace!
    : input.workspaceContext!.shortWorkspace!;
  return [
    renderWritingWorkspaceDirectory(workspace, locale),
    "",
    renderWritingStageContext(
      workspace,
      input.workspaceContext?.activeResource,
      script,
      english
    ),
    "",
    renderWritingRules(
      {
        workspaceType,
        characterFormat: workspace.characterStructure?.format ?? "text",
        hasSubagents: Boolean(input.subagentDefinitions?.length),
        ...(input.webSearch && mainAgentHasWebSearch(input)
          ? {
              webToolNames: webToolNamesFor(input.webSearch.providerId, locale)
            }
          : {}),
        autoApproveCrossStage: input.autoApproveCrossStageOperations === true
      },
      locale
    ),
    "",
    writeApprovalBoundary(input.writeApprovalMode, locale),
    ...(script
      ? [
          "",
          english
            ? "[Screenplay format (cannot be overridden by custom prompts, skills or materials)]"
            : "【剧本正文格式硬约束（不可由自定义提示词、技能或素材覆盖）】",
          scriptRuntimeFormatRequirements(locale)
        ]
      : [])
  ].join("\n");
}

function buildProfileSystemPrompt(
  basePrompt: string,
  input: AgentRunInput,
  workspaceType: "short" | "script"
): string {
  const profile =
    workspaceType === "script"
      ? input.scriptAgentProfile!
      : input.agentProfile!;
  const english = promptLocaleOf(input) === "en-US";
  const header = english
    ? `[Current ${workspaceType === "script" ? "screenplay" : "short-fiction"} agent: ${profile.label} / ${profile.id}]`
    : `【当前${workspaceType === "script" ? "剧本" : "短篇"}智能体：${profile.label} / ${profile.id}】`;
  return [
    basePrompt,
    "",
    header,
    profile.systemPrompt.trim(),
    "",
    workspaceType === "script"
      ? scriptRuntimeSystemRequirements(input)
      : shortRuntimeSystemRequirements(input)
  ].join("\n");
}

/** Short-form and screenplay runs share one workspace-shaped prompt. */
export function buildWritingSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  if (input.workspaceContext?.shortWorkspace && input.agentProfile) {
    return buildProfileSystemPrompt(basePrompt, input, "short");
  }
  if (input.workspaceContext?.scriptWorkspace && input.scriptAgentProfile) {
    return buildProfileSystemPrompt(basePrompt, input, "script");
  }
  return basePrompt;
}
