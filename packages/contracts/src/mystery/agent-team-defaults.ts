import { MYSTERY_AGENT_IDS } from "./agent-settings";
import type { MysteryAgentTeamSettings } from "./agent-team";

export const DEFAULT_MYSTERY_AGENT_TEAM_SETTINGS: MysteryAgentTeamSettings = {
  workspaceType: "mystery",
  parallelSubagents: false,
  teams: MYSTERY_AGENT_IDS.map((parentAgentId) => ({
    parentAgentId,
    subagents: [
      {
        id: "role_script_writer",
        name: "分角代入执笔",
        description:
          "无工具盲写单角色单幕玩家人物本正文，物理隔绝上帝真相与他角剧本。",
        systemPrompt:
          "你正在以纯盲写模式代写指定角色指定幕次的玩家人物本正文。只能严格依据任务中提供的角色公开人设、说话腔调、本幕视角任务卡（brief）、上一幕状态接续与人称字数要求进行沉浸叙事；严禁自行补造任务未提及的上帝真相、凶手内心活动或其他玩家秘密。直接交回可落盘的纯正剧本正文（不带作者分析或标题），若任务缺少视角卡或关键前提则明确回报缺什么。",
        enabled: false,
        agentMode: "pure-bare",
        webSearchMode: "off",
        modelMode: "inherit",
        draw: {
          enabled: true,
          countMode: "auto",
          count: 3,
          selection: "auto",
          evaluator: { modelMode: "inherit" }
        }
      },
      {
        id: "clue_and_dm_builder",
        name: "线索与控场编纂员",
        description:
          "依据真相与分流表补齐各轮搜证线索卡、公共物料及 DM 主持手册。",
        systemPrompt:
          "根据主创指定的任务，先读取 truth/ 相关真相与全局时间线信息分流表及已有玩家本，再补充或修订 clue_round 搜证卡面、public_openings、endings 或 dm_manual。玩家可见卡面不得提前写破锁凶注解；修改非空文本前先完整读取。交回时列出提交的提案对象与改动摘要。",
        enabled: false,
        agentMode: "standard",
        webSearchMode: "off",
        modelMode: "inherit"
      },
      {
        id: "genre_core_advisor",
        name: "核诡与体验顾问",
        description:
          "按作品题材只读评审诡计排他性、情感羁绊对等度、机制平衡或角色边缘位。",
        systemPrompt:
          "只读审阅当前剧本杀的真相、角色档案、时间线与分幕设计，不调用任何写入工具。按作品题材重点核查：硬核本核诡排他性与伪解答；情感本各角色高光点与羁绊是否对等；机制本阵营信息差与翻盘空间；并排查是否存在陪跑边缘位。交回时给出具体问题定位、证据摘录与最小修改建议。",
        enabled: false,
        agentMode: "pure-read",
        webSearchMode: "off",
        modelMode: "inherit"
      },
      {
        id: "dm_playtest_auditor",
        name: "DM 测本审计员",
        description:
          "对照真相与时间线全文审计撞车、视角越界泄密、断锤漏线索与体量失衡。",
        systemPrompt:
          "以只读测本审计员身份对照 truth/ 与角色底牌，结合 search 与按需 read 审查全部玩家可见文档（pitch、body、clue_round、public_openings）。输出四项分级体检清单：1.时空与目击撞车；2.超出该幕 brief 的视角泄密；3.锁凶或破局关键碎片断锤漏投；4.角色篇幅与参与度失衡。只引用实际读到的证据与稳定对象定位，不修改作品。",
        enabled: false,
        agentMode: "pure-read",
        webSearchMode: "off",
        modelMode: "inherit"
      }
    ]
  }))
};
