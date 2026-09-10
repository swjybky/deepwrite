import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import { runAgentWithTurnRetries } from "./agent-turn-retry";
import {
  resolveSubagentTimeoutMs,
  subagentTimeoutMessage
} from "./subagent-timeout";
import {
  isAssistantMessage,
  namespaceChildToolCallId,
  summarizeToolResult,
  normalizeUsage,
  usageObservationStatus,
  readAssistantText,
  textResult,
  SUBAGENT_SUMMARY_MAX_LENGTH
} from "./subagent-helpers";
import type {
  BuildSpawnSubagentToolInput,
  SubagentProgressBase,
  SubagentToolProgress
} from "./subagent-types";
export async function runSubagentLifecycle(
  child: Agent,
  input: BuildSpawnSubagentToolInput,
  progressBase: SubagentProgressBase,
  task: string,
  childRuntime: AgentRuntimeRef,
  emitProgress: (progress: SubagentToolProgress, text: string) => void,
  signal?: AbortSignal
) {
  const subagentRunId = progressBase.subagentRunId;
  const definition = { name: progressBase.name };
  let terminalMessage: AssistantMessage | undefined;
  let terminalError: string | undefined;
  let terminalAborted = false;
  let acceptingActivity = true;
  const handleChildEvent = (event: AgentEvent): void => {
    if (!acceptingActivity) return;
    if (event.type === "message_update" && isAssistantMessage(event.message)) {
      if (event.assistantMessageEvent.type === "thinking_delta") {
        emitProgress(
          {
            ...progressBase,
            type: "activity",
            activity: {
              type: "thinking_delta",
              delta: event.assistantMessageEvent.delta
            }
          },
          "子智能体正在思考。"
        );
      } else if (event.assistantMessageEvent.type === "text_delta") {
        emitProgress(
          {
            ...progressBase,
            type: "activity",
            activity: {
              type: "message_delta",
              delta: event.assistantMessageEvent.delta
            }
          },
          "子智能体正在输出交接摘要。"
        );
      }
      return;
    }

    if (event.type === "tool_execution_start") {
      emitProgress(
        {
          ...progressBase,
          type: "activity",
          activity: {
            type: "tool_requested",
            toolCallId: namespaceChildToolCallId(
              subagentRunId,
              event.toolCallId
            ),
            toolName: event.toolName,
            args: event.args
          }
        },
        `子智能体正在调用 ${event.toolName}。`
      );
      return;
    }

    if (event.type === "tool_execution_end") {
      const toolCallId = namespaceChildToolCallId(
        subagentRunId,
        event.toolCallId
      );
      emitProgress(
        {
          ...progressBase,
          type: "activity",
          activity: {
            type: "tool_completed",
            toolCallId,
            toolName: event.toolName,
            resultSummary: summarizeToolResult(event.result),
            isError: event.isError
          }
        },
        `子智能体已完成 ${event.toolName}。`
      );
      emitProgress(
        {
          ...progressBase,
          type: "child_tool_details",
          toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError
        },
        `子智能体工具 ${event.toolName} 的业务结果已同步。`
      );
      return;
    }

    if (event.type === "message_end" && isAssistantMessage(event.message)) {
      if (event.message.stopReason === "aborted") {
        terminalAborted = true;
        terminalError = event.message.errorMessage || "子智能体运行已中止。";
      } else if (
        event.message.stopReason === "error" ||
        event.message.errorMessage
      ) {
        terminalError =
          event.message.errorMessage || "子智能体模型返回错误终态。";
      } else if (
        !event.message.content.some((item) => item.type === "toolCall")
      ) {
        terminalMessage = event.message;
      }
    }
  };

  type PromptOutcome =
    | { kind: "completed" }
    | { kind: "failed"; error: unknown }
    | { kind: "aborted" }
    | { kind: "timeout" };
  let resolveEarly: ((outcome: PromptOutcome) => void) | undefined;
  let cancellationRequested = signal?.aborted === true;
  const lifecycleController = new AbortController();
  const abortChild = (): void => {
    acceptingActivity = false;
    cancellationRequested = true;
    lifecycleController.abort();
    child.abort();
    resolveEarly?.({ kind: "aborted" });
  };
  if (!cancellationRequested) {
    signal?.addEventListener("abort", abortChild, { once: true });
  }

  let status: "completed" | "error" | "aborted" = "completed";
  let errorMessage: string | undefined;
  let summary = "";
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;
  const timeoutMs = resolveSubagentTimeoutMs(input.timeoutMs);
  try {
    if (cancellationRequested) {
      status = "aborted";
      errorMessage = "子智能体运行已中止。";
    } else {
      const early = new Promise<PromptOutcome>((resolve) => {
        resolveEarly = resolve;
      });
      timeout = setTimeout(() => {
        acceptingActivity = false;
        timedOut = true;
        lifecycleController.abort();
        child.abort();
        resolveEarly?.({ kind: "timeout" });
      }, timeoutMs);
      timeout.unref();
      const prompt: Promise<PromptOutcome> = runAgentWithTurnRetries({
        agent: child,
        initialPrompt: {
          role: "user",
          content: task,
          timestamp: Date.now()
        } satisfies UserMessage,
        runId: subagentRunId,
        signal: lifecycleController.signal,
        ...(input.retryPolicy ? { retryPolicy: input.retryPolicy } : {}),
        onEvent: handleChildEvent,
        onAssistantMessageEnded: (message, attempt) => {
          const usage = normalizeUsage(message.usage);
          if (!usage) return;
          emitProgress(
            {
              ...progressBase,
              type: "usage_observed",
              observationId: `${attempt.turnId}:attempt:${attempt.attempt}`,
              observedAt: new Date().toISOString(),
              messageId: `${subagentRunId}_assistant`,
              turnId: attempt.turnId,
              attempt: attempt.attempt,
              status: usageObservationStatus(message),
              hadToolCall: message.content.some(
                (item) => item.type === "toolCall"
              ),
              usage,
              runtime: childRuntime
            },
            "子智能体模型请求已完成。"
          );
        },
        onTurnStarted: (attempt) => {
          if (!acceptingActivity) return;
          emitProgress(
            {
              ...progressBase,
              type: "activity",
              activity: { type: "turn_started", ...attempt }
            },
            `子智能体正在进行第 ${attempt.attempt} 次模型请求。`
          );
        },
        onRetryScheduled: (retry) => {
          if (!acceptingActivity) return;
          emitProgress(
            {
              ...progressBase,
              type: "activity",
              activity: { type: "retry_scheduled", ...retry }
            },
            `子智能体网络连接波动，将进行第 ${retry.nextAttempt - 1}/${retry.maxAttempts - 1} 次重试。`
          );
        }
      })
        .then((): PromptOutcome => ({ kind: "completed" }))
        .catch((error: unknown): PromptOutcome => ({
          kind: "failed",
          error
        }));
      const outcome = await Promise.race([prompt, early]);
      if (outcome.kind === "failed") throw outcome.error;
      if (outcome.kind === "aborted") {
        status = "aborted";
        errorMessage = "子智能体运行已中止。";
      }
    }
    if (timedOut) {
      status = "error";
      errorMessage = subagentTimeoutMessage(timeoutMs);
    } else if (
      status === "completed" &&
      (cancellationRequested || terminalAborted)
    ) {
      status = "aborted";
      errorMessage = terminalError ?? "子智能体运行已中止。";
    } else if (terminalError) {
      status = "error";
      errorMessage = terminalError;
    } else if (status === "completed" && !terminalMessage) {
      status = "error";
      errorMessage = "子智能体运行结束，但没有返回最终交接摘要。";
    }
  } catch (error: unknown) {
    status = cancellationRequested || signal?.aborted ? "aborted" : "error";
    errorMessage = timedOut
      ? subagentTimeoutMessage(timeoutMs)
      : error instanceof Error
        ? error.message
        : "子智能体运行失败。";
  } finally {
    acceptingActivity = false;
    if (timeout) clearTimeout(timeout);
    resolveEarly = undefined;
    signal?.removeEventListener("abort", abortChild);
  }

  if (status === "completed") {
    summary = readAssistantText(terminalMessage!)
      .trim()
      .slice(0, SUBAGENT_SUMMARY_MAX_LENGTH);
    if (!summary) {
      status = "error";
      errorMessage = "子智能体没有生成可交接的摘要。";
    }
  }
  if (status !== "completed") {
    summary =
      `${status === "aborted" ? "子智能体执行已中止" : "子智能体执行失败"}：${errorMessage}`.slice(
        0,
        SUBAGENT_SUMMARY_MAX_LENGTH
      );
  }

  const usage = terminalMessage
    ? normalizeUsage(terminalMessage.usage)
    : undefined;
  emitProgress(
    {
      ...progressBase,
      type: "completed",
      status,
      summary,
      ...(errorMessage ? { errorMessage: errorMessage.slice(0, 4_000) } : {}),
      ...(usage ? { usage } : {})
    },
    status === "completed" ? `子智能体「${definition.name}」已完成。` : summary
  );

  return textResult(summary, { kind: "subagent-result" as const });
}
