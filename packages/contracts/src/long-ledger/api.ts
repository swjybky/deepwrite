import { z } from "zod";

import {
  LongBookIdSchema,
  LongChapterCardIdSchema,
  LongFileIdSchema,
  LongForeshadowingBeatIdSchema,
  LongLedgerCommitIdSchema,
  LongNarrativePlacementIdSchema
} from "../long-workspace";
import {
  EMPTY_LONG_LEDGER_CHAPTER_OUTPUTS,
  EMPTY_LONG_LEDGER_COVERAGE,
  LedgerContentSchema,
  LongLedgerChapterOutputsSchema,
  LongLedgerCoverageSchema,
  LongLedgerFactMutationSchema,
  LongLedgerKnowledgeMutationSchema,
  LongLedgerOpenLoopMutationSchema,
  LongRequiredChapterSummarySchema,
  RequiredLedgerCommitMessageSchema,
  RequiredLedgerEvidenceNoteSchema
} from "./common";
import { LongLedgerCommitRecordSchema } from "./record";
import { DocumentVersionOriginSchema } from "../document-version-origin";
import { LongWorkspaceOperationBatchSchema } from "../long-workspace-operations";

export const LongContinuityCommitPreparationSchema = z
  .object({
    commitId: LongLedgerCommitIdSchema,
    versionOrigin: DocumentVersionOriginSchema.optional(),
    batch: LongWorkspaceOperationBatchSchema,
    bodyVersions: z
      .array(
        z
          .object({
            fileId: LongFileIdSchema,
            expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u)
          })
          .strict()
      )
      .min(1)
      .max(100_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.bodyVersions.map(({ fileId }) => fileId)).size !==
      value.bodyVersions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["bodyVersions"],
        message: "Body versions must target unique files."
      });
    }
  });
export type LongContinuityCommitPreparation = z.infer<
  typeof LongContinuityCommitPreparationSchema
>;

export const LongChapterFileWriteSchema = z
  .object({ content: LedgerContentSchema })
  .strict();
export type LongChapterFileWrite = z.infer<typeof LongChapterFileWriteSchema>;

export const LongWriteChapterInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    body: LongChapterFileWriteSchema,
    characterState: LongChapterFileWriteSchema,
    handoff: LongChapterFileWriteSchema
  })
  .strict();
export type LongWriteChapterInput = z.infer<typeof LongWriteChapterInputSchema>;

export const LongWriteChapterResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema
  })
  .strict();
export type LongWriteChapterResult = z.infer<
  typeof LongWriteChapterResultSchema
>;

export const LongCommitExecutionDecisionInputSchema = z
  .object({
    status: z.enum(["committed", "missed"]),
    note: RequiredLedgerEvidenceNoteSchema
  })
  .strict();

const LongStructuredCommitChapterInputSchema = z
  .object({
    mode: z.literal("structured").default("structured"),
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    commitMessage: RequiredLedgerCommitMessageSchema,
    chapterSummary: LongRequiredChapterSummarySchema,
    placementDecisions: z
      .record(
        LongNarrativePlacementIdSchema,
        LongCommitExecutionDecisionInputSchema
      )
      .default({}),
    foreshadowingBeatDecisions: z
      .record(
        LongForeshadowingBeatIdSchema,
        LongCommitExecutionDecisionInputSchema
      )
      .default({}),
    fileUpdates: z
      .array(
        z
          .object({
            fileId: LongFileIdSchema,
            content: LedgerContentSchema,
            mode: z.enum(["replace", "append"]).default("replace")
          })
          .strict()
      )
      .max(1_024)
      .default([]),
    coverage: LongLedgerCoverageSchema.default(EMPTY_LONG_LEDGER_COVERAGE),
    factMutations: z
      .array(LongLedgerFactMutationSchema)
      .max(200_000)
      .default([]),
    knowledgeMutations: z
      .array(LongLedgerKnowledgeMutationSchema)
      .max(400_000)
      .default([]),
    openLoopMutations: z
      .array(LongLedgerOpenLoopMutationSchema)
      .max(200_000)
      .default([]),
    chapterOutputs: LongLedgerChapterOutputsSchema.default(
      EMPTY_LONG_LEDGER_CHAPTER_OUTPUTS
    )
  })
  .strict()
  .superRefine((input, context) => {
    const fileIds = input.fileUpdates.map(({ fileId }) => fileId);
    if (new Set(fileIds).size !== fileIds.length) {
      context.addIssue({
        code: "custom",
        path: ["fileUpdates"],
        message: "A ledger commit cannot update the same file twice."
      });
    }
    const factIds = input.factMutations.map(({ factId }) => factId);
    const factKeys = input.factMutations.map(
      ({ domain, subjectId, field }) =>
        `${domain}\0${subjectId}\0${field.normalize("NFC")}`
    );
    if (
      new Set(factIds).size !== factIds.length ||
      new Set(factKeys).size !== factKeys.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["factMutations"],
        message:
          "A ledger commit cannot mutate the same continuity fact key twice."
      });
    }
    const knowledgeKeys = input.knowledgeMutations.map(
      ({ factId, audienceType, audienceId }) =>
        `${factId}\0${audienceType}\0${audienceId ?? ""}`
    );
    if (new Set(knowledgeKeys).size !== knowledgeKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeMutations"],
        message: "A ledger commit cannot mutate the same knowledge key twice."
      });
    }
    const loopIds = input.openLoopMutations.map(({ loopId }) => loopId);
    if (new Set(loopIds).size !== loopIds.length) {
      context.addIssue({
        code: "custom",
        path: ["openLoopMutations"],
        message: "A ledger commit cannot mutate the same open loop twice."
      });
    }
  });

