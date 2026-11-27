import type { PromptLocale } from "@deepwrite/contracts";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  UserMessage
} from "@earendil-works/pi-ai";
import { isAssistantMessage, readAssistantText } from "./subagent-helpers";

/** Continuations after replies cut at the model's output limit. */
export const SUBAGENT_CUT_RECOVERIES = 2;
export const SUBAGENT_EMPTY_RECOVERIES_PER_TURN = 2;
export const SUBAGENT_EMPTY_RECOVERIES_MAX = 4;

const CUT_NOTICE_ZH =
  "上一条回复超过了模型单次输出上限，被截断：其中的工具调用没有执行，内容没有保存。请把提交拆成更小的批次，每次只交一部分条目或单元，按任务给出的每批上限分几次提交；思考保持简短，不要在思考里预写全部成品，直接开始调用工具。";
const EMPTY_NOTICE_FIRST_ZH =
  "上一条回复是空的：没有调用工具，也没有交接文字。不要停在思考阶段，请立即继续执行任务（调用所需工具或直接输出最终结果）；已经全部完成的话，用一两句话写出交接摘要。";
const EMPTY_NOTICE_REPEAT_ZH =
  "上一条回复仍然是空的，没有调用工具也没有输出任何正文。这是最后一次提醒：请缩短思考，立刻调用所需工具或直接输出最终结果，不要再返回空回复。";
const READINESS_NOTICE_ZH =
  "上一条回复只是确认就绪，还没有执行任务。本轮完整委派任务已经在上面的用户消息中给出，不会再有后续指令；请立即开始执行（调用所需工具或直接产出最终结果）。";

const CUT_NOTICE_EN =
  "Your previous response hit the output length limit and was truncated: no tool calls ran and nothing was saved. Split your submission into smaller batches within the per-call limit, keep reasoning brief instead of drafting everything inside thinking, and call the tools directly.";
const EMPTY_NOTICE_FIRST_EN =
  "Your previous response was empty: no tool calls and no handoff text. Do not stop after thinking—execute the assigned task immediately (call the required tools or output the final result directly); if everything is already done, write a brief one- or two-sentence handoff summary.";
const EMPTY_NOTICE_REPEAT_EN =
  "Your previous response was still empty with neither tool calls nor text. Final reminder: keep reasoning brief, immediately call the required tools or output the final result directly, and do not return another empty reply.";
const READINESS_NOTICE_EN =
  "Your previous response only acknowledged readiness without performing the task. The complete assigned task is already in the user message above and no further instructions will follow; execute it immediately (call the required tools or produce the final result directly).";

