import { z } from "zod";

import {
  LongBookIdSchema,
  LongChapterCardIdSchema,
  LongLedgerCommitIdSchema
} from "../long-workspace";
import {
  EMPTY_LONG_CHAPTER_SUMMARY,
  EMPTY_LONG_LEDGER_CHAPTER_OUTPUTS,
  EMPTY_LONG_LEDGER_COVERAGE,
  LedgerCommitMessageSchema,
  LedgerTimestampSchema,
  LongChapterSummarySchema,
  LongLedgerChapterOutputsSchema,
  LongLedgerContinuityFilesAuditSchema,
  LongLedgerCoverageSchema,
  LongLedgerFactChangeSchema,
  LongLedgerForeshadowingBeatChangeSchema,
  LongLedgerForeshadowingThreadChangeSchema,
  LongLedgerKnowledgeChangeSchema,
  LongLedgerOpenLoopChangeSchema,
  LongLedgerPlacementChangeSchema,
  type LongChapterSummary
} from "./common";

/**
 * A chapter ledger record keeps current semantic outcomes together with stable
 * identity, ordering, and timing metadata. It contains no file contents or
 * prior document states.
 */
export const LongLedgerCommitRecordSchema = z
  .object({
    schemaVersion: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5)
    ]),
    id: LongLedgerCommitIdSchema,
    bookId: LongBookIdSchema,
    sequence: z.number().int().positive(),
    chapterCardId: LongChapterCardIdSchema,
    chapterCardIds: z.array(LongChapterCardIdSchema).max(100_000).optional(),
    checkpointChapterCardId: LongChapterCardIdSchema.optional(),
    committedAt: LedgerTimestampSchema,
    bodyEvidence: z
      .array(
        z
          .object({
            chapterCardId: LongChapterCardIdSchema,
            sha256: z.string().regex(/^[a-f0-9]{64}$/u)
          })
          .strict()
      )
      .min(1)
      .max(100_000)
      .optional(),
    commitMessage: LedgerCommitMessageSchema.default(""),
    chapterSummary: LongChapterSummarySchema.default(
      EMPTY_LONG_CHAPTER_SUMMARY
    ),
    committedThroughChapterId: LongChapterCardIdSchema.nullable(),
    placementChanges: z.array(LongLedgerPlacementChangeSchema).max(100_000),
    foreshadowingBeatChanges: z
      .array(LongLedgerForeshadowingBeatChangeSchema)
      .max(100_000),
    foreshadowingThreadChanges: z
      .array(LongLedgerForeshadowingThreadChangeSchema)
      .max(100_000)
      .default([]),
    continuityFiles: LongLedgerContinuityFilesAuditSchema.default([]),
    coverage: LongLedgerCoverageSchema.default(EMPTY_LONG_LEDGER_COVERAGE),
    factChanges: z.array(LongLedgerFactChangeSchema).max(200_000).default([]),
    knowledgeChanges: z
      .array(LongLedgerKnowledgeChangeSchema)
      .max(400_000)
      .default([]),
    openLoopChanges: z
      .array(LongLedgerOpenLoopChangeSchema)
      .max(200_000)
      .default([]),
    chapterOutputs: LongLedgerChapterOutputsSchema.default(
      EMPTY_LONG_LEDGER_CHAPTER_OUTPUTS
    )
  })
  .strict()
  .superRefine((record, context) => {
    if (record.schemaVersion >= 2 && record.commitMessage.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["commitMessage"],
        message: "A current ledger record requires a non-empty commit message."
      });
    }
    if (record.schemaVersion === 2 || record.schemaVersion === 3) {
      for (const key of Object.keys(record.chapterSummary) as Array<
        keyof LongChapterSummary
      >) {
        if (record.chapterSummary[key].length === 0) {
          context.addIssue({
            code: "custom",
            path: ["chapterSummary", key],
            message:
              "A structured ledger record requires all six continuity summaries."
          });
        }
      }
      record.placementChanges.forEach((change, index) => {
        if (change.note.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["placementChanges", index, "note"],
            message:
              "A structured ledger placement decision requires an evidence note."
          });
        }
      });
      record.foreshadowingBeatChanges.forEach((change, index) => {
        if (change.note.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["foreshadowingBeatChanges", index, "note"],
            message:
              "A structured ledger beat decision requires an evidence note."
          });
        }
      });
    }
    if (
      (record.schemaVersion === 4 || record.schemaVersion === 5) &&
      record.continuityFiles.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuityFiles"],
        message:
          "A text-file ledger record requires at least one continuity file."
      });
    }
    if (record.schemaVersion === 5) {
      const chapterCardIds = record.chapterCardIds ?? [];
      if (chapterCardIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["chapterCardIds"],
          message: "A v5 ledger record requires at least one batch chapter."
        });
      }
      if (new Set(chapterCardIds).size !== chapterCardIds.length) {
        context.addIssue({
          code: "custom",
          path: ["chapterCardIds"],
          message: "A batch ledger record cannot contain a chapter twice."
        });
      }
      const checkpointChapterCardId = record.checkpointChapterCardId;
      if (
        checkpointChapterCardId === undefined ||
        chapterCardIds.at(-1) !== checkpointChapterCardId ||
        record.chapterCardId !== checkpointChapterCardId
      ) {
        context.addIssue({
          code: "custom",
          path: ["checkpointChapterCardId"],
          message:
            "The batch checkpoint and compatibility chapter must be the final batch chapter."
        });
      }
    }
    if (record.schemaVersion === 3) {
      for (const [key, item] of Object.entries(record.coverage)) {
        if (item.note.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["coverage", key, "note"],
            message:
              "A v3 ledger record requires a non-empty note for every coverage domain."
          });
        }
      }
      if (
        record.chapterOutputs.characterState.length === 0 ||
        record.chapterOutputs.handoff.summary.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["chapterOutputs"],
          message:
            "A v3 ledger record requires non-empty character state and handoff outputs."
        });
      }
    }

    record.placementChanges.forEach((change, index) => {
      if (
        change.after.commitId !== record.id ||
        (change.after.status !== "committed" &&
          change.after.status !== "missed")
      ) {
        context.addIssue({
          code: "custom",
          path: ["placementChanges", index, "after"],
          message:
            "Committed placement decisions must reference this ledger commit."
        });
      }
    });
    record.foreshadowingBeatChanges.forEach((change, index) => {
      if (
        change.after.commitId !== record.id ||
        (change.after.status !== "committed" &&
          change.after.status !== "missed")
      ) {
        context.addIssue({
          code: "custom",
          path: ["foreshadowingBeatChanges", index, "after"],
          message:
            "Committed foreshadowing decisions must reference this ledger commit."
        });
      }
    });

    const unique = (values: readonly string[]) =>
      new Set(values).size === values.length;
    if (
      !unique(record.placementChanges.map(({ placementId }) => placementId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["placementChanges"],
        message: "A ledger record cannot decide the same placement twice."
      });
    }
    if (!unique(record.foreshadowingBeatChanges.map(({ beatId }) => beatId))) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingBeatChanges"],
        message:
          "A ledger record cannot decide the same foreshadowing beat twice."
      });
    }
    if (
      !unique(
        record.foreshadowingThreadChanges.map(
          ({ foreshadowingId }) => foreshadowingId
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingThreadChanges"],
        message:
          "A ledger record cannot change the same foreshadowing thread twice."
      });
    }
    if (!unique(record.factChanges.map(({ after }) => after.factId))) {
      context.addIssue({
        code: "custom",
        path: ["factChanges"],
        message: "A ledger record cannot change the same fact twice."
      });
    }
    const knowledgeKeys = record.knowledgeChanges.map(
      ({ after }) =>
        `${after.factId}\0${after.audienceType}\0${after.audienceId ?? ""}`
    );
    if (!unique(knowledgeKeys)) {
      context.addIssue({
        code: "custom",
        path: ["knowledgeChanges"],
        message: "A ledger record cannot change the same knowledge key twice."
      });
    }
    if (!unique(record.openLoopChanges.map(({ after }) => after.loopId))) {
      context.addIssue({
        code: "custom",
        path: ["openLoopChanges"],
        message: "A ledger record cannot change the same open loop twice."
      });
    }
    for (const [kind, changes] of [
      ["fact", record.factChanges],
      ["knowledge", record.knowledgeChanges],
      ["open-loop", record.openLoopChanges]
    ] as const) {
      changes.forEach((change, index) => {
        if (
          change.after.sourceCommitId !== record.id ||
          change.after.sourceChapterCardId !== record.chapterCardId
        ) {
          context.addIssue({
            code: "custom",
            path: [`${kind}Changes`, index, "after"],
            message: `A ${kind} change must carry this commit and chapter as its source.`
          });
        }
      });
    }
  });
export type LongLedgerCommitRecord = z.infer<
  typeof LongLedgerCommitRecordSchema
>;

export function longLedgerRecordChapterIds(
  record: Pick<
    LongLedgerCommitRecord,
    "schemaVersion" | "chapterCardId" | "chapterCardIds"
  >
): string[] {
  return record.schemaVersion === 5 && record.chapterCardIds
    ? [...record.chapterCardIds]
    : [record.chapterCardId];
}

export function longLedgerRecordCheckpointChapterId(
  record: Pick<
    LongLedgerCommitRecord,
    "schemaVersion" | "chapterCardId" | "checkpointChapterCardId"
  >
): string {
  return record.schemaVersion === 5
    ? (record.checkpointChapterCardId ?? record.chapterCardId)
    : record.chapterCardId;
}
