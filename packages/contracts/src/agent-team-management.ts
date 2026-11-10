import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { LibraryManagementScopeSchema } from "./library-management-scope";
import { AgentTeamProfileIdSchema } from "./agent-team-book-binding";
import { SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH } from "./agent-team";

export const TEAM_MANAGEMENT_INVOCATION_POLICY =
  "仅在用户主动要求查看、管理或优化当前作品实际生效团队的提示词时调用团队提示词管理工具。普通写作不触发，历史中已完成的请求不构成本次授权。先列出生效团队，再读取目标成员的原提示词；目标不明确时由主智能体询问用户。生效范围与作品运行一致：有作品团队绑定时使用绑定团队，没有绑定时使用该写作类型当前启用的团队，不要求用户先绑定。只能修改生效团队成员的提示词，不得修改模型、启用状态、成员结构或作品绑定。修改必须逐项展示差异，用户明确接受后才能保存；自动审批设置不能跳过提示词审阅。没有可用的生效团队时说明当前团队配置不可用，不得猜测其他团队。";

export const TeamManagementRuntimeContextSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    description: z.string().trim().min(1).max(1_000)
  })
  .strict();
export type TeamManagementRuntimeContext = z.infer<
  typeof TeamManagementRuntimeContextSchema
>;

export const AgentTeamPromptTargetSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    teamId: AgentTeamProfileIdSchema,
    parentAgentId: z.string().trim().min(1).max(120),
    memberId: z.string().trim().min(1).max(120)
  })
  .strict();
export type AgentTeamPromptTarget = z.infer<typeof AgentTeamPromptTargetSchema>;

const PromptSchema = z
  .string()
  .trim()
  .min(1)
  .max(SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH);
export const AgentTeamPromptChangeSchema = AgentTeamPromptTargetSchema.extend({
  previousPrompt: PromptSchema,
  prompt: PromptSchema,
  summary: z.string().trim().min(1).max(1_000)
}).strict();
export type AgentTeamPromptChange = z.infer<typeof AgentTeamPromptChangeSchema>;

export const AgentTeamPromptReviewSchema = AgentTeamPromptChangeSchema.extend({
  teamName: z.string().min(1).max(80),
  memberName: z.string().min(1).max(80),
  boundBookCount: z.number().int().nonnegative(),
  enabledAsDefault: z.boolean()
}).strict();
export type AgentTeamPromptReview = z.infer<typeof AgentTeamPromptReviewSchema>;

export const AgentTeamPromptReadResultSchema =
  AgentTeamPromptTargetSchema.extend({
    teamName: z.string().min(1).max(80),
    memberName: z.string().min(1).max(80),
    description: z.string().min(1).max(1_000),
    boundBookCount: z.number().int().nonnegative(),
    enabledAsDefault: z.boolean(),
    prompt: PromptSchema
  }).strict();
export type AgentTeamPromptReadResult = z.infer<
  typeof AgentTeamPromptReadResultSchema
>;

export const ActiveAgentTeamListSchema = z.array(
  z
    .object({
      id: AgentTeamProfileIdSchema,
      name: z.string().min(1).max(80),
      boundBookCount: z.number().int().nonnegative(),
      enabledAsDefault: z.boolean(),
      members: z.array(
        z
          .object({
            parentAgentId: z.string().min(1).max(120),
            id: z.string().min(1).max(120),
            name: z.string().min(1).max(80),
            description: z.string().min(1).max(1_000),
            enabled: z.boolean()
          })
          .strict()
      )
    })
    .strict()
);

/** Internal Agent-to-Main commands, intercepted before reaching Core. */
export const TeamManagementCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.listActivePrompts"),
    payload: z.object({ scope: LibraryManagementScopeSchema }).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.readActivePrompt"),
    payload: AgentTeamPromptTargetSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.applyActivePrompt"),
    payload: AgentTeamPromptChangeSchema.extend({
      reviewRequestId: z.string().min(1).max(512)
    }).strict()
  })
] as const;

export const AgentTeamPromptSavedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.prompt_saved"),
    payload: z.object({ teamId: AgentTeamProfileIdSchema }).strict()
  });
