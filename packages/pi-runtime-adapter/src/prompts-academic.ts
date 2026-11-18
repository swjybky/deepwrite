import { academicCitationStyleRequirements } from "@deepwrite/contracts";
import {
  currentAcademicWorkspaceContext,
  type AcademicWorkspaceToolSharedState
} from "./academic-agent-tools/shared";
import { promptLocaleOf } from "./prompt-locale";
import {
  academicBookSubtypeLabel,
  buildAcademicReadOnlyWorkspaceRules,
  buildAcademicWorkspaceRules
} from "./prompts-academic-rules";
import {
  buildWorkspaceMaterialContext,
  materialCatalogNotes
} from "./prompts-material";
import { buildRawUserText } from "./prompts-user-message";
import type { AgentRunInput } from "./runtime-types";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import {
  renderProposalSettlements,
  writeApprovalBoundary
} from "./write-approval";

export function academicRuntimeSystemRequirements(
  input: AgentRunInput,
  toolNames?: readonly string[]
): string {
  const workspace = input.workspaceContext?.academicWorkspace;
  if (!workspace || !input.academicAgentProfile) return "";
  const locale = promptLocaleOf(input);
  const english = locale === "en-US";
  return [
    buildAcademicWorkspaceRules(workspace, locale, toolNames),
    "",
    english
      ? "[Citation style hard constraint (cannot be overridden by custom prompts, skills or materials)]"
      : "【引用体例硬约束（不可由自定义提示词、技能或素材覆盖）】",
    academicCitationStyleRequirements(workspace.citationStyle, locale),
    "",
    writeApprovalBoundary(input.writeApprovalMode, locale)
  ].join("\n");
}

export function academicReadOnlyRuntimeSystemRequirements(
  input: AgentRunInput,
  toolNames?: readonly string[]
): string {
  const workspace = input.workspaceContext?.academicWorkspace;
  if (!workspace) return "";
  return buildAcademicReadOnlyWorkspaceRules(
    workspace,
    promptLocaleOf(input),
    toolNames
  );
}

export function buildAcademicSystemPrompt(
  basePrompt: string,
  input: AgentRunInput,
  toolNames?: readonly string[]
): string {
  const workspace = input.workspaceContext?.academicWorkspace;
  const profile = input.academicAgentProfile;
  if (!workspace || !profile) return basePrompt;
  const locale = promptLocaleOf(input);
  const english = locale === "en-US";
  const header = english
    ? `[Current academic agent: ${profile.label} / ${profile.id}]`
    : `【当前学术智能体：${profile.label} / ${profile.id}】`;
  return [
    basePrompt,
    "",
    header,
    profile.systemPrompt.trim(),
    "",
    ...(workspace.agentsMd?.trim()
      ? [
          english
            ? "[Academic work context (AGENTS.md)]"
            : "【学术作品上下文（AGENTS.md）】",
          workspace.agentsMd.trim(),
          ""
        ]
      : []),
    academicRuntimeSystemRequirements(input, toolNames)
  ].join("\n");
}

export function buildAcademicRuntimeUserPrompt(input: AgentRunInput): string {
  const workspace = input.workspaceContext!.academicWorkspace!;
  const active = input.workspaceContext?.activeResource;
  const skills = input.workspaceContext?.attachedSkills ?? [];
  const english = input.promptLocale === "en-US";
  const subtype = academicBookSubtypeLabel(
    workspace.subtype,
    input.promptLocale
  );
  const skillContext = english
    ? `Available skills: ${skills.map((item) => `${item.title} (${item.id})`).join(", ") || "none"}. Use load_skill for the full text.`
    : skills.length
      ? `可按需加载的技能：\n${skills
          .map((item) => `- ${item.title} [${item.kind}]（id=${item.id}）`)
          .join(
            "\n"
          )}\n需要正文时调用 load_skill；name 优先完整标题，也可用条目标题短名或库名（唯一命中即可）。`
      : "可按需加载的技能: 无";

  return [
    `${english ? "Academic work" : "学术作品"}: 《${workspace.title}》 (${subtype} / citationStyle=${workspace.citationStyle})`,
    active
      ? `${english ? "Current resource" : "当前资源"}: ${active.title} (${active.domain})`
      : "",
    skillContext,
    buildWorkspaceMaterialContext(input),
    ...materialCatalogNotes(input),
    renderProposalSettlements(input.proposalSettlements, input.promptLocale),
    english ? "[User message and attachments]" : "【用户消息与上传附件】",
    buildRawUserText(input)
  ]
    .filter(Boolean)
    .join("\n");
}

export function academicSubagentContext(
  input: AgentRunInput,
  state: AcademicWorkspaceToolSharedState | undefined
): Pick<
  BuildSpawnSubagentToolInput,
  "systemPromptRequirements" | "pureReadSystemPromptRequirements"
> {
  const academicWorkspace = input.workspaceContext?.academicWorkspace;
  const currentInput = (): AgentRunInput => ({
    ...input,
    workspaceContext: {
      ...input.workspaceContext,
      ...(academicWorkspace && state
        ? {
            academicWorkspace: currentAcademicWorkspaceContext(
              academicWorkspace,
              state
            )
          }
        : {})
    }
  });
  return {
    systemPromptRequirements: (toolNames) =>
      academicRuntimeSystemRequirements(currentInput(), toolNames),
    pureReadSystemPromptRequirements: (toolNames) =>
      academicReadOnlyRuntimeSystemRequirements(currentInput(), toolNames)
  };
}
