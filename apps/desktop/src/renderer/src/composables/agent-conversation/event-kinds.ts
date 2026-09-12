import type { SystemEventEnvelope } from "@deepwrite/contracts";
import type { SubagentEventEnvelope } from "./types";
export function isAgentEvent(event: SystemEventEnvelope): event is Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.evaluation_snapshot"
      | "agent.turn_started"
      | "agent.retry_scheduled"
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.user_input_requested"
      | "agent.error"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed";
  }
> {
  return (
    event.type === "agent.evaluation_snapshot" ||
    event.type === "agent.turn_started" ||
    event.type === "agent.retry_scheduled" ||
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.user_input_requested" ||
    event.type === "agent.error" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}
export function isSubagentEvent(
  event: SystemEventEnvelope
): event is SubagentEventEnvelope {
  return (
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}