export const LongTextFilesCommitChapterInputSchema = z
  .object({
    mode: z.literal("text_files"),
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    foreshadowingBeatDecisions: z
      .record(
        LongForeshadowingBeatIdSchema,
        LongCommitExecutionDecisionInputSchema
      )
      .default({}),
    commitMessage: RequiredLedgerCommitMessageSchema
  })
  .strict();
export type LongTextFilesCommitChapterInput = z.infer<
  typeof LongTextFilesCommitChapterInputSchema
>;

export const LongTextFilesBatchCommitInputSchema = z
  .object({
    mode: z.literal("text_files_batch"),
    bookId: LongBookIdSchema,
    chapterCardIds: z.array(LongChapterCardIdSchema).min(1).max(100_000),
    checkpointChapterCardId: LongChapterCardIdSchema,
    preparation: LongContinuityCommitPreparationSchema.optional(),
    review: z
      .object({
        commitId: LongLedgerCommitIdSchema,
        versions:
          LongContinuityCommitPreparationSchema.shape.bodyVersions.max(200_001)
      })
      .strict()
      .optional(),
    foreshadowingBeatDecisions: z
      .record(
        LongForeshadowingBeatIdSchema,
        LongCommitExecutionDecisionInputSchema
      )
      .default({}),
    commitMessage: RequiredLedgerCommitMessageSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.chapterCardIds).size !== input.chapterCardIds.length) {
      context.addIssue({
        code: "custom",
        path: ["chapterCardIds"],
        message: "A chapter batch cannot contain the same chapter twice."
      });
    }
    if (input.chapterCardIds.at(-1) !== input.checkpointChapterCardId) {
      context.addIssue({
        code: "custom",
        path: ["checkpointChapterCardId"],
        message: "The checkpoint must be the final chapter in the batch."
      });
    }
  });
export type LongTextFilesBatchCommitInput = z.infer<
  typeof LongTextFilesBatchCommitInputSchema
>;

export const LongCommitChapterInputSchema = z.union([
  LongStructuredCommitChapterInputSchema,
  LongTextFilesCommitChapterInputSchema,
  LongTextFilesBatchCommitInputSchema
]);
export type LongCommitChapterInput = z.infer<
  typeof LongCommitChapterInputSchema
>;

export function longCommitInputChapterIds(
  input: LongCommitChapterInput
): string[] {
  return input.mode === "text_files_batch"
    ? [...input.chapterCardIds]
    : [input.chapterCardId];
}

export function longCommitInputCheckpointChapterId(
  input: LongCommitChapterInput
): string {
  return input.mode === "text_files_batch"
    ? input.checkpointChapterCardId
    : input.chapterCardId;
}

export const LongCommitChapterResultSchema = z
  .object({ record: LongLedgerCommitRecordSchema })
  .strict();
export type LongCommitChapterResult = z.infer<
  typeof LongCommitChapterResultSchema
>;

export const LongDeleteLedgerCommitInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    commitId: LongLedgerCommitIdSchema
  })
  .strict();
export type LongDeleteLedgerCommitInput = z.infer<
  typeof LongDeleteLedgerCommitInputSchema
>;

export const LongDeleteLedgerCommitResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    deletedCommitId: LongLedgerCommitIdSchema,
    chapterCardIds: z.array(LongChapterCardIdSchema).min(1).max(100_000)
  })
  .strict();
export type LongDeleteLedgerCommitResult = z.infer<
  typeof LongDeleteLedgerCommitResultSchema
>;
