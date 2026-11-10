import type { PromptLocale } from "@deepwrite/contracts";

import {
  WRITING_DRAFT_SECTION_RENAME_GUIDANCE,
  WRITING_DRAFT_SECTION_RENAME_GUIDANCE_EN
} from "./writing-edit-guidance";

export interface WritingRulesOptions {
  workspaceType: "short" | "script";
  characterFormat: "text" | "list";
  /** Names of the delegation and web tools mounted this turn, if any. */
  hasSubagents: boolean;
  webToolNames?: string;
  autoApproveCrossStage: boolean;
}

/**
 * Object addressing and tool rules for short-form and screenplay runs. They
 * sit in the non-editable part of the system prompt so that a customized role
 * prompt cannot drop them, and delegated children receive them too.
 */
export function renderWritingRules(
  options: WritingRulesOptions,
  locale: PromptLocale
): string {
  return locale === "en-US"
    ? renderEnglishRules(options)
    : renderChineseRules(options);
}

function renderChineseRules(options: WritingRulesOptions): string {
  const script = options.workspaceType === "script";
  const kind = script ? "剧本" : "短篇";
  const unit = script ? "剧集" : "小节";
  const prose = script ? "剧本正文" : "小说正文";
  return [
    "【DeepWrite 当前工具边界】",
    `${kind}工作区只使用 read、create、edit、delete；素材使用 query_linked_material_entries，技能使用 load_skill，需要用户确认或补充信息时使用 ask_user_question${
      options.hasSubagents ? "，团队委派使用 spawn_subagent" : ""
    }${options.webToolNames ? `，联网查证公开资料使用 ${options.webToolNames}` : ""}。工具以本轮实际清单为准；query_linked_material_entries 只查当前作品已关联的素材，load_skill 只加载当前作品已关联的方法，没有必要时不调用。`,
    "ask_user_question 只在确实需要简短确认、选择或补充缺失事实时使用：一次最多三个问题，问题和选项使用稳定 id；上下文已经足够时直接执行，不要用它重复客户端的写入审批。用户跳过且关键信息仍然不足时，不得猜测目标或内容。",
    "",
    "【作品对象定位】",
    "- 所有对象都用稳定 id 定位。id 只能来自作品目录或工具返回值；不要把人名、标题或文件路径当作 id，也不要猜测不存在的剧情阶段。",
    "- 剧情阶段：kind=plot_stage 加目录中的阶段 id。",
    `- 正文：总目录为 kind=draft、id=draft；单个${unit}为 kind=draft_section 加${unit} id。每个${unit}有 document=body（${prose}）和 document=character_state（人物状态）两份文件，读写其中任何一份都必须指定 document。没有当前${unit}时，写入正文必须明确给出${unit} id。`,
    options.characterFormat === "list"
      ? "- 人物（条目样式）：概览为 kind=character_overview、id=character_design，只做索引；每个人物是独立人物卡，kind=character 加人物 id，完整人设写进人物卡。新建人物用 create（kind=character）逐个创建；delete（kind=character）会删除该人物卡及其文件。"
      : "- 人物（文本样式）：所有人物写在同一份总稿里，kind=character_overview、id=character_design。新建或修改人物都用 edit 写入这份总稿，不要 create character，也不要拆成多张人物卡；delete（kind=character_overview）只清空总稿内容，保留人物结构。",
    "",
    "【读取规则】",
    "- read 一次返回目标的完整文本，没有预览或分页。没有读到的内容不能当作事实；修改任何已有的非空文本前必须先完整 read。",
    `- 读取整本正文可用 kind=draft、id=draft、include_all_sections=true，不传 document 时默认 body；合计超过五万字时按工具提示改为分${unit}精读，避免把无关正文塞满上下文。`,
    "",
    "【写入规则】",
    `- create 每次只建一个对象，可同时写入它的正式内容；id 和排序由系统生成，不要自行指定。可创建剧情阶段 plot_stage 或正文${unit} draft_section，人物按上面的人物结构处理。新增剧情阶段会改变短篇与剧本共享的全局结构定义，只为当前作品建立该阶段正文；除非用户明确要求，不要新增。`,
    "- edit 修改已有对象：空白目标直接用 content 写入；局部修改用 replacements，original_text 必须是完整读取后唯一匹配的原文，new_text 是该片段的新文本。",
    '- 用户明确要求对目标全文重制、整篇重写或重新生成时，先完整 read，再在同一次 edit 中提交 content=重制后的完整正文和 allow_overwrite_existing=true。content 会替换全文，不能只传改动段落；清空非空正文同样传 content="" 和 allow_overwrite_existing=true。用户已经明确要求整体重写且目标清楚时，不要为覆盖参数再次询问。',
    "- 建议为每次 edit 提供 summary 说明改动；省略时系统自动生成。",
    `- ${WRITING_DRAFT_SECTION_RENAME_GUIDANCE}`,
    `- meta 只修改工具支持的结构字段（人物名称或归类、剧情阶段标题或说明、${unit}标题），不要用正文伪造结构变化。`,
    "- 工具返回“未修改”或“未写入”时没有生成提案：按返回说明修正参数后继续，不得当作已经完成。",
    `- delete（kind=plot_stage）只清空该阶段正文，不删除或修改剧情结构、标题、说明与顺序；delete（kind=draft_section）删除整个${unit}及其 body、character_state 两份文件，不接受 document，正文至少保留一个${unit}。`,
    `- 写回的内容只能是正式的人物设定、剧情成果、${prose}或人物状态，不混入标题、相邻${unit}、分析过程、操作说明或聊天回复。`,
    "- 阶段切换、结构排序和剧情结构删除由用户在界面完成；没有对应工具时，说明应在哪里操作，不得声称已经执行。",
    options.autoApproveCrossStage
      ? "- create、edit、delete 可以跨人物、剧情、正文阶段。跨阶段操作已由用户在常规设置中授权自动允许，不会逐笔询问；该授权只跳过跨阶段确认，修改提案仍按下面的写入审批方式处理。"
      : "- create、edit、delete 可以跨人物、剧情、正文阶段，但每笔跨阶段变更都会单独请求用户确认，不得把一次允许扩展到后续操作。"
  ].join("\n");
}

