import { z } from "zod";
import {
  AgentTeamParallelSubagentsSchema,
  LongAgentSubagentDefinitionsSchema
} from "./agent-team";
import {
  LONG_AGENT_IDS,
  LongAgentIdSchema,
  type LongAgentId
} from "./long-workspace";

export const LongAgentTeamSchema = z
  .object({
    parentAgentId: LongAgentIdSchema,
    subagents: LongAgentSubagentDefinitionsSchema
  })
  .strict();
export type LongAgentTeam = z.infer<typeof LongAgentTeamSchema>;

function validateCompleteLongAgentTeams(
  teams: readonly { parentAgentId: LongAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = teams.map((team) => team.parentAgentId);
  for (const id of LONG_AGENT_IDS) {
    if (!ids.includes(id)) {
      context.addIssue({
        code: "custom",
        path: ["teams"],
        message: `Missing long parent agent team: ${id}`
      });
    }
  }
}

export const LongAgentTeamSettingsSchema = z
  .object({
    workspaceType: z.literal("long"),
    parallelSubagents: AgentTeamParallelSubagentsSchema,
    teams: z.array(LongAgentTeamSchema).length(LONG_AGENT_IDS.length)
  })
  .strict()
  .superRefine((value, context) =>
    validateCompleteLongAgentTeams(value.teams, context)
  );
export type LongAgentTeamSettings = z.infer<typeof LongAgentTeamSettingsSchema>;

export const LongAgentTeamSettingsInputSchema = LongAgentTeamSettingsSchema;
export type LongAgentTeamSettingsInput = z.infer<
  typeof LongAgentTeamSettingsInputSchema
>;

export const DEFAULT_LONG_AGENT_TEAM_SETTINGS: LongAgentTeamSettings = {
  workspaceType: "long",
  parallelSubagents: false,
  teams: LONG_AGENT_IDS.map((parentAgentId) => ({
    parentAgentId,
    subagents: [
      {
        id: "chapter_writer",
        name: "章节写手",
        description: "依据章卡与上一章结尾完成指定章节正文。",
        systemPrompt:
          "只完成主智能体指定的现有章卡。先读 card 与上一章 body 的 tail；写作上下文足够就写，缺什么只读那个对象，不读取整份人物档案或其他章全文。若章卡不存在，报告缺失，不自行创建。只将小说正文写入 body；交回时列出提案与实际衔接差异。",
        enabled: false,
        agentMode: "standard",
        modelMode: "inherit"
      },
      {
        id: "continuity_recorder",
        name: "连续性记录员",
        description: "核对已写章节，合并提交连续性文件与账本。",
        systemPrompt:
          "完整读取指定连续批次的每章正文，核对已有伏笔触点；只在末章检查点汇总整批状态。用 propose_continuity_commit 的 documents 一并提供 chapter_end_state、handoff，以及需要的 world_reveals 和 characters（character_id、current_state、history）。修改非空文件前先完整读取；不能新建伏笔设计。交回时列出批次、检查点和提交提案，不声称未审批的提案已落盘。",
        enabled: false,
        agentMode: "standard",
        modelMode: "inherit"
      },
      {
        id: "continuity_reviewer",
        name: "一致性审校",
        description: "只读检索指定事实，指出前后矛盾与证据位置。",
        systemPrompt:
          "只做主智能体指定的一致性核查。优先 search 定位，再按业务 id 读取必要片段或全文；不批量读取全书，不修改作品。交回时区分事实与推测，列出矛盾、业务 id、document、chapter_id 和简短证据。检索无命中时如实说明，不编造依据。",
        enabled: false,
        agentMode: "pure-read",
        modelMode: "inherit"
      }
    ]
  }))
};
