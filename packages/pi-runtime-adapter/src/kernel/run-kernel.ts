import type { Agent } from "@earendil-works/pi-agent-core";
import {
  isRetryableAssistantError,
  type UserMessage
} from "@earendil-works/pi-ai";
import type {
  AgentProviderRuntimeConfig,
  AgentRuntimeRef
} from "@deepwrite/contracts";
import {
  runAgentWithTurnRetries,
  type AgentTurnRetryPolicyOptions
} from "../agent-turn-retry";
import {
  isAssistantMessage,
  toRuntimeEvents,
  toToolStreamRuntimeEvent,
  toUsageObservedRuntimeEvent
} from "../event-mapping";
import {
  buildAgentEvaluationSnapshot,
  evaluationConversationHistory,
  providerVisibleEvaluationTools
} from "../evaluation";
import { RunLifecycle } from "../run-lifecycle";
import type {
  AgentRuntimeEvent,
  AgentUserInputRequester
} from "../runtime-types";
import type { AgentUserInputBroker } from "../user-input-broker";
import {
  interceptToolCallStream,
  type ToolCallAssistantEvent
} from "../tool-stream";
import { createConcurrencyLimiter } from "../concurrency-limiter";
import { AsyncEventQueue } from "./async-event-queue";
import {
  RunContextManager,
  estimateRunFixedTokens,
  resolveSummaryModel
} from "./context";
import type { ConversationAgentCache } from "./run-agent";
import { assertAttachmentsSupported, resolveRunModel } from "./run-model";
import type { AgentRunPlan } from "./run-plan";
import { ToolDeltaStream } from "./tool-delta-stream";
import { createRequiredOutputGuard } from "./required-output-guard";

export interface AgentRunKernelOptions {
  idleTimeoutMs: number;
  tokensPerSecond: number;
  evaluationMode: boolean;
  retryPolicy: AgentTurnRetryPolicyOptions | undefined;
  agents: ConversationAgentCache;
  userInputBroker: AgentUserInputBroker;
  describe(config?: AgentProviderRuntimeConfig): AgentRuntimeRef;
}

/** Streams one agent run for any domain plan; see `AgentRunPlan`. */
export class AgentRunKernel {
  constructor(private readonly options: AgentRunKernelOptions) {}

