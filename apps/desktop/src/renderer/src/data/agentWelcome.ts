import type {
  LibraryAgentDomain,
  LibraryAgentSkill,
  ShortAgentWelcomeShortcuts,
  ShortWorkspaceAgentId
} from "@deepwrite/contracts";
import { DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS } from "@deepwrite/contracts";

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
    questions: DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.character_design
  },
  plot_design: {
    title: "从一个精彩剧情开始",
    description:
      "我是剧情设计智能体，用于设计和管理故事主线、导语钩子与剧情细节，让冲突、转折和结局前后连贯。",
    questions: DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.plot_design
  },
  outline: {
    title: "从一份完整大纲开始",
    description:
      "我是大纲智能体，用于梳理人物与剧情，创建和管理可直接指导分节写作的完整大纲。",
    questions: DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.outline
  },
  expert_draft_coordinator: {
    title: "从一篇完整正文开始",
    description:
      "我是正文专家智能体，用于管理正文结构、调度分节写作，并完成成稿审阅、润色和局部修订。",
    questions: DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.expert_draft_coordinator
  },
  expert_section_writer: {
    title: "从一个正文小节开始",
    description:
      "我是分节写手智能体，用于依据大纲、前文和人物状态创作当前小节，保证情节、人物与文风连续。",
    questions: DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.expert_section_writer
  }
} as const satisfies Record<ShortWorkspaceAgentId, AgentWelcomeContent>;

export const LIBRARY_AGENT_WELCOME_CONTENT = {
  skill: {
    title: "从创建一个技能开始",
    description:
      "我是技能库管理智能体，用于创建、整理和维护可复用的写作方法、检查清单与协作流程。",
    questions: ["初始化库介绍", "创建一个技能", "整理一个技能"]
  },
  material: {
    title: "从创建一个素材开始",
    description:
      "我是素材库管理智能体，用于创建、整理和维护可检索、可复用的短篇素材条目。",
    questions: ["初始化库介绍", "创建一个素材", "整理一个素材"]
  }
} as const satisfies Record<LibraryAgentDomain, AgentWelcomeContent>;

export function resolveAgentWelcome(
  agentId: ShortWorkspaceAgentId | undefined,
  libraryDomain?: LibraryAgentDomain,
  librarySkills?: readonly Pick<LibraryAgentSkill, "name">[],
  welcomeShortcuts?: ShortAgentWelcomeShortcuts | readonly string[]
): AgentWelcomeContent {
  if (agentId) {
    const base = SHORT_AGENT_WELCOME_CONTENT[agentId];
    if (
      welcomeShortcuts &&
      welcomeShortcuts.length === 3 &&
      welcomeShortcuts.every((value) => typeof value === "string" && value.trim().length > 0)
    ) {
      return {
        ...base,
        questions: [
          welcomeShortcuts[0].trim(),
          welcomeShortcuts[1].trim(),
          welcomeShortcuts[2].trim()
        ]
      };
    }
    return base;
  }
  if (libraryDomain) {
    const base = LIBRARY_AGENT_WELCOME_CONTENT[libraryDomain];
    if (!librarySkills?.length) {
      return base;
    }
    const questions = librarySkills.slice(0, 3).map((skill) => skill.name);
    while (questions.length < 3) {
      questions.push(base.questions[questions.length] ?? "");
    }
    return {
      ...base,
      questions: questions as [string, string, string]
    };
  }
  return DEFAULT_AGENT_WELCOME;
}
