import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import {
  WRITE_APPROVAL_MAX_TOOL_CALLS,
  WRITE_APPROVAL_QUESTION_ID,
  type PromptLocale,
  type AgentRuntimeRef
} from "@deepwrite/contracts";
import { toRuntimeEvents } from "../event-mapping";
import type {
  AgentRuntimeEvent,
  AgentUserInputRequester
} from "../runtime-types";
import { renderWriteApprovalResults } from "../write-approval";

/** Runtime events that put an agent write in front of the user for review. */
const PROPOSAL_EVENT_TYPES: ReadonlySet<AgentRuntimeEvent["type"]> = new Set([
  "workspace.editor_mutation",
  "academic.workspace_mutation",
  "library.structure_proposal",
  "library.editor_mutation",
  "long.mutation_proposal",
  "long.worldbuilding_file_proposal",
  "long.character_file_proposal",
  "long.continuity_file_proposal",
  "long.chapter_write_proposal",
  "long.ledger_commit_proposal",
  "mystery.mutation_proposal"
]);

export interface WriteApprovalGate {
  /** Records the tool call behind a proposal event of this agent. */
  observe(event: AgentRuntimeEvent): void;
  /** Same, for a finished tool call that has not been mapped yet. */
  observeToolResult(
    event: Extract<AgentEvent, { type: "tool_execution_end" }>,
    toolCallId: string
  ): void;
  /**
   * Between two turns: when the finished step formed proposals, waits until
   * the user settled them and returns the outcome message for the model.
   */
  wait(signal?: AbortSignal): Promise<UserMessage | undefined>;
}

/**
 * User-review mode pauses the agent after every step that submitted
 * proposals. Proposals reach the window only when their tool call ended, so
 * the pause sits before the next model request instead of inside the tool.
 */
export function createWriteApprovalGate(options: {
  requestUserInput: AgentUserInputRequester;
  locale?: PromptLocale | undefined;
  runtime: AgentRuntimeRef;
}): WriteApprovalGate {
  const pending: string[] = [];
  const record = (toolCallId: string): void => {
    if (!pending.includes(toolCallId)) pending.push(toolCallId);
  };

  return {
    observe(event) {
      if (!PROPOSAL_EVENT_TYPES.has(event.type)) return;
      const toolCallId = (event.payload as { toolCallId?: unknown }).toolCallId;
      if (typeof toolCallId === "string" && toolCallId) record(toolCallId);
    },
    observeToolResult(event, toolCallId) {
      if (event.isError) return;
      const mapped = toRuntimeEvents(
        { ...event, toolCallId },
        { runId: "write-approval", sessionId: "write-approval" },
        options.runtime,
        "write-approval"
      );
      if (mapped.some((item) => PROPOSAL_EVENT_TYPES.has(item.type)))
        record(toolCallId);
    },
    async wait(signal) {
      if (!pending.length) return undefined;
      const toolCallIds = pending
        .splice(0)
        .slice(-WRITE_APPROVAL_MAX_TOOL_CALLS);
      const response = await options.requestUserInput(
        {
          toolCallId: toolCallIds[toolCallIds.length - 1]!,
          source: "write_approval",
          questions: [
            {
              id: WRITE_APPROVAL_QUESTION_ID,
              question:
                options.locale === "en-US"
                  ? "Waiting for review of these changes."
                  : "等待用户审批本步修改。"
            }
          ],
          writeApproval: { toolCallIds }
        },
        signal
      );
      return {
        role: "user",
        content: renderWriteApprovalResults(
          response.writeApproval,
          options.locale
        ),
        timestamp: Date.now()
      };
    }
  };
}