  async *run(plan: AgentRunPlan): AsyncIterable<AgentRuntimeEvent> {
    const { target, eventSource } = plan;
    const { idleTimeoutMs, userInputBroker } = this.options;
    const queue = new AsyncEventQueue<AgentRuntimeEvent>();
    const runtime = this.options.describe(target.runtimeConfig);
    const messageId = `${target.runId}_assistant`;
    const reusableConversationAgent = this.options.agents.select(plan);
    const lifecycle = new RunLifecycle();
    let userInputRequestSequence = 0;
    // The broker holds one question per run, while parallel children (draw
    // selections, cross-stage confirmations) may ask at the same time: each
    // request is shown only after the previous one settled.
    const userInputTurns = createConcurrencyLimiter(1);
    const requestUserInput: AgentUserInputRequester = async (
      request,
      signal
    ) => {
      userInputWaiting += 1;
      lifecycle.clearIdleTimer();
      try {
        return await userInputTurns.run(async () => {
          const requestId = `${target.runId}:user-input:${++userInputRequestSequence}`;
          const response = userInputBroker.wait(
            {
              sessionId: target.sessionId,
              runId: target.runId,
              requestId,
              questions: request.questions,
              ...(request.draw ? { draw: request.draw } : {})
            },
            signal
          );
          emit({
            type: "agent.user_input_requested",
            runId: target.runId,
            sessionId: target.sessionId,
            payload: {
              requestId,
              toolCallId: request.toolCallId,
              source: request.source,
              questions: request.questions,
              ...(request.draw ? { draw: request.draw } : {}),
              runtime
            }
          });
          return await response;
        });
      } finally {
        userInputWaiting = Math.max(0, userInputWaiting - 1);
        if (userInputWaiting === 0) scheduleIdleTimeout();
      }
    };
    const { model, streamFn, spawnStreamFn, thinkingLevel } = resolveRunModel(
      plan,
      runtime,
      this.options.tokensPerSecond
    );
    plan.assertModelBudget?.(model);
    assertAttachmentsSupported(target, model, runtime);
    let prepared: Agent | undefined = reusableConversationAgent;
    const compactedListeners = new Set<() => void>();
    const { systemPrompt, tools } = plan.build({
      model,
      thinkingLevel,
      runtime,
      spawnStreamFn,
      parentSignal: lifecycle.signal,
      requestUserInput,
      getParentMessages: () => prepared?.state.messages ?? [],
      onContextCompacted: (listener) => compactedListeners.add(listener)
    });
    let emitToolCallEvent: (
      event: ToolCallAssistantEvent,
      assistantTurnIndex: number
    ) => void = () => {};
    const interceptedStreamFn = interceptToolCallStream(
      streamFn,
      (event, assistantTurnIndex) =>
        emitToolCallEvent(event, assistantTurnIndex)
    );
    const createdAgent = prepared === undefined;
    const agent = this.options.agents.prepare(plan, prepared, {
      systemPrompt,
      model,
      thinkingLevel,
      tools,
      streamFn: interceptedStreamFn
    });
    prepared = agent;
    const outputGuard = plan.requiredOutputTool
      ? createRequiredOutputGuard(agent, plan.requiredOutputTool)
      : undefined;
    if (outputGuard) agent.shouldStopAfterTurn = () => outputGuard.failed;
    else delete agent.shouldStopAfterTurn;

    let settled = false;
    let terminalEmitted = false;
    let resultDelivered = false;
    let evaluationSnapshotEmitter: (() => void) | undefined;
    let modelRequestInFlight = false;
    let retryWaiting = false;
    let userInputWaiting = 0;
    let idleModelRequestTimedOut = false;
    let currentTurnAttempt = 0;
    let currentTurnMaxAttempts = 1;
    let compactionBusy = false;
    let scheduleIdleTimeout = (): void => {};
    const retryWaitController = new AbortController();

    const emit = (event: AgentRuntimeEvent): void => {
      if (event.type === "extras_agent.output_updated") resultDelivered = true;
      if (event.type === "agent.completed" && !terminalEmitted) {
        for (const derived of plan.completionEvents?.(event) ?? []) {
          emit(derived);
        }
      }
      const terminal =
        event.type === "agent.completed" || event.type === "agent.error";
      if (terminalEmitted && event.type !== "agent.evaluation_snapshot") {
        return;
      }
      for (const childTerminal of lifecycle.observe(event)) {
        queue.push(childTerminal);
      }
      if (terminal) terminalEmitted = true;
      queue.push(event);
      if (!terminal && !terminalEmitted) {
        scheduleIdleTimeout();
      }
    };
    const toolDeltas = new ToolDeltaStream(emit);
    const emitError = (
      code: string,
      message: string,
      details?: Record<string, unknown>
    ): void =>
      emit({
        type: "agent.error",
        runId: target.runId,
        sessionId: target.sessionId,
        payload: { code, message, ...(details ? { details } : {}), runtime }
      });

    emitToolCallEvent = (event, assistantTurnIndex) => {
      toolDeltas.push(
        toToolStreamRuntimeEvent(
          event,
          eventSource,
          runtime,
          messageId,
          assistantTurnIndex
        )
      );
    };

    const cleanup = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      lifecycle.clearIdleTimer();
      toolDeltas.reset();
      lifecycle.dispose();
      userInputBroker.cancelRun(target.runId);
      retryWaitController.abort();
      queue.close();
    };

    lifecycle.bindAbort(target.signal, () => {
      idleModelRequestTimedOut = false;
      retryWaitController.abort();
      agent.abort();
      emitError("pi_agent.aborted", "智能体运行已中止。");
      cleanup();
    });

