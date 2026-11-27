import { z } from "zod";
import type {
  ChatAssistantProjectRuntimeSnapshot,
  ChatAssistantRuntimeSnapshot
} from "../chat-assistant";
import {
  CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH,
  ChatAssistantProjectRefSchema,
  chatAssistantProjectKey
} from "../chat-assistant-base";
import { ExtrasAgentProfileIdSchema } from "./ids";
import { isRecord } from "@deepwrite/shared";

const ChatPromptSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH);

/** The normal chat persona; only its built-in profile is used today. */
export const ChatNormalProfileSchema = z.object({
  id: ExtrasAgentProfileIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  builtin: z.boolean().optional(),
  systemPrompt: ChatPromptSchema
});
export type ChatNormalProfile = z.infer<typeof ChatNormalProfileSchema>;

export const CHAT_PROJECT_DEFAULT_PROFILE_ID = "default";
export const ChatProjectProfileIdSchema = z.string().trim().min(1).max(600);

const ChatProjectProfileObjectSchema = z.object({
  id: ChatProjectProfileIdSchema,
  name: z.string().trim().min(1).max(256),
  /** Absent only on the built-in fallback profile. */
  project: ChatAssistantProjectRefSchema.optional(),
  builtin: z.boolean().optional(),
  systemPrompt: ChatPromptSchema
});

function validateChatProjectProfile(
  profile: {
    id: string;
    project?: z.infer<typeof ChatAssistantProjectRefSchema> | undefined;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  const expected = profile.project
    ? chatAssistantProjectKey(profile.project)
    : CHAT_PROJECT_DEFAULT_PROFILE_ID;
  if (profile.id !== expected) {
    context.addIssue({
      code: "custom",
      path: ["id"],
      message: "项目聊天配置的标识必须与所选项目一致。"
    });
  }
}

/**
 * One configured chat project, with the id `<projectType>:<projectId>`. The
 * built-in `default` profile holds the prompt for projects without their own.
 */
export const ChatProjectProfileSchema =
  ChatProjectProfileObjectSchema.superRefine(validateChatProjectProfile);
export type ChatProjectProfile = z.infer<typeof ChatProjectProfileSchema>;
export const ChatProjectProfileInputSchema =
  ChatProjectProfileObjectSchema.omit({ builtin: true }).superRefine(
    validateChatProjectProfile
  );

/** A role for roleplay chat; the system prompt is the role definition. */
export const ChatRoleplayProfileSchema = z.object({
  id: ExtrasAgentProfileIdSchema,
  name: z.string().trim().min(1).max(120),
  builtin: z.boolean().optional(),
  systemPrompt: ChatPromptSchema
});
export type ChatRoleplayProfile = z.infer<typeof ChatRoleplayProfileSchema>;

/** Chat task inputs sent by the Renderer. */
export const ChatNormalTaskInputSchema = z
  .object({ webSearchEnabled: z.boolean().optional() })
  .strict();
export const ChatProjectTaskInputSchema = z
  .object({
    project: ChatAssistantProjectRefSchema,
    webSearchEnabled: z.boolean().optional()
  })
  .strict();
export const ChatRoleplayTaskInputSchema = z.object({}).strict();

/**
 * Chat inputs Main hands the Agent Utility. Main fully parses the runtime
 * snapshot; this transport check stays light so the large catalog and usage
 * schemas are not evaluated again for every turn.
 */
export const ChatNormalRuntimeInputSchema = ChatNormalTaskInputSchema.extend({
  runtime: z.custom<ChatAssistantRuntimeSnapshot>(isRecord)
});
export const ChatProjectRuntimeInputSchema = ChatProjectTaskInputSchema.extend({
  runtime: z.custom<ChatAssistantProjectRuntimeSnapshot>(isRecord)
}).superRefine((value, context) => {
  const book = (value.runtime as Partial<ChatAssistantProjectRuntimeSnapshot>)
    .projectBook;
  if (
    book?.id !== value.project.projectId ||
    book.bookType !== value.project.projectType
  ) {
    context.addIssue({
      code: "custom",
      path: ["runtime", "projectBook"],
      message: "Chat project snapshot must match the selected project."
    });
  }
});
