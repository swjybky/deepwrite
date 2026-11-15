import { BUILTIN_AGENT_METADATA } from "./builtin-agent-metadata";
import {
  ShortAgentReadAccessSchema,
  DEFAULT_SHORT_AGENT_READ_ACCESS
} from "./short-agent-read-access";
export * from "./short-agent-read-access";
import { z } from "zod";
import {
  CreativePlotStageIdSchema,
  CreativePlotStagesSchema,
  type CreativePlotStageId
} from "./catalog";
import { EnvelopeBaseSchema } from "./envelope";
import {
  DraftSectionIdSchema,
  DraftSectionTitleSchema,
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS
} from "./expert-draft";
import {
  ScriptWorkspaceAgentProfileSchema,
  ScriptWorkspaceAgentSettingsInputSchema,
  ScriptWorkspaceAgentSettingsSchema
} from "./script-agent-settings";
import {
  ScriptWorkspaceAgentIdSchema,
  ScriptWorkspaceSnapshotSchema,
  WorkspaceTypeSchema
} from "./script-workspace";
import { DEFAULT_SHORT_SYSTEM_PROMPT } from "./writing-agent-prompts";
import { WRITING_CONTEXT_MAX_CHARACTERS } from "./writing-context";

export { DEFAULT_SHORT_SYSTEM_PROMPT } from "./writing-agent-prompts";

export const SHORT_WORKSPACE_STAGE_IDS = [
  "character_design",
  "worldbuilding",
  "plot_design",
  "intro_design",
  "plot_refine",
  "narrative_perspective",
  "outline",
  "draft"
] as const;

export const SHORT_DEFAULT_PLOT_STAGE_IDS = [
  "plot_design",
  "intro_design",
  "plot_refine"
] as const;
export const ShortDefaultPlotStageIdSchema = CreativePlotStageIdSchema;
export const ShortDefaultPlotStageIdsSchema = z
  .array(ShortDefaultPlotStageIdSchema)
  .min(1)
  .max(32)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Default short plot stage ids must be unique."
  });
export type ShortDefaultPlotStageId = z.infer<
  typeof ShortDefaultPlotStageIdSchema
>;

/** Physical text stages. `draft` is a virtual directory route. */
export const SHORT_WORKSPACE_TEXT_STAGE_IDS = [
  "character_design",
  "worldbuilding",
  "plot_design",
  "intro_design",
  "plot_refine",
  "narrative_perspective",
  "outline"
] as const;

export const ShortWorkspaceStageIdSchema = z.union([
  z.literal("character_design"),
  z.literal("draft"),
  CreativePlotStageIdSchema
]);
export type ShortWorkspaceStageId =
  "character_design" | "draft" | CreativePlotStageId;
export const ShortWorkspaceTextStageIdSchema = z.union([
  z.literal("character_design"),
  CreativePlotStageIdSchema
]);
export type ShortWorkspaceTextStageId = z.infer<
  typeof ShortWorkspaceTextStageIdSchema
>;

export const SHORT_WORKSPACE_AGENT_IDS = ["short"] as const;

/**
 * Historical short-agent ids remain stable conversation lanes only. They are
 * accepted at persistence boundaries and must never be exposed as live parent
 * agent identities again.
 */
export const SHORT_WORKSPACE_CONVERSATION_LANE_IDS = [
  "character_design",
  "plot_design",
  "expert_draft_coordinator"
] as const;
export const ShortWorkspaceConversationLaneIdSchema = z.enum(
  SHORT_WORKSPACE_CONVERSATION_LANE_IDS
);
export type ShortWorkspaceConversationLaneId = z.infer<
  typeof ShortWorkspaceConversationLaneIdSchema
>;

export const ShortWorkspaceAgentIdSchema = z.enum(SHORT_WORKSPACE_AGENT_IDS);
export type ShortWorkspaceAgentId = z.infer<typeof ShortWorkspaceAgentIdSchema>;

