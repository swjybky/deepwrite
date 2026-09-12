import { z } from "zod";
import {
  SCRIPT_MATERIAL_KINDS,
  SCRIPT_SKILL_KINDS,
  SCRIPT_WORKSPACE_AGENT_IDS,
  ScriptMaterialKindSchema,
  ScriptSkillKindSchema,
  ScriptWorkspaceAgentIdSchema,
  resolveScriptWorkspacePhaseId,
  type ScriptWorkspaceAgentId,
  type ScriptWorkspacePhaseId,
  type ScriptWorkspaceStageId
} from "./script-workspace";
import { DEFAULT_SCRIPT_SYSTEM_PROMPT } from "./writing-agent-prompts";

export { DEFAULT_SCRIPT_SYSTEM_PROMPT } from "./writing-agent-prompts";

/** Hard constraints appended after every customizable script prompt. */
export const SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS = `剧本正文必须严格遵守以下格式：
- 场景标题使用“序号. 内景/外景 地点 - 时间”；每次更换地点或时间都必须新开场次。
- 动作和画面描述独立成行并以“△”开头，只写镜头能够呈现的内容。
- 对白先写角色名；表演提示放在角色名后的括号中。
- OS 表示画面内人物的内心声音；VO 表示人物不在画面内，或来自电话、广播等外部声音。
- 闪回、梦境等时空转换必须使用清晰且成对的开始/结束标记。
- 通过 edit 写入 document=body 时，不得使用 Markdown 表格、分析标题或格式讲解，只能写可直接进入成稿的剧本正文。
`;

export const DEFAULT_SCRIPT_WORKSPACE_AGENT_SYSTEM_PROMPTS: Record<
  ScriptWorkspaceAgentId,
  string
> = { script: DEFAULT_SCRIPT_SYSTEM_PROMPT };

