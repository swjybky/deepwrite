/** Canonical persisted metadata, independent of prompts and runtime schemas. */
export const BUILTIN_AGENT_METADATA = {
  short: {
    label: "短篇智能体",
    description:
      "统一负责人物、动态剧情阶段和正文创作，并按当前阶段加载上下文。"
  },
  script: {
    label: "剧本智能体",
    description:
      "统一负责人物、动态剧情阶段和剧本正文创作，并按当前阶段加载上下文。"
  },
  long: {
    label: "长篇智能体",
    description:
      "统一维护世界观、人物、剧情、正文与连续性账本，按需查询、创建、修改和删除本书内容。"
  },
  academic: {
    label: "学术主创智能体",
    description:
      "统一负责学术作品的研究底座、论证框架、文献证据卡与各章节正文的讨论、规划与撰写。"
  },
  material: {
    label: "素材库管理智能体",
    description:
      "创建、修改、检索和整理当前素材库，维护条目名称、使用说明与库介绍。"
  },
  skill: {
    label: "技能库管理智能体",
    description:
      "创建、修改和管理可复用写作技能，维护方法步骤、使用说明与技能库索引。"
  },
  mystery: {
    label: "剧本杀智能体",
    description:
      "统一统筹真相与核诡、角色档案、多视角人物本、搜证线索与 DM 主持手册，严守视角隔离并配合测本检查。"
  }
} as const;

export const DEFAULT_LONG_AGENT_WELCOME_SHORTCUTS = [
  "梳理当前阶段内容",
  "检查设定与剧情冲突",
  "写当前章"
] as const;

export const DEFAULT_ACADEMIC_AGENT_WELCOME_SHORTCUTS = [
  "先讨论研究问题、核心贡献与立题切入点",
  "结合研究底座梳理当前论证框架阶段",
  "按写作指引与文献证据卡起草或审校当前小节"
] as const;

export const DEFAULT_MYSTERY_AGENT_WELCOME_SHORTCUTS = [
  "搭建盘面与核心真相",
  "拆解时间线与视角任务卡",
  "检查全本视角泄密与时间撞车"
] as const;
