import { longProposalEventEnvelope } from "./long-proposal-event-envelope";
import { createEnvelope, type SystemEventEnvelope } from "@deepwrite/contracts";
import type { AgentRuntimeEvent } from "@deepwrite/pi-runtime-adapter";
import { createId } from "@deepwrite/shared";
import { analysisEventEnvelope } from "./analysis-event-envelope";
export function toEventEnvelope(
  event: AgentRuntimeEvent,
  correlationId: string
): SystemEventEnvelope {
  const context = {
    correlationId,
    sessionId: event.sessionId,
    runId: event.runId
  };

  if (event.type === "agent.evaluation_snapshot") {
    return createEnvelope(
      "agent.evaluation_snapshot",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        messageId: event.payload.messageId,
        snapshot: event.payload.snapshot,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.turn_started") {
    return createEnvelope(
      "agent.turn_started",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        messageId: event.payload.messageId,
        turnId: event.payload.turnId,
        attempt: event.payload.attempt,
        maxAttempts: event.payload.maxAttempts,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.retry_scheduled") {
    return createEnvelope(
      "agent.retry_scheduled",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        messageId: event.payload.messageId,
        turnId: event.payload.turnId,
        failedAttempt: event.payload.failedAttempt,
        nextAttempt: event.payload.nextAttempt,
        maxAttempts: event.payload.maxAttempts,
        delayMs: event.payload.delayMs,
        retryAt: event.payload.retryAt,
        reason: event.payload.reason,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

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
        ...(event.payload.stopReason
          ? { stopReason: event.payload.stopReason }
          : {}),
        ...(event.payload.usage ? { usage: event.payload.usage } : {})
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.usage_observed") {
    return createEnvelope(
      "agent.usage_observed",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        ...event.payload
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "subagent.started") {
    return createEnvelope(
      "subagent.started",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        ...event.payload
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "subagent.activity") {
    return createEnvelope(
      "subagent.activity",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        ...event.payload
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "subagent.completed") {
    return createEnvelope(
      "subagent.completed",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        ...event.payload
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
        ...(event.payload.toolCallId
          ? { toolCallId: event.payload.toolCallId }
          : {}),
        ...(event.payload.toolName ? { toolName: event.payload.toolName } : {}),
        ...(event.payload.args !== undefined
          ? { args: event.payload.args }
          : {})
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

  if (event.type === "agent.user_input_requested") {
    return createEnvelope(
      "agent.user_input_requested",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        requestId: event.payload.requestId,
        toolCallId: event.payload.toolCallId,
        source: event.payload.source,
        questions: event.payload.questions,
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
        ...(event.payload.mutationTarget
          ? { mutationTarget: event.payload.mutationTarget }
          : {}),
        baseRevision: event.payload.baseRevision,
        summary: event.payload.summary,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (
    event.type === "long.mutation_proposal" ||
    event.type === "long.worldbuilding_file_proposal" ||
    event.type === "long.character_file_proposal" ||
    event.type === "long.continuity_file_proposal" ||
    event.type === "long.chapter_write_proposal" ||
    event.type === "long.ledger_commit_proposal"
  )
    return longProposalEventEnvelope(event, correlationId);

  if (event.type === "library.editor_mutation") {
    return createEnvelope(
      "library.editor_mutation",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        ...event.payload
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

  if (event.type === "learning_imitation.result_updated") {
    return createEnvelope(
      "learning_imitation.result_updated",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        stageId: event.payload.stageId,
        update: event.payload.update,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (
    event.type === "revision_analysis.result_updated" ||
    event.type === "short_book_analysis.result_updated" ||
    event.type === "long_book_analysis.note_updated" ||
    event.type === "long_book_analysis.result_updated"
  )
    return analysisEventEnvelope(event, correlationId);

  if (event.type === "subagent_authoring.draft_updated") {
    return createEnvelope(
      "subagent_authoring.draft_updated",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        draft: event.payload.draft,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "agent.context_compacted") {
    return createEnvelope(
      "agent.context_compacted",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        messageId: event.payload.messageId,
        trigger: event.payload.trigger,
        tokensBefore: event.payload.tokensBefore,
        tokensAfter: event.payload.tokensAfter,
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
