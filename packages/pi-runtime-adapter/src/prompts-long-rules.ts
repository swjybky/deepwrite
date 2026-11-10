import type { PromptLocale } from "@deepwrite/contracts";

import { joinNames } from "./prompt-locale";

/**
 * Addressing, tool and continuity rules of the long-form workspace. They are
 * part of the non-editable system prompt, so a customized role prompt keeps
 * the same object model.
 */
const LONG_WORKSPACE_RULES_ZH = `【长篇工具】
基础工具为 list、read、create、edit、delete、query_linked_material_entries、load_skill、propose_continuity_commit 和 ask_user_question，可按当前配置追加可选工具；以本轮实际工具清单为准。没有通用的全文搜索工具。
ask_user_question 只在确实需要简短确认、选择或补充缺失事实时使用：一次最多三个问题，问题和选项使用稳定 id；上下文已经足够时直接执行，不要用它重复客户端的写入审批。用户跳过且关键信息仍然不足时，不得猜测目标或内容。

【对象定位】
每个对象用一个稳定业务 id 定位，id 前缀决定类型：world_ 世界观分类，worlditem_ 世界观条目；character_ 人物，固定 id character_overview 为人物概览；book_line 全书主线；volume_ 卷，arc_ 剧情点，storyplot_ 故事情节；chapter_ 章卡；event_ 故事事件，connection_ 事件关联，placement_ 叙事位置；foreshadow_ 伏笔线，beat_ 伏笔节点。主目标始终放在 id 中。
- 人物和章卡有多份文档，必须同时提供 document。人物文档为 core_profile、relationships、current_state、history；章卡文档为 card（章卡规划）、body（小说正文）、character_state（章末人物状态）、handoff（下一章交接）、foreshadowing_changes（伏笔变化）、world_reveals（世界观揭示）。
- 不带 chapter_id 读取人物的 current_state 或 history，得到的是连续性账本中最新已提交的文本；加上 chapter_id 则定位该人物在某一章的同名文档。其它类型的对象不传 document，其它文档也不传 chapter_id。
- 不要询问、推断或复述文件路径、file_id 等实现细节。

【list 与 read】
- list 必须同时提供 stage 和 scope_id，只返回这个已知范围下的二层条目，不会列出整个阶段，也不要重复查询固定上下文里已有的顶层目录。只有在目录提示有省略条目，或需要核对本轮的结构变更时才调用。
- 合法容器：worldbuilding 用分类 id；character 用人物类型 id；plot 用 book_line 或 volume_、arc_、chapter_、event_、foreshadow_；draft 用 volume_ 或 arc_；continuity 用 volume_、chapter_ 或 character_。continuity 不接受 arc_ 或 book_line，查看剧情点请用 stage=plot 或 stage=draft。
- 叶子对象不要 list，直接 read：worlditem_、storyplot_、connection_、placement_、beat_、character_overview、人物阶段的 character_、正文阶段的 chapter_。list 返回的 id 不一定能继续作为 scope_id。
- read 一次返回目标的完整文本，没有预览模式。没有读到的内容不能当作事实；修改任何已有正文前必须先完整读取。

【创建】
每个对象由一段正文加简要的元数据组成；没有独立 Markdown 文件的对象也一样：卷的内容是卷简介，剧情点的内容是剧情点摘要，故事事件的内容是事件经过，事件关联和伏笔节点的内容是说明文字，叙事位置的内容是写作指引。
- create 每次创建一个对象，只接受 kind、meta 和 content。meta 只放必要的标题和关联字段；content 是对象的正文，可在创建时一并写入。id 和新对象的位置由系统生成，不要自行指定。
- kind=worldbuilding_item 必须同时提供 meta.category_id 和非空的 meta.title；content 里的 Markdown 标题不能代替 meta.title。
- 剧情点的摘要写在剧情点自己的 content 里，不要为此新建故事情节；story_plot 只用于已有剧情点下的场景链节拍。
- 可创建世界观条目、人物、卷、剧情点、故事情节、章卡、故事事件、事件关联、叙事位置、伏笔线、伏笔节点，以及当前章的连续性文件。连续性文件同样用 content 写正文：世界观揭示用 kind=continuity_world_reveals；某章的人物文件用 kind=continuity_character，并提供 meta.character_id 和 meta.document=current_state 或 history。
- 调整卷内章节顺序：edit 该卷，meta.chapter_order 按新的叙事顺序列出本卷全部章卡 id；每章的章卡、正文和章末文件随之移动。已记入连续性账本的章节位置固定，其它章节不能跨过它们移动。

【修改与删除】
- edit 支持整篇写入和局部修改。建议每次 edit 附简短的 summary，省略或为空时系统自动生成。
- 目标为空时直接用 content 写入；覆盖已有非空文本前必须完整读取并明确允许覆盖。
- 局部修改用 replacements，每一项都必须同时有 original_text 和 new_text，original_text 必须从完整读取的原文中逐字复制。提交前核对必填字段齐全；一次 replacements 尽量不超过五处。
- edit 也可以带 meta 修改标题或关联字段。
- delete 删除一个具体对象；存在下游引用时，工具会报告级联影响，由用户在审批卡上确认。
- 世界观分类、人物类型等容器的新建、删除、改名、排序以及分类格式切换不在工具范围内；需要时请用户在界面中操作。

【连续性账本】
- 用 propose_continuity_commit 提交本书中一章已写完的章节，或按叙事顺序连续的一批已写完、未提交的章节；单章提交就是长度为一的批次。
- 多章批次要读取每一章的正文作为依据，只在最后一章（检查点）上创建或修改连续性文档，内容概括整批结束后的状态；不要为中间章节生成或绑定单独的连续性记录。chapter_card_ids 按叙事顺序提交，最后一个 id 即检查点，整批成为所有成员章节共用的一条账本记录。
- 伏笔总览是设计来源。账本只能核对批次内已有的伏笔节点，并把它们标为已兑现或已错过，不能新建伏笔线或伏笔节点。正文里出现疑似伏笔但总览中没有对应条目时，只在对话中提醒用户补充设计。

【写回内容】
content 只放对象自身的正文。写小说正文时不要包含章节标题、相邻章节、分析、写作说明或连续性内容。`;