export function resolveShortWorkspaceAgentIdForStage(
  _stageId: ShortWorkspaceStageId
): ShortWorkspaceAgentId {
  return "short";
}

export function resolveShortWorkspaceConversationLaneIdForStage(
  stageId: ShortWorkspaceStageId
): ShortWorkspaceConversationLaneId {
  if (stageId === "character_design") return "character_design";
  if (stageId === "draft") return "expert_draft_coordinator";
  return "plot_design";
}

export const SHORT_WORKSPACE_PHASE_IDS = [
  "character",
  "plot",
  "draft"
] as const;
export const ShortWorkspacePhaseIdSchema = z.enum(SHORT_WORKSPACE_PHASE_IDS);
export type ShortWorkspacePhaseId = z.infer<typeof ShortWorkspacePhaseIdSchema>;

export function resolveShortWorkspacePhaseId(
  stageId: ShortWorkspaceStageId
): ShortWorkspacePhaseId {
  if (stageId === "character_design") return "character";
  if (stageId === "draft") return "draft";
  return "plot";
}

export function createShortWorkspaceContentRevision(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${content.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Provisional section ids allocated in-run before catalog create lands. */
export const PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX = "pending:section:";

export function isProvisionalExpertDraftSectionId(sectionId: string): boolean {
  return sectionId.startsWith(PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX);
}

export function plotStructureCreationStageId(
  proposalId: string,
  provisionalStageId: string
): string {
  const proposalRevision = createShortWorkspaceContentRevision(proposalId);
  const safeProposalId = proposalId.replace(/[^A-Za-z0-9._:-]/gu, "-");
  return `plot-stage-agent:${proposalRevision}:${safeProposalId.slice(0, 20)}:${safeProposalId.slice(-20)}:${provisionalStageId.slice(-24)}`;
}

/**
 * Directory/structure revision for expert draft. Must NOT include body or
 * character-state content hashes — otherwise same-run content writes falsely
 * invalidate pending section-creation proposals.
 */
export function createExpertDraftDirectoryRevision(
  sections: ReadonlyArray<{
    id: string;
    title: string;
    wordCountRequirement: string;
  }>
): string {
  return createShortWorkspaceContentRevision(
    sections
      .map(
        (section) =>
          `${section.id}\u0000${section.title}\u0000${section.wordCountRequirement}`
      )
      .join("\u0001")
  );
}

/**
 * These defaults are copied byte-for-byte from write-claw's
 * app/prompt_defaults/short/shared/*.txt files, including the final newline.
 */
export const DEFAULT_SHORT_CHARACTER_DESIGN_SYSTEM_PROMPT = `你是 DeepWrite 的短篇人物设计智能体。

你的职责是创建、补全、诊断和修改人物设计。你不负责写剧情大纲或小说正文；只有人物在故事中的功能需要剧情约束时，才读取相关剧情内容。

工作流程：
1. 判断用户是在新建人物、补全人物，还是修改已有设定。
2. 先调用 list_characters 确认人物结构；修改已有内容前用 read_character（mode=full）读取对应人物或概览，需要核对剧情约束时再读取剧情内容。
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
- 文本样式：目标编辑框为空或用户明确要求整体重写时，使用 write_workspace_editor；局部修改先读取原文，再使用 replace_current_stage_text。
- 条目样式：只用 create/write/edit/rename/move/delete_character_*，按稳定 item_id 管理独立人物文件；不得猜测路径，也不得写入正文目录。
- 条目样式的概览只维护人物一览与索引（姓名、定位、一句话摘要）；完整人物卡写入对应条目文件，不要把多人设定或剧情原文整段塞进概览。
- 用户要求“学习”剧情时，从剧情中提炼身份、动机、关系与弧光写入人物设定；不要照抄剧情/大纲/正文原文。
- 写入编辑器的只能是正式人物设定，不要写分析过程、操作说明或聊天回复。
- 不要凭空推翻已经确认的剧情事实；发现冲突时先指出冲突并给出最小改动方案。
`;

export const DEFAULT_SHORT_PLOT_DESIGN_SYSTEM_PROMPT = `你是 DeepWrite 的剧情设计智能体，负责当前作品“剧情”节点下全部动态配置阶段。

阶段名称、顺序、稳定 ID 和任务说明会在每轮运行时注入。不得假设存在固定的剧情设计、导语、细化、视角或大纲阶段；只处理当前配置实际存在的阶段，并以每个阶段的说明作为该阶段的任务边界和成品要求。

工作流程：
1. 确认当前目标阶段；需要跨阶段时，明确每一部分目标，并先读取人物设计、目标阶段和有关的其它剧情阶段。
2. 用户点名技能或需要特定剧情方法时调用 load_skill；需要素材时调用 query_linked_material_entries，先检索再读取原文。
3. 检查人物逻辑、因果、冲突递进、信息顺序、转折、伏笔与结局承诺是否一致。
4. 使用工具把正式成品写入正确的动态阶段。

工具规则：
- 切换阶段时调用 switch_storyline_stage，或在写入工具中明确 target_stage_id。
- 空白阶段或用户明确要求整体重写时使用 write_workspace_editor。
- 局部修改已有内容时先读取原文，再使用 replace_current_stage_text。
- 写入编辑器的只能是当前阶段的正式内容，不要混入分析过程或工具说明。
`;

export const DEFAULT_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT = `你是 DeepWrite 的短篇正文专家编写智能体，也是短篇唯一的正文写作智能体。你既能站在整篇角度完成目录初始化、统一创作、全文审阅、润色、去 AI 味、格式整理和跨章节修订，也能在用户打开具体小节时直接创作或修改该小节。正文是一个虚拟目录，每个小节的正文和人物状态是两个独立文件，不存在可覆盖的合并正文文件。

工作流程：
1. 用户要求初始化正文、按剧情结构创建章节或批量创建空白章节时，先根据本轮「当前剧情结构配置」和用户需求，按需调用 read_workspace_content 读取相关剧情阶段，再调用 read_workspace_content（stage_id=draft）核对现有目录。
2. 优先依据已被读取、且结构说明承担章节规划职责的内容，一次调用 create_draft_sections 批量提交所有尚未存在的章节标题和字数要求；该工具只创建空白正文文件和空白人物状态文件，不会写入小说正文。
3. 处理整篇正文时，先调用 read_draft_sections（mode=preview）扫描相关小节，定位真正需要处理的范围，再对它们调用 read_draft_sections（mode=full）精读原文。
4. 运行时提供「当前用户正在操作的小节」时，把它视为用户当前焦点：只处理这一小节的请求优先作用于该 section_id，写入工具可省略 section_id；需要统一创作或跨小节修改时仍可显式指定其它 section_id。没有当前小节时，写入必须显式指定 section_id。
5. 局部修改使用 replace_draft_section_text；只有章节为空或用户明确要求整章重写时，才使用 write_draft_section。
6. 用户要求修改章节名称时，先核对目录，再调用 rename_draft_section；该工具只改目录名与对应文件标题，不改正文内容。
7. 用户要求删除章节时，先核对目录，再调用 delete_draft_section；正文至少保留一个章节，删除会同时移除正文与人物状态文件。

读取规则：
- 剧情阶段 id 以本轮「当前剧情结构配置」清单为准；read_workspace_content 每次只读一个 stage_id，必须按用户需求按需读取，不要默认通读全部阶段，也不得臆造未出现在清单中的固定阶段名。工具返回 next_offset 时，必须用该 offset 继续分页读取，直至 next_offset=null 才算读完该阶段文件。
- read_draft_sections 单次批量完整读取有章数和字数上限，超出的章节会被留到下一次调用；单个超长文件必须按 next_offset 分页读取。工具返回“本次未读取”或非空 next_offset 时，必须继续分批、分页读完再下结论，不得假设剩余内容为空或与已读部分一致。
- 不要一次性把整本正文读进上下文。先用 preview 判断范围，再对目标章节 full 精读。
- preview 不算完整读取；只有被 mode=full 完整读取的文件才允许整章覆盖。
- 改动会影响后续章节连贯性时，用 include 一并读取相关章节的 character_state，并在修改正文后同步更新受影响章节的人物状态。
- 涉及具体人物设定时，先调用 list_characters 确认人物结构：文本样式可读整份人物设计；条目样式下，概览只是姓名与一句话索引，必须对本章/本次修订涉及的人物用 read_character 并指定 item_id 读取对应人物卡。不得只读概览或只调用 read_workspace_content（stage_id=character_design）就开始编写或修订。

初始化规则：
- 当前剧情结构不足以确定章节清单且用户没有明确给出时，不得猜测章节结构，应引导用户补充章节规划或标题。
- 章节标题、顺序和字数要求应与已读取的相关剧情内容或用户本轮明确要求一致；创建前必须排除目录中已经存在的同名章节。
- 批量初始化必须在一次 create_draft_sections 调用中提交全部待创建章节，不得拆成多次单章调用。
- 初始化只新增空白章节文件，不删除、不改名、不排序、不覆盖已有章节；创建后若需立即写正文，使用工具返回的 section_id（含 pending:section: 临时 id）在同一轮继续写入。

小节写作标准：
- 写作或修订当前小节前，按需读取当前小节、相邻前文和上一小节人物状态；严格执行已读取剧情内容中的任务、承接点与字数要求。
- 延续前文的时间、空间、人物关系、信息知情范围、物品位置、伤势和情绪，不重复已经完成的情节。
- 让冲突通过人物行动、选择、对白和可感知细节推进，保持题材、叙述视角、文风和节奏一致。
- 小节结尾应完成本节任务，并为下一节留下明确承接点或阅读动力。

写回规则：
- 运行时提供当前小节时，省略 section_id 默认作用于该小节；仍可为整篇任务显式指定其它稳定 section_id。不得把多个小节拼成一份文本覆盖。
- file 参数决定写正文还是写人物状态；默认是 body。
- 同一轮内先创建再写文时，必须使用创建结果给出的 section_id；不要假设章节已落盘到磁盘。
- 修改已有章节名称时调用 rename_draft_section；不得用写入正文的方式伪造改名。
- 删除已有章节时调用 delete_draft_section；正文至少保留一个章节。排序仍由界面管理。
- 写入的只能是正式小说正文或正式人物状态，不要混入分析过程、操作说明或工具记录。
- 需要技能时调用 load_skill；只有当前读取范围允许素材且确有必要时，才查询关联素材。
`;

export const DEFAULT_SHORT_EXPERT_SECTION_WRITER_SYSTEM_PROMPT = `你是 DeepWrite 的短篇分节写手智能体，是实际创作小说正文的主要智能体。你与正文专家共用正文读写、改名和删除工具，但不包含批量创建章节；职责区别是：你一次只完成当前选中的这一个章节，不改动其它章节。

写作前必须完成：
1. 根据用户本轮需求和本轮「当前剧情结构配置」，按需调用 read_workspace_content 读取相关剧情阶段（每次一个 stage_id，使用清单中的真实 id）；以被读取阶段的说明与正文作为写作依据，不要默认通读全部阶段，也不得臆造未出现在清单中的阶段名。
2. 调用 read_workspace_content（stage_id=draft）确认当前章节在目录中的位置和相邻章节 id。
3. 调用 read_draft_sections（mode=full）读取当前章节，以及紧邻的前 2 到 3 个已有正文的章节；正文为空的前置章节可跳过。读取紧邻上一章时，include 必须包含 character_state。任一文件返回非空 next_offset 时，必须用该 offset 继续分页，直至 next_offset=null 才算完整读取。
4. 只有在用户明确要求跨章节呼应、或前文伏笔必须核对时，才扩大读取范围；这时优先用 mode=preview 扫描，再对确有必要的章节 full 精读，避免把无关正文塞满上下文。
5. 用户点名技能或文风方法时调用 load_skill；确需参考正文素材时，调用 query_linked_material_entries 检索并读取相关条目。

人物设定：
- 编写或修订前先调用 list_characters 确认人物结构。
- 文本样式：可用 read_character 或 read_workspace_content（stage_id=character_design）读取整份人物设计。
- 条目样式：概览只维护姓名、定位与一句话摘要，不是完整人设。对本节出场或影响情节的人物，必须用 read_character 并指定 item_id 读取对应人物卡；不得只读概览或只读 character_design 阶段概览就开始编写。

写作标准：
- 严格执行当前章节在已读取剧情内容中的任务、承接点和字数要求；未指定字数时，以 800—1500 字为默认范围。
- 延续前文的时间、空间、人物关系、信息知情范围、物品位置、伤势和情绪，不重复已经完成的情节。
- 让冲突通过人物行动、选择、对白和可感知细节推进，避免用总结代替场景。
- 保持题材、叙述视角、文风和节奏一致；用户本轮要求优先于一般写作习惯。
- 精确区分中文弯双引号“”（开引号 U+201C、闭引号 U+201D）与英文半角直双引号（开、闭字符都是 U+0022）。用户本轮要求、书籍记忆或相邻正文指定哪一种，就逐字符沿用哪一种，不得互换。
- 章节结尾应完成本章任务，并为下一章留下明确承接点或阅读动力。

写回规则：
- 写入工具省略 section_id 时默认作用于当前选中章节；你只能修改当前章节，指定其它 section_id 会被拒绝。
- 当前正文为空时，调用 write_draft_section（file=body）写入完整正文；text 只能包含小说正文，不得包含章节名、标题、分析、解释或工具说明。
- 当前正文已有内容且用户要求局部修改时，使用 replace_draft_section_text；只有明确要求整章重写时才允许整章覆盖。
- 当前人物状态为空时调用 write_draft_section（file=character_state）；已有状态只需修改时用 replace_draft_section_text（file=character_state）。
- 用户要求修改当前章节名称时，调用 rename_draft_section；只能改当前选中章节，不改正文内容。
- 用户要求删除当前章节时，调用 delete_draft_section；只能删除当前选中章节，且正文至少保留一个章节。
- 人物状态应记录本章结束时的处境、关系、情绪、已知与隐瞒信息、关键物品、未解决冲突和下一章接续点。
- 没有完成正文与人物状态的必要写回工具调用，本章不算完成。
`;

export const DEFAULT_SHORT_WORKSPACE_AGENT_SYSTEM_PROMPTS: Record<
  ShortWorkspaceAgentId,
  string
> = {
  short: DEFAULT_SHORT_SYSTEM_PROMPT
};

const ShortSystemPromptSchema = z
  .string()
  .min(1)
  .max(200_000)
  .refine((value) => value.trim().length > 0, {
    message: "System prompt must contain non-whitespace text."
  });

export const ShortWorkspaceStageSnapshotSchema = z
  .object({
    stageId: ShortWorkspaceTextStageIdSchema,
    title: z.string().trim().min(1).max(240),
    content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    truncated: z.boolean().optional(),
    originalLength: z
      .number()
      .int()
      .nonnegative()
      .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
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
        message:
          "A truncated stage must report an originalLength larger than content."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "An untruncated stage must omit originalLength."
      });
    }
  });
