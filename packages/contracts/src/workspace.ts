import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  ExpertDraftSectionSchema,
  parseExpertDraftMarkdown
} from "./expert-draft";

export const SHORT_WORKSPACE_STAGE_IDS = [
  "character_design",
  "plot_design",
  "intro_design",
  "plot_refine",
  "outline",
  "draft"
] as const;

export const ShortWorkspaceStageIdSchema = z.enum(SHORT_WORKSPACE_STAGE_IDS);
export type ShortWorkspaceStageId = z.infer<typeof ShortWorkspaceStageIdSchema>;

export const SHORT_WORKSPACE_AGENT_IDS = [
  "character_design",
  "plot_design",
  "outline",
  "expert_draft_coordinator",
  "expert_section_writer"
] as const;

export const ShortWorkspaceAgentIdSchema = z.enum(SHORT_WORKSPACE_AGENT_IDS);
export type ShortWorkspaceAgentId = z.infer<typeof ShortWorkspaceAgentIdSchema>;

export const SHORT_WORKSPACE_STAGE_TO_AGENT_ID = {
  character_design: "character_design",
  plot_design: "plot_design",
  intro_design: "plot_design",
  plot_refine: "plot_design",
  outline: "outline",
  draft: "expert_draft_coordinator"
} as const satisfies Record<ShortWorkspaceStageId, ShortWorkspaceAgentId>;

export function resolveShortWorkspaceAgentIdForStage(
  stageId: ShortWorkspaceStageId
): ShortWorkspaceAgentId {
  return SHORT_WORKSPACE_STAGE_TO_AGENT_ID[stageId];
}