    scheduleIdleTimeout = (): void => {
      if (
        settled ||
        terminalEmitted ||
        retryWaiting ||
        compactionBusy ||
        userInputWaiting > 0 ||
        idleTimeoutMs <= 0
      ) {
        return;
      }
      lifecycle.scheduleIdleTimeout(idleTimeoutMs, () => {
        if (
          target.runtimeConfig &&
          modelRequestInFlight &&
          currentTurnAttempt < currentTurnMaxAttempts
        ) {
          // Aborting only the current Agent invocation yields an assistant
          // failure that the turn retry coordinator can resume. Tool execution
          // timeouts remain terminal so completed side effects are never replayed.
          idleModelRequestTimedOut = true;
          agent.abort();
          return;
        }
        agent.abort();
        emitError(
          "pi_agent.idle_timeout",
          "智能体超过 5 分钟没有返回新事件，运行已中止。"
        );
        cleanup();
      });
    };

    const contextManager = plan.contextPolicy
      ? new RunContextManager({
          agent,
          policy: plan.contextPolicy,
          model,
          summaryModel: resolveSummaryModel(
            { model, streamFn: spawnStreamFn, thinkingLevel, runtime },
            target.compactionRuntimeConfig
          ),
          runId: target.runId,
          sessionId: target.sessionId,
          messageId,
          runtime,
          fixedTokens: estimateRunFixedTokens(systemPrompt, tools),
          signal: lifecycle.signal,
          emit: (event) => emit(event),
          setBusy: (busy) => {
            compactionBusy = busy;
            if (busy) lifecycle.clearIdleTimer();
            else scheduleIdleTimeout();
          },
          refreshUserContent: () => plan.userMessageContent(true),
          notifyCompacted: () => {
            for (const listener of compactedListeners) listener();
          }
        })
      : undefined;
    if (contextManager) {
      agent.prepareNextTurnWithContext = contextManager.prepareNextTurn;
    } else {
      delete agent.prepareNextTurnWithContext;
    }