function renderEnglishRules(options: WritingRulesOptions): string {
  const script = options.workspaceType === "script";
  const kind = script ? "screenplay" : "short-fiction";
  const unit = script ? "episode" : "section";
  const prose = script ? "screenplay pages" : "prose";
  return [
    "[DeepWrite tool boundary]",
    `The ${kind} workspace uses only read, create, edit and delete. Use query_linked_material_entries for materials, load_skill for skills and ask_user_question when you need the user to confirm or supply information${
      options.hasSubagents ? "; delegate team work with spawn_subagent" : ""
    }${options.webToolNames ? `; verify public facts online with ${options.webToolNames}` : ""}. The tool list for this turn is authoritative. query_linked_material_entries only covers materials linked to this work and load_skill only loads methods linked to it; do not call them without need.`,
    "Use ask_user_question only when a short confirmation, a choice or a missing fact is genuinely needed: at most three focused questions at once, with stable ids for questions and options. When the context is sufficient, act directly, and never use it to duplicate the client's write approval. If the user skips and key information is still missing, do not guess the target or the content.",
    "",
    "[Addressing work objects]",
    "- Every object is addressed by a stable id. Ids come only from the work directory or tool results; never use a character name, title or file path as an id, and never guess plot stages that do not exist.",
    "- Plot stages: kind=plot_stage with a stage id from the directory.",
    `- Manuscript: the directory is kind=draft, id=draft; a single ${unit} is kind=draft_section with its id. Every ${unit} has two files, document=body (the ${prose}) and document=character_state (the character state); reading or writing either one requires document. When there is no current ${unit}, a manuscript write must name the ${unit} id explicitly.`,
    options.characterFormat === "list"
      ? "- Characters (card layout): the overview is kind=character_overview, id=character_design and serves only as an index. Each character has its own card, kind=character with the character id, which holds the full profile. Create characters one by one with create (kind=character); delete (kind=character) removes that card and its file."
      : "- Characters (text layout): every character lives in one overview document, kind=character_overview, id=character_design. Create or change characters by writing that document with edit; never create character, and never split it into separate cards. delete (kind=character_overview) only clears the overview text and keeps the character structure.",
    "",
    "[Reading]",
    "- A single read returns the target's complete text; there is no preview or paging. Never treat unread content as fact, and read any existing non-empty text in full before changing it.",
    `- To read the whole manuscript, use kind=draft, id=draft, include_all_sections=true (document defaults to body). When the total exceeds fifty thousand characters, follow the tool's hint and read ${unit} by ${unit} instead of filling the context with unrelated text.`,
    "",
    "[Writing]",
    `- create makes one object per call and may carry its final content; the system assigns ids and order, so never specify them. You can create a plot stage (plot_stage) or a manuscript ${unit} (draft_section); characters follow the character layout above. A new plot stage changes the global structure shared by short fiction and screenplays and creates that stage's text only for this work; do not add one unless the user explicitly asks.`,
    "- edit changes an existing object. Write an empty target directly with content. For a local change use replacements: original_text must match a unique passage of the fully read text, and new_text is its replacement.",
    '- When the user explicitly asks to remake, rewrite or regenerate the whole target, read it in full first, then submit content=the complete new text together with allow_overwrite_existing=true in the same edit call. content replaces the entire text, so never pass only the changed paragraphs. Clearing non-empty text likewise takes content="" with allow_overwrite_existing=true. When the user has clearly asked for a full rewrite of a clear target, do not ask again about the overwrite flag.',
    "- A summary of the change is recommended for each edit; if omitted, the system generates one.",
    `- ${WRITING_DRAFT_SECTION_RENAME_GUIDANCE_EN}`,
    `- meta changes only the structural fields the tool supports (character name or grouping, plot stage title or description, ${unit} title). Never fake a structural change through body text.`,
    '- When a tool returns "未修改" (not changed) or "未写入" (not written), no proposal was created: fix the parameters as the result explains and continue. Never treat it as done.',
    `- delete (kind=plot_stage) only clears that stage's text; it never deletes or changes the plot structure, its titles, descriptions or order. delete (kind=draft_section) removes the whole ${unit} with both its body and character_state files, takes no document, and the manuscript must keep at least one ${unit}.`,
    `- Write back only final character design, plot results, ${prose} or character state. Never mix in titles, neighboring ${unit}s, analysis, operating notes or chat replies.`,
    "- Switching stages, reordering the structure and deleting plot structure are done by the user in the interface. Without a matching tool, tell the user where to do it; never claim it is done.",
    options.autoApproveCrossStage
      ? "- create, edit and delete may cross the character, plot and manuscript stages. The user has allowed cross-stage operations automatically in General settings, so they are not confirmed one by one; this only skips the cross-stage confirmation, and change proposals still follow the write approval mode below."
      : "- create, edit and delete may cross the character, plot and manuscript stages, but every cross-stage change asks the user to confirm it separately. One approval never extends to later operations."
  ].join("\n");
}
