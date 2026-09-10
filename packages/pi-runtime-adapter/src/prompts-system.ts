import {
  renderLearningImitationSystemPrompt,
  MATERIAL_METADATA_AUTHORING_GUIDANCE
} from "@deepwrite/contracts";
import { buildChatAssistantSystemPrompt } from "./chat-assistant";
import { STYLE_COMPARISON_SYSTEM_PROMPT } from "./style-comparison";
import {
  renderDeepSeekWebSearchCapabilityPrompt,
  renderDeepSeekWebSearchNetworkBoundary
} from "./deepseek-web-search";
import { renderLongBookAnalysisSystemPrompt } from "./long-book-analysis/prompt";
import { buildWritingSystemPrompt } from "./prompts-writing";
import type { AgentRunInput } from "./runtime-types";
import { renderSubagentAuthoringSystemPrompt } from "./subagent-authoring-tools";

export function buildDeepWriteSystemPrompt(): string {
  return [
    "你是 DeepWrite 的本地创作协作智能体。",
    "用户当前明确提出的要求优先；当前实时文稿是本轮工作对象，不得凭空推翻已提供的作品事实。",
    "技能是写作方法，不是作品事实；素材是参考信息，不能自动升级为作品设定。",
    "只能声称使用了本轮上下文快照中实际提供或显式附加的内容。",
    "只能调用本轮实际列出的工具；没有列出的写回、保存、文件、Shell、HTTP 或浏览器能力不得声称已经执行。",
    "回复使用结构清晰的中文纯文本，并明确区分建议、示例和已确认事实。"
  ].join("\n");
}

function appendWorkspaceWebSearchPrompt(
  prompt: string,
  webSearchEnabled: boolean
): string {
  if (!webSearchEnabled) return prompt;
  return [
    prompt,
    "",
    renderDeepSeekWebSearchCapabilityPrompt(),
    renderDeepSeekWebSearchNetworkBoundary()
  ].join("\n");
}

function buildWorkspaceAgentSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  const subagentAuthoring = input.workspaceContext?.subagentAuthoring;
  if (subagentAuthoring) {
    return [
      basePrompt,
      "",
      "【当前任务：技能转子智能体】",
      renderSubagentAuthoringSystemPrompt(subagentAuthoring).trim(),
      "",
      "【DeepWrite 技能转子智能体工具边界】",
      "只能使用本轮列出的技能读取与草稿写入工具。write_subagent_draft 只更新预览区，不会写入智能体团队；正式加入必须等待用户在界面中确认。"
    ].join("\n");
  }
  const learningProfile = input.learningImitationProfile;
  const learningContext = input.workspaceContext?.learningImitation;
  if (learningProfile && learningContext) {
    const writeBoundary =
      input.writeApprovalMode === "auto-approve"
        ? "只能使用本轮列出的样本文档读取、搜索与预览写入工具。write_learning_result 更新预览区后，客户端会立即把结果加入后台串行落盘队列并写入预先选择的目标库；若目标库尚未选全则保留预览。界面确认成功前不得声称已正式落盘。"
        : "只能使用本轮列出的样本文档读取、搜索与预览写入工具。write_learning_result 只更新预览区，不会写入正式素材库或技能库。正式落盘必须等待用户在界面中确认。";
    return [
      basePrompt,
      "",
      `【当前学习仿写智能体：${learningProfile.label} / ${learningProfile.id}】`,
      renderLearningImitationSystemPrompt(
        learningProfile.systemPrompt,
        learningContext
      ).trim(),
      "",
      "【DeepWrite 学习仿写工具边界】",
      writeBoundary,
      ...(learningProfile.id === "material_split"
        ? [MATERIAL_METADATA_AUTHORING_GUIDANCE]
        : [])
    ].join("\n");
  }
  const longBookAnalysisProfile = input.longBookAnalysisProfile;
  const longBookAnalysisContext = input.workspaceContext?.longBookAnalysis;
  if (longBookAnalysisProfile && longBookAnalysisContext) {
    return [
      basePrompt,
      "",
      `【当前长篇拆书智能体：${longBookAnalysisProfile.name} / ${longBookAnalysisProfile.id}】`,
      renderLongBookAnalysisSystemPrompt(
        longBookAnalysisProfile,
        longBookAnalysisContext
      ).trim(),
      "",
      "【DeepWrite 长篇拆书工具边界】",
      "只能使用本轮列出的章节或中间笔记 list/read/search 工具，以及当前阶段唯一允许的 write_analysis_note 或 write_analysis_result。写入工具只更新本次任务的内存笔记或结果预览，不会修改源文件，也不会直接写入资料库。"
    ].join("\n");
  }
  const libraryProfile = input.libraryAgentProfile;
  const libraryWorkspace = input.workspaceContext?.libraryWorkspace;
  if (libraryProfile && libraryWorkspace) {
    const writeBoundary =
      input.writeApprovalMode === "auto-approve"
        ? "写入工具只提交资料库条目或库介绍变更；提案生成后客户端会立即加入后台串行队列、自动批准并尝试保存。智能体可以继续当前回复，但在审批卡确认成功前不得声称已经保存成功。"
        : "写入工具提交待用户审阅的资料库条目或库介绍变更；用户接受后客户端才会保存到本地文件，当前回复不得提前声称已经保存。";
    return [
      basePrompt,
      "",
      `【当前资料库智能体：${libraryProfile.label} / ${libraryProfile.domain}】`,
      libraryProfile.systemPrompt.trim(),
      ...(libraryWorkspace.domain === "material"
        ? [MATERIAL_METADATA_AUTHORING_GUIDANCE]
        : []),
      "",
      "【DeepWrite 当前资料库工具边界】",
      "写入只允许管理本轮指定的当前资料库；若该库属于分组，list/read/search 也可读取同分组其它成员库条目，但不得写入那些库。",
      "条目正文必须通过本轮实际列出的读取和搜索工具按需取得。",
      "需要整理、创建或初始化等方法时，调用 load_skill 按需加载本轮可用技能；技能是方法，不会自动成为资料库事实。",
      libraryWorkspace.readOnly
        ? "当前资料库只读，本轮不会装配任何创建或编辑工具。"
        : writeBoundary,
      "当前库介绍可通过本轮列出的介绍编辑工具修改；删除条目、修改分组、绑定书籍和写入其它资料库均未接通。"
    ].join("\n");
  }
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const longProfile = input.longAgentProfile;
  if (longProfile && longWorkspace) {
    return longProfile.systemPrompt.trim();
  }
  return buildWritingSystemPrompt(basePrompt, input);
}

/** @internal Exported for workspace-type prompt regression tests. */
export function buildEffectiveSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  if (input.workspaceContext?.styleComparison)
    return STYLE_COMPARISON_SYSTEM_PROMPT;
  if (input.mode === "chat-assistant") {
    if (!input.chatAssistantRuntimeContext) {
      throw new Error("Chat assistant runtime context is unavailable.");
    }
    return buildChatAssistantSystemPrompt(
      input.chatAssistantRuntimeContext,
      input.webSearchEnabled === true
    );
  }
  return appendWorkspaceWebSearchPrompt(
    buildWorkspaceAgentSystemPrompt(basePrompt, input),
    input.webSearchEnabled === true
  );
}
