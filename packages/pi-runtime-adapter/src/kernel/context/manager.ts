import type {
  Agent,
  AgentLoopTurnUpdate,
  AgentMessage,
  PrepareNextTurnContext
} from "@earendil-works/pi-agent-core";
import {
  getCurrentSystemMessage,
  isContextOverflow,
  type Api,
  type AssistantMessage,
  type Model,
  type UserMessage
} from "@earendil-works/pi-ai";
import type {
  AgentContextCompactionReason,
  AgentRuntimeRef,
  SessionConversationHistoryMessage
} from "@deepwrite/contracts";
import { normalizeUsage } from "../../event-mapping";
import type { AgentRuntimeEvent } from "../../runtime-types";
import { resolveContextBudget, type ContextBudget } from "./budget";
import { checkpointMessage, compactMessages } from "./compact";
import {
  conversationContextState,
  type ConversationContextState
} from "./state";
import type { SummaryModel, SummaryUsage } from "./summarize";
import { estimateContextTokens, estimateMessagesTokens } from "./token-count";
import type { ContextCompactionOutcome, ContextPolicy } from "./types";

export interface RunContextManagerOptions {
  agent: Agent;
  policy: ContextPolicy;
  model: Model<Api>;
  summaryModel: SummaryModel;
  runId: string;
  sessionId: string;
  messageId: string;
  runtime: AgentRuntimeRef;
  /** System prompt and tool schemas of this run. */
  fixedTokens: number;
  signal: AbortSignal;
  emit(event: AgentRuntimeEvent): void;
  /** Marks a compaction in flight so the idle watchdog stays quiet. */
  setBusy(busy: boolean): void;
  /** Tells run tools that earlier reads left the context. */
  notifyCompacted(removedToolCallIds?: readonly string[]): void;
  refreshUserContent?(): UserMessage["content"];
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim().slice(0, 4_000) || "上下文压缩失败。";
}

/**
 * Applies a plan's context policy to one run: compaction before the reply,
 * between turns of a long run, and once after a context-overflow failure.
 */
export class RunContextManager {
  readonly state: ConversationContextState;
  readonly budget: ContextBudget;
  private runStart: AgentMessage | undefined;
  private overflowRecovered = false;
  private sequence = 0;

  constructor(private readonly options: RunContextManagerOptions) {
    this.state = conversationContextState(options.agent);
    this.budget = resolveContextBudget(options.model, options.policy.settings);
  }

  /**
   * Seeds a newly created agent from the persisted checkpoint and marks which
   * restored messages started runs. A cached agent keeps its own history.
   */
  async restore(
    history: readonly SessionConversationHistoryMessage[] | undefined
  ): Promise<void> {
    const { agent, policy } = this.options;
    const messages = agent.state.messages.filter(
      (message) => message.role !== "system"
    );
    (history ?? []).forEach((item, index) => {
      const message = messages[index];
      if (item.role === "user" && item.runId && message) {
        this.state.runStarts.set(message, item.runId);
      }
    });
    const checkpoint = policy.checkpoint;
    if (!checkpoint) return;
    this.state.checkpoint = checkpoint;
    if (checkpoint.refs) this.state.addRefs(checkpoint.refs);
    const summary = checkpointMessage(
      checkpoint,
      undefined,
      Date.parse(checkpoint.createdAt) || Date.now()
    );
    this.state.summaryMessage = summary;
    this.state.pruned.add(summary);
    this.state.compactedAt = Date.now();
    const system = getCurrentSystemMessage(agent.state.messages);
    agent.state.messages = [...(system ? [system] : []), summary, ...messages];
  }

  /** True once when compaction dropped the fixed context of an earlier run. */
  consumeFixedContextRefresh(): boolean {
    return this.state.consumeFixedContextRefresh();
  }

  noteRunStart(
    message: UserMessage,
    rawContent: UserMessage["content"] | undefined
  ): void {
    this.runStart = message;
    this.state.runStarts.set(message, this.options.runId);
    if (rawContent !== undefined && rawContent !== message.content) {
      this.state.runtimeTurns.set(message, { rawContent, snapshot: true });
    }
  }

