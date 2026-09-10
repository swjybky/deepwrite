import { materialCatalogEntries } from "./material-query-runtime";
import { buildMaterialCatalogPrompt } from "./material-catalog";
import {
  resolveScriptWorkspaceStageReadAccess,
  resolveShortWorkspaceStageReadAccess,
  type LongAgentProfile
} from "@deepwrite/contracts";
import {
  buildLongFixedContextLines,
  buildLongFollowUpContextLines
} from "./prompts-long";
import type { UserMessage } from "@earendil-works/pi-ai";
import { buildRawUserText, imageContentBlocks } from "./prompts-user-message";
import type { AgentRunInput } from "./runtime-types";
import { buildStyleComparisonUserPrompt } from "./style-comparison";

export {
  scriptRuntimeFormatRequirements,
  scriptRuntimeSystemRequirements,
  shortRuntimeSystemRequirements
} from "./prompts-writing";

export {
  buildDeepWriteSystemPrompt,
  buildEffectiveSystemPrompt
} from "./prompts-system";

/** @internal Exported for prompt-boundary regression tests. */
export function buildRuntimeUserPrompt(input: AgentRunInput): string {
  if (input.workspaceContext?.styleComparison) {
    return buildStyleComparisonUserPrompt(
      input.workspaceContext.styleComparison
    );
  }
  const active = input.workspaceContext?.activeResource;
  const libraryContext = input.workspaceContext?.libraryWorkspace;
  const shortWorkspace = input.workspaceContext?.shortWorkspace;
  const scriptWorkspace = input.workspaceContext?.scriptWorkspace;
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const writingWorkspace = scriptWorkspace ?? shortWorkspace;
  const writingProfile = input.scriptAgentProfile ?? input.agentProfile;
  const longProfile = input.longAgentProfile;
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
  const learningContext = input.workspaceContext?.learningImitation;
  const longBookAnalysisContext = input.workspaceContext?.longBookAnalysis;
  const writingStageReadAccess = scriptWorkspace
    ? resolveScriptWorkspaceStageReadAccess(scriptWorkspace.activeStageId)
    : shortWorkspace
      ? resolveShortWorkspaceStageReadAccess(shortWorkspace.activeStageId)
      : undefined;
  const readableSkills = writingProfile
    ? skills.filter(
        (item) =>
          item.kind !== undefined &&
          writingProfile.readAccess.skill.includes(item.kind) &&
          (!writingStageReadAccess ||
            writingStageReadAccess.skill.includes(item.kind))
      )
    : longProfile
      ? skills.filter(
          (item) =>
            item.kind !== undefined &&
            longProfile.readAccess.skillKinds.includes(item.kind)
        )
      : input.libraryAgentProfile
        ? skills
        : skills;
  const readableMaterials = writingProfile
    ? materials.filter(
        (item) =>
          item.kind !== undefined &&
          writingProfile.readAccess.material.includes(item.kind) &&
          (!writingStageReadAccess ||
            writingStageReadAccess.material.includes(item.kind))
      )
    : longProfile
      ? materials.filter(
          (item) =>
            item.kind !== undefined &&
            longProfile.readAccess.materialKinds.includes(item.kind)
        )
      : materials;
  const isLongAgentRun = isLongRun;
  const skillContext =
    isWritingAgentRun || isLibraryAgentRun || isLongAgentRun
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
    isWritingAgentRun || isLongAgentRun
      ? buildMaterialCatalogPrompt(readableMaterials)
      : materials.length
        ? `显式附加素材:\n${materials
            .map((item) => `- ${item.title}: ${item.content}`)
            .join("\n")}`
        : "显式附加素材: 无";
  const lines = [
    "【本次智能体会话固定上下文】",
    isLongRun ? "" : `sessionId: ${input.sessionId}`,
    isLongRun ? "" : `runId: ${input.runId}`,
    writingWorkspace
      ? `【${scriptWorkspace ? "剧本" : "短篇"}上下文（AGENTS.md）】\n${writingWorkspace.agentsMd ?? "未提供"}`
      : "",
    writingWorkspace
      ? `【当前${scriptWorkspace ? "剧本" : "短篇"}情况（发送时快照）】`
      : "",
    writingWorkspace
      ? `${scriptWorkspace ? "剧本" : "短篇"}作品: 《${writingWorkspace.title}》`
      : "",
    ...(isLongRun ? buildLongFixedContextLines(longWorkspace!) : []),
    writingWorkspace
      ? `作品分类: ${writingWorkspace.categories.join("、") || "未分类"}`
      : "",
    writingWorkspace ? `当前阶段: ${writingWorkspace.activeStageId}` : "",
    writingWorkspace
      ? `剧情结构顺序: ${writingWorkspace.plotStages
          .map((stage) => `${stage.title} (${stage.id})`)
          .join(" → ")}`
      : "",
    writingWorkspace?.activeSectionId
      ? `当前用户正在操作的${scriptWorkspace ? "剧集" : "小节"}: ${
          writingWorkspace.expertDraft.sections.find(
            (section) => section.id === writingWorkspace.activeSectionId
          )?.title ?? "未知标题"
        }（section_id=${writingWorkspace.activeSectionId}）`
      : "",
    writingWorkspace
      ? writingWorkspace.characterStructure?.format === "list"
        ? `人物结构: 条目样式；人物条目索引: ${
            writingWorkspace.characterStructure.items.length
              ? writingWorkspace.characterStructure.items
                  .map((item) => `${item.title} (${item.id})`)
                  .join("、")
              : "无"
          }`
        : "人物结构: 文本样式（所有人物写在同一份总稿，kind=character_overview、id=character_design）"
      : "",
    writingWorkspace?.expertDraft.sections.length
      ? `正文目录${scriptWorkspace ? "剧集" : "小节"}（由早到晚）: ${writingWorkspace.expertDraft.sections
          .map((section) => `${section.title} (${section.id})`)
          .join("、")}`
      : "",
    writingProfile
      ? `当前智能体: ${writingProfile.label} (${writingProfile.id})`
      : longProfile
        ? `当前智能体: ${longProfile.label}`
        : input.libraryAgentProfile
          ? `当前智能体: ${input.libraryAgentProfile.label} (${input.libraryAgentProfile.domain})`
          : input.learningImitationProfile
            ? `当前智能体: ${input.learningImitationProfile.label} (${input.learningImitationProfile.id})`
            : input.longBookAnalysisProfile
              ? `当前智能体: ${input.longBookAnalysisProfile.name} (${input.longBookAnalysisProfile.id})`
              : "",
    learningContext
      ? `学习阶段: ${learningContext.stageId}；样本文档: ${learningContext.documents.length} 篇`
      : "",
    longBookAnalysisContext
      ? `拆书阶段: ${longBookAnalysisContext.phase}；选择范围: 第 ${longBookAnalysisContext.selectionStart}-${longBookAnalysisContext.selectionEnd} 章`
      : "",
    libraryContext
      ? `当前资料库: 《${libraryContext.title}》 (${libraryContext.domain} / ${libraryContext.kind}；短篇、剧本、长篇共用)`
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
      : learningContext
        ? "当前资源: 学习仿写样本文档（正文请通过工具按需读取）"
        : longBookAnalysisContext
          ? "当前资源: 长篇拆书输入（章节正文或中间笔记请通过工具按需读取）"
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

function materialCatalogNotes(input: AgentRunInput): string[] {
  const catalog = input.workspaceContext?.materialCatalog;
  return catalog
    ? [
        `本轮可查询素材共 ${catalog.total} 条。`,
        ...(catalog.nextCursor !== undefined
          ? [
              `目录还有后续条目，调用 query_linked_material_entries（mode=list，cursor=${catalog.nextCursor}）继续。`
            ]
          : []),
        ...catalog.notices
      ]
    : input.workspaceContext?.materialReadNotice
      ? [input.workspaceContext.materialReadNotice]
      : [];
}

function buildLongFollowUpTurnUserPrompt(input: AgentRunInput): string {
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const agentId = input.longAgentProfile?.id;
  if (!longWorkspace || !longAgentRefreshesDesignContextOnLaterTurns(agentId)) {
    return buildRawUserText(input);
  }
  return [
    ...buildLongFollowUpContextLines(longWorkspace),
    buildMaterialCatalogPrompt(
      (input.workspaceContext?.materialCatalog
        ? materialCatalogEntries(input.workspaceContext.materialCatalog)
        : (input.workspaceContext?.attachedMaterials ?? [])
      ).filter(
        (item) =>
          item.kind !== undefined &&
          input.longAgentProfile!.readAccess.materialKinds.includes(item.kind)
      )
    ),
    ...materialCatalogNotes(input),
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

/** @internal Exported for prompt-content regression tests. */
export function buildRawUserMessage(
  input: AgentRunInput,
  timestamp = Date.now()
): UserMessage {
  const text = buildRawUserText(input);
  const images = imageContentBlocks(input);
  return {
    role: "user",
    content: images.length ? [{ type: "text", text }, ...images] : text,
    timestamp
  };
}
