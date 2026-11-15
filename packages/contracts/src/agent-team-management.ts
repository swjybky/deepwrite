import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { LibraryManagementScopeSchema } from "./library-management-scope";
import { AgentTeamProfileIdSchema } from "./agent-team-book-binding";
import {
  SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH,
  ShortAgentSubagentDefinitionSchema,
  ShortAgentSubagentModelModeSchema,
  SubagentAgentModeSchema,
  SubagentDrawSettingsSchema,
  SubagentWebSearchModeSchema
} from "./agent-team";
import { TemperatureSchema, ThinkingLevelSchema } from "./model-configuration";

export const TEAM_MANAGEMENT_INVOCATION_POLICY =
  "仅在用户主动要求查看、管理或调整当前作品实际生效团队时调用团队管理工具。普通写作不触发，历史中已完成的请求不构成本次授权。先列出生效团队，再读取要修改的成员；目标不明确时询问用户。生效范围与作品运行一致：有作品团队绑定时使用绑定团队，没有绑定时使用该写作类型当前启用的团队，不要求用户先绑定。可以修改成员的名称、说明、提示词、启用状态、运行模式、联网、模型、思考等级、温度与抽卡设置，也可以新增、删除成员或切换团队并行；不得新建、删除或切换团队，不得修改作品绑定。每次提交在审阅卡上逐项展示差异，用户明确接受后才保存；自动审批设置不能跳过团队审阅。没有可用的生效团队时说明当前团队配置不可用，不得猜测其他团队。";

export const TeamManagementRuntimeContextSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    description: z.string().trim().min(1).max(1_000)
  })
  .strict();
export type TeamManagementRuntimeContext = z.infer<
  typeof TeamManagementRuntimeContextSchema
>;

export const AGENT_TEAM_CHANGE_MAX_OPERATIONS = 20;
export const AGENT_TEAM_READ_MAX_MEMBERS = 10;
const ParentAgentIdSchema = z.string().trim().min(1).max(120);
const MemberIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH);
const PromptSchema = z
  .string()
  .trim()
  .min(1)
  .max(SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH);

/** Every member field except the prompt, as the team list shows it. */
const { systemPrompt: _prompt, ...memberSummaryShape } =
  ShortAgentSubagentDefinitionSchema.shape;
export const AgentTeamMemberSummarySchema = z.object({
  ...memberSummaryShape,
  parentAgentId: ParentAgentIdSchema
});
export type AgentTeamMemberSummary = z.infer<
  typeof AgentTeamMemberSummarySchema
>;

export const AgentTeamModelChoiceSchema = z
  .object({
    id: z.string().min(1).max(SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH),
    label: z.string().min(1).max(240),
    kind: z.enum(["llm", "jev"]),
    reasoning: z.boolean(),
    thinkingLevelOptions: z.array(z.string().min(1).max(40)).max(16),
    temperatureOptions: z.array(z.number()).max(16)
  })
  .strict();
export type AgentTeamModelChoice = z.infer<typeof AgentTeamModelChoiceSchema>;

export const ActiveAgentTeamListSchema = z
  .object({
    teams: z.array(
      z
        .object({
          id: AgentTeamProfileIdSchema,
          name: z.string().min(1).max(80),
          boundBookCount: z.number().int().nonnegative(),
          enabledAsDefault: z.boolean(),
          parallelSubagents: z.boolean(),
          parentAgentIds: z.array(ParentAgentIdSchema),
          revision: z.string().regex(/^[a-f0-9]{32}$/),
          members: z.array(AgentTeamMemberSummarySchema)
        })
        .strict()
    ),
    models: z.array(AgentTeamModelChoiceSchema).max(500)
  })
  .strict();
export type ActiveAgentTeamList = z.infer<typeof ActiveAgentTeamListSchema>;

export const AgentTeamMemberTargetSchema = z
  .object({ parentAgentId: ParentAgentIdSchema, memberId: MemberIdSchema })
  .strict();

export const AgentTeamMembersReadInputSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    teamId: AgentTeamProfileIdSchema,
    members: z
      .array(AgentTeamMemberTargetSchema)
      .min(1)
      .max(AGENT_TEAM_READ_MAX_MEMBERS)
  })
  .strict();
export type AgentTeamMembersReadInput = z.infer<
  typeof AgentTeamMembersReadInputSchema
>;

export const AgentTeamMembersReadResultSchema = z
  .object({
    teamId: AgentTeamProfileIdSchema,
    teamName: z.string().min(1).max(80),
    revision: z.string().regex(/^[a-f0-9]{32}$/),
    members: z.array(
      ShortAgentSubagentDefinitionSchema.extend({
        parentAgentId: ParentAgentIdSchema
      })
    )
  })
  .strict();
export type AgentTeamMembersReadResult = z.infer<
  typeof AgentTeamMembersReadResultSchema