    const startRun = async (): Promise<void> => {
      if (settled) return;
      if (createdAgent)
        await contextManager?.restore(target.conversationHistory);
      // Preserve the first request wrapper as the stable prefix for later
      // turns, until compaction removes it from the context.
      const persistInitialRuntimeContext =
        createdAgent ||
        agent.state.messages.length === 0 ||
        contextManager?.consumeFixedContextRefresh() === true;
      const runtimeUserContent = plan.userMessageContent(
        persistInitialRuntimeContext
      );
      const runtimeUserMessage: UserMessage = {
        role: "user",
        content: runtimeUserContent,
        timestamp: Date.now()
      };
      contextManager?.noteRunStart(
        runtimeUserMessage,
        plan.rawUserMessageContent?.()
      );
      await contextManager?.beforeRun(runtimeUserMessage);
      if (settled) return;
      contextManager?.assertFits(runtimeUserMessage);
      if (this.options.evaluationMode) {
        const evaluationTools = providerVisibleEvaluationTools(
          systemPrompt,
          tools,
          runtime.provider,
          target.runtimeConfig?.toolSchemaProfile,
          plan.portableToolSchemaProfile
        );
        const emitEvaluationSnapshot = (): void => {
          emit({
            type: "agent.evaluation_snapshot",
            runId: target.runId,
            sessionId: target.sessionId,
            payload: {
              messageId,
              snapshot: buildAgentEvaluationSnapshot(
                systemPrompt,
                runtimeUserMessage.content,
                persistInitialRuntimeContext,
                evaluationTools,
                new Date().toISOString(),
                evaluationConversationHistory(agent.state.messages)
              ),
              runtime
            }
          });
        };
        emitEvaluationSnapshot();
        evaluationSnapshotEmitter = emitEvaluationSnapshot;
      }
      let completedEvent:
        Extract<AgentRuntimeEvent, { type: "agent.completed" }> | undefined;
      await runAgentWithTurnRetries({
        agent,
        initialPrompt: runtimeUserMessage,
        runId: target.runId,
        rejectEmptyResponse: () => !resultDelivered && !outputGuard,
        signal: retryWaitController.signal,
        ...(this.options.retryPolicy
          ? { retryPolicy: this.options.retryPolicy }
          : {}),
        classifyFailure: (message) => {
          if (idleModelRequestTimedOut && message.stopReason === "aborted") {
            return "模型请求长时间没有返回新事件。";
          }
          return isRetryableAssistantError(message)
            ? message.errorMessage || "模型连接暂时不可用。"
            : undefined;
        },
        onTurnStarted: (attempt) => {
          retryWaiting = false;
          modelRequestInFlight = true;
          idleModelRequestTimedOut = false;
          currentTurnAttempt = attempt.attempt;
          currentTurnMaxAttempts = attempt.maxAttempts;
          emit({
            type: "agent.turn_started",
            runId: target.runId,
            sessionId: target.sessionId,
            payload: {
              messageId,
              turnId: attempt.turnId,
              attempt: attempt.attempt,
              maxAttempts: attempt.maxAttempts,
              runtime
            }
          });
        },
        onRetryRollback: () => {
          modelRequestInFlight = false;
          idleModelRequestTimedOut = false;
          lifecycle.clearIdleTimer();
          toolDeltas.reset();
        },
        onRetryScheduled: (schedule) => {
          retryWaiting = true;
          lifecycle.clearIdleTimer();
          emit({
            type: "agent.retry_scheduled",
            runId: target.runId,
            sessionId: target.sessionId,
            payload: {
              messageId,
              ...schedule,
              runtime
            }
          });
        },
        onAssistantMessageEnded: (message, attempt) => {
          const usageEvent = toUsageObservedRuntimeEvent(
            message,
            eventSource,
            runtime,
            messageId,
            attempt
          );
          if (usageEvent) emit(usageEvent);
        },
        onEvent: (event) => {
          if (
            event.type === "message_end" &&
            isAssistantMessage(event.message)
          ) {
            modelRequestInFlight = false;
            const decision = outputGuard?.inspect(
              event.message,
              resultDelivered
            );
            if (decision) {
              completedEvent = undefined;
              if (decision.type === "error")
                emitError(decision.code, decision.message);
              return;
            }
          } else if (event.type === "tool_execution_start") {
            modelRequestInFlight = false;
          }
          for (const runtimeEvent of toRuntimeEvents(
            event,
            eventSource,
            runtime,
            messageId
          )) {
            if (runtimeEvent.type === "agent.completed")
              completedEvent = runtimeEvent;
            else emit(runtimeEvent);
          }
        },
        ...(contextManager
          ? {
              contextOverflow: {
                matches: (message) => contextManager.matchesOverflow(message),
                recover: (message) => contextManager.recoverOverflow(message)
              }
            }
          : {})
      });
      if (completedEvent && !settled) {
        await contextManager?.afterRun();
        if (!settled) emit(completedEvent);
      }
    };

    let running: Promise<void> | undefined;
    if (!settled) {
      scheduleIdleTimeout();
      running = startRun()
        .catch((error: unknown) => {
          if (settled || retryWaitController.signal.aborted) return;
          emitError(
            "pi_agent.prompt_failed",
            error instanceof Error ? error.message : "本地智能体请求失败。",
            { kind: error instanceof Error ? error.name : "unknown" }
          );
        })
        .finally(() => {
          if (!terminalEmitted) {
            emitError(
              "pi_agent.missing_terminal_event",
              "智能体运行结束，但没有收到完成事件。"
            );
          }
          evaluationSnapshotEmitter?.();
          cleanup();
        });
    }

    try {
      for await (const event of queue) {
        yield event;
      }
    } finally {
      if (!settled) {
        agent.abort();
        cleanup();
      }
      // UI completion/abort can close the queue while a model or tool still
      // owns this Agent. Do not let Utility release its session until it ends.
      await running;
    }
  }
}
