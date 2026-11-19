import { materialCatalogEntries } from "./material-query-runtime";
import {
  buildWorkspaceMaterialContext,
  materialCatalogNotes
} from "./prompts-material";
import { type LongAgentProfile } from "@deepwrite/contracts";
import {
  buildLongFixedContextLines,
  buildLongFollowUpContextLines
} from "./prompts-long";
import {
  academicReadOnlyRuntimeSystemRequirements,
  academicRuntimeSystemRequirements,
  buildAcademicRuntimeUserPrompt
} from "./prompts-academic";
import {
  buildMysteryFixedContextLines,
  buildMysteryFollowUpContextLines
} from "./mystery";
import type { UserMessage } from "@earendil-works/pi-ai";
import {
  buildRawUserText,
  imageContentBlocks,
  rawUserMessageContent
} from "./prompts-user-message";
import type { AgentRunInput } from "./runtime-types";
import { renderProposalSettlements } from "./write-approval";

export {
  scriptRuntimeFormatRequirements,
  scriptRuntimeSystemRequirements,
  shortRuntimeSystemRequirements
} from "./prompts-writing";
export {
  scriptReadOnlyRuntimeSystemRequirements,
  shortReadOnlyRuntimeSystemRequirements
} from "./prompts-writing-readonly";
export {
  academicReadOnlyRuntimeSystemRequirements,
  academicRuntimeSystemRequirements
};

export {
  buildDeepWriteSystemPrompt,
  buildEffectiveSystemPrompt
} from "./prompts-system";

/** @internal Exported for prompt-boundary regression tests. */
export function buildRuntimeUserPrompt(input: AgentRunInput): string {
  const active = input.workspaceContext?.activeResource;
  const libraryContext = input.workspaceContext?.libraryWorkspace;
  const shortWorkspace = input.workspaceContext?.shortWorkspace;
  const scriptWorkspace = input.workspaceContext?.scriptWorkspace;
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const writingWorkspace = scriptWorkspace ?? shortWorkspace;
  const writingProfile = input.scriptAgentProfile ?? input.agentProfile;
  const longProfile = input.longAgentProfile;
  const mysteryWorkspace = input.workspaceContext?.mysteryWorkspace;
  const mysteryProfile = input.mysteryAgentProfile;
  const skills = input.workspaceContext?.attachedSkills ?? [];
  const materials = input.workspaceContext?.materialCatalog
    ? materialCatalogEntries(input.workspaceContext.materialCatalog)
    : (input.workspaceContext?.attachedMaterials ?? []);
  const isWritingAgentRun = Boolean(writingWorkspace && writingProfile);
  const isLibraryAgentRun = Boolean(
    libraryContext && input.libraryAgentProfile
  );
  // The unified long agent owns every stage, so all fixed context is injected
  // and no implementation-level ids are exposed.
  const isLongRun = Boolean(longWorkspace && longProfile);
  const isMysteryRun = Boolean(mysteryWorkspace && mysteryProfile);
  const readableSkills = skills;
  const isLongAgentRun = isLongRun;
  const skillContext =
    isWritingAgentRun || isLibraryAgentRun || isLongAgentRun || isMysteryRun
      ? readableSkills.length
        ? isLibraryAgentRun
          ? `可按需加载的技能：\n${input
              .libraryAgentProfile!.readAccess.skills.map(
                (skill) => `- ${skill.name}：${skill.description || "无描述"}`
              )
              .join(
                "\n"
              )}\n需要正文时调用 load_skill；name 可用完整名称或唯一短名。`
          : `可按需加载的技能：\n${readableSkills
              .map((item) => `- ${item.title} [${item.kind}]（id=${item.id}）`)
              .join(
                "\n"
              )}\n需要正文时调用 load_skill；name 优先完整标题，也可用条目标题短名或库名（唯一命中即可）。`
        : "可按需加载的技能: 无"
      : skills.length
        ? `显式附加技能:\n${skills.map((item) => `- ${item.title}: ${item.content}`).join("\n")}`
        : "显式附加技能: 无";
  const materialContext =
    isWritingAgentRun || isLongAgentRun || isMysteryRun
      ? buildWorkspaceMaterialContext(input)
      : materials.length
        ? `显式附加素材:\n${materials
            .map((item) => `- ${item.title}: ${item.content}`)
            .join("\n")}`
        : "显式附加素材: 无";
  if (input.workspaceContext?.academicWorkspace && input.academicAgentProfile) {
    return buildAcademicRuntimeUserPrompt(input);
  }
  if (writingWorkspace && writingProfile) {
    const english = input.promptLocale === "en-US";
    return [
      `${english ? "Work" : scriptWorkspace ? "剧本作品" : "短篇作品"}: 《${writingWorkspace.title}》`,
      writingWorkspace.categories.length
        ? `${english ? "Categories" : "作品分类"}: ${writingWorkspace.categories.join(english ? ", " : "、")}`
        : "",
      active
        ? `${english ? "Current resource" : "当前资源"}: ${active.title} (${active.domain})`
        : "",
      english
        ? `Available skills: ${readableSkills.map((item) => `${item.title} (${item.id})`).join(", ") || "none"}. Use load_skill for the full text.`
        : skillContext,
      materialContext,
      ...materialCatalogNotes(input),
      renderProposalSettlements(input.proposalSettlements, input.promptLocale),
      english ? "[User message and attachments]" : "【用户消息与上传附件】",
      buildRawUserText(input)
    ]
      .filter(Boolean)
      .join("\n");
  }
  const lines = [
    "【本次智能体会话固定上下文】",
    isLongRun || isMysteryRun || writingWorkspace
      ? ""
      : `sessionId: ${input.sessionId}`,
    isLongRun || isMysteryRun || writingWorkspace
      ? ""
      : `runId: ${input.runId}`,
    ...(isLongRun ? buildLongFixedContextLines(longWorkspace!) : []),
    ...(isMysteryRun ? buildMysteryFixedContextLines(mysteryWorkspace!) : []),
    writingProfile
      ? `当前智能体: ${writingProfile.label} (${writingProfile.id})`
      : longProfile
        ? `当前智能体: ${longProfile.label}`
        : mysteryProfile
          ? `当前智能体: ${mysteryProfile.label}`
          : input.libraryAgentProfile
            ? `当前智能体: ${input.libraryAgentProfile.label} (${input.libraryAgentProfile.domain})`
            : "",
    libraryContext
      ? `当前资料库: 《${libraryContext.title}》 (${libraryContext.domain} / ${libraryContext.customTag ?? libraryContext.kind}；短篇、剧本、长篇共用)`
      : "",
    libraryContext
      ? `资料库状态: ${libraryContext.readOnly ? "只读" : "可写"}${libraryContext.projectRevision === undefined ? "" : `；项目版本 ${libraryContext.projectRevision}`}`
      : "",
    libraryContext?.activeEntryId
      ? `当前条目: ${libraryContext.activeEntryId}`
      : "",
    libraryContext
      ? `库介绍${libraryContext.overviewTruncated ? "（已截断）" : ""}:\n${libraryContext.overview || "未填写"}`
      : "",
    libraryContext
      ? `条目索引（正文请通过工具读取）:\n${
          libraryContext.entries.length
            ? libraryContext.entries
                .map(
                  (entry) =>
                    `- ${entry.title} (${entry.id}) [${entry.stageId}]${entry.readOnly ? " [只读]" : ""}${entry.truncated ? " [正文快照已截断]" : ""}`
                )
                .join("\n")
            : "- 无条目"
        }${libraryContext.omittedEntryCount ? `\n- 另有 ${libraryContext.omittedEntryCount} 个条目未进入本轮快照` : ""}`
      : "",
    active
      ? `当前资源: ${active.title} (${active.domain}${active.format ? ` / ${active.format}` : ""})`
      : "当前资源: 未提供",
    active && !isLongRun ? `资源路径: ${active.path.join(" / ")}` : "",
    active &&
    !writingWorkspace &&
    !longWorkspace &&
    !input.workspaceContext?.libraryWorkspace
      ? `实时内容:\n${active.content}`
      : "",
    skillContext,
    materialContext,
    ...materialCatalogNotes(input),
    "",
    renderProposalSettlements(input.proposalSettlements),
    "",
    "【用户消息与上传附件】",
    buildRawUserText(input)
  ];
  return lines.filter((line) => line !== "").join("\n");
}

