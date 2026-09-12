import type { PersistenceControllerOperations } from "./persistence-controller-operations";
import type { RunLifecycleOperations } from "./run-lifecycle-operations";
import type { MessageIdentityOperations } from "./message-identity-operations";
import type { TurnRetryOperations } from "./turn-retry-operations";
import type { SubagentIdentityOperations } from "./subagent-identity-operations";
import type { SubagentRetryOperations } from "./subagent-retry-operations";
import type { SubagentEventsOperations } from "./subagent-events-operations";
import type { ApprovalsOperations } from "./approvals-operations";
import type { StreamingOperations } from "./streaming-operations";
import type { EventsOperations } from "./events-operations";
import type { SendMessageOperations } from "./send-message-operations";
import type { SendEntrypointsOperations } from "./send-entrypoints-operations";
import type { SessionLifecycleOperations } from "./session-lifecycle-operations";
import type { RunSettingsOperations } from "./run-settings-operations";

export type AgentConversationOperations = PersistenceControllerOperations &
  RunLifecycleOperations &
  MessageIdentityOperations &
  TurnRetryOperations &
  SubagentIdentityOperations &
  SubagentRetryOperations &
  SubagentEventsOperations &
  ApprovalsOperations &
  StreamingOperations &
  EventsOperations &
  SendMessageOperations &
  SendEntrypointsOperations &
  SessionLifecycleOperations &
  RunSettingsOperations;
