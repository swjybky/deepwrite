import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import { runAgentWithTurnRetries } from "./agent-turn-retry";
import { createSubagentReplyGuard } from "./subagent-reply-guard";
import { createSubagentFailureHandoff } from "./subagent-failure-handoff";
import {
  RunContextManager,
  estimateRunFixedTokens,
  resolveSummaryModel
} from "./kernel/context";
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
  SUBAGENT_SUMMARY_MAX_LENGTH
} from "./subagent-helpers";
import type {
  BuildSpawnSubagentToolInput,
  SubagentProgressBase,
  SubagentTaskOutcome,
  SubagentToolProgress
} from "./subagent-types";
export async function runSubagentLifecycle(
  child: Agent,
  input: BuildSpawnSubagentToolInput,
  progressBase: SubagentProgressBase,
  task: string,
  childRuntime: AgentRuntimeRef,
  emitProgress: (progress: SubagentToolProgress, text: string) => void,
  signal?: AbortSignal,
  notifyCompacted: () => void = () => {},
  /**
   * A run that delivers its result through a terminating tool has no final
   * text reply; a returned string completes it with that summary instead.
   */
  finalSummary?: () => string | undefined
): Promise<SubagentTaskOutcome> {
  const subagentRunId = progressBase.subagentRunId;
  const definition = { name: progressBase.name };
  let terminalMessage: AssistantMessage | undefined;
  let terminalError: string | undefined;
  let terminalAborted = false;
  let acceptingActivity = true;
  let cutOff = false;
  const replies = createSubagentReplyGuard(child);
  const failureHandoff = createSubagentFailureHandoff();
  // Declared before the handler so a cut-off reply can stop the child.
  let stopCutOff = (): void => {};
  const handleChildEvent = (event: AgentEvent): void => {
    if (!acceptingActivity) return;
    failureHandoff.observe(event);
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
      } else {
        const verdict = replies.inspect(
          event.message,
          finalSummary?.() !== undefined
        );
        if (verdict === "cut-off") stopCutOff();
        else if (
          verdict === "final" &&
          !event.message.content.some((item) => item.type === "toolCall")
        )
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
  stopCutOff = () => {
    acceptingActivity = false;
    cutOff = true;
    lifecycleController.abort();
    child.abort();
    resolveEarly?.({ kind: "timeout" });
  };

  let status: "completed" | "error" | "aborted" = "completed";
  let errorMessage: string | undefined;
  let summary = "";
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;
  let running: Promise<PromptOutcome> | undefined;
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
      const taskMessage: UserMessage = {
        role: "user",
        content: task,
        timestamp: Date.now()
      };
      const contextGuard = input.contextPolicy
        ? new RunContextManager({
            agent: child,
            policy: input.contextPolicy,
            model: child.state.model,
            summaryModel: resolveSummaryModel(
              {
                model: child.state.model,
                streamFn: child.streamFunction,
                thinkingLevel: child.state.thinkingLevel,
                runtime: childRuntime
              },
              undefined
            ),
            runId: subagentRunId,
            sessionId: input.parentSessionId,
            messageId: `${subagentRunId}_assistant`,
            runtime: childRuntime,
            fixedTokens: estimateRunFixedTokens(
              child.state.systemPrompt,
              child.state.tools
            ),
            signal: lifecycleController.signal,
            emit: (event) => {
              if (event.type !== "agent.usage_observed") return;
              emitProgress(
                { ...progressBase, type: "usage_observed", ...event.payload },
                "子智能体上下文已压缩。"
              );
            },
            setBusy: () => {},
            notifyCompacted
          })
        : undefined;
      if (contextGuard) {
        child.prepareNextTurnWithContext = contextGuard.prepareNextTurn;
        contextGuard.noteRunStart(taskMessage, undefined);
      }
      running = (async () => {
        await contextGuard?.beforeRun(taskMessage);
        lifecycleController.signal.throwIfAborted();
        contextGuard?.assertFits(taskMessage);
        await runAgentWithTurnRetries({
          agent: child,
          initialPrompt: taskMessage,
          runId: subagentRunId,
          ...(contextGuard
            ? {
                contextOverflow: {
                  matches: (message) => contextGuard.matchesOverflow(message),
                  recover: (message) => contextGuard.recoverOverflow(message)
                }
              }
            : {}),
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
        });
      })()
        .then((): PromptOutcome => ({ kind: "completed" }))
        .catch((error: unknown): PromptOutcome => ({
          kind: "failed",
          error
        }));
      const outcome = await Promise.race([running, early]);
      if (outcome.kind === "failed") throw outcome.error;
      if (outcome.kind === "aborted") {
        status = "aborted";
        errorMessage = "子智能体运行已中止。";
      }
    }
    if (timedOut) {
      status = "error";
      errorMessage = subagentTimeoutMessage(timeoutMs);
    } else if (cutOff) {
      status = "error";
      errorMessage = replies.cutOffMessage();
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
      : cutOff
        ? replies.cutOffMessage()
        : error instanceof Error
          ? error.message
          : "子智能体运行失败。";
  } finally {
    acceptingActivity = false;
    if (timeout) clearTimeout(timeout);
    resolveEarly = undefined;
    signal?.removeEventListener("abort", abortChild);
  }

  const deliveredSummary = finalSummary?.();
  if (deliveredSummary && !timedOut && status !== "aborted") {
    status = "completed";
    errorMessage = undefined;
  }
  if (status === "completed") {
    summary = (deliveredSummary ?? readAssistantText(terminalMessage!))
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
  try {
    emitProgress(
      {
        ...progressBase,
        type: "completed",
        status,
        summary,
        ...(errorMessage ? { errorMessage: errorMessage.slice(0, 4_000) } : {}),
        ...(usage ? { usage } : {})
      },
      status === "completed"
        ? `子智能体「${definition.name}」已完成。`
        : summary
    );
    // Activity already retains the fragment in the UI. Include it in the
    // parent's tool result too, while leaving the terminal error unchanged.
    return failureHandoff.forParent({ status, summary });
  } finally {
    // Timeout/abort remains visible immediately. The parent tool still owns
    // this child until its model, tools and retry listeners really finish.
    await running;
  }
}
