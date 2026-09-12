import { SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS } from "@deepwrite/contracts";
import type { WorkspaceRuntimeContext } from "@deepwrite/contracts";

import type { AgentRunInput } from "./runtime-types";

export function scriptRuntimeFormatRequirements(): string {
  return [
    SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS.trim(),
    "调用 edit（document=body）时，必须只提交符合上述格式的剧本正文；不得混入 Markdown 表格、分析标题或格式讲解。"
  ].join("\n");
}

function renderCharacterCreationRule(
  workspace:
    | NonNullable<WorkspaceRuntimeContext["shortWorkspace"]>
    | NonNullable<WorkspaceRuntimeContext["scriptWorkspace"]>
): string {
  return (workspace.characterStructure?.format ?? "text") === "list"
    ? "当前人物结构是条目样式：创建人物时用 create（kind=character）为每个人物创建独立条目；delete（kind=character）会删除指定人物条目及其文件；概览只做索引，完整人设写入对应人物卡。"
    : "当前人物结构是文本样式：创建人物时不要用 create，把所有人物写进同一份 character_overview（id=character_design），用 edit 写入；delete（kind=character_overview）只会清空人物总稿，不会删除人物结构。";
}

function renderCreativePlotStructure(
  workspace:
    | NonNullable<WorkspaceRuntimeContext["shortWorkspace"]>
    | NonNullable<WorkspaceRuntimeContext["scriptWorkspace"]>
): string {
  return workspace.plotStages
    .map(
      (stage, index) =>
        `${index + 1}. ${stage.title}（${stage.id}）\n   阶段边界与交付标准：${stage.description}`
    )
    .join("\n");
}