export type ShortWorkspaceStageSnapshot = z.infer<
  typeof ShortWorkspaceStageSnapshotSchema
>;

export const ShortCharacterItemSnapshotSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(256),
    order: z.number().int().positive(),
    content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    truncated: z.boolean().optional(),
    originalLength: z
      .number()
      .int()
      .nonnegative()
      .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
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
        message: "A truncated character item must report its original length."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "An untruncated character item must omit originalLength."
      });
    }
  });
export type ShortCharacterItemSnapshot = z.infer<
  typeof ShortCharacterItemSnapshotSchema
>;

export const ShortCharacterStructureSnapshotSchema = z.discriminatedUnion(
  "format",
  [
    z.object({ format: z.literal("text") }),
    z.object({
      format: z.literal("list"),
      items: z.array(ShortCharacterItemSnapshotSchema).max(4_096)
    })
  ]
);
export type ShortCharacterStructureSnapshot = z.infer<
  typeof ShortCharacterStructureSnapshotSchema
>;

export const ExpertDraftFileSnapshotSchema = z.object({
  documentId: z.string().trim().min(1).max(4_096),
  // Character-state titles append a suffix to a valid 240-character section
  // title, so file snapshots follow CatalogDocument's 256-character limit.
  title: z.string().trim().min(1).max(256),
  content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
  revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/)
});
export type ExpertDraftFileSnapshot = z.infer<
  typeof ExpertDraftFileSnapshotSchema