export function createShortWorkspaceContentRevision(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${content.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const SHORT_MATERIAL_KINDS = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other"
] as const;
export const ShortMaterialKindSchema = z.enum(SHORT_MATERIAL_KINDS);
export type ShortMaterialKind = z.infer<typeof ShortMaterialKindSchema>;

export const SHORT_SKILL_KINDS = ["general", "plot", "style", "other"] as const;
export const ShortSkillKindSchema = z.enum(SHORT_SKILL_KINDS);
export type ShortSkillKind = z.infer<typeof ShortSkillKindSchema>;

/**
 * These defaults are copied byte-for-byte from write-claw's
 * app/prompt_defaults/short/shared/*.txt files, including the final newline.
 */
export const DEFAULT_SHORT_CHARACTER_DESIGN_SYSTEM_PROMPT = `你是 DeepWrite 的短篇人物设计智能体。

你的职责是创建、补全、诊断和修改人物设计。你不负责写剧情大纲或小说正文；只有人物在故事中的功能需要剧情约束时，才读取相关剧情内容。

工作流程：
1. 判断用户是在新建人物、补全人物，还是修改已有设定。
2. 修改已有内容前，先调用 read_workspace_content 读取人物阶段；需要核对剧情约束时，再读取当前允许访问的剧情内容。
3. 用户点名技能，或某项人物设计方法明显适用时，调用 load_skill；需要人设素材时，调用 query_linked_material_entries，先检索再读取条目全文。
4. 形成可直接用于后续剧情和正文的人物稿，并使用工具写回人物编辑器。

人物设计至少关注：
- 身份与处境：人物现在是谁，处于什么关系和压力之中。
- 核心欲望、恐惧、缺陷、秘密与不可退让的底线。
- 行动逻辑：遇到选择时会怎么做，为什么这样做。
- 关系结构：人物之间的利益、情感、误解、控制与变化空间。
- 辨识度：稳定的语言习惯、行为习惯、价值判断和反差。
- 人物弧：起点、关键转变、付出代价和最终状态。

工具规则：
- 目标编辑框为空，或用户明确要求整体重写时，使用 write_workspace_editor。
- 已有内容只需局部修改、补充或润色时，先读取原文，再使用 replace_current_stage_text。
- 写入编辑器的只能是正式人物设定，不要写分析过程、操作说明或聊天回复。
- 不要凭空推翻已经确认的剧情事实；发现冲突时先指出冲突并给出最小改动方案。
`;

export const DEFAULT_SHORT_PLOT_DESIGN_SYSTEM_PROMPT = `你是 DeepWrite 的短篇剧情智能体，统一负责剧情设计、导语设计和剧情细化。

三个内容槽位的边界：
- 剧情设计（plot_design）：核心命题、人物目标、主要冲突、因果链、关键转折、真实时间线和结局兑现。
- 导语设计（intro_design）：书名建议、开篇导语和前十秒钩子；必须与主线事实一致，不能提前泄露不该公开的信息。
- 剧情细化（plot_refine）：供正文直接执行的场景链、节拍、信息投放、人物选择、情绪推进、伏笔与回收。

工作流程：
1. 先确认用户本次处理哪个子方向；需要跨子方向时，明确每一部分的目标。
2. 调用 read_workspace_content 读取人物设计、当前目标槽位和与任务有关的已有剧情，避免重复设计或制造矛盾。
3. 用户点名技能或需要特定剧情方法时调用 load_skill；需要素材时调用 query_linked_material_entries，先检索再读取原文。
4. 检查因果是否成立、冲突是否递进、转折是否由人物选择触发、伏笔是否可回收、结局是否兑现前文承诺。
5. 使用工具把成品写入正确的剧情子槽位。

创作标准：
- 每个重要情节点都要说明触发原因、人物选择、直接后果和后续压力。
- 区分“故事真实时间线”和“读者看到的信息顺序”。
- 导语只负责抓住读者并建立悬念，不代替剧情设计。
- 剧情细化要具体到可写场景，但不要直接写成小说正文。
- 尊重已确认的人设、分类和记忆要求；题材方法来自用户、技能和素材，不套用固定题材模板。

工具规则：
- 切换剧情子方向时先调用 switch_storyline_stage，或在写入工具中明确 target_stage_id。
- 空白槽位或用户明确要求整体重写时使用 write_workspace_editor。
- 局部修改已有内容时先读取原文，再使用 replace_current_stage_text。
- 写入编辑器的只能是正式剧情内容，不要混入分析过程或工具说明。
`;

export const DEFAULT_SHORT_OUTLINE_SYSTEM_PROMPT = `你是 DeepWrite 的短篇大纲智能体，负责把已经存在的人物和剧情内容梳理成可直接指导分节写作的完整大纲。

开始任何大纲任务前，必须分别调用 read_workspace_content 检查以下阶段，存在的内容全部读取，不得只凭聊天摘要：
1. 人物设计（character_design）
2. 剧情设计（plot_design）
3. 导语设计（intro_design）
4. 剧情细化（plot_refine）
5. 当前大纲（outline）

工作模式：
- 整理大纲：保留前置阶段已经确认的人物、因果、时间线、关键情节和结局，不得遗漏重要内容；发现冲突时明确标注并采用最小改动方案。
- 创作大纲：在已有内容基础上补足缺口；用户点名技能或需要特定大纲方法时，调用 load_skill 后再组织。
- 前置内容为空时可以说明缺口，但不要声称已经读到不存在的设定。

大纲成品必须包含：
- 全文定位、主线目标、核心冲突、时间线与结局。
- 正文小节总数及顺序；短篇有导语时单独列出。
- 每个小节的标题、预估字数或字数范围。
- 每个小节的出场人物、场景、起始状态、详细剧情、关键选择、冲突或转折、信息投放、结尾钩子。
- 小节之间的承接关系、人物状态变化、伏笔埋设与回收位置。

工具规则：
- 目标编辑框为空，或用户明确要求整体重做时，使用 write_workspace_editor 写入完整大纲。
- 已有大纲只需局部调整时，先读取原文，再使用 replace_current_stage_text。
- 写入编辑器的只能是最终大纲，不要写分析过程、读取记录或操作说明。
`;

export const DEFAULT_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT = `你是 DeepWrite 的短篇正文专家编写智能体，负责正文结构管理、分节任务调度和成稿后的处理。主要正文由分节写手完成，你不要在聊天中直接代写整章。

你负责四类任务：
1. 初始化：读取 outline，根据完整大纲调用 initialize_expert_draft，一次性创建导语、全部正文小节及一一对应的人物状态槽位。
2. 全部写作：用户明确要求“开始写正文”“自动写全部小节”或同义指令时，如果尚未完整初始化，先读取大纲并初始化，然后在同一轮调用 start_expert_writing，不要再要求用户二次确认。短篇默认跳过导语；用户明确要求写导语时才把 intro 加入 section_ids。
3. 单节写作：用户指定一个已初始化小节时，调用 write_single_expert_section；目标不存在则先按大纲初始化完整结构。
4. 后处理：正文审阅、润色、去 AI 味、格式整理、章节名修改和局部修订，都在当前智能体内完成。

初始化规则：
- 初始化前必须读取 outline；大纲为空且用户没有明确授权你从零规划时，说明无法可靠初始化并引导用户先完成大纲。
- 小节标题、顺序和数量必须与大纲一致。
- 把大纲中的预估字数或字数规划填入 word_count_requirement。
- 正文列表与人物状态列表必须一一对应。
- 已有正文只做结构补全或改名时，不要清空已有小节正文。

启动规则：
- 用户提出的文风、情绪、节奏、爽点、人设表达或平台要求，必须整理进 user_writing_prompt。
- start_expert_writing 和 write_single_expert_section 都是异步工具；调用成功后直接告知已经启动，不等待后台全部完成。
- 局部修改已有正文时不得重新启动分节写作，除非用户明确要求重写该小节。

后处理规则：
- 先调用 read_workspace_content（stage_id=draft）读取当前合并正文。
- 使用 edit_expert_draft_section 按原文片段修改章节名或正文；不要用初始化工具处理局部修改。
- 总控不修改人物状态，不调用普通阶段写入工具，也不要求用户复制粘贴。
- 需要技能时调用 load_skill；只有当前读取范围允许素材且确有必要时，才查询关联素材。
`;

export const DEFAULT_SHORT_EXPERT_SECTION_WRITER_SYSTEM_PROMPT = `你是 DeepWrite 的短篇分节写手智能体，是实际创作小说正文的主要智能体。你一次只处理当前上下文指定的一个小节，不得修改其它小节。

写作前必须完成：
1. 调用 read_workspace_content 读取大纲；读取范围允许时，可补充读取剧情细化。
2. 调用 read_expert_draft_section 读取当前小节之前最近三个已有正文的小节；正文为空的前置小节可跳过。
3. 必须读取紧邻上一节的人物状态；修改当前已有正文时，还要先读取当前小节正文和人物状态。
4. 用户点名技能或文风方法时调用 load_skill；确需参考正文素材时，调用 query_linked_material_entries 检索并读取相关条目。

写作标准：
- 严格执行当前小节在大纲中的任务、承接点和字数要求；未指定字数时，以 800—1500 字为默认范围。
- 延续前文的时间、空间、人物关系、信息知情范围、物品位置、伤势和情绪，不重复已经完成的情节。
- 让冲突通过人物行动、选择、对白和可感知细节推进，避免用总结代替场景。
- 保持题材、叙述视角、文风和节奏一致；用户本轮要求优先于一般写作习惯。
- 精确区分中文弯双引号“”（开引号 U+201C、闭引号 U+201D）与英文半角直双引号（开、闭字符都是 U+0022）。用户本轮要求、书籍记忆或相邻正文指定哪一种，就逐字符沿用哪一种，不得互换。
- 小节结尾应完成本节任务，并为下一节留下明确承接点或阅读动力。

写回规则：
- 当前正文为空时，调用 write_section_body 写入完整正文；text 只能包含小说正文，不得包含章节名、标题、分析、解释或工具说明。
- 当前正文已有内容且用户要求局部修改时，使用 replace_section_body_text；只有明确要求整节重写时才允许整体重写。
- 当前人物状态为空时调用 write_character_state；已有状态只需修改时调用 replace_character_state_text。
- 人物状态应记录本节结束时的处境、关系、情绪、已知与隐瞒信息、关键物品、未解决冲突和下一节接续点。
- 没有完成正文与人物状态的必要写回工具调用，本小节不算完成。
`;

export const DEFAULT_SHORT_WORKSPACE_AGENT_SYSTEM_PROMPTS: Record<
  ShortWorkspaceAgentId,
  string
> = {
  character_design: DEFAULT_SHORT_CHARACTER_DESIGN_SYSTEM_PROMPT,
  plot_design: DEFAULT_SHORT_PLOT_DESIGN_SYSTEM_PROMPT,
  outline: DEFAULT_SHORT_OUTLINE_SYSTEM_PROMPT,
  expert_draft_coordinator: DEFAULT_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT,
  expert_section_writer: DEFAULT_SHORT_EXPERT_SECTION_WRITER_SYSTEM_PROMPT
};

const UniqueShortWorkspaceStageIdsSchema = z
  .array(ShortWorkspaceStageIdSchema)
  .max(SHORT_WORKSPACE_STAGE_IDS.length)
  .superRefine((values, context) => {
    values.forEach((value, index) => {
      if (values.indexOf(value) !== index) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate workspace stage id: ${value}`
        });
      }
    });
  });

const UniqueShortMaterialKindsSchema = z
  .array(ShortMaterialKindSchema)
  .max(SHORT_MATERIAL_KINDS.length)
  .superRefine((values, context) => {
    values.forEach((value, index) => {
      if (values.indexOf(value) !== index) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate material kind: ${value}`
        });
      }
    });
  });

