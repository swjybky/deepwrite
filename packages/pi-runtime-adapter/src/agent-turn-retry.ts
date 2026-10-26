import {
  type Agent,
  type AgentEvent,
  type AgentMessage
} from "@earendil-works/pi-agent-core";
import {
  isRetryableAssistantError,
  type AssistantMessage
} from "@earendil-works/pi-ai";
import {
  getModelContentBlockReason,
  isModelQuotaExhausted
} from "@deepwrite/contracts";

export const DEFAULT_AGENT_TURN_RETRY_DELAYS_MS = [
  2_000, 5_000, 10_000, 20_000, 30_000
] as const;

const DEFAULT_RETRY_JITTER_RATIO = 0.2;

export type AgentTurnRetrySleep = (
  delayMs: number,
  signal?: AbortSignal
) => Promise<void>;

export interface AgentTurnRetryPolicyOptions {
  /** One base delay for every retry after the initial attempt. */
  delaysMs?: readonly number[];
  /** Random source used for +/-20% delay jitter. */
  random?: () => number;
  /** Abort-aware wait implementation. Primarily useful for deterministic tests. */
  sleep?: AgentTurnRetrySleep;
  /** Clock used to calculate the externally reported retryAt value. */
  now?: () => number;
}

export interface AgentTurnAttempt {
  turnId: string;
  attempt: number;
  maxAttempts: number;
}

export interface AgentTurnRetrySchedule {
  turnId: string;
  failedAttempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  retryAt: string;
  reason: string;
}

export interface RunAgentWithTurnRetriesOptions {
  agent: Agent;
  initialPrompt: AgentMessage | AgentMessage[];
  runId: string;
  signal?: AbortSignal;
  retryPolicy?: AgentTurnRetryPolicyOptions;
  /**
   * Return a user-facing reason to retry, or undefined for a terminal failure.
   * The default delegates to pi-ai's transient provider-error classifier.
   */
  classifyFailure?: (message: AssistantMessage) => string | undefined;
  /**
   * Reject an otherwise successful reply without text or tool calls. Runs
   * that already delivered a structured result may allow an empty ending;
   * subagents use their own handoff guard instead.
   */
  rejectEmptyResponse?: () => boolean;
  onEvent?: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void;
  /**
   * Runs for every provider-returned assistant terminal message before retry
   * suppression. Use this for accounting that must include transient failures
   * and intermediate tool-call turns without exposing them to presentation.
   */
  onAssistantMessageEnded?: (
    message: AssistantMessage,
    attempt: AgentTurnAttempt,
    signal: AbortSignal
  ) => Promise<void> | void;
  onTurnStarted?: (attempt: AgentTurnAttempt) => Promise<void> | void;
  onRetryScheduled?: (
    schedule: AgentTurnRetrySchedule,
    message: AssistantMessage
  ) => Promise<void> | void;
  onRetryRollback?: (
    attempt: AgentTurnAttempt,
    message: AssistantMessage
  ) => Promise<void> | void;
  /**
   * Recovers once from a request the provider rejected as too long. The
   * failed message is removed before `recover` compacts the transcript; when
   * it returns true the run continues instead of failing.
   */
  contextOverflow?: {
    matches(message: AssistantMessage): boolean;
    recover(message: AssistantMessage): Promise<boolean>;
  };
}

interface ResolvedAgentTurnRetryPolicy {
  delaysMs: readonly number[];
  random: () => number;
  sleep: AgentTurnRetrySleep;
  now: () => number;
}

function isAssistantMessage(
  message: AgentMessage
): message is AssistantMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    message.role === "assistant"
  );
}

function defaultFailureClassifier(
  message: AssistantMessage
): string | undefined {
  return isRetryableAssistantError(message)
    ? message.errorMessage || "模型连接暂时不可用。"
    : undefined;
}

function createAbortError(): Error {
  const error = new Error("Agent turn retry was aborted.");
  error.name = "AbortError";
  return error;
}