>;

export const ExpertDraftSectionSnapshotSchema = z
  .object({
    id: DraftSectionIdSchema,
    title: DraftSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    body: ExpertDraftFileSnapshotSchema,
    characterState: ExpertDraftFileSnapshotSchema
  })
  .superRefine((value, context) => {
    if (value.body.documentId === value.characterState.documentId) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "documentId"],
        message:
          "Expert draft body and character state must use distinct files."
      });
    }
  });
export type ExpertDraftSectionSnapshot = z.infer<
  typeof ExpertDraftSectionSnapshotSchema
>;

export const ExpertDraftDirectorySnapshotSchema = z
  .object({
    id: z.literal("draft"),
    title: z.string().trim().min(1).max(240),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    sections: z.array(ExpertDraftSectionSnapshotSchema).min(1).max(100)
  })
  .superRefine((value, context) => {
    const sectionIds = value.sections.map((section) => section.id);
    sectionIds.forEach((sectionId, index) => {
      if (sectionIds.indexOf(sectionId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: `Duplicate expert draft section id: ${sectionId}`
        });
      }
    });

    const documentIds = value.sections.flatMap((section) => [
      section.body.documentId,
      section.characterState.documentId
    ]);
    documentIds.forEach((documentId, index) => {
      if (documentIds.indexOf(documentId) !== index) {
        const sectionIndex = Math.floor(index / 2);
        const fileField = index % 2 === 0 ? "body" : "characterState";
        context.addIssue({
          code: "custom",
          path: ["sections", sectionIndex, fileField, "documentId"],
          message: `Duplicate expert draft document id: ${documentId}`
        });
      }
    });
  });
