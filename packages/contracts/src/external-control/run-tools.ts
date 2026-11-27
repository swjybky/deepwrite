import { z } from "zod";
import { EnvelopeBaseSchema } from "../envelope";
import type { ExternalControlOverview } from "./commands";
import {
  AgentUserInputAnswerSchema,
  AgentUserInputQuestionsSchema,
  AgentUserInputSourceSchema
} from "../session/user-input";

const IdSchema = z.string().trim().min(1).max(512);

export const ExternalAgentModeSchema = z.enum(["normal", "team"]);

/** Exactly one of workId and libraryId; checked by the route. */
const targetFields = {
  workId: IdSchema.optional().describe("Target work from list_works."),
  libraryId: IdSchema.optional().describe("Target library from list_libraries.")
};

export const ExternalOpenInAppInputSchema = z.object(targetFields).strict();

export const ExternalRunAgentInputSchema = z
  .object({
    ...targetFields,
    message: z
      .string()
      .trim()
      .min(1)
      .max(20_000)
      .describe("What to ask DeepWrite's built-in agent to do."),
    sessionId: IdSchema.optional().describe(
      "Continue a returned sessionId on this target. Cannot combine with newConversation."
    ),
    newConversation: z
      .boolean()
      .optional()
      .describe("Start a new conversation instead of continuing the current."),
    mode: ExternalAgentModeSchema.optional().describe(
      "team runs the work's agent team and fails if it has none. normal runs the main agent alone. Omit to use the team when there is one."
    )
  })
  .strict();

const RunIdSchema = IdSchema.describe("runId from run_agent.");

export const ExternalAgentRunInputSchema = z
  .object({ runId: RunIdSchema })
  .strict();

export const ExternalAnswerAgentQuestionInputSchema = z
  .object({
    runId: RunIdSchema,
    answers: z
      .array(AgentUserInputAnswerSchema)
      .min(1)
      .describe(
        "One answer per question: its id, plus selectedOptionIds or text."
      )
  })
  .strict();

export const ExternalRestartAppInputSchema = z
  .object({
    force: z
      .boolean()
      .optional()
      .describe(
        "Force restart even if agent runs are active or the app window/process is unresponsive. Defaults to false."
      ),
    waitForReady: z
      .boolean()
      .optional()
      .describe(
        "Wait for the restarted DeepWrite instance to come back online and reconnect automatically. Defaults to true."
      )
  })
  .strict();

export const ExternalRestartAppResultSchema = z
  .object({
    restarted: z.boolean(),
    restarting: z.boolean().optional(),
    launched: z.boolean().optional(),
    forced: z.boolean().optional(),
    previousPid: z.number().int().positive().optional(),
    pid: z.number().int().positive().optional(),
    appVersion: z.string().min(1).optional(),
    rendererReady: z.boolean().optional(),
    activeRunCount: z.number().int().nonnegative().optional(),
    permissionMode: z.string().min(1).optional()
  })
  .strict();

export type ExternalOpenInAppInput = z.infer<
  typeof ExternalOpenInAppInputSchema
>;
export type ExternalRunAgentInput = z.infer<typeof ExternalRunAgentInputSchema>;
export type ExternalAgentRunInput = z.infer<typeof ExternalAgentRunInputSchema>;
export type ExternalAnswerAgentQuestionInput = z.infer<
  typeof ExternalAnswerAgentQuestionInputSchema
>;
export type ExternalRestartAppInput = z.infer<
  typeof ExternalRestartAppInputSchema
>;
export type ExternalRestartAppResult = z.infer<
  typeof ExternalRestartAppResultSchema
>;

export const ExternalAgentRunStatusSchema = z.enum([
  "running",
  "waiting_for_input",
  "waiting_for_user",
  "completed",
  "failed",
  "stopped",
  "interrupted"
]);

const ToolCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    directSucceeded: z.number().int().nonnegative().default(0),
    normalizedSucceeded: z.number().int().nonnegative().default(0),
    failed: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative()
  })
  .strict();
export const ExternalToolUsageSchema = ToolCountsSchema.extend({
  byTool: z.array(ToolCountsSchema.extend({ name: z.string().min(1) }).strict())
}).strict();
export type ExternalToolUsage = z.infer<typeof ExternalToolUsageSchema>;

