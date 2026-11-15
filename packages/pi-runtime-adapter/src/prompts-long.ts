import type { LongWorkspaceRuntimeContext } from "@deepwrite/contracts";

import {
  renderLongCharacterDirectory,
  renderLongCharacterTypeDirectory,
  renderLongWorldbuildingDirectory,
  renderLongWorldbuildingScopeDirectory
} from "./prompts-long-directory";
import { renderLongPlotNavigation } from "./prompts-long-navigation";

import { renderLongCurrentPosition } from "./prompts-long-position";

export { buildLongRuntimeToolBoundary } from "./prompts-long-rules";

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
    renderLongCurrentPosition(longWorkspace)
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
    `【长篇结构导航（本轮发送时快照；条目正文与最新内容请通过工具读取）】\n${renderLongPlotNavigation(
      longWorkspace.navigation,
      longWorkspace.activeChapterCardId
    )}`,
    renderLongCurrentPosition(longWorkspace)
  ];
}
