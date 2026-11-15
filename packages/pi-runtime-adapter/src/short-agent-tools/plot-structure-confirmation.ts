import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentUserInputQuestion } from "@deepwrite/contracts";
import { askOutsideSubagentWriteLock } from "../subagent-write-lock";
import {
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolDetails,
  type ShortWorkspaceToolSharedState
} from "./shared";

const QUESTION_ID = "plot_structure_change";
const ALLOW_ONCE_OPTION_ID = "allow_once";

/**
 * The plot structure is one definition shared by every short and script work.
 * User-review mode stops at the approval card. Auto-save has no card to stop
 * at, so the user confirms here first. Call it after validation and before
 * the run overlay changes: under the subagent write lock the tool runs again
 * once the question is answered.
 */
export async function confirmPlotStructureChange(
  input: BuildWritingWorkspaceToolsInput,
  _state: ShortWorkspaceToolSharedState,
  request: { toolCallId: string; change: string; signal?: AbortSignal }
): Promise<boolean> {
  if (input.writeApprovalMode !== "auto-approve") return true;
  if (!input.requestUserInput) {
    throw new Error(
      input.promptLocale === "en-US"
        ? "This run cannot request confirmation for plot structure changes."
        : "当前运行无法向用户请求剧情结构修改确认。"
    );
  }

  const questions: AgentUserInputQuestion[] = [
    {
      id: QUESTION_ID,
      header:
        input.promptLocale === "en-US"
          ? "Change plot structure"
          : "修改剧情结构",
      question:
        input.promptLocale === "en-US"
          ? `The agent wants to ${request.change}. Plot structure is shared by all short-fiction and screenplay works. This change affects all of them. Allow it?`
          : `智能体要${request.change}。剧情结构由所有短篇和剧本作品共用，这次修改会同时出现在其他作品里。是否允许？`,
      options: [
        {
          id: ALLOW_ONCE_OPTION_ID,
          label:
            input.promptLocale === "en-US"
              ? "Allow this change"
              : "允许本次修改",
          description:
            input.promptLocale === "en-US"
              ? "Approve only this change; later structure changes require confirmation again."
              : "只允许这一笔，之后再改剧情结构仍会询问。"
        },
        {
          id: "cancel",
          label: input.promptLocale === "en-US" ? "Do not allow" : "不允许",
          description:
            input.promptLocale === "en-US"
              ? "Keep the plot structure and continue the remaining work."
              : "不修改剧情结构，智能体会继续其余任务。"
        }
      ]
    }
  ];
  const requestUserInput = input.requestUserInput;
  const response = await askOutsideSubagentWriteLock(
    JSON.stringify(questions),
    () =>
      requestUserInput(
        {
          toolCallId: request.toolCallId,
          source: "plot_structure_change",
          questions
        },
        request.signal
      )
  );
  const selected = response.answers[0]?.selectedOptionIds ?? [];
  return selected.includes(ALLOW_ONCE_OPTION_ID);
}

export function plotStructureChangeDeclined(
  input: BuildWritingWorkspaceToolsInput
): AgentToolResult<ShortWorkspaceToolDetails> {
  return textResult(
    input.promptLocale === "en-US"
      ? "Not changed: the user did not approve this shared plot structure change. Do not retry or use another route; explain and continue other work."
      : "未修改：用户没有允许修改短篇与剧本共用的剧情结构。不要重试，也不要改用其他方式修改结构；向用户说明后继续其余任务。"
  );
}
