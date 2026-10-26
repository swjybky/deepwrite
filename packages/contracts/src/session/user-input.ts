import { z } from "zod";
import { AgentRuntimeRefSchema } from "./agent-event-identity";
import {
  SUBAGENT_DRAW_MAX_COUNT,
  SUBAGENT_DRAW_MIN_COUNT,
  SUBAGENT_DRAW_VARIANT_MAX_LENGTH
} from "../subagent-settings";

export const AGENT_USER_INPUT_MAX_QUESTIONS = 3;
export const AGENT_USER_INPUT_MAX_OPTIONS = 5;

export const AgentUserInputSourceSchema = z.enum([
  "ask_user_question",
  "cross_stage_write",
  "subagent_draw"
]);
export type AgentUserInputSource = z.infer<typeof AgentUserInputSourceSchema>;

export const AgentUserInputOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500).optional()
  })
  .strict();
export type AgentUserInputOption = z.infer<typeof AgentUserInputOptionSchema>;

export const AgentUserInputQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(1_000),
    header: z.string().trim().min(1).max(40).optional(),
    options: z
      .array(AgentUserInputOptionSchema)
      .min(2)
      .max(AGENT_USER_INPUT_MAX_OPTIONS)
      .optional(),
    multi_select: z.boolean().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const optionIds = new Set<string>();
    value.options?.forEach((option, index) => {
      if (optionIds.has(option.id)) {
        context.addIssue({
          code: "custom",
          path: ["options", index, "id"],
          message: `Duplicate option id: ${option.id}`
        });
      }
      optionIds.add(option.id);
    });
    if (value.multi_select === true && !value.options) {
      context.addIssue({
        code: "custom",
        path: ["multi_select"],
        message: "Multi-select questions require options."
      });
    }
  });
export type AgentUserInputQuestion = z.infer<
  typeof AgentUserInputQuestionSchema
>;

export const AgentUserInputQuestionsSchema = z
  .array(AgentUserInputQuestionSchema)
  .min(1)
  .max(AGENT_USER_INPUT_MAX_QUESTIONS)
  .superRefine((questions, context) => {
    const questionIds = new Set<string>();
    questions.forEach((question, index) => {
      if (questionIds.has(question.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate question id: ${question.id}`
        });
      }
      questionIds.add(question.id);
    });
  });

export const AgentUserInputAnswerSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    selectedOptionIds: z
      .array(z.string().trim().min(1).max(80))
      .max(AGENT_USER_INPUT_MAX_OPTIONS)
      .optional(),
    text: z.string().max(4_000).optional()
  })
  .strict()
  .superRefine((value, context) => {
    const selected = value.selectedOptionIds ?? [];
    if (new Set(selected).size !== selected.length) {
      context.addIssue({
        code: "custom",
        path: ["selectedOptionIds"],
        message: "Selected option ids must be unique."
      });
    }
    if (selected.length === 0 && !value.text?.trim()) {
      context.addIssue({
        code: "custom",
        message: "An answer must contain a selected option or text."
      });
    }
  });
export type AgentUserInputAnswer = z.infer<typeof AgentUserInputAnswerSchema>;

/** Question id of a draw selection; its answer picks one candidate id. */
export const SUBAGENT_DRAW_QUESTION_ID = "draw";
/** Option id the user picks to adopt none of the candidates. */
export const SUBAGENT_DRAW_REJECT_OPTION_ID = "reject";

export const AgentUserInputDrawCandidateSchema = z
  .object({
    /** `c1`…`c10`, echoed in `selectedOptionIds`. */
    id: z.string().regex(/^c(?:[1-9]|10)$/),
    /** Zero-based draw position, also when earlier draws failed. */
    index: z
      .number()
      .int()
      .min(0)
      .max(SUBAGENT_DRAW_MAX_COUNT - 1),
    subagentRunId: z.string().min(1),
    text: z.string().min(1).max(20_000),
    /** The parent's requirement for this draw in auto-count mode. */
    variant: z.string().min(1).max(SUBAGENT_DRAW_VARIANT_MAX_LENGTH).optional()
  })
  .strict();
export type AgentUserInputDrawCandidate = z.infer<
  typeof AgentUserInputDrawCandidateSchema
>;

/** The successful candidates of a manual draw selection. */
export const AgentUserInputDrawSchema = z
  .object({
    parentToolCallId: z.string().min(1),
    subagentId: z.string().min(1).max(120),
    name: z.string().trim().min(1).max(80),
    taskKey: z.string().min(1).max(40).optional(),
    task: z.string().min(1).max(20_000),
    count: z
      .number()
      .int()
      .min(SUBAGENT_DRAW_MIN_COUNT)
      .max(SUBAGENT_DRAW_MAX_COUNT),
    candidates: z
      .array(AgentUserInputDrawCandidateSchema)
      .min(2)
      .max(SUBAGENT_DRAW_MAX_COUNT),
    /** Why the evaluator handed the choice to the user. */
    fallbackReason: z.string().min(1).max(2_000).optional()
  })
  .strict();
export type AgentUserInputDraw = z.infer<typeof AgentUserInputDrawSchema>;

export const AgentUserInputRequestedPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    requestId: z.string().min(1),
    toolCallId: z.string().min(1),
    source: AgentUserInputSourceSchema,
    questions: AgentUserInputQuestionsSchema,
    /** Present exactly when `source` is `subagent_draw`. */
    draw: AgentUserInputDrawSchema.optional(),
    runtime: AgentRuntimeRefSchema
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.source === "subagent_draw") !== (value.draw !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["draw"],
        message: "Draw candidates belong to subagent_draw requests only."
      });
    }
  });
export type AgentUserInputRequestedPayload = z.infer<
  typeof AgentUserInputRequestedPayloadSchema
>;

export const SessionUserInputResponsePayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    requestId: z.string().min(1),
    answers: z
      .array(AgentUserInputAnswerSchema)
      .min(1)
      .max(AGENT_USER_INPUT_MAX_QUESTIONS)
  })
  .strict();
export type SessionUserInputResponsePayload = z.infer<
  typeof SessionUserInputResponsePayloadSchema
>;

export const SessionUserInputResponseAcceptedPayloadSchema =
  SessionUserInputResponsePayloadSchema.pick({
    sessionId: true,
    runId: true,
    requestId: true
  }).extend({ resolvedAt: z.string().datetime() });
export type SessionUserInputResponseAcceptedPayload = z.infer<
  typeof SessionUserInputResponseAcceptedPayloadSchema
>;
