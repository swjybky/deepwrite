import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "../envelope";
import {
  AgentContextCompactionPayloadSchema,
  type AgentContextCompactionPayload
} from "./context-compaction";
import {
  AgentEvaluationSnapshotPayloadSchema,
  type AgentEvaluationSnapshotPayload
} from "./evaluation";
import {
  AgentErrorPayloadSchema,
  AgentMessageCompletedPayloadSchema,
  AgentMessageDeltaPayloadSchema,
  AgentRetryScheduledPayloadSchema,
  AgentThinkingDeltaPayloadSchema,
  AgentToolCallStreamPayloadSchema,
  AgentToolCompletedPayloadSchema,
  AgentToolRequestedPayloadSchema,
  AgentTurnStartedPayloadSchema,
  AgentUsageObservedPayloadSchema,
  SubagentAuthoringDraftUpdatedPayloadSchema,
  type AgentErrorPayload,
  type AgentMessageCompletedPayload,
  type AgentMessageDeltaPayload,
  type AgentRetryScheduledPayload,
  type AgentThinkingDeltaPayload,
  type AgentToolCallStreamPayload,
  type AgentToolCompletedPayload,
  type AgentToolRequestedPayload,
  type AgentTurnStartedPayload,
  type AgentUsageObservedPayload,
  type SubagentAuthoringDraftUpdatedPayload
} from "./agent-events";
import {
  SubagentActivityPayloadSchema,
  SubagentCompletedPayloadSchema,
  SubagentDrawUpdatedPayloadSchema,
  SubagentPlannedPayloadSchema,
  SubagentStartedPayloadSchema,
  type SubagentActivityPayload,
  type SubagentCompletedPayload,
  type SubagentDrawUpdatedPayload,
  type SubagentPlannedPayload,
  type SubagentStartedPayload
} from "./subagent";
import {
  LibraryEditorMutationPayloadSchema,
  WorkspaceEditorMutationPayloadSchema,
  WorkspaceStageSelectionPayloadSchema,
  type LibraryEditorMutationPayload,
  type WorkspaceEditorMutationPayload,
  type WorkspaceStageSelectionPayload
} from "./workspace-mutations";
import {
  LongChapterWriteProposalPayloadSchema,
  LongCharacterFileProposalPayloadSchema,
  LongContinuityFileProposalPayloadSchema,
  LongLedgerCommitProposalPayloadSchema,
  LongMutationProposalPayloadSchema,
  LongWorldbuildingFileProposalPayloadSchema,
  type LongChapterWriteProposalPayload,
  type LongCharacterFileProposalPayload,
  type LongContinuityFileProposalPayload,
  type LongLedgerCommitProposalPayload,
  type LongMutationProposalPayload,
  type LongWorldbuildingFileProposalPayload
} from "./long-proposals";
import {
  AcademicWorkspaceMutationPayloadSchema,
  type AcademicWorkspaceMutationPayload
} from "./academic-proposals";
import {
  MysteryMutationProposalPayloadSchema,
  type MysteryMutationProposalPayload
} from "../mystery/proposals";
import {
  AgentUserInputRequestedPayloadSchema,
  type AgentUserInputRequestedPayload
} from "./user-input";

export const AgentMessageDeltaEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.message_delta"),
  payload: AgentMessageDeltaPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentEvaluationSnapshotEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.evaluation_snapshot"),
    payload: AgentEvaluationSnapshotPayloadSchema
  }).superRefine(validateAgentEventContext);

export const AgentTurnStartedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.turn_started"),
  payload: AgentTurnStartedPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentRetryScheduledEventEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("agent.retry_scheduled"),
    payload: AgentRetryScheduledPayloadSchema
  }
).superRefine(validateAgentEventContext);

export const AgentContextCompactionEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.context_compaction"),
    payload: AgentContextCompactionPayloadSchema
  }).superRefine(validateAgentEventContext);

export const SubagentPlannedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("subagent.planned"),
  payload: SubagentPlannedPayloadSchema
}).superRefine(validateAgentEventContext);

export const SubagentStartedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("subagent.started"),
  payload: SubagentStartedPayloadSchema
}).superRefine(validateAgentEventContext);

export const SubagentActivityEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("subagent.activity"),
  payload: SubagentActivityPayloadSchema
}).superRefine(validateAgentEventContext);

