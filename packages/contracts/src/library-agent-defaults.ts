import {
  MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPTS,
  SKILL_LIBRARY_AGENT_SYSTEM_PROMPTS
} from "./agent-prompts/library";
import { DEFAULT_PROMPT_LOCALE } from "./prompt-locale";

export const DEFAULT_SKILL_LIBRARY_AGENT_SKILLS = [
  {
    id: "init-library-overview",
    name: "初始化库介绍",
    description: "为当前技能库撰写或完善库介绍、适用边界和索引说明。",
    content: `目标：输出可直接写入库介绍的正式文案。

步骤：
1. 调用 list_skill_entries 了解当前库已有条目与结构。
2. 归纳本库用途、适用场景、不适用边界和条目组织方式。
3. 若库介绍为空或明显过时，整理一版完整库介绍；若已有内容，只补充缺失部分。
4. 调用 edit_skill_library_overview 提交正式修改；正文只写库介绍本身，不要混入分析过程或操作记录。`
  },
  {
    id: "create-skill",
    name: "创建一个技能",
    description: "在当前技能库中新建一条可复用的写作方法或检查清单。",
    content: `目标：创建一条边界清晰、可重复执行的技能条目。

步骤：
1. 调用 list_skill_entries 确认当前库栏目与已有条目，避免重复。
2. 明确适用场景、输入条件、执行步骤、检查标准和不适用边界。
3. 调用 create_skill_entry，提供 stage_id、title、name、description 和 body。name 是技能名称；description 简明说明何时使用、解决什么问题；body 写正式方法正文。工具会把 name、description 补充或覆盖到 Markdown 头部，不写入 JSON 清单。
4. 关键目标明确即可创建，把合理假设写清；只有缺失信息影响技能用途或正确性时才向用户追问。`
  },
  {
    id: "organize-skill",
    name: "整理一个技能",
    description: "梳理并优化已有技能条目的结构、步骤与质量标准。",
    content: `目标：让已有技能更易读、更可执行、边界更清楚。

步骤：
1. 调用 search_skill_entries 或 list_skill_entries 定位目标技能；不确定时先向用户确认。
2. 调用 read_skill_entry 读取完整快照后再修改。
3. 优先使用 replace_fragments 做局部修订；需要追加时使用 append。
4. 整理后应保留适用场景、步骤顺序、检查标准和不适用边界，不要删成空泛口号。`
  }
] as const;

export const DEFAULT_MATERIAL_LIBRARY_AGENT_SKILLS = [
  {
    id: "init-library-overview",
    name: "初始化库介绍",
    description: "为当前素材库撰写或完善库介绍、适用边界和索引说明。",
    content: `目标：输出可直接写入库介绍的正式文案。

步骤：
1. 调用 list_material_entries 了解当前库已有条目与栏目。
2. 归纳本库用途、适用场景、不适用边界和条目组织方式。
3. 若库介绍为空或明显过时，整理一版完整库介绍；若已有内容，只补充缺失部分。
4. 调用 edit_material_library_overview 提交正式修改；正文只写库介绍本身，不要混入分析过程或操作记录。`
  },
  {
    id: "create-material",
    name: "创建一个素材",
    description: "在当前素材库中新建一条可检索、可复用的素材条目。",
    content: `目标：创建一条边界清晰、便于后续检索与引用的素材条目。

步骤：
1. 调用 list_material_entries 确认当前库栏目与已有条目，避免重复。
2. 明确素材主题、适用场景、关键信息与引用边界。
3. 调用 create_material_entry，提供 stage_id、title、name、description 和 body。name 是素材名称；description 简明说明内容特征、适用场景和引用价值；body 写正式素材正文。工具会把 name、description 补充或覆盖到 Markdown 头部，不写入 JSON 清单。
4. 关键主题明确即可创建；用户给出的原文、事实和来源需保留，只有缺失信息影响素材准确性或用途时才追问。`
  },
  {
    id: "organize-material",
    name: "整理一个素材",
    description: "梳理并优化已有素材条目的结构、信息与可读性。",
    content: `目标：让已有素材更易检索、信息更完整、边界更清楚。

步骤：
1. 调用 search_material_entries 或 list_material_entries 定位目标素材；不确定时先向用户确认。
2. 调用 read_material_entry 读取完整快照后再修改。
3. 优先使用 replace_fragments 做局部修订；需要追加时使用 append。
4. 整理后应保留主题、关键信息和适用边界，不要把分析过程写进素材正文。`
  }
] as const;

/** Built-in library agent prompts in the default prompt language; see `agent-prompts/library.ts`. */
export const DEFAULT_MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPT =
  MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPTS[DEFAULT_PROMPT_LOCALE];

export const DEFAULT_SKILL_LIBRARY_AGENT_SYSTEM_PROMPT =
  SKILL_LIBRARY_AGENT_SYSTEM_PROMPTS[DEFAULT_PROMPT_LOCALE];
