import type { PromptLocale } from "@deepwrite/contracts";

import {
  WRITING_DRAFT_SECTION_RENAME_GUIDANCE,
  WRITING_DRAFT_SECTION_RENAME_GUIDANCE_EN
} from "./writing-edit-guidance";

export interface WritingRulesOptions {
  workspaceType: "short" | "script";
  characterFormat: "text" | "list";
  toolNames?: readonly string[];
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
    options.toolNames
      ? `本轮可用工具：${options.toolNames.join("、")}。`
      : `请按本轮工具清单操作${kind}作品。`,
    ...(options.toolNames?.includes("ask_user_question")
      ? ["只在缺少关键信息时使用 ask_user_question，不重复写入审批。"]
      : []),
    "",
    "【作品对象定位】",
    "- 所有对象都用稳定 id 定位。id 只能来自作品目录或工具返回值；不要把人名、标题或文件路径当作 id，也不要猜测不存在的剧情阶段。",
    "- 剧情阶段：kind=plot_stage 加目录中的阶段 id。",
    `- 正文：总目录为 kind=draft、id=draft；单个${unit}为 kind=draft_section 加${unit} id。每个${unit}有 document=body（${prose}）和 document=state（状态，可记录人物、剧情、情感等任何信息）两份文件，读写其中任何一份都必须指定 document。没有当前${unit}时，写入正文必须明确给出${unit} id。`,
    options.characterFormat === "list"
      ? "- 人物（条目样式）：概览为 kind=character_overview、id=character_design，由你按需维护为索引；每个人物是独立人物卡，kind=character 加人物 id，完整人设写进人物卡。新建人物用 create（kind=character）逐个创建；delete（kind=character）会删除该人物卡及其文件。"
      : '- 人物（文本样式）：所有人物写在同一份总稿里，kind=character_overview、id=character_design。新建或修改人物都用 edit 写入这份总稿，不要 create character，也不要拆成多张人物卡；清空总稿用 edit 传 content=""，不要用 delete。',
    "",
    "【读取规则】",
    "- read 一次返回目标的完整文本，超过 50000 字符（含空白）时用 offset、limit 分段读取；分段读取不授予全文覆盖权限。没有读到的内容不能当作事实；修改任何已有的非空文本前必须先完整 read。",
    `- 读取整本正文可用 kind=draft、id=draft、include_all_sections=true，不传 document 时默认 body；合计超过 50000 字符（含空白）时只返回目录，改为分${unit}精读，避免把无关正文塞满上下文。`,
    "- 只分段读取了部分内容时，回答要说明读了哪些范围；未读部分只说明未读，不要根据目录或前后文推断它的内容。",
    "",
    "【写入规则】",
    `- create 可单项创建；同一作品的多个 draft_section 用 items 按顺序创建，正文和状态可随项提交，id 由系统生成。可创建剧情阶段 plot_stage 或正文${unit} draft_section，人物按上面的人物结构处理。新增剧情阶段会改变短篇与剧本共享的全局结构定义，只为当前作品建立该阶段正文；除非用户明确要求，不要新增。`,
    "- edit 修改已有对象：空白目标直接用 content 写入；续写用 append，定位插入用 insert（唯一 anchor、position=before/after、text）。局部修改用 replacements，original_text 必须是完整读取后唯一匹配的原文，new_text 是该片段的新文本。",
    '- 用户明确要求对目标全文重制、整篇重写或重新生成时，先完整 read，再在同一次 edit 中提交 content=重制后的完整正文和 allow_overwrite_existing=true。content 会替换全文，不能只传改动段落；清空非空正文同样传 content="" 和 allow_overwrite_existing=true。用户已经明确要求整体重写且目标清楚时，不要为覆盖参数再次询问。',
    "- 篇幅有上限时按上限的 85%–90% 写，给计数误差留出余量；工具返回“高于要求”或“低于要求”时，修正到范围内再结束。",
    "- 建议为每次 edit 提供 summary 说明改动；省略时系统自动生成。",
    `- ${WRITING_DRAFT_SECTION_RENAME_GUIDANCE}`,
    `- meta 只修改工具支持的结构字段（人物名称或上移、下移、剧情阶段标题或说明、${unit}标题、篇幅要求或目录位置），每次只改一项小节属性，不要用正文伪造结构变化。剧情阶段的标题和说明同样是短篇与剧本共享的全局结构定义，修改会影响所有作品并需要用户确认；除非用户明确要求，不要修改。`,
    "- 工具返回“未修改”时没有生成提案：目标已一致时无需重试；其余情况按返回说明处理。",
    `- delete 只做真正的删除：kind=character 删除人物卡及其文件；kind=draft_section 删除整个${unit}及其 body、state 两份文件，不接受 document，正文至少保留一个${unit}。清空人物总稿或剧情阶段的内容不是删除，用 edit 传 content="" 和 allow_overwrite_existing=true。`,
    `- 写回的内容只能是正式的人物设定、剧情成果、${prose}或状态，不混入标题、相邻${unit}、分析过程、操作说明或聊天回复。`,
    "- 阶段切换、剧情阶段排序和剧情结构删除由用户在界面完成；没有对应工具时，说明应在哪里操作，不得声称已经执行。",
    "- create、edit、delete 不受界面当前阶段限制，可以直接操作人物、剧情、正文任一阶段的对象。"
  ].join("\n");
}