export const SubagentCompletedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("subagent.completed"),
  payload: SubagentCompletedPayloadSchema
}).superRefine(validateAgentEventContext);

export const SubagentDrawUpdatedEventEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("subagent.draw_updated"),
    payload: SubagentDrawUpdatedPayloadSchema
  }
).superRefine(validateAgentEventContext);

export const AgentThinkingDeltaEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.thinking_delta"),
  payload: AgentThinkingDeltaPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentMessageCompletedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.message_completed"),
    payload: AgentMessageCompletedPayloadSchema
  }).superRefine(validateAgentEventContext);

export const AgentUsageObservedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.usage_observed"),
  payload: AgentUsageObservedPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentToolRequestedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("tool.call_requested"),
  payload: AgentToolRequestedPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentToolCallStreamEventEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("tool.call_stream"),
    payload: AgentToolCallStreamPayloadSchema
  }
).superRefine(validateAgentEventContext);

export const AgentToolCompletedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("tool.execution_completed"),
  payload: AgentToolCompletedPayloadSchema
}).superRefine(validateAgentEventContext);

export const AgentUserInputRequestedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.user_input_requested"),
    payload: AgentUserInputRequestedPayloadSchema
  }).superRefine(validateAgentEventContext);

export const SubagentAuthoringDraftUpdatedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("subagent_authoring.draft_updated"),
    payload: SubagentAuthoringDraftUpdatedPayloadSchema
  }).superRefine(validateAgentEventContext);

export const WorkspaceEditorMutationEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("workspace.editor_mutation"),
    payload: WorkspaceEditorMutationPayloadSchema
  }).superRefine(validateAgentEventContext);

export const LongMutationProposalEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.mutation_proposal"),
    payload: LongMutationProposalPayloadSchema
  }).superRefine(validateAgentEventContext);

export const LongWorldbuildingFileProposalEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.worldbuilding_file_proposal"),
    payload: LongWorldbuildingFileProposalPayloadSchema
  }).superRefine(validateAgentEventContext);

export const LongCharacterFileProposalEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.character_file_proposal"),
    payload: LongCharacterFileProposalPayloadSchema
  }).superRefine(validateAgentEventContext);

export const LongContinuityFileProposalEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.continuity_file_proposal"),
    payload: LongContinuityFileProposalPayloadSchema
  }).superRefine(validateAgentEventContext);

export const LongChapterWriteProposalEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.chapter_write_proposal"),
    payload: LongChapterWriteProposalPayloadSchema
  }).superRefine(validateAgentEventContext);

export const LongLedgerCommitProposalEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.ledger_commit_proposal"),
    payload: LongLedgerCommitProposalPayloadSchema
  }).superRefine(validateAgentEventContext);

export const AcademicWorkspaceMutationEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("academic.workspace_mutation"),
    payload: AcademicWorkspaceMutationPayloadSchema
  }).superRefine(validateAgentEventContext);

export const MysteryMutationProposalEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("mystery.mutation_proposal"),
    payload: MysteryMutationProposalPayloadSchema
  }).superRefine(validateAgentEventContext);

export const LibraryEditorMutationEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("library.editor_mutation"),
    payload: LibraryEditorMutationPayloadSchema
  }).superRefine(validateAgentEventContext);

export const WorkspaceStageSelectionEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("workspace.stage_selection"),
    payload: WorkspaceStageSelectionPayloadSchema
  }).superRefine(validateAgentEventContext);

export const AgentErrorEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.error"),
  payload: AgentErrorPayloadSchema
}).superRefine(validateAgentEventContext);

export function validateAgentEventContext(
  value: {
    context: { sessionId?: string | undefined; runId?: string | undefined };
    payload: { sessionId: string; runId: string };
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  if (value.context.sessionId !== value.payload.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["context", "sessionId"],
      message: "Envelope and payload sessionId must match."
    });
  }
  if (value.context.runId !== value.payload.runId) {
    context.addIssue({
      code: "custom",
      path: ["context", "runId"],
      message: "Envelope and payload runId must match."
    });
  }
}

export type AgentMessageDeltaEventEnvelope = Envelope<
  AgentMessageDeltaPayload,
  "agent.message_delta"
