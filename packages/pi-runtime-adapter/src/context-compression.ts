import {
  BACKGROUND_CONTEXT,
  compact,
  createCompactionSummaryMessage,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  shouldCompact,
  withAbortSignal,
  type Agent,
  type AgentMessage,
  type CompactionEntry,
  type CompactionSettings,
  type CompactionSummaryMessage,
  type Entry,
  type MessageEntry,
  type StreamFn,
  type ThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  isContextOverflow,
  type Api,
  type AssistantMessage,
  type Model,
  type Models
} from "@earendil-works/pi-ai";

/** Which condition asked for a compaction. */
export type ContextCompactionTrigger = "threshold" | "overflow";

export interface ContextCompactedInfo {
  trigger: ContextCompactionTrigger;
  /** Context tokens before compaction (provider usage when available). */
  tokensBefore: number;
  /** Context tokens after compaction (character-heuristic estimate). */
  tokensAfter: number;
  /** How many raw messages were folded into the summary. */
  summarizedMessages: number;
}

export interface ContextCompressionConfig {
  model: Model<Api>;
  /**
   * Stream function used for the summarization request. Pass the spawn stream so
   * tool-stream interception and web-search injection stay out of the way; the
   * provider compatibility and API-key handling are preserved either way.
   */
  streamFn: StreamFn;
  enabled: boolean;
  /** Compaction triggers once usage passes this share of the context window. */
  thresholdPercent: number;
  thinkingLevel: ThinkingLevel;
  onCompacted?: (info: ContextCompactedInfo) => void;
}

/**
 * Summary prefix currently shadowing the head of the agent transcript.
 *
 * `transformContext` only shapes one model request: its return value never flows
 * back into `agent.state.messages`, and the next call receives the raw
 * transcript again. The prefix therefore has to be carried here between calls.
 */
interface CachedPrefix {
  /** Number of leading raw messages the summary replaces. */
  summarizedCount: number;
  /** Identity sentinel for `messages[summarizedCount - 1]`. */
  lastSummarizedMessage: AgentMessage | undefined;
  /** The summary message substituted for the prefix. */
  summaryMessage: CompactionSummaryMessage;
  /** Summary text, reused as `previousSummary` so later runs update it. */
  summary: string;
  tokensBefore: number;
  /** Raw transcript length when this prefix was produced (debounce input). */
  compactedAtLength: number;
}

/** Minimum reserve so a summarization output budget survives at any window size. */
const MIN_RESERVE_TOKENS = 1_024;
/** Lower bound for the retained tail when the window is small. */
const MIN_KEEP_RECENT_TOKENS = 2_000;
/**
 * New transcript messages required before another threshold compaction may run.
 * Right after a compaction the retained tail still carries pre-compaction usage,
 * so `estimateContextTokens` over-reports until a fresh assistant message lands.
 */
const MIN_MESSAGES_BETWEEN_COMPACTIONS = 2;

/**
 * Build a `Models` registry that routes `completeSimple` back into the run's own
 * stream function, so summarization uses the exact provider configuration
 * (endpoint, API key, compatibility shims) the conversation already uses.
 */
export function createCompactionModels(
  model: Model<Api>,
  streamFn: StreamFn
): Models {
  const models = createModels();
  const stream = ((
    requestModel: Model<Api>,
    context: Parameters<StreamFn>[1],
    options?: Parameters<StreamFn>[2]
  ) => streamFn(requestModel, context, options)) as never;
  models.setProvider(
    createProvider({
      // Must match `model.provider`, otherwise Models routes to an unknown provider.
      id: model.provider,
      name: model.provider,
      auth: {
        apiKey: {
          name: "DeepWrite runtime",
          resolve: async () => ({ auth: {} })
        }
      },
      models: [model],
      api: { stream, streamSimple: stream }
    })
  );
  return models;
}

/**
 * Owns automatic context compaction for one conversation agent.
 *
 * Compaction never touches `agent.state.messages`: the transcript the user sees,
 * the persistence layer, sub-agent snapshots, and retry rollback all keep
 * operating on the untouched original. Only the message array handed to the
 * model is rewritten.
 */
export class ContextCompressionController {
  private config: ContextCompressionConfig | undefined;
  private models: Models | undefined;
  private prefix: CachedPrefix | undefined;
  private inFlight: Promise<AgentMessage[] | undefined> | undefined;
  private overflowRecoveryUsed = false;

  constructor(private readonly agent: Agent) {}

  /** Re-arm for one run. Called on every `start()`, including cached agents. */
  configure(config: ContextCompressionConfig | undefined): void {
    this.config = config;
    this.prefix = undefined;
    this.inFlight = undefined;
    this.overflowRecoveryUsed = false;
    if (!config || !isUsableContextWindow(config.model)) {
      this.models = undefined;
      return;
    }
    // Rebuilt per run: a model switch changes the provider routing key.
    this.models = createCompactionModels(config.model, config.streamFn);
  }

