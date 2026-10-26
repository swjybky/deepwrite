import { z } from "zod";
import {
  LongCharacterTypeIdSchema,
  LongFileIdSchema,
  LongStableIdSchema,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema
} from "../long-workspace";
import { LongWorkspaceLedgerRecordEditSchema } from "./ledger-impact-schema";
import {
  LongProvisionalIdSchema,
  LongWorkspaceOperationSchema
} from "./operation-schema";
import {
  OperationTimestampSchema,
  sortedUniqueIdArray
} from "./schema-helpers";

const DocumentWriteProposalBaseShape = {
  proposalId: z
    .string()
    .trim()
    .min(3)
    .max(160)
    .regex(/^proposal_[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  fileId: LongFileIdSchema,
  content: z.string().max(10_000_000),
  updatedAt: OperationTimestampSchema,
  reason: z.string().trim().min(1).max(1_000)
} as const;

export const LongDocumentWriteProposalSchema = z.discriminatedUnion("mode", [
  z
    .object({
      ...DocumentWriteProposalBaseShape,
      mode: z.literal("create")
    })
    .strict(),
  z
    .object({
      ...DocumentWriteProposalBaseShape,
      mode: z.enum(["replace", "append"]),
      /** SHA-256 of the UTF-8 text the agent edited; Core rejects drift. */
      expectedSha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional()
    })
    .strict()
]);
export type LongDocumentWriteProposal = z.infer<
  typeof LongDocumentWriteProposalSchema
>;

export const LongWorkspaceEntityIdSchema = z.union([
  LongStableIdSchema,
  LongCharacterTypeIdSchema
]);
export type LongWorkspaceEntityId = z.infer<typeof LongWorkspaceEntityIdSchema>;

export const LongWorkspaceImpactSummarySchema = z
  .object({
    createdEntityIds: sortedUniqueIdArray(LongWorkspaceEntityIdSchema),
    updatedEntityIds: sortedUniqueIdArray(LongWorkspaceEntityIdSchema),
    deletedEntityIds: sortedUniqueIdArray(LongWorkspaceEntityIdSchema),
    createdFileIds: sortedUniqueIdArray(LongFileIdSchema),
    deletedFileIds: sortedUniqueIdArray(LongFileIdSchema),
    documentWriteProposalIds: sortedUniqueIdArray(
      z
        .string()
        .trim()
        .min(3)
        .max(160)
        .regex(/^proposal_[A-Za-z0-9][A-Za-z0-9._:-]*$/)
    )
  })
  .strict();
export type LongWorkspaceImpactSummary = z.infer<
  typeof LongWorkspaceImpactSummarySchema
>;

export const LongWorkspaceFileIntentSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      file: LongWorkspaceFileReferenceSchema,
      reason: z.string().trim().min(1).max(1_000)
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      file: LongWorkspaceFileReferenceSchema,
      reason: z.string().trim().min(1).max(1_000)
    })
    .strict()
]);
export type LongWorkspaceFileIntent = z.infer<
  typeof LongWorkspaceFileIntentSchema
>;

export const LONG_WORKSPACE_ENTITY_KINDS = [
  "worldbuilding-category",
  "worldbuilding-item",
  "character-type",
  "character",
  "volume",
  "arc",
  "chapter-card",
  "story-event",
  "story-plot",
  "event-connection",
  "narrative-placement",
  "foreshadowing-thread",
  "foreshadowing-beat"
] as const;
export const LongWorkspaceEntityKindSchema = z.enum(
  LONG_WORKSPACE_ENTITY_KINDS
);
export type LongWorkspaceEntityKind = z.infer<
  typeof LongWorkspaceEntityKindSchema
>;

export const LongWorkspaceEntitySnapshotSchema = z.record(z.string(), z.json());
export type LongWorkspaceEntitySnapshot = z.infer<
  typeof LongWorkspaceEntitySnapshotSchema
>;
const LongWorkspaceEntityChangeBaseShape = {
  kind: LongWorkspaceEntityKindSchema,
  id: LongWorkspaceEntityIdSchema
} as const;

export const LongWorkspaceEntityChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...LongWorkspaceEntityChangeBaseShape,
      action: z.literal("create"),
      before: z.null(),
      after: LongWorkspaceEntitySnapshotSchema
    })
    .strict(),
  z
    .object({
      ...LongWorkspaceEntityChangeBaseShape,
      action: z.literal("update"),
      before: LongWorkspaceEntitySnapshotSchema,
      after: LongWorkspaceEntitySnapshotSchema
    })
    .strict(),
  z
    .object({
      ...LongWorkspaceEntityChangeBaseShape,
      action: z.literal("delete"),
      before: LongWorkspaceEntitySnapshotSchema,
      after: z.null()
    })
    .strict()
]);
export type LongWorkspaceEntityChange = z.infer<
  typeof LongWorkspaceEntityChangeSchema
>;

export const LONG_WORKSPACE_RELATIONSHIP_KINDS = [
  "worldbuilding-category-item",
  "character-type-member",
  "arc-volume",
  "chapter-volume",
  "chapter-primary-arc",
  "story-plot-arc",
  "story-event-arc",
  "story-event-character",
  "event-connection-source",
  "event-connection-target",
  "narrative-placement-event",
  "narrative-placement-chapter",
  "narrative-placement-commit",
  "foreshadowing-truth-event",
  "foreshadowing-thread-beat",
  "foreshadowing-beat-volume",
  "foreshadowing-beat-arc",
  "foreshadowing-beat-event",
  "foreshadowing-beat-placement",
  "foreshadowing-beat-chapter",
  "foreshadowing-beat-commit",
  "character-files",
  "chapter-files",
  "ledger-commit",
  "ledger-state",
  "continuity-projection"
] as const;
export const LongWorkspaceRelationshipKindSchema = z.enum(
  LONG_WORKSPACE_RELATIONSHIP_KINDS
);
export type LongWorkspaceRelationshipKind = z.infer<
  typeof LongWorkspaceRelationshipKindSchema
