import {
  ModelConnectionTestResultSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  type CommandResult,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import {
  PiAgentRuntimeAdapter,
  type AgentRuntimeEvent
} from "@deepwrite/pi-runtime-adapter";
import { createId, nowIso } from "@deepwrite/shared";
import { bootUtility } from "./runtime";

const runtime = new PiAgentRuntimeAdapter();
const activeStreams = new Set<Promise<void>>();
const terminalRuns = new Set<string>();
const activeSessionRuns = new Map<string, string>();
const abortControllers = new Map<string, AbortController>();
const MAX_ACTIVE_RUNS = 4;

function toEventEnvelope(
  event: AgentRuntimeEvent,
  correlationId: string
): SystemEventEnvelope {
  const context = {
    correlationId,
    sessionId: event.sessionId,
    runId: event.runId
  };

  if (event.type === "agent.delta") {
    return createEnvelope(
      "agent.message_delta",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        messageId: event.payload.messageId,
        delta: event.payload.delta,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.thinking_delta") {
    return createEnvelope(
      "agent.thinking_delta",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        messageId: event.payload.messageId,
        delta: event.payload.delta,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.completed") {
    return createEnvelope(
      "agent.message_completed",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        messageId: event.payload.messageId,
        role: "assistant" as const,
        content: event.payload.content,
        runtime: event.payload.runtime,
        ...(event.payload.thinking ? { thinking: event.payload.thinking } : {}),
        ...(event.payload.stopReason ? { stopReason: event.payload.stopReason } : {}),
        ...(event.payload.usage ? { usage: event.payload.usage } : {})
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.tool_requested") {
    return createEnvelope(
      "tool.call_requested",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        toolName: event.payload.toolName,
        args: event.payload.args,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.tool_stream") {
    return createEnvelope(
      "tool.call_stream",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        streamId: event.payload.streamId,
        phase: event.payload.phase,
        argumentsDelta: event.payload.argumentsDelta,
        runtime: event.payload.runtime,
        ...(event.payload.toolCallId ? { toolCallId: event.payload.toolCallId } : {}),
        ...(event.payload.toolName ? { toolName: event.payload.toolName } : {}),
        ...(event.payload.args !== undefined ? { args: event.payload.args } : {})
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.tool_completed") {
    return createEnvelope(
      "tool.execution_completed",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        toolName: event.payload.toolName,
        resultSummary: event.payload.resultSummary,
        isError: event.payload.isError,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "workspace.editor_mutation") {
    return createEnvelope(
      "workspace.editor_mutation",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        workspaceId: event.payload.workspaceId,
        stageId: event.payload.stageId,
        text: event.payload.text,
        baseRevision: event.payload.baseRevision,
        summary: event.payload.summary,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "workspace.stage_selection") {
    return createEnvelope(
      "workspace.stage_selection",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        workspaceId: event.payload.workspaceId,
        stageId: event.payload.stageId,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  return createEnvelope(
    "agent.error",
    {
      sessionId: event.sessionId,
      runId: event.runId,
      code: event.payload.code,
      message: event.payload.message,
      ...(event.payload.details ? { details: event.payload.details } : {}),
      ...(event.payload.runtime ? { runtime: event.payload.runtime } : {})
    },
    { id: createId("evt"), context }
  );
}

function streamPrompt(
  input: Parameters<PiAgentRuntimeAdapter["start"]>[0],
  correlationId: string,
  emitEvent: (event: SystemEventEnvelope) => void,
  controller: AbortController
): void {
  const stream = (async () => {
    try {
      for await (const event of runtime.start(input)) {
        if (terminalRuns.has(input.runId)) {
          continue;
        }
        emitEvent(toEventEnvelope(event, correlationId));
        if (event.type === "agent.completed" || event.type === "agent.error") {
          terminalRuns.add(input.runId);
        }
      }
    } catch (error: unknown) {
      if (!terminalRuns.has(input.runId)) {
        terminalRuns.add(input.runId);
        emitEvent(
          createEnvelope(
            "agent.error",
            {
              sessionId: input.sessionId,
              runId: input.runId,
              code: "agent.stream_failed",
              message: error instanceof Error ? error.message : "Agent stream failed.",
              details: { kind: error instanceof Error ? error.name : "unknown" },
              runtime: runtime.describe(input.runtimeConfig)
            },
            {
              id: createId("evt"),
              context: {
                correlationId,
                sessionId: input.sessionId,
                runId: input.runId
              }
            }
          )
        );
      }
    } finally {
      terminalRuns.delete(input.runId);
      abortControllers.delete(input.runId);
      if (activeSessionRuns.get(input.sessionId) === input.runId) {
        activeSessionRuns.delete(input.sessionId);
      }
    }
  })();

  activeStreams.add(stream);
  void stream.then(
    () => activeStreams.delete(stream),
    () => activeStreams.delete(stream)
  );
}

bootUtility("agent", {
  mode: "pi-agent-provider",
  async commandHandler(command, emitEvent): Promise<CommandResult> {
    if (command.type === "agent.model_test") {
      const result = ModelConnectionTestResultSchema.parse(
        await runtime.testConnection(command.payload.runtimeConfig)
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: result
      };
    }

    if (command.type === "agent.abort") {
      const activeRunId = activeSessionRuns.get(command.payload.sessionId);
      const controller = abortControllers.get(command.payload.runId);
      if (activeRunId !== command.payload.runId || !controller) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "agent.run_not_active",
            message: "要停止的智能体运行已结束或不存在。"
          }
        };
      }
      controller.abort();
      return {
        status: "accepted",
        requestId: command.id,
        payload: SessionAbortAcceptedPayloadSchema.parse({
          sessionId: command.payload.sessionId,
          runId: command.payload.runId,
          abortedAt: nowIso()
        })
      };
    }

    if (command.type !== "agent.prompt") {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent.unsupported_command",
          message: `Agent utility does not support ${command.type}.`
        }
      };
    }

    const activeRunId = activeSessionRuns.get(command.payload.sessionId);
    if (activeRunId) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent.session_busy",
          message: "当前会话已有一轮智能体运行尚未结束。",
          details: { activeRunId }
        }
      };
    }
    if (activeStreams.size >= MAX_ACTIVE_RUNS) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent.capacity_reached",
          message: "本地智能体并发运行数量已达到上限。"
        }
      };
    }

    const runId = createId("run");
    const correlationId = command.context.correlationId;
    const runtimeRef = runtime.describe(command.payload.runtimeConfig);
    const accepted = SessionPromptAcceptedPayloadSchema.parse({
      sessionId: command.payload.sessionId,
      runId,
      acceptedAt: nowIso(),
      runtime: runtimeRef
    });
    const controller = new AbortController();
    activeSessionRuns.set(command.payload.sessionId, runId);
    abortControllers.set(runId, controller);

    streamPrompt(
      {
        runId,
        sessionId: command.payload.sessionId,
        prompt: command.payload.message,
        ...(command.payload.attachments?.length
          ? { attachments: command.payload.attachments }
          : {}),
        ...(command.payload.writeApprovalMode
          ? { writeApprovalMode: command.payload.writeApprovalMode }
          : {}),
        ...(command.payload.thinkingLevel
          ? { thinkingLevel: command.payload.thinkingLevel }
          : {}),
        ...(command.payload.temperature !== undefined
          ? { temperature: command.payload.temperature }
          : {}),
        ...(command.payload.runtimeConfig
          ? { runtimeConfig: command.payload.runtimeConfig }
          : {}),
        ...(command.payload.agentProfile
          ? { agentProfile: command.payload.agentProfile }
          : {}),
        ...(command.payload.workspaceContext
          ? { workspaceContext: command.payload.workspaceContext }
          : {}),
        signal: controller.signal
      },
      correlationId,
      emitEvent,
      controller
    );

    return {
      status: "accepted",
      requestId: command.id,
      payload: accepted
    };
  },
  async onShutdown(): Promise<void> {
    for (const controller of abortControllers.values()) {
      controller.abort();
    }
    if (activeStreams.size === 0) {
      return;
    }
    await Promise.race([
      Promise.allSettled([...activeStreams]),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000))
    ]);
  }
});