  /**
   * Bound to `agent.transformContext`. The agent loop calls this before every
   * model request, so a compaction produced here applies to the request in
   * flight. Must never throw: a failed compaction degrades to the raw transcript.
   */
  readonly transformContext = async (
    messages: AgentMessage[],
    signal?: AbortSignal
  ): Promise<AgentMessage[]> => {
    try {
      const config = this.config;
      if (
        !config?.enabled ||
        !this.models ||
        !isUsableContextWindow(config.model)
      ) {
        return messages;
      }

      const prefix = this.validPrefix(messages);
      const projection = project(messages, prefix);

      if (
        prefix &&
        messages.length - prefix.compactedAtLength <
          MIN_MESSAGES_BETWEEN_COMPACTIONS
      ) {
        return projection;
      }

      const settings = settingsFor(config);
      if (!settings) return projection;

      if (
        !shouldCompact(
          estimateContextTokens(projection).tokens,
          config.model.contextWindow,
          settings
        )
      ) {
        return projection;
      }

      const compacted = await this.runExclusive(() =>
        this.compactTranscript(messages, prefix, settings, "threshold", signal)
      );
      return compacted ?? projection;
    } catch {
      return messages;
    }
  };

  /**
   * Compact now, at the user's request, regardless of the threshold.
   *
   * The automatic path only fires past a share of the window and skips while
   * the previous compaction is still fresh; neither gate applies here — the
   * user asked, so the only reasons to refuse are that compaction is switched
   * off, the model has no usable window, or one is already running.
   */
  async compactNow(signal?: AbortSignal): Promise<{
    compacted: boolean;
    reason?: string;
    tokensBefore?: number;
    tokensAfter?: number;
  }> {
    const config = this.config;
    if (!config?.enabled) {
      return { compacted: false, reason: "自动压缩已关闭。" };
    }
    if (!this.models || !isUsableContextWindow(config.model)) {
      return { compacted: false, reason: "当前模型未配置上下文窗口。" };
    }
    if (this.inFlight) {
      return { compacted: false, reason: "已有一次压缩正在进行。" };
    }
    const settings = settingsFor(config);
    if (!settings) {
      return { compacted: false, reason: "上下文窗口过小，无法压缩。" };
    }

    const messages = this.agent.state.messages;
    const prefix = this.validPrefix(messages);
    const before = estimateContextTokens(project(messages, prefix)).tokens;
    const compacted = await this.runExclusive(() =>
      this.compactTranscript(messages, prefix, settings, "threshold", signal)
    );
    if (!compacted) {
      return { compacted: false, reason: "没有可压缩的历史。" };
    }
    return {
      compacted: true,
      tokensBefore: before,
      tokensAfter: estimateContextTokens(project(compacted, this.prefix))
        .tokens
    };
  }

  /** Whether a terminal assistant error is a context overflow worth recovering. */
  canRecoverOverflow(message: AssistantMessage): boolean {
    const config = this.config;
    return (
      Boolean(config?.enabled) &&
      Boolean(this.models) &&
      Boolean(config && isUsableContextWindow(config.model)) &&
      !this.overflowRecoveryUsed &&
      message.stopReason === "error" &&
      isContextOverflow(message)
    );
  }

  /**
   * Compact so an overflowed request can be retried. Returns false when recovery
   * is unavailable, which leaves the error as terminal exactly as before.
   */
  async recoverFromOverflow(signal?: AbortSignal): Promise<boolean> {
    const config = this.config;
    if (
      !config?.enabled ||
      !this.models ||
      !isUsableContextWindow(config.model)
    ) {
      return false;
    }
    // One shot per run: a second overflow after a successful compaction is real.
    if (this.overflowRecoveryUsed) return false;
    this.overflowRecoveryUsed = true;

    const messages = this.agent.state.messages;
    const settings = settingsFor(config);
    if (!settings) return false;

    const prefix = this.validPrefix(messages);
    const compacted = await this.runExclusive(() =>
      this.compactTranscript(messages, prefix, settings, "overflow", signal)
    );
    return compacted !== undefined;
  }

  /** Drop the cached prefix when the transcript no longer matches it. */
  private validPrefix(messages: AgentMessage[]): CachedPrefix | undefined {
    const prefix = this.prefix;
    if (!prefix) return undefined;
    if (
      prefix.summarizedCount <= 0 ||
      messages.length < prefix.summarizedCount ||
      messages[prefix.summarizedCount - 1] !== prefix.lastSummarizedMessage
    ) {
      this.prefix = undefined;
      return undefined;
    }
    return prefix;
  }

  /** Serialize compaction so concurrent callers cannot summarize the same head. */
  private runExclusive(
    task: () => Promise<AgentMessage[] | undefined>
  ): Promise<AgentMessage[] | undefined> {
    if (this.inFlight) return Promise.resolve(undefined);
    const running = task().finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = running;
    return running;
  }