export type ExpertDraftDirectorySnapshot = z.infer<
  typeof ExpertDraftDirectorySnapshotSchema
>;

const ShortWorkspaceSnapshotAgentIdSchema = z
  .union([ShortWorkspaceAgentIdSchema, ShortWorkspaceConversationLaneIdSchema])
  .transform(() => "short" as const);

export const ShortWorkspaceSnapshotSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(240),
    categories: z.array(z.string().trim().min(1).max(120)).max(16),
    activeStageId: ShortWorkspaceStageIdSchema,
    activeAgentId: ShortWorkspaceSnapshotAgentIdSchema.optional(),
    activeSectionId: z.string().trim().min(1).max(120).optional(),
    readSource: z.literal("core").optional(),
    agentsMd: z.string().max(WRITING_CONTEXT_MAX_CHARACTERS).optional(),
    plotStages: CreativePlotStagesSchema,
    characterStructure: ShortCharacterStructureSnapshotSchema.default({
      format: "text"
    }),
    expertDraft: ExpertDraftDirectorySnapshotSchema,
    stages: z.array(ShortWorkspaceStageSnapshotSchema).min(2).max(33)
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
    const expectedStageIds = [
      "character_design",
      ...value.plotStages.map((stage) => stage.id)
    ];
    if (
      expectedStageIds.length !== stageIds.length ||
      expectedStageIds.some((stageId, index) => stageIds[index] !== stageId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["stages"],
        message:
          "Workspace text stages must contain character design followed by configured plot stages."
      });
    }
    if (
      value.activeStageId !== "draft" &&
      !stageIds.includes(value.activeStageId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeStageId"],
        message: "Active stage must be present in the workspace snapshot."
      });
    }

    if (value.activeStageId !== "draft") {
      const defaultAgentId = resolveShortWorkspaceAgentIdForStage(
        value.activeStageId
      );
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
          message: "Only the draft stage may target a section."
        });
      }
      return;
    }

    if (value.activeAgentId !== undefined && value.activeAgentId !== "short") {
      context.addIssue({
        code: "custom",
        path: ["activeAgentId"],
        message: "The draft stage must use the unified short agent."
      });
      return;
    }

    if (value.activeSectionId === undefined) return;

    const sectionExists = value.expertDraft.sections.some(
      (section) => section.id === value.activeSectionId
    );
    if (!sectionExists) {
      context.addIssue({
        code: "custom",
        path: ["activeSectionId"],
        message: `Unknown expert draft section: ${value.activeSectionId}`
      });
    }
  });
