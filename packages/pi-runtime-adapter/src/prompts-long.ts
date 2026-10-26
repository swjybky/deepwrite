import type { LongWorkspaceRuntimeContext } from "@deepwrite/contracts";

import {
  renderLongCharacterDirectory,
  renderLongCharacterTypeDirectory,
  renderLongCurrentStageSection,
  renderLongWorldbuildingDirectory,
  renderLongWorldbuildingScopeDirectory
} from "./prompts-long-directory";
import {
  renderLongPlotFocus,
  renderLongPlotNavigation
} from "./prompts-long-navigation";

/** Authoritative per-run capabilities, including for saved legacy role prompts. */
export function buildLongRuntimeToolBoundary(
  tools: readonly { name: string }[]
): string {
  const names = tools.map((tool) => tool.name);
  return [
    "【本轮长篇工具边界】",
    `本轮实际可用工具：${names.join("、")}。`,
    "工具权限以本轮实际清单为准，优先于角色提示词中的固定数量、旧清单与历史回复；未列出的工具不可调用。",
    names.includes("spawn_subagent")
      ? "spawn_subagent 已开放：可用成员、成员 id 与委派方式见工具说明，只能选择其中列出的成员。用户以 #成员名 点名的工作必须交给该成员；不要因旧提示词或历史回复未提及委派工具而声称不能调用。"
      : "本轮没有 spawn_subagent，不能调用子智能体，也不得声称已委派。"
  ].join("\n");
}

function renderLongListScopeGuide(): string {
  return [
    "【list 范围规则】",
    "list 必须同时提供 stage 与 scope_id，只返回该范围的二层目录，不能查询阶段最上层。",
    "合法容器：worldbuilding=分类 id；character=人物类型 id；plot=book_line / volume_ / arc_ / chapter_ / event_ / foreshadow_；draft=volume_ / arc_；continuity=volume_ / chapter_ / character_。",
    "叶子不要 list，直接 read：worlditem_、storyplot_、connection_、placement_、beat_、character_overview；人物卡与章卡正文也用 read。上一次 list 返回的 id 不都是合法 scope_id。",
    "连续性不要传 arc_ 或 book_line；查看某章连续性用 list(stage=continuity, scope_id=<chapter_id>)。",
    "切换章卡的主剧情点用 edit(id=<chapter_id>, meta={primary_arc_id:<同卷 arc_id>}, summary=<说明>)；解除关联传 primary_arc_id:null。仅修改章卡信息可省略 document，换绑保持章节顺序，形成带关联影响预览的提案。"
  ].join("\n");
}

/** Fixed-context block injected on the first turn of a long-form run. */
export function buildLongFixedContextLines(
  longWorkspace: LongWorkspaceRuntimeContext
): string[] {
  return [
    `长篇作品: 《${longWorkspace.title}》`,
    longWorkspace.agentsMd?.trim()
      ? `【长篇上下文（AGENTS.md）】\n${longWorkspace.agentsMd.trim()}`
      : "",
    `【世界观条目列表（发送时快照）】\n${renderLongWorldbuildingDirectory(
      longWorkspace.worldbuildingDirectory,
      longWorkspace.navigation
    )}`,
    `【人物设计列表（发送时快照）】\n${renderLongCharacterDirectory(
      longWorkspace.navigation
    )}\n新建人物或修改人物类型时只能使用目录中的 type_id；移动已有的人物用 edit(id=<人物 id>, meta={type_id:<目标类型 id>}, summary=<说明>)，仅修改人物信息时无需 document。人物类型目录的新增、改名和删除只能由用户在结构管理中维护。需要某类完整人物列表时调用 list（stage=character, scope_id=<type_id>）。`,
    `【长篇结构导航（发送时快照；条目正文与最新内容请通过工具读取）】\n${renderLongPlotNavigation(
      longWorkspace.navigation,
      longWorkspace.activeChapterCardId
    )}`,
    renderLongListScopeGuide(),
    longWorkspace.plotFocus
      ? `当前剧情工作区: ${renderLongPlotFocus(longWorkspace.plotFocus)}`
      : "",
    renderLongCurrentStageSection(
      longWorkspace.worldbuildingFocus,
      longWorkspace.characterFocus,
      longWorkspace
    ),
    longWorkspace.activeChapterCardId
      ? `当前章卡: ${longWorkspace.activeChapterCardId}`
      : ""
  ];
}

/**
 * Later turns re-send the lightweight top-level scope directories and plot
 * navigation because their ids may drift as proposals or UI changes land.
 */
export function buildLongFollowUpContextLines(
  longWorkspace: LongWorkspaceRuntimeContext
): string[] {
  return [
    "【本轮长篇工作区上下文】",
    `长篇作品: 《${longWorkspace.title}》`,
    longWorkspace.agentsMd?.trim()
      ? `【长篇上下文（AGENTS.md）】\n${longWorkspace.agentsMd.trim()}`
      : "",
    `【世界观分类入口（本轮发送时快照）】\n${renderLongWorldbuildingScopeDirectory(
      longWorkspace.navigation
    )}`,
    `【人物类型入口（本轮发送时快照）】\n${renderLongCharacterTypeDirectory(
      longWorkspace.navigation
    )}`,
    longWorkspace.activeChapterCardId
      ? `当前章卡: ${longWorkspace.activeChapterCardId}`
      : "",
    `【长篇结构导航（本轮发送时快照；条目正文与最新内容请通过工具读取）】\n${renderLongPlotNavigation(
      longWorkspace.navigation,
      longWorkspace.activeChapterCardId
    )}`,
    renderLongListScopeGuide(),
    longWorkspace.plotFocus
      ? `当前剧情工作区: ${renderLongPlotFocus(longWorkspace.plotFocus)}`
      : ""
  ];
}