>;

/**
 * Domain edges use a length-prefixed source/target pair. They are impact-only
 * identities rather than persisted entity ids, so the 160-character stable-id
 * ceiling would force truncation and make exact confirmations ambiguous.
 */
export const LongWorkspaceRelationshipIdSchema = z.union([
  LongStableIdSchema,
  z
    .string()
    .trim()
    .min(3)
    .max(512)
    .regex(
      /^relation_[A-Za-z0-9._:-]+$/,
      "Relationship impact ids must use a safe relation_ identity."
    )
]);
export type LongWorkspaceRelationshipId = z.infer<
  typeof LongWorkspaceRelationshipIdSchema
>;

const LongWorkspaceRelationshipChangeBaseShape = {
  kind: LongWorkspaceRelationshipKindSchema,
  id: LongWorkspaceRelationshipIdSchema
} as const;

export const LongWorkspaceRelationshipChangeSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        ...LongWorkspaceRelationshipChangeBaseShape,
        action: z.literal("create"),
        before: z.null(),
        after: LongWorkspaceEntitySnapshotSchema
      })
      .strict(),
    z
      .object({
        ...LongWorkspaceRelationshipChangeBaseShape,
        action: z.literal("update"),
        before: LongWorkspaceEntitySnapshotSchema,
        after: LongWorkspaceEntitySnapshotSchema
      })
      .strict(),
    z
      .object({
        ...LongWorkspaceRelationshipChangeBaseShape,
        action: z.literal("delete"),
        before: LongWorkspaceEntitySnapshotSchema,
        after: z.null()
      })
      .strict()
  ]
);
export type LongWorkspaceRelationshipChange = z.infer<
  typeof LongWorkspaceRelationshipChangeSchema
>;

export * from "./ledger-impact-schema";

export const LongWorkspaceImpactConfirmationSchema = z
  .object({
    impact: LongWorkspaceImpactSummarySchema,
    entityChanges: z.array(LongWorkspaceEntityChangeSchema).max(2_000_000),
    relationshipChanges: z
      .array(LongWorkspaceRelationshipChangeSchema)
      .max(2_000_000),
    fileIntents: z.array(LongWorkspaceFileIntentSchema),
    ledgerRecordEdits: z.array(LongWorkspaceLedgerRecordEditSchema)
  })
  .strict();
export type LongWorkspaceImpactConfirmation = z.infer<
  typeof LongWorkspaceImpactConfirmationSchema
>;

export const LongWorkspaceOperationBatchSchema = z
  .object({
    updatedAt: OperationTimestampSchema,
    operations: z.array(LongWorkspaceOperationSchema).max(10_000),
    documentWrites: z
      .array(LongDocumentWriteProposalSchema)
      .max(10_000)
      .default([]),
    expectedImpact: LongWorkspaceImpactConfirmationSchema.optional()
  })
  .strict()
  .superRefine((batch, context) => {
    if (batch.operations.length === 0 && batch.documentWrites.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message:
          "A long workspace batch must contain an operation or document write."
      });
    }
  });
export type LongWorkspaceOperationBatch = z.infer<
  typeof LongWorkspaceOperationBatchSchema
>;
export type LongWorkspaceOperationBatchInput = z.input<
  typeof LongWorkspaceOperationBatchSchema
>;

export const LongWorkspaceImpactPreviewSchema = z
  .object({
    impact: LongWorkspaceImpactSummarySchema,
    entityChanges: z.array(LongWorkspaceEntityChangeSchema).max(2_000_000),
    relationshipChanges: z
      .array(LongWorkspaceRelationshipChangeSchema)
      .max(2_000_000),
    fileIntents: z.array(LongWorkspaceFileIntentSchema),
    ledgerRecordEdits: z.array(LongWorkspaceLedgerRecordEditSchema),
    confirmation: LongWorkspaceImpactConfirmationSchema,
    documentWrites: z.array(LongDocumentWriteProposalSchema),
    provisionalIdMap: z.record(LongProvisionalIdSchema, LongStableIdSchema)
  })
  .strict();
export type LongWorkspaceImpactPreview = z.infer<
  typeof LongWorkspaceImpactPreviewSchema
>;

export const LongWorkspaceOperationResultSchema =
  LongWorkspaceImpactPreviewSchema.extend({
    snapshot: LongWorkspaceIndexSnapshotSchema
  }).strict();
export type LongWorkspaceOperationResult = z.infer<
  typeof LongWorkspaceOperationResultSchema
>;

export const LONG_WORKSPACE_OPERATION_ERROR_CODES = [
  "not_found",
  "already_exists",
  "invalid_reference",
  "impact_mismatch",
  "invalid_order",
  "recorded_chapter_order",
  "invalid_document_write",
  "invalid_result",
  "document_changed"
] as const;
export const LongWorkspaceOperationErrorCodeSchema = z.enum(
  LONG_WORKSPACE_OPERATION_ERROR_CODES
);
export type LongWorkspaceOperationErrorCode = z.infer<
  typeof LongWorkspaceOperationErrorCodeSchema
>;

export class LongWorkspaceOperationError extends Error {
  readonly code: LongWorkspaceOperationErrorCode;
  readonly details: Readonly<Record<string, string>> | undefined;

  constructor(
    code: LongWorkspaceOperationErrorCode,
    message: string,
    details?: Readonly<Record<string, string>>
  ) {
    super(message);
    this.name = "LongWorkspaceOperationError";
    this.code = code;
    this.details = details;
  }
}
