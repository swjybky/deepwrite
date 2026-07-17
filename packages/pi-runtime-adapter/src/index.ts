import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  type AssistantMessage,
  type Usage
} from "@earendil-works/pi-ai";
import type {
  AgentRuntimeRef,
  AgentUsage,
  ThinkingLevel,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";

export interface AgentRunInput {
  runId: string;
  sessionId: string;
  prompt: string;
  thinkingLevel?: ThinkingLevel;
  workspaceContext?: WorkspaceRuntimeContext;
  signal?: AbortSignal;
}

export type AgentRuntimeEvent =
  | {
      type: "agent.delta";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        delta: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.thinking_delta";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        delta: string;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.completed";
      runId: string;
      sessionId: string;
      payload: {
        messageId: string;
        content: string;
        thinking?: string;
        stopReason?: string;
        usage?: AgentUsage;
        runtime: AgentRuntimeRef;
      };
    }
  | {
      type: "agent.error";
      runId: string;
      sessionId: string;
      payload: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
        runtime?: AgentRuntimeRef;
      };
    };

export interface AgentRuntime {
  describe(): AgentRuntimeRef;
  start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}

export interface PiRuntimeAdapterOptions {
  requestTimeoutMs?: number;
  tokensPerSecond?: number;
  systemPrompt?: string;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      }
    };
  }
}

const DEEPWRITE_FAUX_RUNTIME: AgentRuntimeRef = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux"
};

export class PiAgentRuntimeAdapter implements AgentRuntime {
  private readonly requestTimeoutMs: number;
  private readonly tokensPerSecond: number;
  private readonly systemPrompt: string;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
    this.tokensPerSecond = options.tokensPerSecond ?? 90;
    this.systemPrompt = options.systemPrompt ?? buildDeepWriteSystemPrompt();
  }

  describe(): AgentRuntimeRef {
    return { ...DEEPWRITE_FAUX_RUNTIME };
  }

  async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const queue = new AsyncEventQueue<AgentRuntimeEvent>();
    const runtime = this.describe();
    const messageId = `${input.runId}_assistant`;
    const models = createModels();
    const faux = fauxProvider({
      api: "deepwrite-faux",
      provider: runtime.provider,
      models: [
        {
          id: runtime.model,
          name: "DeepWrite Local Writing Faux",
          reasoning: true,
          input: ["text"]
        }
      ],
      tokensPerSecond: this.tokensPerSecond,
      tokenSize: { min: 2, max: 4 }
    });
    models.setProvider(faux.provider);
    const model = faux.getModel(runtime.model);
    if (!model) {
      throw new Error("DeepWrite faux model is unavailable.");
    }

    const effectiveThinkingLevel = input.thinkingLevel ?? "medium";
    faux.setResponses([
      fauxAssistantMessage(
        effectiveThinkingLevel === "off"
          ? [fauxText(buildLocalWritingResponse(input))]
          : [
              fauxThinking(buildLocalThinking(input)),
              fauxText(buildLocalWritingResponse(input))
            ]
      )
    ]);

    const agent = new Agent({
      initialState: {
        systemPrompt: this.systemPrompt,
        model,
        thinkingLevel: input.thinkingLevel ?? "medium",
        tools: []
      },
      streamFn: models.streamSimple.bind(models),
      toolExecution: "sequential"
    });

    let settled = false;
    let terminalEmitted = false;
    let timeout: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const emit = (event: AgentRuntimeEvent): void => {
      const terminal = event.type === "agent.completed" || event.type === "agent.error";
      if (terminalEmitted) {
        return;
      }
      if (terminal) {
        terminalEmitted = true;
      }
      queue.push(event);
    };

    const unsubscribe = agent.subscribe((event) => {
      for (const runtimeEvent of toRuntimeEvents(event, input, runtime, messageId)) {
        emit(runtimeEvent);
      }
    });

    const cleanup = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (abortListener && input.signal) {
        input.signal.removeEventListener("abort", abortListener);
      }
      unsubscribe();
      queue.close();
    };

    abortListener = () => {
      emit({
        type: "agent.error",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          code: "pi_agent.aborted",
          message: "智能体运行已中止。",
          runtime
        }
      });
      agent.abort();
      cleanup();
    };
    if (input.signal?.aborted) {
      abortListener();
    } else {
      input.signal?.addEventListener("abort", abortListener, { once: true });
    }

    if (!settled && this.requestTimeoutMs > 0) {
      timeout = setTimeout(() => {
        emit({
          type: "agent.error",
          runId: input.runId,
          sessionId: input.sessionId,
          payload: {
            code: "pi_agent.prompt_timeout",
            message: `本地智能体响应超时（${this.requestTimeoutMs}ms）。`,
            runtime
          }
        });
        agent.abort();
        cleanup();
      }, this.requestTimeoutMs);
      timeout.unref();
    }

    if (!settled) {
      void agent
        .prompt({
          role: "user",
          content: buildRuntimeUserPrompt(input),
          timestamp: Date.now()
        })
        .catch((error: unknown) => {
          emit({
            type: "agent.error",
            runId: input.runId,
            sessionId: input.sessionId,
            payload: {
              code: "pi_agent.prompt_failed",
              message: error instanceof Error ? error.message : "本地智能体请求失败。",
              details: { kind: error instanceof Error ? error.name : "unknown" },
              runtime
            }
          });
        })
        .finally(() => {
          if (!terminalEmitted) {
            emit({
              type: "agent.error",
              runId: input.runId,
              sessionId: input.sessionId,
              payload: {
                code: "pi_agent.missing_terminal_event",
                message: "智能体运行结束，但没有收到完成事件。",
                runtime
              }
            });
          }
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
    }
  }
}