function uniqueEnumValuesSchema<T extends string>(
  schema: z.ZodType<T>,
  maxLength: number,
  label: string
) {
  return z
    .array(schema)
    .max(maxLength)
    .superRefine((values, context) => {
      values.forEach((value, index) => {
        if (values.indexOf(value) !== index) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label}: ${value}`
          });
        }
      });
    });
}

const UniqueScriptMaterialKindsSchema = uniqueEnumValuesSchema(
  ScriptMaterialKindSchema,
  SCRIPT_MATERIAL_KINDS.length,
  "material kind"
);
const UniqueScriptSkillKindsSchema = uniqueEnumValuesSchema(
  ScriptSkillKindSchema,
  SCRIPT_SKILL_KINDS.length,
  "skill kind"
);

export const ScriptAgentReadAccessSchema = z
  .object({
    material: UniqueScriptMaterialKindsSchema,
    skill: UniqueScriptSkillKindsSchema
  })
  .strict();
export type ScriptAgentReadAccess = z.infer<typeof ScriptAgentReadAccessSchema>;

export const DEFAULT_SCRIPT_STAGE_READ_ACCESS: Record<
  ScriptWorkspacePhaseId,
  ScriptAgentReadAccess
> = {
  character: {
    material: ["character"],
    skill: ["general", "plot", "other"]
  },
  plot: {
    material: ["gimmick", "character", "plot"],
    skill: ["general", "plot", "other"]
  },
  draft: {
    material: ["character", "gimmick", "plot", "draft", "other"],
    skill: ["style", "general", "other"]
  }
};

export function resolveScriptWorkspaceStageReadAccess(
  stageId: ScriptWorkspaceStageId
): ScriptAgentReadAccess {
  return DEFAULT_SCRIPT_STAGE_READ_ACCESS[
    resolveScriptWorkspacePhaseId(stageId)
  ];
}

export const DEFAULT_SCRIPT_AGENT_READ_ACCESS: Record<
  ScriptWorkspaceAgentId,
  ScriptAgentReadAccess
> = {
  script: {
    material: ["character", "gimmick", "plot", "draft", "other"],
    skill: ["general", "plot", "style", "other"]
  }
};

export const DEFAULT_SCRIPT_WORKSPACE_AGENT_READ_ACCESS =
  DEFAULT_SCRIPT_AGENT_READ_ACCESS;

const ScriptSystemPromptSchema = z
  .string()
  .min(1)
  .max(200_000)
  .refine((value) => value.trim().length > 0, {
    message: "System prompt must contain non-whitespace text."
  });

export const SCRIPT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH = 120;
export const ScriptAgentWelcomeShortcutsSchema = z.tuple([
  z.string().trim().min(1).max(SCRIPT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH),
  z.string().trim().min(1).max(SCRIPT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH),
  z.string().trim().min(1).max(SCRIPT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH)
]);
export type ScriptAgentWelcomeShortcuts = z.infer<
  typeof ScriptAgentWelcomeShortcutsSchema
>;

export const DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS = {
  script: [
    "根据当前阶段继续完成剧本",
    "检查人物、剧情和前后集是否一致",
    "读取相关资料并给出可直接写回的成稿"
  ]
} as const satisfies Record<
  ScriptWorkspaceAgentId,
  ScriptAgentWelcomeShortcuts
>;

export const ScriptWorkspaceAgentProfileSchema = z.object({
  id: ScriptWorkspaceAgentIdSchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000),
  systemPrompt: ScriptSystemPromptSchema,
  welcomeShortcuts: ScriptAgentWelcomeShortcutsSchema,
  readAccess: ScriptAgentReadAccessSchema
});
export type ScriptWorkspaceAgentProfile = z.infer<
  typeof ScriptWorkspaceAgentProfileSchema
>;

export const DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES: readonly ScriptWorkspaceAgentProfile[] =
  [
    {
      id: "script",
      label: "剧本智能体",
      description:
        "统一负责人物、动态剧情阶段和剧本正文创作，并按当前阶段加载上下文。",
      systemPrompt: DEFAULT_SCRIPT_SYSTEM_PROMPT,
      welcomeShortcuts: [...DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS.script],
      readAccess: DEFAULT_SCRIPT_AGENT_READ_ACCESS.script
    }
  ];

function validateCompleteScriptAgentSet(
  agents: readonly { id: ScriptWorkspaceAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = agents.map((agent) => agent.id);
  ids.forEach((id, index) => {
    if (ids.indexOf(id) !== index) {
      context.addIssue({
        code: "custom",
        path: ["agents", index, "id"],
        message: `Duplicate script workspace agent profile: ${id}`
      });
    }
  });
}

export const ScriptWorkspaceAgentSettingsSchema = z
  .object({
    workspaceType: z.literal("script"),
    agents: z
      .array(ScriptWorkspaceAgentProfileSchema)
      .length(SCRIPT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) =>
    validateCompleteScriptAgentSet(value.agents, context)
  );
export type ScriptWorkspaceAgentSettings = z.infer<
  typeof ScriptWorkspaceAgentSettingsSchema
>;

export const ScriptWorkspaceAgentSettingsInputAgentSchema = z.object({
  id: ScriptWorkspaceAgentIdSchema,
  systemPrompt: ScriptSystemPromptSchema,
  welcomeShortcuts: ScriptAgentWelcomeShortcutsSchema,
  readAccess: ScriptAgentReadAccessSchema
});
export type ScriptWorkspaceAgentSettingsInputAgent = z.infer<
  typeof ScriptWorkspaceAgentSettingsInputAgentSchema
>;

export const ScriptWorkspaceAgentSettingsInputSchema = z
  .object({
    workspaceType: z.literal("script"),
    agents: z
      .array(ScriptWorkspaceAgentSettingsInputAgentSchema)
      .length(SCRIPT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) =>
    validateCompleteScriptAgentSet(value.agents, context)
  );
export type ScriptWorkspaceAgentSettingsInput = z.infer<
  typeof ScriptWorkspaceAgentSettingsInputSchema
>;

export const DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS: ScriptWorkspaceAgentSettings =
  {
    workspaceType: "script",
    agents: [...DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES]
  };