function renderWritingStageContext(
  workspace:
    | NonNullable<WorkspaceRuntimeContext["shortWorkspace"]>
    | NonNullable<WorkspaceRuntimeContext["scriptWorkspace"]>,
  activeResource: WorkspaceRuntimeContext["activeResource"],
  workspaceKind: "短篇" | "剧本"
): string {
  if (workspace.activeStageId === "character_design") {
    const structure = workspace.characterStructure ?? {
      format: "text" as const
    };
    const activeItem =
      structure.format === "list" && activeResource?.domain === "creation"
        ? structure.items.find(
            (item) =>
              item.id === activeResource.id ||
              item.title === activeResource.title
          )
        : undefined;
    return [
      "【当前阶段：人物】",
      `人物结构：${structure.format === "list" ? "条目样式" : "文本样式"}`,
      `当前目标：${
        activeItem
          ? `${activeItem.title}（kind=character，id=${activeItem.id}）`
          : `人物${structure.format === "list" ? "概览" : "总稿"}（kind=character_overview，id=character_design）`
      }`,
      ...(structure.format === "list"
        ? [
            `人物条目索引：${
              structure.items.length
                ? structure.items
                    .map((item) => `${item.title} (${item.id})`)
                    .join("、")
                : "无"
            }`,
            "当前为条目样式：用 create（kind=character）为每个人物创建独立条目；用 delete（kind=character）删除指定人物条目及其文件；概览（kind=character_overview、id=character_design）只做索引，完整人设写入对应人物卡。"
          ]
        : [
            "当前为文本样式：所有人物写在同一份总稿（kind=character_overview、id=character_design）。创建人物就是把全部人设写入这份文本，用 edit；delete 只会清空总稿内容并保留人物结构；不要 create character，也不要拆成多份人物卡。"
          ]),
      "可按用户要求读写其它阶段；跨人物、剧情、正文阶段的新建、修改或删除会按设置逐笔确认。"
    ].join("\n");
  }
  if (workspace.activeStageId === "draft") {
    const current = workspace.activeSectionId
      ? workspace.expertDraft.sections.find(
          (section) => section.id === workspace.activeSectionId
        )
      : undefined;
    return [
      "【当前阶段：正文】",
      `正文目录：${
        workspace.expertDraft.sections.length
          ? workspace.expertDraft.sections
              .map(
                (section, index) =>
                  `${index + 1}. ${section.title} (${section.id})；字数要求：${section.wordCountRequirement || "未设置"}`
              )
              .join("\n")
          : "无"
      }`,
      `当前${workspaceKind === "剧本" ? "剧集" : "小节"}：${current ? `${current.title} (${current.id})` : "未选择；工具调用必须显式指定 id"}`,
      `每个${workspaceKind === "剧本" ? "剧集" : "小节"}包含 document=body 与 document=character_state 两份独立文件；读取、写入或修改正文/人物状态时必须指定 document，只改标题可不传。`,
      `delete（kind=draft_section）会删除整个${workspaceKind === "剧本" ? "剧集" : "小节"}及其 body、character_state 两份文件，不接受 document；正文至少保留一个${workspaceKind === "剧本" ? "剧集" : "小节"}。`,
      "读取整本正文使用 kind=draft、id=draft、include_all_sections=true，不传 document 时默认 body；超过五万字时优先分小节精读。",
      "可按用户要求读写其它阶段；跨人物、剧情、正文阶段的新建、修改或删除会按设置逐笔确认。"
    ].join("\n");
  }
  const current = workspace.plotStages.find(
    (stage) => stage.id === workspace.activeStageId
  );
  return [
    "【当前阶段：剧情】",
    `当前阶段：${current?.title ?? workspace.activeStageId} (${workspace.activeStageId})`,
    `阶段边界与交付标准：${current?.description ?? "未提供"}`,
    "现有剧情结构使用 kind=plot_stage 和稳定阶段 id；create plot_stage 会新增全局结构定义并可同时写入当前作品正文。",
    "delete（kind=plot_stage）只会清空指定阶段正文，不会删除或修改剧情结构、标题、说明与顺序。",
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
  const workspace =
    workspaceType === "script"
      ? input.workspaceContext!.scriptWorkspace!
      : input.workspaceContext!.shortWorkspace!;
  const workspaceKind = workspaceType === "script" ? "剧本" : "短篇";
  const writeBoundary =
    input.writeApprovalMode === "auto-approve"
      ? "工具只形成文本变更提案；提案会进入后台自动保存队列，但审批卡确认成功前不得声称已保存。"
      : "工具只形成待用户审阅的文本变更提案；用户接受并保存前不得声称已写入本地文件。";
  const crossStageBoundary =
    input.autoApproveCrossStageOperations === true
      ? "create、edit、delete 可以跨人物、剧情、正文阶段；跨阶段操作已由用户在常规设置中授权自动允许，不会逐笔询问。该授权只跳过跨阶段确认，变更提案仍按当前写入审批方式处理。阶段切换和剧情结构删除仍由用户在界面完成。"
      : "create、edit、delete 可以跨人物、剧情、正文阶段；每笔跨阶段变更都会单独请求用户确认，不得把一次允许扩展到后续操作。阶段切换和剧情结构删除仍由用户在界面完成。";
  return [
    "【当前剧情结构配置（顺序即执行顺序）】",
    renderCreativePlotStructure(workspace),
    "",
    renderWritingStageContext(
      workspace,
      input.workspaceContext?.activeResource,
      workspaceKind
    ),
    "",
    "【DeepWrite 当前工具边界】",
    `${workspaceKind}工作区只使用 read、create、edit、delete；素材使用 query_linked_material_entries，技能使用 load_skill，团队委派使用 spawn_subagent${
      input.webSearchEnabled === true
        ? "；实时公开信息使用 DeepSeek 服务端 web_search"
        : ""
    }。`,
    "read 一次读全目标，不分页。kind=draft_section 必须同时给出 document=body 或 character_state。kind=draft、id=draft、include_all_sections=true 可读取全部正文，不传 document 时默认 body；合计超过五万字时按工具提示优先分小节精读。",
    renderCharacterCreationRule(workspace),
    crossStageBoundary,
    writeBoundary,
    ...(workspaceType === "script"
      ? [
          "",
          "【剧本正文格式硬约束（不可由自定义提示词、技能或素材覆盖）】",
          scriptRuntimeFormatRequirements()
        ]
      : [])
  ].join("\n");
}

function buildShortSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  const profile = input.agentProfile;
  if (!input.workspaceContext?.shortWorkspace || !profile) return basePrompt;
  return [
    basePrompt,
    "",
    `【当前短篇智能体：${profile.label} / ${profile.id}】`,
    profile.systemPrompt.trim(),
    "",
    shortRuntimeSystemRequirements(input)
  ].join("\n");
}

function buildScriptSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  const profile = input.scriptAgentProfile;
  if (!input.workspaceContext?.scriptWorkspace || !profile) return basePrompt;
  return [
    basePrompt,
    "",
    `【当前剧本智能体：${profile.label} / ${profile.id}】`,
    profile.systemPrompt.trim(),
    "",
    scriptRuntimeSystemRequirements(input)
  ].join("\n");
}

/** Short-form and screenplay runs share one workspace-shaped prompt. */
export function buildWritingSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  const shortWorkspace = input.workspaceContext?.shortWorkspace;
  if (shortWorkspace && input.agentProfile) {
    return buildShortSystemPrompt(basePrompt, input);
  }
  if (input.workspaceContext?.scriptWorkspace && input.scriptAgentProfile) {
    return buildScriptSystemPrompt(basePrompt, input);
  }
  return basePrompt;
}