>;

const MemberFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH),
    description: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH),
    enabled: z.boolean(),
    agentMode: SubagentAgentModeSchema,
    webSearchMode: SubagentWebSearchModeSchema,
    modelMode: ShortAgentSubagentModelModeSchema,
    modelId: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH),
    thinkingLevel: ThinkingLevelSchema,
    temperature: TemperatureSchema,
    draw: SubagentDrawSettingsSchema
  })
  .partial()
  .strict();

const PromptReplacementSchema = z
  .object({
    originalText: z.string().min(1).max(2_400),
    newText: z.string().max(20_000)
  })
  .strict();

/** What the agent asks for; Main turns it into exact member before/after. */
export const AgentTeamChangeOperationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("update-member"),
      parentAgentId: ParentAgentIdSchema,
      memberId: MemberIdSchema,
      set: MemberFieldsSchema.optional(),
      /** Whole new prompt; excludes promptReplacements. */
      systemPrompt: PromptSchema.optional(),
      promptReplacements: z
        .array(PromptReplacementSchema)
        .min(1)
        .max(20)
        .optional()
    })
    .strict(),
  z
    .object({
      action: z.literal("add-member"),
      parentAgentId: ParentAgentIdSchema,
      member: MemberFieldsSchema.extend({
        id: MemberIdSchema.optional(),
        systemPrompt: PromptSchema
      }).required({ name: true, description: true })
    })
    .strict(),
  z
    .object({
      action: z.literal("remove-member"),
      parentAgentId: ParentAgentIdSchema,
      memberId: MemberIdSchema
    })
    .strict(),
  z.object({ action: z.literal("set-parallel"), enabled: z.boolean() }).strict()
]);
export type AgentTeamChangeOperation = z.infer<
  typeof AgentTeamChangeOperationSchema
>;

/** Tool parameter schema for the agent; Main re-validates every operation. */
export function agentTeamChangeOperationJsonSchema() {
  return z.toJSONSchema(AgentTeamChangeOperationSchema, {
    target: "draft-7",
    io: "input"
  });
}

export const AgentTeamChangePreviewInputSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    teamId: AgentTeamProfileIdSchema,
    baseRevision: z.string().regex(/^[a-f0-9]{32}$/),
    summary: z.string().trim().min(1).max(1_000),
    operations: z
      .array(AgentTeamChangeOperationSchema)
      .min(1)
      .max(AGENT_TEAM_CHANGE_MAX_OPERATIONS)
  })
  .strict();
export type AgentTeamChangePreviewInput = z.infer<
  typeof AgentTeamChangePreviewInputSchema
>;

const MemberDefinitionSchema = ShortAgentSubagentDefinitionSchema;
/** One reviewed member: absent before means added, absent after removed. */
export const AgentTeamMemberChangeSchema = z
  .object({
    parentAgentId: ParentAgentIdSchema,
    memberId: MemberIdSchema,
    before: MemberDefinitionSchema.optional(),
    after: MemberDefinitionSchema.optional()
  })
  .strict()
  .refine((value) => value.before || value.after, "Empty member change.");
export type AgentTeamMemberChange = z.infer<typeof AgentTeamMemberChangeSchema>;

/** The exact change saved on acceptance; Main re-checks it against consent. */
export const AgentTeamChangeSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    teamId: AgentTeamProfileIdSchema,
    baseRevision: z.string().regex(/^[a-f0-9]{32}$/),
    summary: z.string().trim().min(1).max(1_000),
    parallelSubagents: z
      .object({ before: z.boolean(), after: z.boolean() })
      .strict()
      .optional(),
    members: z
      .array(AgentTeamMemberChangeSchema)
      .max(AGENT_TEAM_CHANGE_MAX_OPERATIONS)
  })
  .strict();
export type AgentTeamChange = z.infer<typeof AgentTeamChangeSchema>;

export const AgentTeamChangeReviewSchema = AgentTeamChangeSchema.extend({
  teamName: z.string().min(1).max(80),
  boundBookCount: z.number().int().nonnegative(),
  enabledAsDefault: z.boolean()
}).strict();
export type AgentTeamChangeReview = z.infer<typeof AgentTeamChangeReviewSchema>;

/** Internal Agent-to-Main commands, intercepted before reaching Core. */
export const TeamManagementCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.listActive"),
    payload: z.object({ scope: LibraryManagementScopeSchema }).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.readActiveMembers"),
    payload: AgentTeamMembersReadInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.previewActiveChange"),
    payload: AgentTeamChangePreviewInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.applyActiveChange"),
    payload: AgentTeamChangeSchema.extend({
      reviewRequestId: z.string().min(1).max(512)
    }).strict()
  })
] as const;

export const AgentTeamPromptSavedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.prompt_saved"),
    payload: z.object({ teamId: AgentTeamProfileIdSchema }).strict()
  });
