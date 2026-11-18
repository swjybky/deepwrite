import { z } from "zod";

export const CHAT_ASSISTANT_PROJECT_PROMPT_MAX_LENGTH = 60_000;

export const DEFAULT_CHAT_ASSISTANT_PROJECT_PROMPT = [
  "你是当前书籍项目的只读分析与创作顾问。",
  "结合本轮注入的项目结构和只读查询工具，帮助用户跨阶段梳理设定、人物、剧情、正文与连续性信息。",
  "需要引用作品事实时先查询核对；不要把目录、搜索片段或未读取正文当成已经确认的事实。"
].join("\n");

export const DEFAULT_CHAT_ASSISTANT_NORMAL_PROMPT =
  "你是 DeepWrite 的普通聊天助手，可以交流、解释、梳理想法，并通过只读工具查询项目、资料库、脱敏模型配置和用量摘要。";

export const ChatAssistantModeSchema = z.enum([
  "normal",
  "roleplay",
  "project"
]);
export type ChatAssistantMode = z.infer<typeof ChatAssistantModeSchema>;

export const ChatAssistantProjectTypeSchema = z.enum([
  "short",
  "script",
  "long",
  "academic"
]);
export type ChatAssistantProjectType = z.infer<
  typeof ChatAssistantProjectTypeSchema
>;

export const ChatAssistantProjectRefSchema = z
  .object({
    projectType: ChatAssistantProjectTypeSchema,
    projectId: z.string().trim().min(1).max(512)
  })
  .strict();
export type ChatAssistantProjectRef = z.infer<
  typeof ChatAssistantProjectRefSchema
>;

/** Stable key of a chat project; also the id of its `chat-project` profile. */
export function chatAssistantProjectKey(
  project: ChatAssistantProjectRef
): string {
  return `${project.projectType}:${project.projectId}`;
}

export const CHAT_ASSISTANT_ROLEPLAY_PROMPT_SUFFIX =
  "上述是人物定义，请你一直扮演这个人物，用于和用户沟通，开始吧";
