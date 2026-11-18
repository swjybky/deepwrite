import { z } from "zod";
import { AgentRuntimeRefSchema } from "../session/agent-event-identity";
import { MysteryAgentIdSchema } from "./agent-settings";
import {
  MYSTERY_DOCUMENT_MAX_CHARACTERS,
  MysteryBookIdSchema,
  MysteryDocumentTargetSchema
} from "./manifest";
import { MysteryOperationBatchSchema } from "./operations";

export const MysteryFileChangeSchema = z
  .object({
    targetKey: z.string().min(1).max(240),
    target: MysteryDocumentTargetSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(MYSTERY_DOCUMENT_MAX_CHARACTERS),
    afterText: z.string().max(MYSTERY_DOCUMENT_MAX_CHARACTERS)
  })
  .strict();
export type MysteryFileChange = z.infer<typeof MysteryFileChangeSchema>;

export const MysteryMutationProposalPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    toolCallId: z.string().min(1),
    bookId: MysteryBookIdSchema,
    agentId: MysteryAgentIdSchema,
    summary: z.string().trim().min(1).max(1_000),
    batch: MysteryOperationBatchSchema,
    fileChanges: z.array(MysteryFileChangeSchema).max(200),
    structureChanges: z.array(z.string().max(500)).max(200),
    runtime: AgentRuntimeRefSchema
  })
  .strict();
export type MysteryMutationProposalPayload = z.infer<
  typeof MysteryMutationProposalPayloadSchema
>;
