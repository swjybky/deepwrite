import type { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const MAX_RECOVERIES = 2;

type ReplyDecision =
  { type: "continue" } | { type: "error"; code: string; message: string };

/** Keeps a tool-submitted task in the same transcript until its output arrives. */
export function createRequiredOutputGuard(agent: Agent, toolName: string) {
  let recoveries = 0;
  let failed = false;
  return {
    get failed() {
      return failed;
    },
    inspect(
      message: AssistantMessage,
      delivered: boolean
    ): ReplyDecision | undefined {
      if (
        delivered ||
        message.stopReason === "error" ||
        message.stopReason === "aborted" ||
        message.errorMessage
      ) {
        return;
      }
      const truncated = message.stopReason === "length";
      // Successful tool-call turns are checked only after their tools execute.
      if (
        !truncated &&
        message.content.some(({ type }) => type === "toolCall")
      ) {
        return;
      }
      if (recoveries >= MAX_RECOVERIES) {
        failed = true;
        return {
          type: "error",
          code: truncated
            ? "pi_agent.output_truncated"
            : "pi_agent.output_missing",
          message: truncated
            ? `模型回复达到单次输出上限被截断，精简后仍未成功提交当前阶段结果（已自动提示补交 ${recoveries} 次）。请调低思考强度、提高模型最大输出长度或缩小章节范围后重试。`
            : `模型仍未通过 ${toolName} 成功提交当前阶段结果（已自动提示补交 ${recoveries} 次）。请重试当前阶段或检查模型的工具调用支持。`
        };
      }
      recoveries++;
      agent.steer({
        role: "user",
        content: [
          {
            type: "text",
            text: [
              truncated
                ? "上一条回复达到模型单次输出上限，被截断，未成功提交结果。请精简思考与提交内容，保留关键结论和章节证据。"
                : "本阶段仍未收到成功提交的结果；普通回复只显示在执行记录中。",
              `请沿用已读取的输入和已有分析；未读的输入先通过本轮工具补读，不得补造章节内容。直接调用 ${toolName} 提交当前阶段结果，不要在普通回复中重复展开全文。工具报错时按错误修正参数后重交；只有工具成功提交才算完成。`
            ].join("\n")
          }
        ],
        timestamp: Date.now()
      });
      return { type: "continue" };
    }
  };
}
