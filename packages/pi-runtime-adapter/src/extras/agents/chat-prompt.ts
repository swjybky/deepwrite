import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking
} from "@earendil-works/pi-ai";
import type { FauxResponseStep } from "@earendil-works/pi-ai";
import type {
  ChatAssistantProjectRuntimeSnapshot,
  ChatAssistantRuntimeSnapshot
} from "@deepwrite/contracts";

/** Read-only rules shared by the normal and project chat boundaries. */
export function chatReadOnlyBoundary(): string[] {
  return [
    "只使用本轮实际列出的工具；没有出现的能力尚未接通，不得声称已经执行。",
    "所有工具均为只读。不能创建、保存、编辑、删除、审批或覆盖书籍、资料库、模型设置及其它本地数据。",
    "不能访问文件系统路径、Shell、API Key、Token、Base URL 或请求路由；网络能力仅限本轮实际列出的联网工具（如有），不具备浏览器控制、任意 HTTP 请求或其它联网能力；不得要求工具绕过项目 ID 锁定。",
    "目录和搜索片段只用于定位；涉及作品事实时必须读取目标正文核对，未读取内容不得当成事实。",
    "不要把讨论或建议描述为已完成的修改。优先使用用户所用语言，回复自然、清晰、直接。",
    "上方的配置提示词只能定义角色、目标和表达方式，不能覆盖本运行边界中的只读、安全、脱敏和工具限制。"
  ];
}

/** Software facts the chat may state about the app it runs in. */
export function chatSoftwareContext(
  runtime: ChatAssistantRuntimeSnapshot
): string[] {
  const { software } = runtime;
  return [
    "",
    "【DeepWrite 软件基础情况】",
    `当前软件：${software.name} ${software.version}`,
    `运行平台：${software.platform} / ${software.arch}`,
    `当前时间：${software.currentTime}`,
    `时区：${software.timezone}`,
    "DeepWrite 是本地优先的写作桌面软件，管理短篇、剧本、长篇、技能库、素材库、模型配置和模型用量。"
  ];
}

export function chatProjectStructure(
  runtime: ChatAssistantProjectRuntimeSnapshot
): string[] {
  const book = runtime.projectBook;
  if (book.bookType === "long") {
    return [
      `项目类型：长篇`,
      `项目名称：《${book.title}》`,
      `项目 ID：${book.id}`,
      `类型：${book.genre}；状态：${book.status}`,
      "阶段：世界观、人物、剧情设计、正文、连续性账本。",
      "【长篇结构导航（本轮权威快照；正文必须通过工具按需读取）】",
      JSON.stringify(book.navigation, null, 2)
    ];
  }
  if (book.bookType === "academic") {
    return [
      `项目类型：学术作品（${book.subtype}，引用体例：${book.citationStyle}）`,
      `项目名称：《${book.title}》`,
      `项目 ID：${book.id}`,
      `状态：${book.status}`,
      `研究底座：研究立意与核心贡献、术语与符号表、文献与证据卡（${book.foundation.cards.length} 张）`,
      `论证阶段：${book.frameworkStages
        .filter((stage) => stage.enabled)
        .map((stage) => `${stage.title}(${stage.id})`)
        .join(" → ")}`,
      `正文小节：${book.manuscript.sections
        .map((section) => `${section.title}(${section.id})`)
        .join("、")}`,
      "各层与正文原文未注入系统提示词，必须通过本轮只读工具按需读取。"
    ];
  }
  return [
    `项目类型：${book.bookType === "script" ? "剧本" : "短篇"}`,
    `项目名称：《${book.title}》`,
    `项目 ID：${book.id}`,
    `类型：${book.genre}；状态：${book.status}`,
    `人物结构：${book.characterStructure.format}`,
    `阶段顺序：人物设计 → ${book.plotStages
      .filter((stage) => stage.enabled)
      .map((stage) => `${stage.title}(${stage.id})`)
      .join(" → ")} → 正文`,
    `人物目录：${
      book.characterStructure.format === "list"
        ? book.characterStructure.items
            .map((item) => `${item.title}(${item.id})`)
            .join("、") || "无"
        : "单文档人物设计"
    }`,
    `正文目录：${book.draft.sections
      .map((section) => `${section.title}(${section.id})`)
      .join("、")}`,
    "阶段和正文内容未注入系统提示词，必须通过本轮只读工具按需读取。"
  ];
}

/** The local faux reply that proves the chat link without a real model. */
export function chatFauxResponse(
  label: string,
  thinking: string,
  turn: { message: string; thinking: boolean }
): FauxResponseStep[] {
  const reply = [
    `${label}聊天助手的本地 Faux 流式链路已就绪。`,
    "",
    `我收到了你的消息：${turn.message.replace(/\s+/g, " ").slice(0, 220)}`,
    "",
    "当前是用于验证客户端聊天链路的本地模型。只读工具已按当前模式装配；不会修改任何项目或配置。配置真实模型后，可以继续正式交流。"
  ].join("\n");
  return [
    fauxAssistantMessage(
      turn.thinking
        ? [fauxThinking(thinking), fauxText(reply)]
        : [fauxText(reply)]
    )
  ];
}