function toRuntimeEvents(
  event: AgentEvent,
  input: AgentRunInput,
  runtime: AgentRuntimeRef,
  messageId: string
): AgentRuntimeEvent[] {
  if (event.type === "message_update" && isAssistantMessage(event.message)) {
    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "text_delta") {
      return [{
        type: "agent.delta",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: { messageId, delta: streamEvent.delta, runtime }
      }];
    }
    if (streamEvent.type === "thinking_delta") {
      return [{
        type: "agent.thinking_delta",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: { messageId, delta: streamEvent.delta, runtime }
      }];
    }
  }

  if (event.type === "message_end" && isAssistantMessage(event.message)) {
    if (
      event.message.stopReason === "error" ||
      event.message.stopReason === "aborted" ||
      event.message.errorMessage
    ) {
      return [{
        type: "agent.error",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          code:
            event.message.stopReason === "aborted"
              ? "pi_agent.aborted"
              : "pi_agent.provider_error",
          message:
            event.message.errorMessage ??
            (event.message.stopReason === "aborted"
              ? "智能体运行已中止。"
              : "模型返回错误终态。"),
          runtime
        }
      }];
    }

    const thinking = readAssistantThinking(event.message);
    return [{
      type: "agent.completed",
      runId: input.runId,
      sessionId: input.sessionId,
      payload: {
        messageId,
        content: readAssistantText(event.message),
        ...(thinking ? { thinking } : {}),
        ...(event.message.stopReason ? { stopReason: event.message.stopReason } : {}),
        usage: normalizeUsage(event.message.usage),
        runtime
      }
    }];
  }

  return [];
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return typeof message === "object" && message !== null && message.role === "assistant";
}

function readAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}

function readAssistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "thinking")
    .map((item) => item.thinking)
    .join("\n\n");
}

function normalizeUsage(usage: Usage): AgentUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.totalTokens
  };
}

function buildDeepWriteSystemPrompt(): string {
  return [
    "你是 DeepWrite 的本地创作协作智能体。",
    "用户当前明确提出的要求优先；当前实时文稿是本轮工作对象，不得凭空推翻已提供的作品事实。",
    "技能是写作方法，不是作品事实；素材是参考信息，不能自动升级为作品设定。",
    "只能声称使用了本轮上下文快照中实际提供或显式附加的内容。",
    "本阶段没有写回、保存、文件、Shell、HTTP 或浏览器工具，不得声称已经修改或保存右侧文稿。",
    "回复使用结构清晰的中文纯文本，并明确区分建议、示例和已确认事实。"
  ].join("\n");
}

function buildRuntimeUserPrompt(input: AgentRunInput): string {
  const active = input.workspaceContext?.activeResource;
  const skills = input.workspaceContext?.attachedSkills ?? [];
  const materials = input.workspaceContext?.attachedMaterials ?? [];
  const lines = [
    "【本轮运行上下文，不写入会话历史】",
    `sessionId: ${input.sessionId}`,
    `runId: ${input.runId}`,
    active
      ? `当前资源: ${active.title} (${active.domain}${active.format ? ` / ${active.format}` : ""})`
      : "当前资源: 未提供",
    active ? `资源路径: ${active.path.join(" / ")}` : "",
    active ? `实时内容:\n${active.content}` : "",
    skills.length ? `显式附加技能:\n${skills.map((item) => `- ${item.title}: ${item.content}`).join("\n")}` : "显式附加技能: 无",
    materials.length ? `显式附加素材:\n${materials.map((item) => `- ${item.title}: ${item.content}`).join("\n")}` : "显式附加素材: 无",
    "",
    "【用户消息】",
    input.prompt
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function buildLocalThinking(input: AgentRunInput): string {
  const title = input.workspaceContext?.activeResource?.title ?? "未命名资源";
  return `正在读取发送瞬间的创作上下文快照，确认当前工作对象为《${title}》，并区分用户要求、作品事实与参考信息。`;
}

function buildLocalWritingResponse(input: AgentRunInput): string {
  const active = input.workspaceContext?.activeResource;
  const request = input.prompt.replace(/\s+/g, " ").slice(0, 220);
  const activeLabel = active ? `《${active.title}》` : "当前创作资源";
  const contentLength = active?.content.replace(/\s/g, "").length ?? 0;
  const snapshotLabel = active?.truncated
    ? `${activeLabel} 前 ${active.content.length.toLocaleString("zh-CN")} 个字符的上下文快照（原文 ${active.originalLength?.toLocaleString("zh-CN") ?? "超过限制"} 个字符）`
    : `${activeLabel} 上下文快照（约 ${contentLength} 字）`;

  return [
    "本地 Faux 流式链路已就绪。",
    "",
    `我已读取本轮发送时的 ${snapshotLabel}，并收到请求：${request}`,
    "",
    "本轮可验证结果",
    "",
    "- 回复由 pi-agent-core 驱动，并通过 Agent Utility 流式返回。",
    "- Thinking 与回复内容使用独立事件，Renderer 会绑定到同一条助手消息。",
    "- 当前是无需 API Key 的本地 Faux 模型，用于验证客户端链路和上下文边界。",
    "- 本轮没有调用写入工具，也没有修改或保存右侧文稿。",
    "",
    "下一切片接入真实模型配置后，可以在保持同一协议的前提下生成正式续写、润色和一致性检查结果。"
  ].join("\n");
}
