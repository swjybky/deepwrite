import {
  BookTitleDesignTaskInputSchema,
  BookSynopsisDesignTaskInputSchema,
  BookCoverDesignTaskInputSchema,
  BookTitleDesignResolvedInputSchema,
  BookSynopsisDesignResolvedInputSchema,
  BookCoverDesignResolvedInputSchema
} from "../book-identity/tasks";
import {
  BookTitleDesignProfileSchema,
  BookSynopsisDesignProfileSchema,
  BookCoverDesignProfileSchema
} from "../book-identity/profiles";
import { z } from "zod";
import {
  DecompositionTaskInputSchema,
  DecompositionResolvedInputSchema
} from "../long-book-decomposition/job";
import { LongBookDecompositionProfileSchema } from "../long-book-decomposition/profile";
import {
  LongMaterialGuideResolvedInputSchema,
  LongMaterialGuideTaskInputSchema
} from "../long-material-pack/guide";
import { LongBookAnalysisRuntimeContextSchema } from "../long-book-analysis";
import { LongBookAnalysisPresetSchema } from "../long-book-analysis-presets";
import {
  AgentProviderRuntimeConfigSchema,
  TemperatureSchema,
  ThinkingLevelSchema
} from "../models";
import { RevisionAnalysisRuntimeContextSchema } from "../revision-analysis";
import { UserPromptAttachmentsSchema } from "../session/attachments";
import { SessionConversationHistorySchema } from "../session/commands";
import {
  ContextCompactionRequestSchema,
  ContextCompactionRunSettingsSchema,
  ConversationCheckpointSchema
} from "../session/context-compaction-state";
import { ShortBookAnalysisRuntimeContextSchema } from "../short-book-analysis";
import { ShortBookAnalysisPresetSchema } from "../short-book-analysis-presets";
import { StyleComparisonRuntimeContextSchema } from "../style-comparison";
import { chatAssistantProjectKey } from "../chat-assistant-base";
import {
  ChatNormalProfileSchema,
  ChatNormalRuntimeInputSchema,
  ChatNormalTaskInputSchema,
  ChatProjectProfileIdSchema,
  ChatProjectProfileSchema,
  ChatProjectRuntimeInputSchema,
  ChatProjectTaskInputSchema,
  ChatRoleplayProfileSchema,
  ChatRoleplayTaskInputSchema
} from "./chat";
import {
  ExtrasAgentProfileIdSchema,
  isExtrasConversationAgent,
  type ExtrasAgentId
} from "./ids";
import {
  LongMaterialGuideProfileSchema,
  RevisionAnalysisProfileSchema,
  StyleComparisonProfileSchema
} from "./profiles";

const EXTRAS_AGENT_INPUT_SCHEMAS = {
  "revision-analysis": RevisionAnalysisRuntimeContextSchema,
  "short-book-analysis": ShortBookAnalysisRuntimeContextSchema,
  "long-book-analysis": LongBookAnalysisRuntimeContextSchema,
  "style-comparison": StyleComparisonRuntimeContextSchema
} as const;

function taskVariant<A extends ExtrasAgentId, I extends z.ZodType>(
  agentId: A,
  input: I,
  profileId: z.ZodType<string> = ExtrasAgentProfileIdSchema
) {
  return z.object({ agentId: z.literal(agentId), profileId, input });
}

/** What the Renderer asks for: an agent, a saved profile and the task input. */
export const ExtrasAgentTaskSchema = z.discriminatedUnion("agentId", [
  taskVariant("book-title-design", BookTitleDesignTaskInputSchema),
  taskVariant("book-synopsis-design", BookSynopsisDesignTaskInputSchema),
  taskVariant("book-cover-design", BookCoverDesignTaskInputSchema),
  taskVariant(
    "revision-analysis",
    EXTRAS_AGENT_INPUT_SCHEMAS["revision-analysis"]
  ),
  taskVariant(
    "short-book-analysis",
    EXTRAS_AGENT_INPUT_SCHEMAS["short-book-analysis"]
  ),
  taskVariant(
    "long-book-analysis",
    EXTRAS_AGENT_INPUT_SCHEMAS["long-book-analysis"]
  ),
  taskVariant(
    "style-comparison",
    EXTRAS_AGENT_INPUT_SCHEMAS["style-comparison"]
  ),
  taskVariant("long-book-decomposition", DecompositionTaskInputSchema),
  taskVariant("long-material-guide", LongMaterialGuideTaskInputSchema),
  taskVariant("chat-normal", ChatNormalTaskInputSchema),
  // A project chat names its project's profile; Main falls back to the
  // built-in prompt when the project has none yet.
  taskVariant(
    "chat-project",
    ChatProjectTaskInputSchema,
    ChatProjectProfileIdSchema
  ).superRefine((task, context) => {
    if (task.profileId !== chatAssistantProjectKey(task.input.project)) {
      context.addIssue({
        code: "custom",
        path: ["profileId"],
        message: "Chat project profile must match the selected project."
      });
    }
  }),
  taskVariant("chat-roleplay", ChatRoleplayTaskInputSchema)
]);
export type ExtrasAgentTask = z.infer<typeof ExtrasAgentTaskSchema>;
export type ExtrasChatTask = Extract<
  ExtrasAgentTask,
  { agentId: "chat-normal" | "chat-project" | "chat-roleplay" }
