import { z } from "zod";
import {
  LibraryTypeSchema,
  MaterialLibraryKindSchema,
  MaterialStageIdSchema,
  SkillKindSchema,
  SkillStageIdSchema
} from "./catalog";
import { EnvelopeBaseSchema } from "./envelope";

export const LIBRARY_AGENT_DOMAINS = ["material", "skill"] as const;
export const LibraryAgentDomainSchema = z.enum(LIBRARY_AGENT_DOMAINS);
export type LibraryAgentDomain = z.infer<typeof LibraryAgentDomainSchema>;

export const LIBRARY_AGENT_MAX_ENTRIES = 128;
export const LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS = 12_000;
export const LIBRARY_AGENT_ENTRY_MAX_CHARACTERS = 80_000;
export const LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS = 320_000;

const LibraryAgentSystemPromptSchema = z
  .string()
  .min(1)
  .max(60_000)
  .refine((value) => value.trim().length > 0, {
    message: "System prompt must contain non-whitespace text."
  });

export const DEFAULT_MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPT = `你是 DeepWrite 的短篇素材库管理智能体。你只管理当前运行上下文指定的一个素材库，不得修改书籍正文、其它素材库或技能库。

工作目标：
- 把素材整理为可检索、可复用、边界清晰的条目，而不是把聊天分析直接堆进素材正文。
- 当前库可能属于人物、卖点、剧情、正文片段或其他分类；新增条目必须使用当前库允许的栏目。
- 库介绍只作为只读索引与使用边界；当前工具不修改库介绍。

工作流程：
1. 先调用 list_material_entries 了解当前库的条目和栏目。
2. 修改已有条目前，调用 read_material_entry 读取完整可用快照；不知道目标时先调用 search_material_entries。
3. 新增独立素材时调用 create_material_entry；修改已有素材时调用 edit_material_entry。
4. 已有正文优先使用 replace_fragments 做局部、唯一原文替换；追加内容使用 append。
5. 只有条目为空或用户明确要求全文重写时，才使用 replace，并显式设置 allow_overwrite_existing=true。

安全规则：
- 搜索结果只是定位片段，重要事实必须继续读取目标条目核对。
- 截断条目和只读条目不得写入；应提示用户先在界面打开目标条目或选择可写素材库。
- 写入工具只提交待审阅变更。用户接受后客户端才会保存到本地 Markdown；当前回复不得提前声称保存成功。
- 工具正文只能包含正式素材内容，不要混入分析过程、操作说明或工具记录。
`;

export const DEFAULT_SKILL_LIBRARY_AGENT_SYSTEM_PROMPT = `你是 DeepWrite 的短篇技能库管理智能体。你只管理当前运行上下文指定的一个技能库，不得修改书籍正文、素材库或其它技能库。

技能库用于沉淀可重复执行的写作方法、检查清单、模板和协作流程，不用于保存某一篇小说的一次性人物、情节或正文。

工作流程：
1. 先调用 list_skill_entries 了解当前库的条目和适用阶段。
2. 修改已有技能前，调用 read_skill_entry 读取完整可用快照；不知道目标时先调用 search_skill_entries。
3. 新增可复用方法时调用 create_skill_entry；修改已有方法时调用 edit_skill_entry。
4. 已有正文优先使用 replace_fragments 做局部、唯一原文替换；追加内容使用 append。
5. 只有条目为空或用户明确要求全文重写时，才使用 replace，并显式设置 allow_overwrite_existing=true。

技能质量要求：
- 写清适用场景、输入条件、执行步骤、检查标准和不适用边界。
- 协调型技能负责规划、拆分和验收；分节写作技能负责具体写作动作，不要混淆职责。
- 库说明只作为只读索引；当前工具不修改库说明。

安全规则：
- 搜索结果只是定位片段，重要规则必须继续读取目标条目核对。
- 官方技能库、截断条目和其它只读条目不得写入。
- 写入工具只提交待审阅变更。用户接受后客户端才会保存到本地 Markdown；当前回复不得提前声称保存成功。
- 工具正文只能包含正式技能内容，不要混入分析过程、操作说明或工具记录。
`;

export const LibraryAgentProfileSchema = z.object({
  domain: LibraryAgentDomainSchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000),
  systemPrompt: LibraryAgentSystemPromptSchema
});
export type LibraryAgentProfile = z.infer<typeof LibraryAgentProfileSchema>;

export const DEFAULT_LIBRARY_AGENT_PROFILES: readonly LibraryAgentProfile[] = [
  {
    domain: "material",
    label: "素材库管理智能体",
    description: "读取、搜索、新建和安全编辑当前素材库中的短篇素材条目。",
    systemPrompt: DEFAULT_MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPT
  },
  {
    domain: "skill",
    label: "技能库管理智能体",
    description: "将写作方法整理为可复用技能，并安全维护当前技能库条目。",
    systemPrompt: DEFAULT_SKILL_LIBRARY_AGENT_SYSTEM_PROMPT
  }
];

function validateCompleteLibraryAgentSet(
  agents: readonly { domain: LibraryAgentDomain }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const domains = agents.map((agent) => agent.domain);
  domains.forEach((domain, index) => {
    if (domains.indexOf(domain) !== index) {
      context.addIssue({
        code: "custom",
        path: ["agents", index, "domain"],
        message: `Duplicate library agent profile: ${domain}`
      });
    }
  });
  for (const domain of LIBRARY_AGENT_DOMAINS) {
    if (!domains.includes(domain)) {
      context.addIssue({
        code: "custom",
        path: ["agents"],
        message: `Missing library agent profile: ${domain}`
      });
    }
  }
}