export const ExternalWindowTargetSchema = z
  .object({
    kind: z.enum(["short", "script", "long", "academic", "mystery", "library"]),
    id: IdSchema
  })
  .strict();
export type ExternalWindowTarget = z.infer<typeof ExternalWindowTargetSchema>;

export const ExternalRunRecoverySchema = z
  .object({
    runId: IdSchema,
    sessionId: IdSchema,
    assistantId: IdSchema,
    lastStatus: ExternalAgentRunStatusSchema.optional(),
    internalRunId: IdSchema.optional(),
    target: ExternalWindowTargetSchema,
    mode: ExternalAgentModeSchema.optional()
  })
  .strict();
export type ExternalRunRecovery = z.infer<typeof ExternalRunRecoverySchema>;

export const ExternalAgentRunSchema = z
  .object({
    runId: IdSchema,
    sessionId: IdSchema.optional(),
    workId: IdSchema.optional(),
    libraryId: IdSchema.optional(),
    status: ExternalAgentRunStatusSchema,
    /** How this run was sent; absent for libraries, which have no teams. */
    mode: ExternalAgentModeSchema.optional(),
    /** The agent's latest reply so far. */
    reply: z.string(),
    /** Documents this run changed or proposed, by title. */
    changes: z.array(z.string()),
    /** Present while status is waiting_for_input. */
    questionSource: AgentUserInputSourceSchema.optional(),
    questions: AgentUserInputQuestionsSchema.optional(),
    error: z.string().optional(),
    toolUsage: ExternalToolUsageSchema.optional(),
    lastCompletedTool: z
      .object({
        name: z.string(),
        completedAt: z.string().optional(),
        success: z.boolean()
      })
      .strict()
      .optional(),
    recovery: z
      .object({ available: z.boolean(), resumedFromDisk: z.boolean() })
      .strict()
      .optional()
  })
  .strict();
export type ExternalAgentRun = z.infer<typeof ExternalAgentRunSchema>;

/** What Main may ask the window to do; each case has one bridge handler. */
export const ExternalWindowRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("open_target"),
      target: ExternalWindowTargetSchema
    })
    .strict(),
  z
    .object({
      action: z.literal("start_run"),
      target: ExternalWindowTargetSchema,
      message: ExternalRunAgentInputSchema.shape.message,
      sessionId: IdSchema.optional().describe(
        "Continue a returned sessionId on this target. Cannot combine with newConversation."
      ),
      newConversation: z.boolean().optional(),
      mode: ExternalAgentModeSchema.optional()
    })
    .strict(),
  z.object({ action: z.literal("run_status"), runId: IdSchema }).strict(),
  z
    .object({
      action: z.literal("answer_run"),
      runId: IdSchema,
      answers: ExternalAnswerAgentQuestionInputSchema.shape.answers
    })
    .strict(),
  z.object({ action: z.literal("stop_run"), runId: IdSchema }).strict(),
  z
    .object({ action: z.literal("long_editor_state"), bookId: IdSchema })
    .strict()
]);
export type ExternalWindowRequest = z.infer<typeof ExternalWindowRequestSchema>;

export const ExternalControlWindowRequestEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("externalControl.window_request"),
    payload: ExternalWindowRequestSchema
  });

export const ExternalWindowResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      requestId: z.string().min(1),
      ok: z.literal(true),
      result: z.unknown()
    })
    .strict(),
  z
    .object({
      requestId: z.string().min(1),
      ok: z.literal(false),
      code: z.enum([
        "external.not_found",
        "external.busy",
        "external.not_ready",
        "external.invalid_input"
      ]),
      message: z.string().min(1).max(600)
    })
    .strict()
]);
export type ExternalWindowResponse = z.infer<
  typeof ExternalWindowResponseSchema
>;

export const ExternalControlWindowResponseCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("externalControl.window_response"),
    payload: ExternalWindowResponseSchema
  });

export interface ExternalControlPreloadApi {
  respond(response: ExternalWindowResponse): Promise<void>;
  overview(): Promise<ExternalControlOverview>;
  revokeClient(name: string): Promise<ExternalControlOverview>;
  restoreTrash(trashId: string): Promise<ExternalControlOverview>;
  emptyTrash(): Promise<ExternalControlOverview>;
  installSkill(targetId: string): Promise<ExternalControlOverview>;
}