  /** Compaction before the reply: threshold-driven or requested by the user. */
  async beforeRun(incoming?: UserMessage): Promise<void> {
    const { agent, policy } = this.options;
    // Rebuild recovered source content from this run's authorized snapshot.
    // Cached checkpoints must not pin an old skill body or draft version.
    if (this.state.checkpoint && this.state.summaryMessage) {
      const index = agent.state.messages.indexOf(this.state.summaryMessage);
      if (index >= 0) {
        const previous = this.state.summaryMessage;
        const refreshed = checkpointMessage(
          this.state.checkpoint,
          await policy.rehydrate?.(
            this.state.refs,
            this.budget.rehydrateTokens
          ),
          previous.timestamp
        );
        agent.state.messages[index] = refreshed;
        this.state.summaryMessage = refreshed;
        this.state.pruned.add(refreshed);
        this.state.compactedAt = Date.now();
      }
    }
    const force = policy.manual !== undefined;
    if (
      !force &&
      (!policy.settings.enabled || policy.thresholdCompaction === false)
    )
      return;
    const messages = incoming
      ? [...agent.state.messages, incoming]
      : agent.state.messages;
    const tokensBefore = this.tokens(messages);
    if (!force && tokensBefore <= this.budget.pruneAt) return;
    let protectFrom = messages.length;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (this.state.isRunStart(messages[index]!)) {
        protectFrom = index;
        break;
      }
    }
    const result = await this.compact(force ? "manual" : "threshold", {
      messages,
      protectFrom,
      tokensBefore,
      force,
      allowSplitTurn: true
    });
    if (result)
      agent.state.messages = incoming
        ? result.filter((item) => item !== incoming)
        : result;
  }

  /** Between two turns of one run: keeps a long run under the working budget. */
  readonly prepareNextTurn = async (
    context: PrepareNextTurnContext
  ): Promise<AgentLoopTurnUpdate | undefined> => {
    if (!this.options.policy.settings.enabled) return undefined;
    const messages = context.context.messages;
    const tokensBefore = this.tokens(messages);
    if (tokensBefore <= this.budget.working) return undefined;
    const result = await this.compact("run_limit", {
      messages,
      protectFrom: this.protectCurrentRun(messages),
      tokensBefore,
      force: false,
      allowSplitTurn: true
    });
    if (!result) {
      if (tokensBefore > this.budget.hardLimit)
        throw new Error(
          "本轮读取内容超过模型上下文容量，压缩未能释放足够空间。请缩小处理范围。"
        );
      return undefined;
    }
    this.options.agent.state.messages = result;
    if (this.tokens(result) > this.budget.hardLimit)
      throw new Error("保留的任务原文仍超过模型上下文容量，请缩小处理范围。");
    return { context: { ...context.context, messages: result.slice() } };
  };

  /** A provider rejection this run can still recover from by compacting. */
  matchesOverflow(message: AssistantMessage): boolean {
    return (
      this.options.policy.settings.enabled &&
      !this.overflowRecovered &&
      message.stopReason === "error" &&
      message.provider === this.options.model.provider &&
      message.model === this.options.model.id &&
      isContextOverflow(message, this.options.model.contextWindow)
    );
  }

  /**
   * After the provider rejected the request as too long: compacts once so the
   * retry coordinator can continue. The failed message is already removed.
   */
  async recoverOverflow(failed: AssistantMessage): Promise<boolean> {
    const { agent } = this.options;
    if (!this.matchesOverflow(failed)) return false;
    this.overflowRecovered = true;
    const messages = agent.state.messages;
    const result = await this.compact("overflow", {
      messages,
      protectFrom: this.protectCurrentRun(messages),
      tokensBefore: Math.max(this.tokens(messages), this.budget.hardLimit),
      force: true,
      allowSplitTurn: true
    });
    if (!result) return false;
    agent.state.messages = result;
    return true;
  }

  assertFits(incoming: UserMessage): void {
    const tokens = this.tokens([
      ...this.options.agent.state.messages,
      incoming
    ]);
    if (tokens > this.budget.hardLimit) {
      throw new Error(
        "当前任务原文、技能或附件仍超过模型上下文容量，请缩小本次处理范围或选择更大窗口的模型。原文已保留。"
      );
    }
  }

  /** Run after the final answer, before the terminal event is persisted. */
  async afterRun(): Promise<void> {
    if (!this.options.policy.settings.enabled) return;
    const messages = this.options.agent.state.messages;
    const tokensBefore = this.tokens(messages);
    if (tokensBefore <= this.budget.summarizeAt) return;
    const result = await this.compact("idle", {
      messages,
      protectFrom: this.protectCurrentRun(messages),
      tokensBefore,
      force: false,
      allowSplitTurn: true
    });
    if (result) this.options.agent.state.messages = result;
  }

  private tokens(messages: readonly AgentMessage[]): number {
    return estimateContextTokens(
      messages,
      this.options.fixedTokens,
      this.state.compactedAt,
      this.options.model
    ).tokens;
  }

  private protectCurrentRun(messages: readonly AgentMessage[]): number {
    const index = this.runStart ? messages.indexOf(this.runStart) : -1;
    return index >= 0 ? index : messages.length;
  }

  private async compact(
    reason: AgentContextCompactionReason,
    input: {
      messages: readonly AgentMessage[];
      protectFrom: number;
      tokensBefore: number;
      force: boolean;
      allowSplitTurn: boolean;
    }
  ): Promise<AgentMessage[] | undefined> {
    const { policy, summaryModel } = this.options;
    let started = false;
    this.options.setBusy(true);
    try {
      const system = getCurrentSystemMessage(input.messages);
      const conversation = input.messages.filter(
        (message) => message.role !== "system"
      );
      const staged = this.state.fork(conversation);
      const { agent } = this.options;
      const result = await compactMessages({
        ...input,
        messages: conversation,
        protectFrom: input.messages
          .slice(0, input.protectFrom)
          .filter((message) => message.role !== "system").length,
        state: staged,
        policy,
        budget: this.budget,
        reason,
        fixedTokens: this.options.fixedTokens,
        summaryModel,
        ...(policy.inPlaceSummary &&
        summaryModel.model.provider === this.options.model.provider &&
        summaryModel.model.id === this.options.model.id
          ? {
              inPlace: {
                systemPrompt: agent.state.systemPrompt,
                tools: agent.state.tools,
                sessionId: agent.sessionId
              }
            }
          : {}),
        signal: this.options.signal,
        onSummaryStart: () => {
          started = true;
          this.emitCompaction({
            phase: "started",
            reason,
            level: "summary",
            tokensBefore: input.tokensBefore
          });
        },
        onUsage: (usage) => this.emitUsage(usage)
      });
      if (!result) {
        if (input.force) {
          this.emitCompaction({
            phase: "completed",
            reason,
            level: "prune",
            tokensBefore: input.tokensBefore,
            tokensAfter: input.tokensBefore
          });
        }
        return undefined;
      }
      this.options.signal.throwIfAborted();
      if (staged.consumeFixedContextRefresh()) {
        if (this.runStart?.role === "user" && this.options.refreshUserContent) {
          this.runStart.content = this.options.refreshUserContent();
        } else staged.markFixedContextStale();
      }
      result.outcome.tokensAfter =
        this.options.fixedTokens + estimateMessagesTokens(result.messages);
      this.state.adopt(staged, result.messages);
      this.state.compactedAt = Date.now();
      const originals = new Map(
        input.messages.flatMap((message) =>
          message.role === "toolResult"
            ? [[message.toolCallId, message] as const]
            : []
        )
      );
      const removed = result.messages.flatMap((message) =>
        message.role === "toolResult" &&
        originals.get(message.toolCallId) !== message
          ? [message.toolCallId]
          : []
      );
      this.options.notifyCompacted(
        result.outcome.level === "summary" ? undefined : removed
      );
      this.emitOutcome(result.outcome);
      return [...(system ? [system] : []), ...result.messages];
    } catch (error: unknown) {
      if (this.options.signal.aborted) throw error;
      this.emitCompaction({
        phase: "failed",
        reason,
        ...(started ? { level: "summary" as const } : {}),
        tokensBefore: input.tokensBefore,
        errorMessage: errorMessage(error)
      });
      return undefined;
    } finally {
      this.options.setBusy(false);
    }
  }

  private emitOutcome(outcome: ContextCompactionOutcome): void {
    this.emitCompaction({
      phase: "completed",
      reason: outcome.reason,
      level: outcome.level,
      tokensBefore: outcome.tokensBefore,
      tokensAfter: outcome.tokensAfter,
      ...(outcome.checkpoint ? { checkpoint: outcome.checkpoint } : {})
    });
  }

  private emitCompaction(
    payload: Omit<
      Extract<
        AgentRuntimeEvent,
        { type: "agent.context_compaction" }
      >["payload"],
      "messageId" | "runtime"
    >
  ): void {
    const { runId, sessionId, messageId, runtime } = this.options;
    this.options.emit({
      type: "agent.context_compaction",
      runId,
      sessionId,
      payload: { ...payload, messageId, runtime }
    });
  }

  private emitUsage({ usage, runtime, status }: SummaryUsage): void {
    const normalized = normalizeUsage(usage);
    if (!normalized) return;
    const { runId, sessionId, messageId } = this.options;
    const turnId = `${runId}:compaction:${++this.sequence}`;
    this.options.emit({
      type: "agent.usage_observed",
      runId,
      sessionId,
      payload: {
        observationId: `${turnId}:attempt:1`,
        observedAt: new Date().toISOString(),
        messageId,
        turnId,
        attempt: 1,
        status,
        hadToolCall: false,
        usage: normalized,
        runtime
      }
    });
  }
}