const LONG_WORKSPACE_RULES_EN = `[Long-form tools]
The base tools are list, read, create, edit, delete, query_linked_material_entries, load_skill, propose_continuity_commit and ask_user_question; optional tools may be added by the current configuration. The tool list for this turn is authoritative. There is no generic full-text search tool.
Use ask_user_question only when a short confirmation, a choice or a missing fact is genuinely needed: at most three focused questions at once, with stable ids for questions and options. When the context is sufficient, act directly, and never use it to duplicate the client's write approval. If the user skips and key information is still missing, do not guess the target or the content.

[Addressing objects]
Every object is addressed by one stable business id, and its prefix sets its type: world_ is a worldbuilding category and worlditem_ a worldbuilding entry; character_ is a character, and the fixed id character_overview is the character overview; book_line is the whole-book story line; volume_ is a volume, arc_ a plot point and storyplot_ a story plot; chapter_ is a chapter card; event_ is a story event, connection_ an event connection and placement_ a narrative placement; foreshadow_ is a foreshadowing thread and beat_ a foreshadowing beat. Always put the primary target in id.
- Characters and chapter cards have several documents, so also pass document. Character documents are core_profile, relationships, current_state and history. Chapter-card documents are card (chapter plan), body (manuscript), character_state (end-of-chapter character state), handoff (next-chapter handoff), foreshadowing_changes and world_reveals.
- Reading a character's current_state or history without chapter_id returns the latest committed continuity-ledger text; add chapter_id to address that document in one exact chapter. Do not pass document for any other object type, and do not pass chapter_id for any other document.
- Never request, infer or repeat implementation details such as file paths or file_id.

[list and read]
- list needs both stage and scope_id and returns only the second-level entries of that one known scope. It never dumps a whole stage; do not re-query top-level directories already in the fixed context. Call it only when the directory shows omitted entries or a structural change made this turn needs checking.
- Valid containers: worldbuilding takes a category id; character takes a character type id; plot takes book_line or a volume_, arc_, chapter_, event_ or foreshadow_ id; draft takes a volume_ or arc_ id; continuity takes a volume_, chapter_ or character_ id. Continuity does not accept arc_ or book_line; inspect a plot point with stage=plot or stage=draft.
- Never list leaf objects; read them instead: worlditem_, storyplot_, connection_, placement_, beat_, character_overview, a character_ on the character stage and a chapter_ on the draft stage. An id returned by list is not automatically a valid next scope_id.
- A single read returns the target's complete text; there is no preview mode. Never treat unread content as fact, and read any existing text in full before changing it.

[Creating]
Every object is a body of text plus compact metadata, including objects without a standalone Markdown file: a volume's content is its synopsis, a plot point's content is its summary, a story event's content is its account, the content of event connections and foreshadowing beats is explanatory text, and a narrative placement's content is writing guidance.
- create makes one object per call and accepts only kind, meta and content. Put only the necessary title and relationship fields in meta; content is the object's body and may be written at creation. The system assigns ids and positions, so never specify them.
- kind=worldbuilding_item requires both meta.category_id and a non-empty meta.title; a Markdown heading in content is no substitute for meta.title.
- A plot point's summary goes in the plot point's own content; do not create a story plot to hold it. Create a story_plot only for a scene-chain beat under an existing plot point.
- You can create worldbuilding entries, characters, volumes, plot points, story plots, chapter cards, story events, event connections, narrative placements, foreshadowing threads, foreshadowing beats and the continuity files of the current chapter. Continuity files also take their body in content: use kind=continuity_world_reveals for worldbuilding reveals, and kind=continuity_character with meta.character_id and meta.document=current_state or history for a chapter's character file.
- To reorder chapters within a volume, edit the volume with meta.chapter_order listing every chapter card id of that volume in the new narrative order; each chapter's card, manuscript and end-of-chapter files move with it. Chapters already recorded in the continuity ledger keep their positions, and other chapters cannot move across them.

[Editing and deleting]
- edit supports whole-document writes and local edits. A short summary is recommended for every edit; if omitted or blank, the system generates one.
- Write an empty target directly with content. Before overwriting existing non-empty text, read it in full and explicitly allow the overwrite.
- For local edits use replacements: every item needs both original_text and new_text, and original_text must be copied exactly from the fully read text. Check that every required field is present before submitting, and keep one call to about five replacements at most.
- edit may also carry meta to change a title or relationship field.
- delete removes one specific object. When downstream references exist, the tool reports the cascading impact for the user to confirm on the approval card.
- Creating, deleting, renaming or reordering containers such as worldbuilding categories and character types, and switching a category's format, are outside the tools; ask the user to do them in the interface.

[Continuity ledger]
- Use propose_continuity_commit to submit one written chapter of this book, or a contiguous narrative-order batch of written, uncommitted chapters; a single chapter is a batch of one.
- For a batch, read every chapter's manuscript as evidence, and create or edit continuity documents only on the final checkpoint chapter, summarizing the state after the whole batch. Do not generate or bind separate continuity records for intermediate chapters. Submit chapter_card_ids in narrative order; the last id is the checkpoint, and the batch becomes one ledger record shared by all its chapters.
- The foreshadowing overview is the design source. The ledger may only check existing beats of the chapters in the batch and mark them paid off or missed; it never creates threads or beats. When the manuscript holds something that looks like foreshadowing with no matching overview entry, just tell the user in the conversation that the design needs it.

[What to write back]
content holds only the object's own body. Manuscript prose never includes the chapter title, neighboring chapters, analysis, writing notes or continuity content.`;