/** Waits without leaving a timer alive after cancellation. */
export async function sleepForAgentTurnRetry(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw createAbortError();
  if (delayMs <= 0) {
    await Promise.resolve();
    if (signal?.aborted) throw createAbortError();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    timeout.unref?.();

    const onAbort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Applies the policy's fixed +/-20% jitter to one base delay. */
export function jitterAgentTurnRetryDelay(
  baseDelayMs: number,
  random: () => number = Math.random
): number {
  const normalizedBase = Number.isFinite(baseDelayMs)
    ? Math.max(0, Math.round(baseDelayMs))
    : 0;
  const randomValue = random();
  const sample = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0.5;
  const factor =
    1 - DEFAULT_RETRY_JITTER_RATIO + sample * DEFAULT_RETRY_JITTER_RATIO * 2;
  return Math.max(0, Math.round(normalizedBase * factor));
}

function resolveRetryPolicy(
  policy: AgentTurnRetryPolicyOptions | undefined
): ResolvedAgentTurnRetryPolicy {
  return {
    delaysMs: policy?.delaysMs ?? DEFAULT_AGENT_TURN_RETRY_DELAYS_MS,
    random: policy?.random ?? Math.random,
    sleep: policy?.sleep ?? sleepForAgentTurnRetry,
    now: policy?.now ?? Date.now
  };
}

/**
 * Removes only the failed assistant response appended by the current attempt.
 * Earlier assistant tool calls and their following tool results remain intact,
 * so retrying with Agent.continue() cannot replay an already completed tool.
 */
export function removeFailedAssistantFromTranscript(
  agent: Agent,
  failedMessage: AssistantMessage
): boolean {
  const messages = agent.state.messages;
  const failedIndex = messages.lastIndexOf(failedMessage);
  if (failedIndex < 0) return false;
  agent.state.messages = [
    ...messages.slice(0, failedIndex),
    ...messages.slice(failedIndex + 1)
  ];
  return true;
}

/**
 * Runs one Agent prompt and transparently restarts only a failed model turn.
 *
 * Retryable assistant terminal messages are withheld from `onEvent`, removed
 * from the transcript, and resumed from the preceding user/tool-result
 * checkpoint. Every other event, including the final terminal failure, is
 * forwarded unchanged. The same logical turn id is retained across attempts.
 */
export async function runAgentWithTurnRetries(
  options: RunAgentWithTurnRetriesOptions
): Promise<void> {
  const policy = resolveRetryPolicy(options.retryPolicy);
  const maxAttempts = policy.delaysMs.length + 1;
  const classifyFailure = options.classifyFailure ?? defaultFailureClassifier;
  let turnSequence = 0;
  let activeTurn: AgentTurnAttempt | undefined;
  let retryContinuationPending = false;
  let pendingRetry:
    { schedule: AgentTurnRetrySchedule; message: AssistantMessage } | undefined;
  let overflowRecoveryAttempted = false;
  let overflowContinuationPending = false;

  const unsubscribe = options.agent.subscribe(async (event, signal) => {
    if (event.type === "turn_start") {
      if (retryContinuationPending && activeTurn) {
        retryContinuationPending = false;
        activeTurn = { ...activeTurn, attempt: activeTurn.attempt + 1 };
      } else {
        turnSequence += 1;
        activeTurn = {
          turnId: `${options.runId}:turn:${turnSequence}`,
          attempt: 1,
          maxAttempts
        };
      }
      await options.onTurnStarted?.(activeTurn);
      await options.onEvent?.(event, signal);
      return;
    }

    let emptyResponse = false;
    if (
      event.type === "message_end" &&
      isAssistantMessage(event.message) &&
      activeTurn
    ) {
      if (
        event.message.stopReason === "stop" &&
        !event.message.errorMessage &&
        options.rejectEmptyResponse?.() &&
        !event.message.content.some(
          (item) =>
            item.type === "toolCall" ||
            (item.type === "text" && item.text.trim().length > 0)
        )
      ) {
        emptyResponse = true;
        event.message.stopReason = "error";
        event.message.errorMessage =
          "模型返回了空回复（没有正文或工具调用），任务尚未完成。请重试或检查模型服务。";
      }
      await options.onAssistantMessageEnded?.(
        event.message,
        { ...activeTurn },
        signal
      );
    }

    if (
      event.type === "message_end" &&
      isAssistantMessage(event.message) &&
      activeTurn &&
      !overflowRecoveryAttempted &&
      !getModelContentBlockReason(event.message) &&
      options.contextOverflow?.matches(event.message) &&
      removeFailedAssistantFromTranscript(options.agent, event.message)
    ) {
      overflowRecoveryAttempted = true;
      const recovered = await options.contextOverflow
        .recover(event.message)
        .catch(() => false);
      if (recovered) {
        overflowContinuationPending = true;
        retryContinuationPending = true;
        activeTurn = {
          ...activeTurn,
          maxAttempts: Math.max(activeTurn.maxAttempts, activeTurn.attempt + 1)
        };
        await options.onRetryRollback?.(activeTurn, event.message);
        await options.onRetryScheduled?.(
          {
            turnId: activeTurn.turnId,
            failedAttempt: activeTurn.attempt,
            nextAttempt: activeTurn.attempt + 1,
            maxAttempts: activeTurn.maxAttempts,
            delayMs: 0,
            retryAt: new Date(policy.now()).toISOString(),
            reason: "上下文已压缩，正在恢复本次模型请求。"
          },
          event.message
        );
        // Do not expose the overflow as a terminal failure.
        return;
      }
      // Failed recovery must leave the original error in the durable agent history.
      options.agent.state.messages = [
        ...options.agent.state.messages,
        event.message
      ];
      await options.onEvent?.(event, signal);
      return;
    }

    if (
      event.type === "message_end" &&
      isAssistantMessage(event.message) &&
      activeTurn &&
      activeTurn.attempt < maxAttempts
    ) {
      const reason = emptyResponse
        ? event.message.errorMessage
        : isModelQuotaExhausted(event.message.errorMessage) ||
            getModelContentBlockReason(event.message)
          ? undefined
          : classifyFailure(event.message);
      if (reason) {
        const baseDelayMs = policy.delaysMs[activeTurn.attempt - 1] ?? 0;
        const delayMs = jitterAgentTurnRetryDelay(baseDelayMs, policy.random);
        const schedule: AgentTurnRetrySchedule = {
          turnId: activeTurn.turnId,
          failedAttempt: activeTurn.attempt,
          nextAttempt: activeTurn.attempt + 1,
          maxAttempts,
          delayMs,
          retryAt: new Date(policy.now() + delayMs).toISOString(),
          reason: reason.slice(0, 4_000)
        };
        if (
          !removeFailedAssistantFromTranscript(options.agent, event.message)
        ) {
          await options.onEvent?.(event, signal);
          return;
        }
        pendingRetry = { schedule, message: event.message };
        await options.onRetryRollback?.(activeTurn, event.message);
        await options.onRetryScheduled?.(schedule, event.message);
        // Do not expose the retryable message_end as a terminal failure.
        return;
      }
    }

    await options.onEvent?.(event, signal);
  });

  try {
    await options.agent.prompt(options.initialPrompt);
    while (pendingRetry || overflowContinuationPending) {
      if (overflowContinuationPending) {
        overflowContinuationPending = false;
        if (options.signal?.aborted) throw createAbortError();
        await options.agent.continue();
        continue;
      }
      if (!pendingRetry) break;
      const retry = pendingRetry;
      pendingRetry = undefined;
      await policy.sleep(retry.schedule.delayMs, options.signal);
      if (options.signal?.aborted) throw createAbortError();
      retryContinuationPending = true;
      await options.agent.continue();
    }
  } finally {
    unsubscribe();
  }
}
