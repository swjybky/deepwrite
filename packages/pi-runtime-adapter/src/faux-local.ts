import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type { AgentRunInput } from "./runtime-types";

export const DEEPWRITE_FAUX_RUNTIME: AgentRuntimeRef = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux"
};

export function buildLocalThinking(input: AgentRunInput): string {
  const title = input.workspaceContext?.activeResource?.title ?? "未命名资源";
  if (
    (
      input.workspaceContext?.shortWorkspace ??
      input.workspaceContext?.scriptWorkspace ??
      input.workspaceContext?.academicWorkspace
    )?.readSource === "core"
  )
    return input.promptLocale === "en-US"
      ? `Checking the selected work and current target: ${title}.`
      : `正在核对作品目录与当前目标《${title}》。`;
  const selectedProfile =
    input.academicAgentProfile ??
    input.scriptAgentProfile ??
    input.agentProfile ??
    input.longAgentProfile ??
    input.mysteryAgentProfile ??
    input.libraryAgentProfile;
  const agent = selectedProfile ? `，由「${selectedProfile.label}」处理` : "";
  return `正在读取发送瞬间的创作上下文快照，确认当前工作对象为《${title}》${agent}，并区分用户要求、作品事实与参考信息。`;
}

export function buildLocalWritingResponse(input: AgentRunInput): string {
  const active = input.workspaceContext?.activeResource;
  const request = input.prompt.replace(/\s+/g, " ").slice(0, 220);
  if (
    (
      input.workspaceContext?.shortWorkspace ??
      input.workspaceContext?.scriptWorkspace ??
      input.workspaceContext?.academicWorkspace
    )?.readSource === "core"
  )
    return input.promptLocale === "en-US"
      ? `The local Faux runtime received the work directory and your request: ${request}. Saved text is available through the read tool.`
      : `本地 Faux 流式链路已就绪。已收到作品目录与请求：${request}。可通过 read 工具按需读取已保存的文稿。`;
  const activeLabel = active ? `《${active.title}》` : "当前创作资源";
  const contentLength = active?.content.replace(/\s/g, "").length ?? 0;
  const snapshotLabel = active?.truncated
    ? `${activeLabel} 前 ${active.content.length.toLocaleString("zh-CN")} 个字符的上下文快照（原文 ${active.originalLength?.toLocaleString("zh-CN") ?? "超过限制"} 个字符）`
    : `${activeLabel} 上下文快照（约 ${contentLength} 字）`;

  return [
    "本地 Faux 流式链路已就绪。",
    "",
    `我已读取本轮发送时的 ${snapshotLabel}，并收到请求：${request}`,
    "",
    "本轮可验证结果",
    "",
    "- 回复由 pi-agent-core 驱动，并通过 Agent Utility 流式返回。",
    "- Thinking 与回复内容使用独立事件，Renderer 会绑定到同一条助手消息。",
    "- 当前是无需 API Key 的本地 Faux 模型，用于验证客户端链路和上下文边界。",
    "- 本轮没有调用写入工具，也没有修改或保存右侧文稿。",
    (input.scriptAgentProfile ?? input.agentProfile)
      ? `- 当前已按${input.scriptAgentProfile ? "剧本" : "短篇"}阶段选择「${(input.scriptAgentProfile ?? input.agentProfile)!.label}」智能体，并装配 ${
          input.workspaceContext?.scriptWorkspace ||
          input.workspaceContext?.shortWorkspace
            ? "阶段专属工具"
            : "通用上下文"
        }。`
      : input.libraryAgentProfile
        ? `- 当前已选择「${input.libraryAgentProfile.label}」，并且装配当前资料库读写工具与按需 load_skill。`
        : input.longAgentProfile
          ? `- 当前已按长篇根节点选择「${input.longAgentProfile.label}」智能体；结构与正文只会通过长篇专用工具按需读取。`
          : input.academicAgentProfile
            ? `- 当前已选择「${input.academicAgentProfile.label}」智能体；学术目录、文献卡与正文将通过学术工作台工具按需读取。`
            : input.mysteryAgentProfile &&
                input.workspaceContext?.mysteryWorkspace
              ? `- 当前已选择剧本杀「${input.mysteryAgentProfile.label}」智能体，正在创作《${input.workspaceContext.mysteryWorkspace.title}》，多视角正文与上帝真相将通过剧本杀工具按需读取与提案审阅。`
              : "",
    "",
    "下一切片接入真实模型配置后，可以在保持同一协议的前提下生成正式续写、润色和一致性检查结果。"
  ]
    .filter(Boolean)
    .join("\n");
}
