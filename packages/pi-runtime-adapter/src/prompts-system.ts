import { mainAgentHasWebSearch } from "./web-search/mount";
import { webSearchPromptForProvider } from "./web-search/prompt";
import { buildDeepWriteSystemPrompt } from "./prompts-base";
import {
  buildLibraryRuntimeRequirements,
  libraryAgentHeader
} from "./prompts-library";
import { buildLongWorkspaceRules } from "./prompts-long-rules";
import { buildWritingSystemPrompt } from "./prompts-writing";
import { promptLocaleOf } from "./prompt-locale";
import type { AgentRunInput } from "./runtime-types";
import { renderSubagentAuthoringSystemPrompt } from "./subagent-authoring-tools";
import { writeApprovalBoundary } from "./write-approval";

export { buildDeepWriteSystemPrompt } from "./prompts-base";

function appendWorkspaceWebSearchPrompt(
  prompt: string,
  input: AgentRunInput
): string {
  if (!input.webSearch || !mainAgentHasWebSearch(input)) return prompt;
  return [
    prompt,
    "",
    webSearchPromptForProvider(
      input.webSearch.providerId,
      promptLocaleOf(input)
    )
  ].join("\n");
}

function buildSubagentAuthoringPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  const english = promptLocaleOf(input) === "en-US";
  return [
    basePrompt,
    "",
    english
      ? "[Current task: turn a skill into a team member]"
      : "【当前任务：技能转子智能体】",
    renderSubagentAuthoringSystemPrompt(
      input.workspaceContext!.subagentAuthoring!
    ).trim(),
    "",
    english
      ? "[DeepWrite tool boundary for turning a skill into a team member]"
      : "【DeepWrite 技能转子智能体工具边界】",
    english
      ? "Use only the tools listed for this turn (reading skills, writing the draft and so on). write_subagent_draft only updates the preview; it never writes to an agent team. Adding the member requires the user's confirmation in the interface."
      : "只能使用本轮列出的工具（技能读取、草稿写入等）。write_subagent_draft 只更新预览区，不会写入智能体团队；正式加入必须等待用户在界面中确认。"
  ].join("\n");
}

function buildWorkspaceAgentSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  if (input.workspaceContext?.subagentAuthoring) {
    return buildSubagentAuthoringPrompt(basePrompt, input);
  }
  const locale = promptLocaleOf(input);
  const libraryProfile = input.libraryAgentProfile;
  const libraryWorkspace = input.workspaceContext?.libraryWorkspace;
  if (libraryProfile && libraryWorkspace) {
    return [
      basePrompt,
      "",
      libraryAgentHeader(libraryProfile, locale),
      libraryProfile.systemPrompt.trim(),
      "",
      buildLibraryRuntimeRequirements(libraryWorkspace, input, locale)
    ].join("\n");
  }
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const longProfile = input.longAgentProfile;
  if (longProfile && longWorkspace) {
    return [
      basePrompt,
      "",
      locale === "en-US"
        ? `[Current long-form agent: ${longProfile.label}]`
        : `【当前长篇智能体：${longProfile.label}】`,
      longProfile.systemPrompt.trim(),
      "",
      buildLongWorkspaceRules(locale),
      "",
      writeApprovalBoundary(input.writeApprovalMode, locale)
    ].join("\n");
  }
  return buildWritingSystemPrompt(basePrompt, input);
}

/**
 * Layers: ground rules → editable role prompt → non-editable workspace rules
 * and write approval → optional web search. `basePrompt` overrides the ground
 * rules (tests and embedders); otherwise they follow the run's language.
 *
 * @internal Exported for workspace-type prompt regression tests.
 */
export function buildEffectiveSystemPrompt(
  basePrompt: string | undefined,
  input: AgentRunInput
): string {
  return appendWorkspaceWebSearchPrompt(
    buildWorkspaceAgentSystemPrompt(
      basePrompt ?? buildDeepWriteSystemPrompt(promptLocaleOf(input)),
      input
    ),
    input
  );
}