>;

function resolvedVariant<
  A extends ExtrasAgentId,
  P extends z.ZodType,
  I extends z.ZodType
>(agentId: A, profile: P, input: I) {
  return z.object({ agentId: z.literal(agentId), profile, input });
}

/** What Main hands the Agent Utility after resolving the saved profile. */
export const ExtrasAgentResolvedTaskSchema = z.discriminatedUnion("agentId", [
  resolvedVariant(
    "book-title-design",
    BookTitleDesignProfileSchema,
    BookTitleDesignResolvedInputSchema
  ),
  resolvedVariant(
    "book-synopsis-design",
    BookSynopsisDesignProfileSchema,
    BookSynopsisDesignResolvedInputSchema
  ),
  resolvedVariant(
    "book-cover-design",
    BookCoverDesignProfileSchema,
    BookCoverDesignResolvedInputSchema
  ),
  resolvedVariant(
    "revision-analysis",
    RevisionAnalysisProfileSchema,
    EXTRAS_AGENT_INPUT_SCHEMAS["revision-analysis"]
  ),
  resolvedVariant(
    "short-book-analysis",
    ShortBookAnalysisPresetSchema,
    EXTRAS_AGENT_INPUT_SCHEMAS["short-book-analysis"]
  ),
  resolvedVariant(
    "long-book-analysis",
    LongBookAnalysisPresetSchema,
    EXTRAS_AGENT_INPUT_SCHEMAS["long-book-analysis"]
  ),
  resolvedVariant(
    "style-comparison",
    StyleComparisonProfileSchema,
    EXTRAS_AGENT_INPUT_SCHEMAS["style-comparison"]
  ),
  resolvedVariant(
    "long-book-decomposition",
    LongBookDecompositionProfileSchema,
    DecompositionResolvedInputSchema
  ),
  resolvedVariant(
    "long-material-guide",
    LongMaterialGuideProfileSchema,
    LongMaterialGuideResolvedInputSchema
  ),
  resolvedVariant(
    "chat-normal",
    ChatNormalProfileSchema,
    ChatNormalRuntimeInputSchema
  ),
  resolvedVariant(
    "chat-project",
    ChatProjectProfileSchema,
    ChatProjectRuntimeInputSchema
  ),
  resolvedVariant(
    "chat-roleplay",
    ChatRoleplayProfileSchema,
    ChatRoleplayTaskInputSchema
  )
]);
export type ExtrasAgentResolvedTask = z.infer<
  typeof ExtrasAgentResolvedTaskSchema
>;
export type ExtrasAgentResolvedTaskOf<
  A extends ExtrasAgentResolvedTask["agentId"]
> = Extract<ExtrasAgentResolvedTask, { agentId: A }>;

/** The turn a conversation agent answers, with the history before it. */
export const ExtrasAgentConversationSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  history: SessionConversationHistorySchema.optional(),
  /** Discards the cached conversation and rebuilds it from `history`. */
  historyMode: z.literal("replace").optional(),
  /** Summary of turns older than `history`, if any. */
  checkpoint: ConversationCheckpointSchema.optional(),
  /** Compact the conversation context before this reply. */
  compaction: ContextCompactionRequestSchema.optional(),
  attachments: UserPromptAttachmentsSchema.optional()
});
export type ExtrasAgentConversation = z.infer<
  typeof ExtrasAgentConversationSchema
>;

function validateConversation(
  value: { task: { agentId: ExtrasAgentId }; conversation?: unknown },
  context: z.core.$RefinementCtx<unknown>
): void {
  const expected = isExtrasConversationAgent(value.task.agentId);
  if (expected !== (value.conversation !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["conversation"],
      message: expected
        ? "Conversation agents require the conversation turn."
        : "Only conversation agents accept a conversation turn."
    });
  }
}

export const ExtrasAgentRunRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    modelId: z.string().min(1).max(120).optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional(),
    task: ExtrasAgentTaskSchema,
    conversation: ExtrasAgentConversationSchema.optional()
  })
  .superRefine(validateConversation);
export type ExtrasAgentRunRequest = z.infer<typeof ExtrasAgentRunRequestSchema>;

/** Credentials stay in Main and the Agent Utility; never sent to Renderer. */
export const ExtrasAgentRunSpecSchema = z
  .object({
    sessionId: z.string().min(1),
    runtimeConfig: AgentProviderRuntimeConfigSchema.optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional(),
    task: ExtrasAgentResolvedTaskSchema,
    conversation: ExtrasAgentConversationSchema.optional(),
    /** Main-resolved compaction settings for conversation agents. */
    contextCompactionSettings: ContextCompactionRunSettingsSchema.optional(),
    compactionRuntimeConfig: AgentProviderRuntimeConfigSchema.optional()
  })
  .superRefine(validateConversation);
export type ExtrasAgentRunSpec = z.infer<typeof ExtrasAgentRunSpecSchema>;
