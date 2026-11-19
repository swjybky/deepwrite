import { createEnvelope, type SystemEventEnvelope } from "@deepwrite/contracts";
import type { AgentRuntimeEvent } from "@deepwrite/pi-runtime-adapter";
import { createId } from "@deepwrite/shared";
type LongProposalEvent = Extract<
  AgentRuntimeEvent,
  {
    type:
      | "long.mutation_proposal"
      | "long.worldbuilding_file_proposal"
      | "long.character_file_proposal"
      | "long.continuity_file_proposal"
      | "long.chapter_write_proposal"
      | "long.ledger_commit_proposal";
  }
>;
export function longProposalEventEnvelope(
  event: LongProposalEvent,
  correlationId: string
): SystemEventEnvelope {
  const context = {
    correlationId,
    sessionId: event.sessionId,
    runId: event.runId
  };
  if (event.type === "long.mutation_proposal") {
    return createEnvelope(
      "long.mutation_proposal",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        bookId: event.payload.bookId,
        agentId: event.payload.agentId,
        batch: event.payload.batch,
        summary: event.payload.summary,
        ...(event.payload.review ? { review: event.payload.review } : {}),
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "long.worldbuilding_file_proposal") {
    return createEnvelope(
      "long.worldbuilding_file_proposal",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        bookId: event.payload.bookId,
        agentId: event.payload.agentId,
        batch: event.payload.batch,
        summary: event.payload.summary,
        files: event.payload.files,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "long.character_file_proposal") {
    return createEnvelope(
      "long.character_file_proposal",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        bookId: event.payload.bookId,
        agentId: event.payload.agentId,
        batch: event.payload.batch,
        summary: event.payload.summary,
        files: event.payload.files,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "long.continuity_file_proposal") {
    return createEnvelope(
      "long.continuity_file_proposal",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        bookId: event.payload.bookId,
        agentId: event.payload.agentId,
        batch: event.payload.batch,
        summary: event.payload.summary,
        files: event.payload.files,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "long.chapter_write_proposal") {
    return createEnvelope(
      "long.chapter_write_proposal",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        bookId: event.payload.bookId,
        agentId: event.payload.agentId,
        batch: event.payload.batch,
        file: event.payload.file,
        summary: event.payload.summary,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  if (event.type === "long.ledger_commit_proposal") {
    return createEnvelope(
      "long.ledger_commit_proposal",
      {
        sessionId: event.sessionId,
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        bookId: event.payload.bookId,
        agentId: event.payload.agentId,
        input: event.payload.input,
        ...(event.payload.files ? { files: event.payload.files } : {}),
        summary: event.payload.summary,
        runtime: event.payload.runtime
      },
      { id: createId("evt"), context }
    );
  }

  throw new Error("未知长篇提案事件。");
}