export function longAgentRefreshesDesignContextOnLaterTurns(
  agentId: LongAgentProfile["id"] | undefined
): boolean {
  return agentId !== undefined;
}

function buildLongFollowUpTurnUserPrompt(input: AgentRunInput): string {
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const agentId = input.longAgentProfile?.id;
  if (!longWorkspace || !longAgentRefreshesDesignContextOnLaterTurns(agentId)) {
    return buildRawUserText(input);
  }
  return [
    ...buildLongFollowUpContextLines(longWorkspace),
    buildWorkspaceMaterialContext(input),
    ...materialCatalogNotes(input),
    "",
    renderProposalSettlements(input.proposalSettlements),
    "",
    "【用户消息与上传附件】",
    buildRawUserText(input)
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function buildRuntimeUserMessageContent(
  input: AgentRunInput
): UserMessage["content"] {
  const images = imageContentBlocks(input);
  return images.length
    ? [{ type: "text", text: buildRuntimeUserPrompt(input) }, ...images]
    : buildRuntimeUserPrompt(input);
}

export function buildLongFollowUpTurnUserMessageContent(
  input: AgentRunInput
): UserMessage["content"] {
  const text = buildLongFollowUpTurnUserPrompt(input);
  const images = imageContentBlocks(input);
  return images.length ? [{ type: "text", text }, ...images] : text;
}

export function buildMysteryFollowUpTurnUserMessageContent(
  input: AgentRunInput
): UserMessage["content"] {
  const mysteryWorkspace = input.workspaceContext?.mysteryWorkspace;
  if (!mysteryWorkspace || !input.mysteryAgentProfile) {
    return buildFollowUpRawUserMessageContent(input);
  }
  const text = [
    ...buildMysteryFollowUpContextLines(mysteryWorkspace),
    buildWorkspaceMaterialContext(input),
    ...materialCatalogNotes(input),
    "",
    renderProposalSettlements(input.proposalSettlements),
    "",
    "【用户消息与上传附件】",
    buildRawUserText(input)
  ]
    .filter((line) => line !== "")
    .join("\n");
  const images = imageContentBlocks(input);
  return images.length ? [{ type: "text", text }, ...images] : text;
}

/**
 * A later turn without a refreshed snapshot. Proposal outcomes still precede
 * the raw message so the agent learns what its earlier writes became.
 */
export function buildFollowUpRawUserMessageContent(
  input: AgentRunInput
): UserMessage["content"] {
  const settlements = renderProposalSettlements(input.proposalSettlements);
  if (!settlements) return rawUserMessageContent(input);
  const text = [
    settlements,
    "",
    "【用户消息与上传附件】",
    buildRawUserText(input)
  ].join("\n");
  const images = imageContentBlocks(input);
  return images.length ? [{ type: "text", text }, ...images] : text;
}

/** @internal Exported for prompt-content regression tests. */
export function buildRawUserMessage(
  input: AgentRunInput,
  timestamp = Date.now()
): UserMessage {
  return { role: "user", content: rawUserMessageContent(input), timestamp };
}