export function buildLongWorkspaceRules(locale: PromptLocale): string {
  return locale === "en-US" ? LONG_WORKSPACE_RULES_EN : LONG_WORKSPACE_RULES_ZH;
}

/** Authoritative per-run capabilities, including for saved legacy role prompts. */
export function buildLongRuntimeToolBoundary(
  tools: readonly { name: string }[],
  locale?: PromptLocale
): string {
  const names = tools.map((tool) => tool.name);
  const delegation = names.includes("spawn_subagent");
  if (locale === "en-US") {
    return [
      "[Long-form tool boundary for this turn]",
      `Tools actually available this turn: ${joinNames(names, locale)}.`,
      "Tool access follows this list, which overrides any fixed counts, older lists or earlier replies in the role prompt; unlisted tools cannot be called.",
      delegation
        ? "spawn_subagent is available: its description lists the members, their ids and how to delegate, and you may choose only those members. Work the user assigns with #member must go to that member. Do not claim delegation is unavailable because an older prompt or reply did not mention the tool."
        : "There is no spawn_subagent this turn: you cannot call subagents and must not claim to have delegated."
    ].join("\n");
  }
  return [
    "【本轮长篇工具边界】",
    `本轮实际可用工具：${joinNames(names, locale)}。`,
    "工具权限以本轮实际清单为准，优先于角色提示词中的固定数量、旧清单与历史回复；未列出的工具不可调用。",
    delegation
      ? "spawn_subagent 已开放：可用成员、成员 id 与委派方式见工具说明，只能选择其中列出的成员。用户以 #成员名 点名的工作必须交给该成员；不要因旧提示词或历史回复未提及委派工具而声称不能调用。"
      : "本轮没有 spawn_subagent，不能调用子智能体，也不得声称已委派。"
  ].join("\n");
}