function renderEnglishRules(options: WritingRulesOptions): string {
  const script = options.workspaceType === "script";
  const kind = script ? "screenplay" : "short-fiction";
  const unit = script ? "episode" : "section";
  const prose = script ? "screenplay pages" : "prose";
  return [
    "[DeepWrite tool boundary]",
    options.toolNames
      ? `Tools available this turn: ${options.toolNames.join(", ")}.`
      : `Use the mounted tools for this ${kind} work.`,
    ...(options.toolNames?.includes("ask_user_question")
      ? [
          "Use ask_user_question only for missing information. Do not repeat write approval."
        ]
      : []),
    "",
    "[Addressing work objects]",
    "- Every object is addressed by a stable id. Ids come only from the work directory or tool results; never use a character name, title or file path as an id, and never guess plot stages that do not exist.",
    "- Plot stages: kind=plot_stage with a stage id from the directory.",
    `- Manuscript: the directory is kind=draft, id=draft; a single ${unit} is kind=draft_section with its id. Every ${unit} has two files, document=body (the ${prose}) and document=state (State: character, plot, emotional or other continuity notes); reading or writing either one requires document. When there is no current ${unit}, a manuscript write must name the ${unit} id explicitly.`,
    options.characterFormat === "list"
      ? "- Characters (card layout): the overview is kind=character_overview, id=character_design and you maintain it as an index when needed. Each character has its own card, kind=character with the character id, which holds the full profile. Create characters one by one with create (kind=character); delete (kind=character) removes that card and its file."
      : '- Characters (text layout): every character lives in one overview document, kind=character_overview, id=character_design. Create or change characters by writing that document with edit; never create character, and never split it into separate cards. To clear the overview, use edit with content="", not delete.',
    "",
    "[Reading]",
    "- A single read returns the target's complete text; objects over 50000 characters including whitespace require offset/limit reads, which do not authorize full-text overwrites. Never treat unread content as fact, and read any existing non-empty text in full before changing it.",
    `- To read the whole manuscript, use kind=draft, id=draft, include_all_sections=true (document defaults to body). Above 50000 characters including whitespace, only the directory is returned; read ${unit} by ${unit} instead of filling the context with unrelated text.`,
    "- When you have read only some slices, say which ranges you read. For unread ranges, say they are unread; never infer their content from the directory or the surrounding text.",
    "",
    "[Writing]",
    `- create can create one object or an ordered batch of draft_section items with body and State. The system assigns ids. You can create a plot stage (plot_stage) or a manuscript ${unit} (draft_section); characters follow the character layout above. A new plot stage changes the global structure shared by short fiction and screenplays and creates that stage's text only for this work; do not add one unless the user explicitly asks.`,
    "- edit changes an existing object. Write an empty target directly with content. Use append to continue, or insert with a unique anchor, position=before/after and text. For a local change use replacements: original_text must match a unique passage of the fully read text, and new_text is its replacement.",
    '- When the user explicitly asks to remake, rewrite or regenerate the whole target, read it in full first, then submit content=the complete new text together with allow_overwrite_existing=true in the same edit call. content replaces the entire text, so never pass only the changed paragraphs. Clearing non-empty text likewise takes content="" with allow_overwrite_existing=true. When the user has clearly asked for a full rewrite of a clear target, do not ask again about the overwrite flag.',
    '- With a length ceiling, aim for 85%–90% of it to leave room for counting drift. When a tool reports "above target" or "below target", bring the text within range before finishing.',
    "- A summary of the change is recommended for each edit; if omitted, the system generates one.",
    `- ${WRITING_DRAFT_SECTION_RENAME_GUIDANCE_EN}`,
    `- meta changes only the structural fields the tool supports (character name or position (up/down), plot stage title or description, ${unit} title, length target or directory position). Change one section property per call. Never fake a structural change through body text. A plot stage's title and description are also part of the global structure shared by short fiction and screenplays: changing them affects every work and needs the user's confirmation, so do not change them unless the user explicitly asks.`,
    '- When a tool returns "Not changed", no proposal was created: if the target already matches, no retry is needed. Otherwise follow the recovery instructions.',
    `- delete only performs real deletions: kind=character removes a character card and its file; kind=draft_section removes the whole ${unit} with both its body and state files, takes no document, and the manuscript must keep at least one ${unit}. Clearing the character overview or a plot stage's text is not a deletion: use edit with content="" and allow_overwrite_existing=true.`,
    `- Write back only final character design, plot results, ${prose} or state. Never mix in titles, neighboring ${unit}s, analysis, operating notes or chat replies.`,
    "- Switching stages, reordering plot stages and deleting plot structure are done by the user in the interface. Without a matching tool, tell the user where to do it; never claim it is done.",
    "- create, edit and delete are not limited by the stage open in the interface: they can work on objects of the character, plot and manuscript stages directly."
  ].join("\n");
}