>;
export type AgentEvaluationSnapshotEventEnvelope = Envelope<
  AgentEvaluationSnapshotPayload,
  "agent.evaluation_snapshot"
>;
export type AgentTurnStartedEventEnvelope = Envelope<
  AgentTurnStartedPayload,
  "agent.turn_started"
>;
export type AgentRetryScheduledEventEnvelope = Envelope<
  AgentRetryScheduledPayload,
  "agent.retry_scheduled"
>;
export type AgentContextCompactionEventEnvelope = Envelope<
  AgentContextCompactionPayload,
  "agent.context_compaction"
>;
export type SubagentPlannedEventEnvelope = Envelope<
  SubagentPlannedPayload,
  "subagent.planned"
>;
export type SubagentStartedEventEnvelope = Envelope<
  SubagentStartedPayload,
  "subagent.started"
>;
export type SubagentActivityEventEnvelope = Envelope<
  SubagentActivityPayload,
  "subagent.activity"
>;
export type SubagentCompletedEventEnvelope = Envelope<
  SubagentCompletedPayload,
  "subagent.completed"
>;
export type SubagentDrawUpdatedEventEnvelope = Envelope<
  SubagentDrawUpdatedPayload,
  "subagent.draw_updated"
>;
export type AgentThinkingDeltaEventEnvelope = Envelope<
  AgentThinkingDeltaPayload,
  "agent.thinking_delta"
>;
export type AgentMessageCompletedEventEnvelope = Envelope<
  AgentMessageCompletedPayload,
  "agent.message_completed"
>;
export type AgentUsageObservedEventEnvelope = Envelope<
  AgentUsageObservedPayload,
  "agent.usage_observed"
>;
export type AgentToolRequestedEventEnvelope = Envelope<
  AgentToolRequestedPayload,
  "tool.call_requested"
>;
export type AgentToolCallStreamEventEnvelope = Envelope<
  AgentToolCallStreamPayload,
  "tool.call_stream"
>;
export type AgentToolCompletedEventEnvelope = Envelope<
  AgentToolCompletedPayload,
  "tool.execution_completed"
>;
export type AgentUserInputRequestedEventEnvelope = Envelope<
  AgentUserInputRequestedPayload,
  "agent.user_input_requested"
>;
export type SubagentAuthoringDraftUpdatedEventEnvelope = Envelope<
  SubagentAuthoringDraftUpdatedPayload,
  "subagent_authoring.draft_updated"
>;
export type WorkspaceEditorMutationEventEnvelope = Envelope<
  WorkspaceEditorMutationPayload,
  "workspace.editor_mutation"
>;
export type LongMutationProposalEventEnvelope = Envelope<
  LongMutationProposalPayload,
  "long.mutation_proposal"
>;
export type LongWorldbuildingFileProposalEventEnvelope = Envelope<
  LongWorldbuildingFileProposalPayload,
  "long.worldbuilding_file_proposal"
>;
export type LongCharacterFileProposalEventEnvelope = Envelope<
  LongCharacterFileProposalPayload,
  "long.character_file_proposal"
>;
export type LongContinuityFileProposalEventEnvelope = Envelope<
  LongContinuityFileProposalPayload,
  "long.continuity_file_proposal"
>;
export type LongChapterWriteProposalEventEnvelope = Envelope<
  LongChapterWriteProposalPayload,
  "long.chapter_write_proposal"
>;
export type LongLedgerCommitProposalEventEnvelope = Envelope<
  LongLedgerCommitProposalPayload,
  "long.ledger_commit_proposal"
>;
export type AcademicWorkspaceMutationEventEnvelope = Envelope<
  AcademicWorkspaceMutationPayload,
  "academic.workspace_mutation"
>;
export type MysteryMutationProposalEventEnvelope = Envelope<
  MysteryMutationProposalPayload,
  "mystery.mutation_proposal"
>;
export type LibraryEditorMutationEventEnvelope = Envelope<
  LibraryEditorMutationPayload,
  "library.editor_mutation"
>;
export type WorkspaceStageSelectionEventEnvelope = Envelope<
  WorkspaceStageSelectionPayload,
  "workspace.stage_selection"
>;
export type AgentErrorEventEnvelope = Envelope<
  AgentErrorPayload,
  "agent.error"
>;
