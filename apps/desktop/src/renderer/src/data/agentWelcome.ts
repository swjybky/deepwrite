import type { ShortWorkspaceAgentId } from "@deepwrite/contracts";

export interface AgentWelcomeContent {
  title: string;
  description: string;
  questions: readonly [string, string, string];
}

export const DEFAULT_AGENT_WELCOME: AgentWelcomeContent = {
  title: "从一个创作目标开始",
  description: "告诉我你想完成的创作任务，我会结合当前文稿与你一起推进。",
  questions: ["帮我梳理当前创作目标", "检查当前文稿的问题", "告诉我下一步可以做什么"]
};

export const SHORT_AGENT_WELCOME_CONTENT = {
  character_design: {
    title: "从一个人物设计开始",
    description:
      "我是人物设计智能体，用于创建、管理和完善优秀的人设，让角色能够直接服务于后续剧情与正文。",
    questions: [
      "帮我从零创建一个人物设计",
      "检查当前人设有哪些问题",
      "完善人物关系和人物弧光"
    ]
  },
  plot_design: {
    title: "从一个精彩剧情开始",
    description:
      "我是剧情设计智能体，用于设计和管理故事主线、导语钩子与剧情细节，让冲突、转折和结局前后连贯。",
    questions: [
      "根据当前人设设计一条主线剧情",
      "帮我写一个抓人的开篇导语",
      "细化当前剧情的场景和节拍"
    ]
  },
  outline: {
    title: "从一份完整大纲开始",
    description:
      "我是大纲智能体，用于梳理人物与剧情，创建和管理可直接指导分节写作的完整大纲。",
    questions: [
      "根据现有人物和剧情生成完整大纲",
      "检查当前大纲是否有逻辑漏洞",
      "把大纲拆成可写作的小节"
    ]
  },
  expert_draft_coordinator: {
    title: "从一篇完整正文开始",
    description:
      "我是正文专家智能体，用于管理正文结构、调度分节写作，并完成成稿审阅、润色和局部修订。",
    questions: [
      "根据大纲初始化并开始写正文",
      "帮我写指定的正文小节",
      "审阅并润色当前正文"
    ]
  },
  expert_section_writer: {
    title: "从一个正文小节开始",
    description:
      "我是分节写手智能体，用于依据大纲、前文和人物状态创作当前小节，保证情节、人物与文风连续。",
    questions: [
      "按照大纲写当前小节",
      "续写当前小节并衔接前文",
      "重写当前小节，增强冲突和画面感"
    ]
  }
} as const satisfies Record<ShortWorkspaceAgentId, AgentWelcomeContent>;

export function resolveAgentWelcome(
  agentId: ShortWorkspaceAgentId | undefined
): AgentWelcomeContent {
  return agentId ? SHORT_AGENT_WELCOME_CONTENT[agentId] : DEFAULT_AGENT_WELCOME;
}