const OUTER_DECORATION_PREFIX = /^[\s*`~_#>【】「」『』[\]()（）"“”'‘’]+/u;
const OUTER_DECORATION_SUFFIX =
  /[\s*`~_【】「」『』[\]()（）"“”'‘’。.,!！:：;；]+$/u;

const ACK_CLAUSE =
  /^(?:好的|好|收到|明白|了解|知道了|好的收到|已收到|已明白|已了解|已确认|已阅读|已理解(?:上述|以上|全部|本轮)?(?:规则|要求|设定|约束|职责)?|understood|acknowledged|got it|copy that|noted|sure|alright)$/iu;

const READINESS_CLAUSE =
  /^(?:(?:任务)?(?:已)?(?:准备)?就绪|准备好了|已准备好|随时可以开始|(?:(?:the\s+)?task\s+(?:is\s+)?|i(?:'m|\s+am)\s+)?ready(?:\s+(?:to\s+(?:start|begin|proceed|go|assist)|for\s+(?:the\s+)?(?:task|instructions?)))?)$/iu;

const WAIT_TASK_CLAUSE =
  /^(?:请(?:开始|继续|指示|吩咐|下达(?:具体)?(?:任务|指令)|提供(?:具体)?(?:任务|内容|要求)|发送(?:具体)?(?:任务|指令)|给出(?:具体)?(?:任务|要求)|输入(?:你的)?(?:任务|指令)|告诉我(?:需要|要)?(?:做什么|执行的任务))|waiting\s+for\s+(?:the\s+)?(?:task|instructions?|prompt|next\s+step)|please\s+(?:provide|send|give|share)\s+(?:the\s+|your\s+)?(?:task|instructions?|prompt|request|details)|how\s+can\s+i\s+help(?:\s+you)?\??)$/iu;

function stripOuterDecoration(text: string): string {
  let current = text.trim();
  while (current) {
    const next = current
      .replace(OUTER_DECORATION_PREFIX, "")
      .replace(OUTER_DECORATION_SUFFIX, "")
      .trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Detects short acknowledgement-only replies where the child mistook a long
 * structured task prompt for system instructions and waited for another turn.
 */
export function isPrematureReadinessReply(text: string): boolean {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (!collapsed || collapsed.length > 80) return false;
  const unwrapped = stripOuterDecoration(collapsed);
  if (!unwrapped) return false;
  const clauses = unwrapped
    .split(/[，,。.!！;；:：\n]+/u)
    .map((part) => stripOuterDecoration(part))
    .filter(Boolean);
  if (clauses.length === 0 || clauses.length > 3) return false;
  return clauses.every(
    (clause) =>
      ACK_CLAUSE.test(clause) ||
      READINESS_CLAUSE.test(clause) ||
      WAIT_TASK_CLAUSE.test(clause)
  );
}

function mergeUserMessages(
  first: UserMessage,
  second: UserMessage
): UserMessage {
  if (typeof first.content === "string" && typeof second.content === "string") {
    return {
      ...first,
      content: [first.content, second.content].filter(Boolean).join("\n\n"),
      timestamp: second.timestamp
    };
  }
  const toBlocks = (
    content: UserMessage["content"]
  ): Array<TextContent | ImageContent> =>
    typeof content === "string"
      ? content
        ? [{ type: "text", text: content }]
        : []
      : content;
  const firstBlocks = toBlocks(first.content);
  const secondBlocks = toBlocks(second.content);
  if (
    firstBlocks.every((part) => part.type === "text") &&
    secondBlocks.every((part) => part.type === "text")
  ) {
    const firstText = firstBlocks.map((part) => part.text).join("");
    const secondText = secondBlocks.map((part) => part.text).join("");
    return {
      ...first,
      content: [firstText, secondText].filter(Boolean).join("\n\n"),
      timestamp: second.timestamp
    };
  }
  return {
    ...first,
    content: [...firstBlocks, ...secondBlocks],
    timestamp: second.timestamp
  };
}

/**
 * Removes empty or thinking-only assistant turns before sending context to a
 * provider, and merges any adjacent user turns so recovery steers never create
 * dangling reasoning items or consecutive user messages.
 */
export function sanitizeSubagentContextMessages(
  messages: readonly AgentMessage[]
): AgentMessage[] {
  const sanitized: AgentMessage[] = [];
  for (const message of messages) {
    if (isAssistantMessage(message)) {
      const hasToolCall = message.content.some(
        (item) => item.type === "toolCall"
      );
      if (!hasToolCall && !readAssistantText(message).trim()) {
        continue;
      }
      sanitized.push(message);
      continue;
    }
    if (message.role === "user") {
      const previous = sanitized.at(-1);
      if (previous?.role === "user") {
        sanitized[sanitized.length - 1] = mergeUserMessages(previous, message);
        continue;
      }
    }
    sanitized.push(message);
  }
  return sanitized;
}

export type SubagentReplyVerdict = "continue" | "cut-off" | "final";

/**
 * Replies that would end a child without a result get another chance instead
 * of a misleading failure: cut-offs prompt smaller batches, empty/thinking-only
 * replies get bounded per-turn nudges, and premature readiness acknowledgements
 * are prompted once before any tool call.
 */
export function createSubagentReplyGuard(child: Agent, locale?: PromptLocale) {
  let cuts = 0;
  let consecutiveEmpties = 0;
  let totalEmpties = 0;
  let hadToolCall = false;
  let readinessNudged = false;
  const english = locale === "en-US";
  const cutNotice = english ? CUT_NOTICE_EN : CUT_NOTICE_ZH;
  const emptyNoticeFirst = english
    ? EMPTY_NOTICE_FIRST_EN
    : EMPTY_NOTICE_FIRST_ZH;
  const emptyNoticeRepeat = english
    ? EMPTY_NOTICE_REPEAT_EN
    : EMPTY_NOTICE_REPEAT_ZH;
  const readinessNotice = english ? READINESS_NOTICE_EN : READINESS_NOTICE_ZH;
  const steer = (text: string) =>
    child.steer({
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now()
    });
  return {
    /** `delivered`: a terminating tool already handed the result over. */
    inspect(
      message: AssistantMessage,
      delivered: boolean
    ): SubagentReplyVerdict {
      if (message.stopReason === "length") {
        if (cuts >= SUBAGENT_CUT_RECOVERIES) return "cut-off";
        cuts++;
        steer(cutNotice);
        return "continue";
      }
      if (message.content.some(({ type }) => type === "toolCall")) {
        hadToolCall = true;
        consecutiveEmpties = 0;
        return "final";
      }
      const text = readAssistantText(message).trim();
      if (!text) {
        if (
          !delivered &&
          consecutiveEmpties < SUBAGENT_EMPTY_RECOVERIES_PER_TURN &&
          totalEmpties < SUBAGENT_EMPTY_RECOVERIES_MAX
        ) {
          consecutiveEmpties += 1;
          totalEmpties += 1;
          steer(
            consecutiveEmpties === 1 ? emptyNoticeFirst : emptyNoticeRepeat
          );
          return "continue";
        }
        return "final";
      }
      consecutiveEmpties = 0;
      if (
        !hadToolCall &&
        !delivered &&
        !readinessNudged &&
        isPrematureReadinessReply(text)
      ) {
        readinessNudged = true;
        steer(readinessNotice);
        return "continue";
      }
      return "final";
    },
    hadEmptyReplies: () => totalEmpties > 0,
    cutOffMessage: () =>
      `子智能体的回复连续 ${cuts + 1} 次超过模型单次输出上限被截断，没有保存任何内容。请调低思考强度、换用单次输出上限更大的模型，或把任务拆小后重试。`
  };
}
