import { z } from "zod";
import { ThinkingLevelSchema } from "./models";
import {
  LongBookAnalysisNoteSchema,
  LongBookAnalysisResultSchema
} from "./long-book-analysis-limits";
import { LongBookAnalysisSavedSourceIdSchema } from "./long-book-analysis-sources";

/** Upper bounds that keep a plan file small enough to round-trip over IPC. */
export const LONG_BOOK_ANALYSIS_PLAN_MAX_TASKS = 5_000;
export const LONG_BOOK_ANALYSIS_PLAN_MAX_PLANS = 20;
export const LONG_BOOK_ANALYSIS_PLAN_MAX_BYTES = 16 * 1024 * 1024;
/** Matches the runtime context's own cap on notes per unit. */
const PLAN_CHECKPOINT_MAX_NOTES = 100;

export const LongBookAnalysisPlanIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/u, "计划 id 只能包含字母、数字、下划线和连字符。");

export const LongBookAnalysisTaskStatusSchema = z.enum([
  "queued",
  "running",
  /** Parked because the agent process is at its concurrent-run ceiling. */
  "waiting_capacity",
  "retrying",
  "completed",
  "skipped",
  "stopped",
  "failed"
]);
export type LongBookAnalysisTaskStatus = z.infer<
  typeof LongBookAnalysisTaskStatusSchema
>;

export const LongBookAnalysisPlanStatusSchema = z.enum([
  "running",
  "paused",
  "completed",
  /** Stopped by an unrecoverable condition (for example exhausted credit). */
  "halted"
]);
export type LongBookAnalysisPlanStatus = z.infer<
  typeof LongBookAnalysisPlanStatusSchema
>;

/**
 * Batch-level progress inside one round. Written after every completed batch so
 * a restart resumes mid-round instead of redoing finished work.
 */
export const LongBookAnalysisRoundCheckpointSchema = z.object({
  batchIndex: z.number().int().min(0),
  reductionRounds: z.number().int().min(0),
  notes: z.array(LongBookAnalysisNoteSchema).max(PLAN_CHECKPOINT_MAX_NOTES)
});
export type LongBookAnalysisRoundCheckpoint = z.infer<
  typeof LongBookAnalysisRoundCheckpointSchema
>;

export const LongBookAnalysisPlanTaskSchema = z.object({
  id: z.string().trim().min(1).max(120),
  presetId: z.string().trim().min(1).max(120),
  presetName: z.string().trim().min(1).max(80),
  /** Zero-based index of the chapter window this task covers. */
  roundIndex: z.number().int().min(0),
  startOrder: z.number().int().min(1),
  endOrder: z.number().int().min(1),
  /** Frozen when the plan is created so later preset edits cannot retarget it. */
  libraryId: z.string().trim().min(1).max(512),
  status: LongBookAnalysisTaskStatusSchema,
  attempts: z.number().int().min(0).max(10),
  error: z.string().max(2_000).optional(),
  checkpoint: LongBookAnalysisRoundCheckpointSchema.optional(),
  /** Library entry written for this round, when it landed. */
  entry: z
    .object({ id: z.string().max(120), title: z.string().max(256) })
    .optional(),
  /** Result that could not be written to the library, kept for manual retry. */
  unsavedResult: LongBookAnalysisResultSchema.optional()
});
export type LongBookAnalysisPlanTask = z.infer<
  typeof LongBookAnalysisPlanTaskSchema
>;

export const LongBookAnalysisPlanSchema = z
  .object({
    version: z.literal(1),
    id: LongBookAnalysisPlanIdSchema,
    sourceId: LongBookAnalysisSavedSourceIdSchema,
    sourceTitle: z.string().trim().min(1).max(256),
    sourceChapterCount: z.number().int().min(1),
    modelId: z.string().trim().min(1),
    thinkingLevel: ThinkingLevelSchema,
    /** Whole selection the user asked for; rounds are derived from it. */
    startOrder: z.number().int().min(1),
    endOrder: z.number().int().min(1),
    /** Whether opening the analysis page resumes this plan automatically. */
    autoContinueOnLaunch: z.boolean(),
    status: LongBookAnalysisPlanStatusSchema,
    haltReason: z.string().max(2_000).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    tasks: z.array(LongBookAnalysisPlanTaskSchema).max(
      LONG_BOOK_ANALYSIS_PLAN_MAX_TASKS
    )
  })
  .superRefine((plan, context) => {
    if (plan.endOrder < plan.startOrder) {
      context.addIssue({
        code: "custom",
        path: ["endOrder"],
        message: "结束章节不能早于开始章节。"
      });
    }
    const ids = new Set<string>();
    for (const [index, task] of plan.tasks.entries()) {
      if (ids.has(task.id)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: "计划内的任务 id 必须唯一。"
        });
      }
      ids.add(task.id);
      if (task.endOrder < task.startOrder) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "endOrder"],
          message: "任务的结束章节不能早于开始章节。"
        });
      }
    }
  });
export type LongBookAnalysisPlan = z.infer<typeof LongBookAnalysisPlanSchema>;