export type ShortWorkspaceSnapshot = z.infer<
  typeof ShortWorkspaceSnapshotSchema
>;

export const SHORT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH = 120;

export const ShortAgentWelcomeShortcutsSchema = z.tuple([
  z.string().trim().min(1).max(SHORT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH),
  z.string().trim().min(1).max(SHORT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH),
  z.string().trim().min(1).max(SHORT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH)
]);
export type ShortAgentWelcomeShortcuts = z.infer<
  typeof ShortAgentWelcomeShortcutsSchema
>;

export const DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS = {
  short: [
    "根据当前阶段继续完善作品",
    "检查当前内容与前后阶段是否一致",
    "读取相关资料并给出可直接写回的成稿"
  ]
} as const satisfies Record<ShortWorkspaceAgentId, ShortAgentWelcomeShortcuts>;

export const ShortWorkspaceAgentProfileSchema = z.object({
  id: ShortWorkspaceAgentIdSchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000),
  systemPrompt: ShortSystemPromptSchema,
  welcomeShortcuts: ShortAgentWelcomeShortcutsSchema,
  readAccess: ShortAgentReadAccessSchema
});
export type ShortWorkspaceAgentProfile = z.infer<
  typeof ShortWorkspaceAgentProfileSchema
>;

export const DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES: readonly ShortWorkspaceAgentProfile[] =
  [
    {
      id: "short",
      ...BUILTIN_AGENT_METADATA.short,
      systemPrompt: DEFAULT_SHORT_SYSTEM_PROMPT,
      welcomeShortcuts: [...DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.short],
      readAccess: DEFAULT_SHORT_AGENT_READ_ACCESS.short
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
    defaultPlotStageIds: ShortDefaultPlotStageIdsSchema.default([
      ...SHORT_DEFAULT_PLOT_STAGE_IDS
    ]),
    agents: z
      .array(ShortWorkspaceAgentProfileSchema)
      .length(SHORT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) =>
    validateCompleteAgentSet(value.agents, context)
  );
export type ShortWorkspaceAgentSettings = z.infer<
  typeof ShortWorkspaceAgentSettingsSchema
>;

export const ShortWorkspaceAgentSettingsInputAgentSchema = z.object({
  id: ShortWorkspaceAgentIdSchema,
  systemPrompt: ShortSystemPromptSchema,
  welcomeShortcuts: ShortAgentWelcomeShortcutsSchema,
  readAccess: ShortAgentReadAccessSchema
});
export type ShortWorkspaceAgentSettingsInputAgent = z.infer<
  typeof ShortWorkspaceAgentSettingsInputAgentSchema
>;

export const ShortWorkspaceAgentSettingsInputSchema = z
  .object({
    workspaceType: z.literal("short"),
    defaultPlotStageIds: ShortDefaultPlotStageIdsSchema.default([
      ...SHORT_DEFAULT_PLOT_STAGE_IDS
    ]),
    baseDefaultPlotStageIds: ShortDefaultPlotStageIdsSchema.optional(),
    agents: z
      .array(ShortWorkspaceAgentSettingsInputAgentSchema)
      .length(SHORT_WORKSPACE_AGENT_IDS.length),
    baseAgents: z
      .array(ShortWorkspaceAgentSettingsInputAgentSchema)
      .length(SHORT_WORKSPACE_AGENT_IDS.length)
      .optional()
  })
  .superRefine((value, context) => {
    validateCompleteAgentSet(value.agents, context);
    if (value.baseAgents) validateCompleteAgentSet(value.baseAgents, context);
  });
export type ShortWorkspaceAgentSettingsInput = z.infer<
  typeof ShortWorkspaceAgentSettingsInputSchema
>;

export const DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS: ShortWorkspaceAgentSettings =
  {
    workspaceType: "short",
    defaultPlotStageIds: [...SHORT_DEFAULT_PLOT_STAGE_IDS],
    agents: [...DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES]
  };

/** Shared unions for callers that handle both isolated creative workspaces. */
export const WorkspaceAgentIdSchema = z.union([
  ShortWorkspaceAgentIdSchema,
  ScriptWorkspaceAgentIdSchema
]);
export type WorkspaceAgentId = z.infer<typeof WorkspaceAgentIdSchema>;

export const WorkspaceAgentProfileSchema = z.union([
  ShortWorkspaceAgentProfileSchema,
  ScriptWorkspaceAgentProfileSchema
]);
export type WorkspaceAgentProfile = z.infer<typeof WorkspaceAgentProfileSchema>;

export const CreativeWorkspaceSnapshotSchema = z.union([
  ShortWorkspaceSnapshotSchema,
  ScriptWorkspaceSnapshotSchema
]);
export type CreativeWorkspaceSnapshot = z.infer<
  typeof CreativeWorkspaceSnapshotSchema
>;

export const WorkspaceAgentSettingsSchema = z.discriminatedUnion(
  "workspaceType",
  [ShortWorkspaceAgentSettingsSchema, ScriptWorkspaceAgentSettingsSchema]
);
export type WorkspaceAgentSettings = z.infer<
  typeof WorkspaceAgentSettingsSchema
>;

export const WorkspaceAgentSettingsInputSchema = z.discriminatedUnion(
  "workspaceType",
  [
    ShortWorkspaceAgentSettingsInputSchema,
    ScriptWorkspaceAgentSettingsInputSchema
  ]
);
export type WorkspaceAgentSettingsInput = z.infer<
  typeof WorkspaceAgentSettingsInputSchema
>;

export const WorkspaceAgentsListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("workspaceAgents.list"),
    payload: z.object({ workspaceType: WorkspaceTypeSchema })
  });

export const WorkspaceAgentsSaveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("workspaceAgents.save"),
    payload: WorkspaceAgentSettingsInputSchema
  });

export const WorkspaceAgentsResetCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("workspaceAgents.reset"),
    payload: z.discriminatedUnion("workspaceType", [
      z.object({
        workspaceType: z.literal("short"),
        agentId: ShortWorkspaceAgentIdSchema.optional()
      }),
      z.object({
        workspaceType: z.literal("script"),
        agentId: ScriptWorkspaceAgentIdSchema.optional()
      })
    ])
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
