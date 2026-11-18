import { registerFeatureMessages } from "../../i18n";

/**
 * Minimal shared mystery labels loaded dynamically via registerFeatureMessages
 * so core language catalogs stay within their startup byte budget.
 */
export const mysteryLabels = registerFeatureMessages("features.mysteryLabels", {
  "zh-CN": {
    murderMystery: "剧本杀",
    mysteryWriting: "剧本杀创作",
    mysteryWorkspace: "剧本杀创作空间",
    mysteryTypeDescription: "真相与统筹、角色与选角、分幕人物本、线索与DM手册",
    enterMysteryTitle: "请输入剧本杀名称",
    mysteryGenre: "剧本杀题材",
    createMystery: "创建剧本杀",
    playerCount: "人数规格",
    actCountTarget: "预计幕数",
    narrativePerson: "正文人称",
    secondPerson: "第二人称（你）",
    firstPerson: "第一人称（我）",
    unavailableMystery: "剧本杀不可用（{bookId}）",
    unavailableMysteryFailed: "读取失败",
    unavailableMysteryTemp: "暂不可用",
    mysteryCoordinatorLabel: "剧本杀总控创作智能体",
    mysteryWelcomeTitle: "从剧本杀核心立意与真相开始",
    stageTruth: "真相与统筹",
    stageCharacters: "角色与选角",
    stageScripts: "分幕人物本",
    stageClues: "线索与演绎",
    stageDm: "主持人手册",
    agentsMdItem: "项目约定 (AGENTS.md)",
    characterRelationsItem: "角色关系总图",
    publicOpeningsItem: "公共背景与序幕",
    endingsItem: "结局与真相复盘",
    dmManualItem: "DM 带本与复盘手册",
    roleProfileTab: "上帝底牌",
    rolePitchTab: "公开选角页",
    actBriefTab: "视角任务卡",
    actBodyTab: "人物本正文",
    mysteryWelcomeDescription:
      "我是剧本杀总控创作智能体，可协助策划五阶段创作流程：核诡真相与时间线调度、双面角色档案、R × A 分幕人物本、轮次搜证线索与 DM 主持手册。"
  },
  "en-US": {
    murderMystery: "Murder mystery",
    mysteryWriting: "Murder mystery writing",
    mysteryWorkspace: "Murder mystery workspace",
    mysteryTypeDescription:
      "Truth, roles & casting, R x A act scripts, clues & DM manual",
    enterMysteryTitle: "Enter a murder mystery title",
    mysteryGenre: "Mystery genre",
    createMystery: "Create mystery",
    playerCount: "Players",
    actCountTarget: "Target acts",
    narrativePerson: "Script POV",
    secondPerson: "2nd person (You)",
    firstPerson: "1st person (I)",
    unavailableMystery: "Mystery unavailable ({bookId})",
    unavailableMysteryFailed: "Read failed",
    unavailableMysteryTemp: "Unavailable",
    mysteryCoordinatorLabel: "Mystery coordinator agent",
    mysteryWelcomeTitle: "Start with core truth and game structure",
    stageTruth: "Truth & planning",
    stageCharacters: "Roles & casting",
    stageScripts: "Player act scripts",
    stageClues: "Clues & performance",
    stageDm: "DM manual",
    agentsMdItem: "Project rules (AGENTS.md)",
    characterRelationsItem: "Role relationships",
    publicOpeningsItem: "Public background & opening",
    endingsItem: "Endings & truth review",
    dmManualItem: "DM running & review manual",
    roleProfileTab: "Secret profile",
    rolePitchTab: "Public casting sheet",
    actBriefTab: "Perspective brief",
    actBodyTab: "Player script",
    mysteryWelcomeDescription:
      "I am your murder-mystery coordinator across all 5 stages: core truth & timeline dispatch, secret/public role sheets, R x A act scripts, clue rounds, and DM manual."
  }
});