const UniqueShortSkillKindsSchema = z
  .array(ShortSkillKindSchema)
  .max(SHORT_SKILL_KINDS.length)
  .superRefine((values, context) => {
    values.forEach((value, index) => {
      if (values.indexOf(value) !== index) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate skill kind: ${value}`
        });
      }
    });
  });

export const ShortAgentReadAccessSchema = z.object({
  workspace: UniqueShortWorkspaceStageIdsSchema,
  material: UniqueShortMaterialKindsSchema,
  skill: UniqueShortSkillKindsSchema
});
export type ShortAgentReadAccess = z.infer<typeof ShortAgentReadAccessSchema>;

/** Defaults from write-claw's short/shared/read_access.json. */
export const DEFAULT_SHORT_AGENT_READ_ACCESS: Record<
  ShortWorkspaceAgentId,
  ShortAgentReadAccess
> = {
  character_design: {
    workspace: ["character_design", "plot_design"],
    material: ["character"],
    skill: ["general", "plot", "other"]
  },
  plot_design: {
    workspace: [
      "character_design",
      "plot_design",
      "intro_design",
      "plot_refine"
    ],
    material: ["gimmick", "character", "plot"],
    skill: ["general", "plot", "other"]
  },
  outline: {
    workspace: [
      "plot_design",
      "intro_design",
      "plot_refine",
      "outline",
      "character_design"
    ],
    material: [],
    skill: ["general", "other"]
  },
  expert_draft_coordinator: {
    workspace: ["outline", "draft"],
    material: [],
    skill: ["general", "other"]
  },
  expert_section_writer: {
    workspace: ["outline", "plot_refine", "draft"],
    material: ["draft"],
    skill: ["style", "general"]
  }
};

export const DEFAULT_SHORT_WORKSPACE_AGENT_READ_ACCESS =
  DEFAULT_SHORT_AGENT_READ_ACCESS;

const ShortSystemPromptSchema = z
  .string()
  .min(1)
  .max(200_000)
  .refine((value) => value.trim().length > 0, {
    message: "System prompt must contain non-whitespace text."
  });

export const ShortWorkspaceStageSnapshotSchema = z
  .object({
    stageId: ShortWorkspaceStageIdSchema,
    title: z.string().trim().min(1).max(240),
    content: z.string().max(10_000_000),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    truncated: z.boolean().optional(),
    originalLength: z.number().int().nonnegative().max(100_000_000).optional()
  })
  .superRefine((value, context) => {
    if (
      value.truncated === true &&
      (value.originalLength === undefined || value.originalLength <= value.content.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "A truncated stage must report an originalLength larger than content."
      });
    }
  });
export type ShortWorkspaceStageSnapshot = z.infer<
  typeof ShortWorkspaceStageSnapshotSchema
>;

export const ShortWorkspaceSnapshotSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(240),
    categories: z.array(z.string().trim().min(1).max(120)).max(16),
    activeStageId: ShortWorkspaceStageIdSchema,
    activeAgentId: ShortWorkspaceAgentIdSchema.optional(),
    activeSectionId: z.string().trim().min(1).max(120).optional(),
    expertDraftSectionIds: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .optional(),
    expertDraftSections: z
      .array(ExpertDraftSectionSchema)
      .min(1)
      .max(4)
      .optional(),
    stages: z
      .array(ShortWorkspaceStageSnapshotSchema)
      .length(SHORT_WORKSPACE_STAGE_IDS.length)
  })
  .superRefine((value, context) => {
    const stageIds = value.stages.map((stage) => stage.stageId);
    stageIds.forEach((stageId, index) => {
      if (stageIds.indexOf(stageId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["stages", index, "stageId"],
          message: `Duplicate workspace stage snapshot: ${stageId}`
        });
      }
    });
    if (!stageIds.includes(value.activeStageId)) {
      context.addIssue({
        code: "custom",
        path: ["activeStageId"],
        message: "Active stage must be present in the workspace snapshot."
      });
    }
    const indexedSectionIds = value.expertDraftSectionIds ?? [];
    indexedSectionIds.forEach((sectionId, index) => {
      if (indexedSectionIds.indexOf(sectionId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["expertDraftSectionIds", index],
          message: `Duplicate expert draft section id: ${sectionId}`
        });
      }
    });
    const contextSectionIds =
      value.expertDraftSections?.map((section) => section.id) ?? [];
    contextSectionIds.forEach((sectionId, index) => {
      if (contextSectionIds.indexOf(sectionId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["expertDraftSections", index, "id"],
          message: `Duplicate expert draft context section id: ${sectionId}`
        });
      }
    });

    if (value.activeStageId !== "draft") {
      const defaultAgentId = resolveShortWorkspaceAgentIdForStage(value.activeStageId);
      if (
        value.activeAgentId !== undefined &&
        value.activeAgentId !== defaultAgentId
      ) {
        context.addIssue({
          code: "custom",
          path: ["activeAgentId"],
          message: `Stage ${value.activeStageId} must use its default agent ${defaultAgentId}.`
        });
      }
      if (value.activeSectionId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["activeSectionId"],
          message: "Only the draft section writer may target a section."
        });
      }
      if (value.expertDraftSections !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["expertDraftSections"],
          message: "Only the draft section writer may receive section context."
        });
      }
      return;
    }

    if (value.activeAgentId === undefined) {
      if (value.activeSectionId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["activeSectionId"],
          message: "A draft section target requires the section writer agent."
        });
      }
      if (value.expertDraftSections !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["expertDraftSections"],
          message: "Draft section context requires the section writer agent."
        });
      }
      return;
    }

    if (value.activeAgentId === "expert_draft_coordinator") {
      if (value.activeSectionId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["activeSectionId"],
          message: "The draft coordinator cannot target an individual section."
        });
      }
      if (value.expertDraftSections !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["expertDraftSections"],
          message: "The draft coordinator cannot receive individual section context."
        });
      }
      return;
    }

    if (value.activeAgentId !== "expert_section_writer") {
      context.addIssue({
        code: "custom",
        path: ["activeAgentId"],
        message: "The draft stage must use the coordinator or section writer agent."
      });
      return;
    }

    if (value.activeSectionId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["activeSectionId"],
        message: "The section writer requires an active section id."
      });
      return;
    }

    const draftStage = value.stages.find((stage) => stage.stageId === "draft");
    const parsedSectionIds = draftStage
      ? parseExpertDraftMarkdown(draftStage.content).sections.map(
          (section) => section.id
        )
      : [];
    if (
      draftStage?.truncated !== true &&
      value.expertDraftSectionIds !== undefined &&
      (indexedSectionIds.length !== parsedSectionIds.length ||
        indexedSectionIds.some((sectionId, index) => sectionId !== parsedSectionIds[index]))
    ) {
      context.addIssue({
        code: "custom",
        path: ["expertDraftSectionIds"],
        message: "The expert draft section index must match the complete draft snapshot."
      });
    }
    const sectionExists = (
      draftStage?.truncated === true ? indexedSectionIds : parsedSectionIds
    ).includes(value.activeSectionId);
    if (!sectionExists) {
      context.addIssue({
        code: "custom",
        path: ["activeSectionId"],
        message: `Unknown expert draft section: ${value.activeSectionId}`
      });
    }
    const completeSectionIds =
      draftStage?.truncated === true ? indexedSectionIds : parsedSectionIds;
    const activeSectionIndex = completeSectionIds.indexOf(value.activeSectionId);
    const expectedContextIds = activeSectionIndex < 0
      ? []
      : completeSectionIds.slice(Math.max(0, activeSectionIndex - 3), activeSectionIndex + 1);
    if (draftStage?.truncated === true && value.expertDraftSections === undefined) {
      context.addIssue({
        code: "custom",
        path: ["expertDraftSections"],
        message: "A truncated expert draft requires complete current and preceding section context."
      });
    }
    if (
      value.expertDraftSections !== undefined &&
      (contextSectionIds.length !== expectedContextIds.length ||
        contextSectionIds.some((sectionId, index) => sectionId !== expectedContextIds[index]))
    ) {
      context.addIssue({
        code: "custom",
        path: ["expertDraftSections"],
        message: "Expert draft context must contain the current section and up to three preceding sections in order."
      });
    }
  });
export type ShortWorkspaceSnapshot = z.infer<typeof ShortWorkspaceSnapshotSchema>;

export const ShortWorkspaceAgentProfileSchema = z.object({
  id: ShortWorkspaceAgentIdSchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000),
  systemPrompt: ShortSystemPromptSchema,
  readAccess: ShortAgentReadAccessSchema
});
export type ShortWorkspaceAgentProfile = z.infer<
  typeof ShortWorkspaceAgentProfileSchema
>;

export const DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES: readonly ShortWorkspaceAgentProfile[] = [
  {
    id: "character_design",
    label: "人物",
    description: "创建、补全、诊断和修改可供剧情与正文直接使用的人物设计。",
    systemPrompt: DEFAULT_SHORT_CHARACTER_DESIGN_SYSTEM_PROMPT,
    readAccess: DEFAULT_SHORT_AGENT_READ_ACCESS.character_design
  },
  {
    id: "plot_design",
    label: "剧情",
    description: "统一负责剧情设计、导语设计和剧情细化三个内容阶段。",
    systemPrompt: DEFAULT_SHORT_PLOT_DESIGN_SYSTEM_PROMPT,
    readAccess: DEFAULT_SHORT_AGENT_READ_ACCESS.plot_design
  },
  {
    id: "outline",
    label: "大纲",
    description: "将人物与剧情内容整理成可直接指导分节写作的完整大纲。",
    systemPrompt: DEFAULT_SHORT_OUTLINE_SYSTEM_PROMPT,
    readAccess: DEFAULT_SHORT_AGENT_READ_ACCESS.outline
  },
  {
    id: "expert_draft_coordinator",
    label: "正文专家编写智能体",
    description: "管理正文结构、调度分节写作并处理成稿后的修订任务。",
    systemPrompt: DEFAULT_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT,
    readAccess: DEFAULT_SHORT_AGENT_READ_ACCESS.expert_draft_coordinator
  },
  {
    id: "expert_section_writer",
    label: "分节写手智能体",
    description: "按大纲和连续人物状态完成单个正文小节的实际创作。",
    systemPrompt: DEFAULT_SHORT_EXPERT_SECTION_WRITER_SYSTEM_PROMPT,
    readAccess: DEFAULT_SHORT_AGENT_READ_ACCESS.expert_section_writer
  }
];

function validateCompleteAgentSet(
  agents: readonly { id: ShortWorkspaceAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = agents.map((agent) => agent.id);
  ids.forEach((id, index) => {
    if (ids.indexOf(id) !== index) {
      context.addIssue({
        code: "custom",
        path: ["agents", index, "id"],
        message: `Duplicate workspace agent profile: ${id}`
      });
    }
  });
}

export const ShortWorkspaceAgentSettingsSchema = z
  .object({
    workspaceType: z.literal("short"),
    agents: z
      .array(ShortWorkspaceAgentProfileSchema)
      .length(SHORT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) => validateCompleteAgentSet(value.agents, context));
export type ShortWorkspaceAgentSettings = z.infer<
  typeof ShortWorkspaceAgentSettingsSchema
>;

export const ShortWorkspaceAgentSettingsInputAgentSchema = z.object({
  id: ShortWorkspaceAgentIdSchema,
  systemPrompt: ShortSystemPromptSchema,
  readAccess: ShortAgentReadAccessSchema
});
export type ShortWorkspaceAgentSettingsInputAgent = z.infer<
  typeof ShortWorkspaceAgentSettingsInputAgentSchema
>;

export const ShortWorkspaceAgentSettingsInputSchema = z
  .object({
    workspaceType: z.literal("short"),
    agents: z
      .array(ShortWorkspaceAgentSettingsInputAgentSchema)
      .length(SHORT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) => validateCompleteAgentSet(value.agents, context));
export type ShortWorkspaceAgentSettingsInput = z.infer<
  typeof ShortWorkspaceAgentSettingsInputSchema
>;

export const DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS: ShortWorkspaceAgentSettings = {
  workspaceType: "short",
  agents: [...DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES]
};

export const WorkspaceAgentsListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("workspaceAgents.list"),
  payload: z.object({ workspaceType: z.literal("short") })
});

export const WorkspaceAgentsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("workspaceAgents.save"),
  payload: ShortWorkspaceAgentSettingsInputSchema
});

export const WorkspaceAgentsResetCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("workspaceAgents.reset"),
  payload: z.object({
    workspaceType: z.literal("short"),
    agentId: ShortWorkspaceAgentIdSchema.optional()
  })
});

export type WorkspaceAgentsListCommandEnvelope = z.infer<
  typeof WorkspaceAgentsListCommandEnvelopeSchema
>;
export type WorkspaceAgentsSaveCommandEnvelope = z.infer<
  typeof WorkspaceAgentsSaveCommandEnvelopeSchema
>;
export type WorkspaceAgentsResetCommandEnvelope = z.infer<
  typeof WorkspaceAgentsResetCommandEnvelopeSchema
>;
