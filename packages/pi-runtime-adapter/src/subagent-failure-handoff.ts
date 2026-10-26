import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { getModelContentBlockReason } from "@deepwrite/contracts";
import {
  isAssistantMessage,
  readAssistantText,
  SUBAGENT_SUMMARY_MAX_LENGTH
} from "./subagent-helpers";
import type { SubagentTaskOutcome } from "./subagent-types";

const TRUNCATION_NOTICE = "\n（已截断）";

function clip(text: string, limit: number): string {
  return text.length > limit
    ? `${text.slice(0, limit - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`
    : text;
}

/** Keeps evidence for the parent without treating a blocked reply as complete. */
export function createSubagentFailureHandoff() {
  let partialText = "";
  let blocked = false;
  let successfulToolCount = 0;
  const successfulTools = new Map<string, number>();

  return {
    observe(event: AgentEvent): void {
      if (event.type === "turn_start") {
        // A transient retry or a new tool turn must not reuse an older draft.
        partialText = "";
        blocked = false;
      } else if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        partialText =
          `${partialText}${event.assistantMessageEvent.delta}`.slice(
            0,
            SUBAGENT_SUMMARY_MAX_LENGTH
          );
      } else if (event.type === "tool_execution_end" && !event.isError) {
        successfulToolCount++;
        successfulTools.set(
          event.toolName,
          (successfulTools.get(event.toolName) ?? 0) + 1
        );
      } else if (
        event.type === "message_end" &&
        isAssistantMessage(event.message)
      ) {
        blocked =
          event.message.stopReason !== "aborted" &&
          getModelContentBlockReason(event.message) !== undefined;
        if (blocked) {
          const returnedText = readAssistantText(event.message).trim();
          if (returnedText)
            partialText = returnedText.slice(0, SUBAGENT_SUMMARY_MAX_LENGTH);
        }
      }
    },

    forParent(outcome: SubagentTaskOutcome): SubagentTaskOutcome {
      const text = partialText.trim();
      if (
        outcome.status !== "error" ||
        !blocked ||
        (!text && successfulToolCount === 0)
      )
        return outcome;

      const tools = [...successfulTools]
        .map(([name, count]) => `${name} × ${count}`)
        .join("、");
      const summary = [
        clip(outcome.summary, 4_000),
        "【未完成任务的已有成果】模型服务因内容限制中断了输出，以下记录不代表任务已完成。不要原样重试被拦截的请求。",
        ...(successfulToolCount > 0
          ? [
              `此前已有 ${successfulToolCount} 次工具调用成功返回：${clip(tools, 2_000)}。涉及修改的内容仍以提案审阅与保存状态为准；请先核对已有成果，避免重复创建或覆盖。`
            ]
          : []),
        ...(text ? ["【中断前已收到的正文片段（不完整）】", text] : [])
      ].join("\n\n");
      return {
        ...outcome,
        summary: clip(summary, SUBAGENT_SUMMARY_MAX_LENGTH)
      };
    }
  };
}