export const LibraryAgentSettingsSchema = z
  .object({
    agents: z.array(LibraryAgentProfileSchema).length(LIBRARY_AGENT_DOMAINS.length)
  })
  .superRefine((value, context) =>
    validateCompleteLibraryAgentSet(value.agents, context)
  );
export type LibraryAgentSettings = z.infer<typeof LibraryAgentSettingsSchema>;

export const LibraryAgentSettingsInputAgentSchema = z.object({
  domain: LibraryAgentDomainSchema,
  systemPrompt: LibraryAgentSystemPromptSchema
});
export const LibraryAgentSettingsInputSchema = z
  .object({
    agents: z
      .array(LibraryAgentSettingsInputAgentSchema)
      .length(LIBRARY_AGENT_DOMAINS.length)
  })
  .superRefine((value, context) =>
    validateCompleteLibraryAgentSet(value.agents, context)
  );
export type LibraryAgentSettingsInput = z.infer<
  typeof LibraryAgentSettingsInputSchema
>;

export const DEFAULT_LIBRARY_AGENT_SETTINGS: LibraryAgentSettings = {
  agents: [...DEFAULT_LIBRARY_AGENT_PROFILES]
};

const LibraryAgentEntrySnapshotBaseSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    documentId: z.string().trim().min(1).max(4_096),
    title: z.string().trim().min(1).max(256),
    content: z.string().max(LIBRARY_AGENT_ENTRY_MAX_CHARACTERS),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    readOnly: z.boolean(),
    truncated: z.boolean().optional(),
    originalLength: z
      .number()
      .int()
      .nonnegative()
      .max(32 * 1024 * 1024)
      .optional()
  })
  .superRefine((value, context) => {
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= value.content.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "A truncated library entry must report its original length."
      });
    }
  });

export const MaterialLibraryAgentEntrySnapshotSchema =
  LibraryAgentEntrySnapshotBaseSchema.extend({
    stageId: MaterialStageIdSchema
  });
export const SkillLibraryAgentEntrySnapshotSchema =
  LibraryAgentEntrySnapshotBaseSchema.extend({
    stageId: SkillStageIdSchema
  });
export type MaterialLibraryAgentEntrySnapshot = z.infer<
  typeof MaterialLibraryAgentEntrySnapshotSchema
>;
export type SkillLibraryAgentEntrySnapshot = z.infer<
  typeof SkillLibraryAgentEntrySnapshotSchema
>;
export type LibraryAgentEntrySnapshot =
  | MaterialLibraryAgentEntrySnapshot
  | SkillLibraryAgentEntrySnapshot;

const LibraryAgentWorkspaceBaseSchema = z.object({
  libraryId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(256),
  libraryType: LibraryTypeSchema,
  overview: z.string().max(LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS),
  overviewTruncated: z.boolean().optional(),
  overviewOriginalLength: z
    .number()
    .int()
    .nonnegative()
    .max(32 * 1024 * 1024)
    .optional(),
  readOnly: z.boolean(),
  activeEntryId: z.string().trim().min(1).max(512).optional(),
  projectRevision: z.number().int().nonnegative().optional(),
  omittedEntryCount: z.number().int().nonnegative().max(4_096).optional()
});

export const LibraryAgentWorkspaceSnapshotSchema = z
  .discriminatedUnion("domain", [
    LibraryAgentWorkspaceBaseSchema.extend({
      domain: z.literal("material"),
      kind: MaterialLibraryKindSchema,
      entries: z
        .array(MaterialLibraryAgentEntrySnapshotSchema)
        .max(LIBRARY_AGENT_MAX_ENTRIES)
    }),
    LibraryAgentWorkspaceBaseSchema.extend({
      domain: z.literal("skill"),
      kind: SkillKindSchema,
      entries: z
        .array(SkillLibraryAgentEntrySnapshotSchema)
        .max(LIBRARY_AGENT_MAX_ENTRIES)
    })
  ])
  .superRefine((value, context) => {
    if (
      value.overviewTruncated === true &&
      (value.overviewOriginalLength === undefined ||
        value.overviewOriginalLength <= value.overview.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["overviewOriginalLength"],
        message: "A truncated library overview must report its original length."
      });
    }
    const ids = value.entries.map((entry) => entry.id);
    const documentIds = value.entries.map((entry) => entry.documentId);
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "id"],
          message: `Duplicate library entry id: ${id}`
        });
      }
    });
    documentIds.forEach((documentId, index) => {
      if (documentIds.indexOf(documentId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "documentId"],
          message: `Duplicate library entry document id: ${documentId}`
        });
      }
    });
    if (
      value.activeEntryId !== undefined &&
      !ids.includes(value.activeEntryId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeEntryId"],
        message: "The active library entry must be present in the snapshot."
      });
    }
    const totalCharacters =
      value.overview.length +
      value.entries.reduce((total, entry) => total + entry.content.length, 0);
    if (totalCharacters > LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "The library agent snapshot exceeds its total character budget."
      });
    }
  });
export type LibraryAgentWorkspaceSnapshot = z.infer<
  typeof LibraryAgentWorkspaceSnapshotSchema
>;

export const LibraryAgentsListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("libraryAgents.list"),
  payload: z.object({})
});

export const LibraryAgentsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("libraryAgents.save"),
  payload: LibraryAgentSettingsInputSchema
});

export const LibraryAgentsResetCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("libraryAgents.reset"),
  payload: z.object({ domain: LibraryAgentDomainSchema.optional() })
});

export type LibraryAgentsListCommandEnvelope = z.infer<
  typeof LibraryAgentsListCommandEnvelopeSchema
>;
export type LibraryAgentsSaveCommandEnvelope = z.infer<
  typeof LibraryAgentsSaveCommandEnvelopeSchema
>;
export type LibraryAgentsResetCommandEnvelope = z.infer<
  typeof LibraryAgentsResetCommandEnvelopeSchema
>;