  /**
   * Summarize the head of the transcript and return the replacement array.
   * Returns undefined whenever compaction cannot be completed, leaving callers
   * on their existing projection.
   */
  private async compactTranscript(
    messages: AgentMessage[],
    prefix: CachedPrefix | undefined,
    settings: CompactionSettings,
    trigger: ContextCompactionTrigger,
    signal?: AbortSignal
  ): Promise<AgentMessage[] | undefined> {
    const config = this.config;
    const models = this.models;
    if (!config || !models) return undefined;

    const startIndex = prefix?.summarizedCount ?? 0;
    const entries = buildShadowEntries(messages, startIndex, prefix);
    const prepared = prepareCompaction(entries, settings);
    if (!prepared.ok || !prepared.value) return undefined;

    const preparation = prepared.value;
    if (
      preparation.messagesToSummarize.length === 0 &&
      preparation.turnPrefixMessages.length === 0
    ) {
      return undefined;
    }

    const context = withAbortSignal(
      signal ?? new AbortController().signal,
      BACKGROUND_CONTEXT
    );
    const result = await compact(
      preparation,
      models,
      config.model,
      undefined,
      config.thinkingLevel,
      undefined,
      undefined,
      context
    );
    if (!result.ok) return undefined;

    const { summary, tokensBefore, retainedTail } = result.value;

    // `retainedTail` is a suffix of the raw transcript. Deriving the boundary
    // from lengths avoids mis-locating a message that appears more than once.
    const summarizedCount = messages.length - retainedTail.length;
    if (summarizedCount < startIndex) return undefined;
    if (
      retainedTail.length > 0 &&
      messages[summarizedCount] !== retainedTail[0]
    ) {
      return undefined;
    }

    const summaryMessage = createCompactionSummaryMessage(
      summary,
      tokensBefore,
      Date.now()
    );
    // Provider usage is stale inside the retained tail, so estimate the result
    // from characters instead of reusing `estimateContextTokens`.
    const tokensAfter =
      estimateTokens(summaryMessage) + estimateTokensOf(retainedTail);

    this.prefix = {
      summarizedCount,
      lastSummarizedMessage: messages[summarizedCount - 1],
      summaryMessage,
      summary,
      tokensBefore,
      compactedAtLength: messages.length
    };
    config.onCompacted?.({
      trigger,
      tokensBefore,
      tokensAfter,
      summarizedMessages: summarizedCount - startIndex
    });

    return [summaryMessage, ...messages.slice(summarizedCount)];
  }
}

function isUsableContextWindow(model: Model<Api>): boolean {
  return Number.isFinite(model.contextWindow) && model.contextWindow > 0;
}

function project(
  messages: AgentMessage[],
  prefix: CachedPrefix | undefined
): AgentMessage[] {
  if (!prefix) return messages;
  return [prefix.summaryMessage, ...messages.slice(prefix.summarizedCount)];
}

function estimateTokensOf(messages: readonly AgentMessage[]): number {
  let total = 0;
  for (const message of messages) total += estimateTokens(message);
  return total;
}

/**
 * Derive the trigger point from the user's threshold while keeping the retained
 * tail proportional on small windows.
 */
function settingsFor(
  config: ContextCompressionConfig
): CompactionSettings | undefined {
  const contextWindow = config.model.contextWindow;
  const reserveTokens = Math.max(
    MIN_RESERVE_TOKENS,
    Math.round(contextWindow * (1 - config.thresholdPercent / 100))
  );
  if (reserveTokens >= contextWindow) return undefined;

  const triggerBudget = contextWindow - reserveTokens;
  const keepRecentTokens = Math.min(
    DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
    Math.max(MIN_KEEP_RECENT_TOKENS, Math.floor(triggerBudget / 2))
  );
  return { enabled: true, reserveTokens, keepRecentTokens };
}

/**
 * Map the tail of the transcript onto session entries.
 *
 * The already-summarized head is represented by a single compaction entry with
 * an empty `retainedTail`: those messages have left the array for good, so the
 * framework folds the new summary into the previous one instead of restating it.
 */
function buildShadowEntries(
  messages: readonly AgentMessage[],
  startIndex: number,
  prefix: CachedPrefix | undefined
): Entry[] {
  const entries: Entry[] = [];
  let parentId: string | null = null;
  let seq = 0;

  if (prefix && startIndex > 0) {
    const summaryEntry: CompactionEntry = {
      id: "shadow:compaction",
      parentId: null,
      seq: seq++,
      timestamp: prefix.summaryMessage.timestamp,
      type: "compaction",
      summary: prefix.summary,
      retainedTail: [],
      tokensBefore: prefix.tokensBefore,
      fromHook: true
    };
    entries.push(summaryEntry);
    parentId = summaryEntry.id;
  }

  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index]!;
    const entry: MessageEntry = {
      id: `shadow:${index}`,
      parentId,
      seq: seq++,
      timestamp: messageTimestamp(message),
      type: "message",
      message
    };
    entries.push(entry);
    parentId = entry.id;
  }
  return entries;
}

function messageTimestamp(message: AgentMessage): number {
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
