import { scriptScreenplayFormatRequirements } from "@deepwrite/contracts";
import type { WorkspaceRuntimeContext } from "@deepwrite/contracts";

import { renderWritingWorkspaceDirectory } from "./writing-workspace-directory";
import { promptLocaleOf } from "./prompt-locale";
import type { AgentRunInput } from "./runtime-types";
import { webToolNamesFor } from "./web-search/prompt";

type WritingWorkspace =
  | NonNullable<WorkspaceRuntimeContext["shortWorkspace"]>
  | NonNullable<WorkspaceRuntimeContext["scriptWorkspace"]>;

/** Where the work stands, without any rule about changing it. */
function renderReadOnlyWorkspaceContext(
  workspace: WritingWorkspace,
  script: boolean,
  english: boolean
): string {
  const stage = workspace.plotStages.find(
    (item) => item.id === workspace.activeStageId
  );
  const section = workspace.activeSectionId
    ? workspace.expertDraft.sections.find(
        (item) => item.id === workspace.activeSectionId
      )
    : undefined;
  const stageText = `${stage?.title ?? workspace.activeStageId} (${workspace.activeStageId})`;
  if (english) {
    return [
      "[Where the work stands]",
      `Current stage: ${stageText}`,
      `Current ${script ? "episode" : "section"}: ${section ? `${section.title} (${section.id})` : "none selected"}`
    ].join("\n");
  }
  return [
    "【当前作品位置】",
    `当前阶段：${stageText}`,
    `当前${script ? "剧集" : "小节"}：${section ? `${section.title} (${section.id})` : "未选择"}`
  ].join("\n");
}

function readOnlyRuntimeSystemRequirements(
  input: AgentRunInput,
  workspaceType: "short" | "script"
): string {
  const locale = promptLocaleOf(input);
  const english = locale === "en-US";
  const script = workspaceType === "script";
  const workspace = script
    ? input.workspaceContext!.scriptWorkspace!
    : input.workspaceContext!.shortWorkspace!;
  const webTools = input.webSearch
    ? webToolNamesFor(input.webSearch.providerId, locale)
    : undefined;
  return [
    renderWritingWorkspaceDirectory(workspace, locale),
    "",
    renderReadOnlyWorkspaceContext(workspace, script, english),
    "",
    ...(english
      ? [
          "[DeepWrite tool boundary (read-only)]",
          `This task uses only read to read the ${script ? "screenplay" : "short-fiction"} work and query_linked_material_entries to read materials${
            webTools
              ? `; when web_search is in the tool list, you may also verify public facts with ${webTools}`
              : ""
          }. There is no create, edit or delete: you cannot change the work and must never claim to have changed it.`,
          "A single read returns the target in full; there is no paging. kind=draft_section always needs document=body or character_state. kind=draft, id=draft, include_all_sections=true reads the whole manuscript (document defaults to body); above fifty thousand characters in total, follow the tool's hint and read section by section."
        ]
      : [
          "【DeepWrite 当前工具边界（只读）】",
          `本任务只使用 read 读取${script ? "剧本" : "短篇"}作品、query_linked_material_entries 读取素材${
            webTools
              ? `；工具清单列有 web_search 时，也可用 ${webTools} 查证公开资料`
              : ""
          }；没有 create、edit、delete，不能修改作品，也不得声称已经修改。`,
          "read 一次读全目标，不分页。kind=draft_section 必须同时给出 document=body 或 character_state。kind=draft、id=draft、include_all_sections=true 可读取全部正文，不传 document 时默认 body；合计超过五万字时按工具提示优先分小节精读。"
        ]),
    ...(script
      ? [
          "",
          english
            ? "[Screenplay format (also applies to screenplay passages handed back to the main agent)]"
            : "【剧本正文格式硬约束（交付给主智能体的剧本正文片段同样适用）】",
          scriptScreenplayFormatRequirements(locale).trim()
        ]
      : [])
  ].join("\n");
}

/** Requirements for `pure-read` children: reading rules, no writing rules. */
export function shortReadOnlyRuntimeSystemRequirements(
  input: AgentRunInput
): string {
  if (!input.workspaceContext?.shortWorkspace || !input.agentProfile) return "";
  return readOnlyRuntimeSystemRequirements(input, "short");
}

export function scriptReadOnlyRuntimeSystemRequirements(
  input: AgentRunInput
): string {
  if (!input.workspaceContext?.scriptWorkspace || !input.scriptAgentProfile) {
    return "";
  }
  return readOnlyRuntimeSystemRequirements(input, "script");
}
