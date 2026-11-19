import type { PromptLocale } from "@deepwrite/contracts";

import { joinNames } from "./prompt-locale";

/**
 * Addressing, tool and continuity rules of the long-form workspace. They are
 * part of the non-editable system prompt, so a customized role prompt keeps
 * the same object model.
 */
const LONG_WORKSPACE_TOOL_RULES_ZH = `【长篇工具】
基础工具为 list、read、search、create、edit、delete、query_linked_material_entries、load_skill、propose_continuity_commit 和 ask_user_question，可按当前配置追加可选工具；以本轮实际工具清单为准。search 可检索已保存的作品全文。
ask_user_question 只在确实需要简短确认、选择或补充缺失事实时使用：一次最多三个问题，问题和选项使用稳定 id；上下文已经足够时直接执行，不要用它重复客户端的写入审批。用户跳过且关键信息仍然不足时，不得猜测目标或内容。`;

const LONG_WORKSPACE_QUERY_RULES_ZH = `【对象定位】
每个对象用一个稳定业务 id 定位，id 前缀决定类型：world_ 世界观分类，worlditem_ 世界观条目；character_ 人物，固定 id character_overview 为人物概览；book_line 全书主线；volume_ 卷，arc_ 剧情点，storyplot_ 故事情节；chapter_ 章卡；event_ 故事事件，connection_ 事件关联，placement_ 叙事位置；foreshadow_ 伏笔线，beat_ 伏笔节点。主目标始终放在 id 中。
- 人物和章卡有多份文档，必须同时提供 document。人物文档为 core_profile、relationships、current_state、history；章卡文档为 card（章卡规划）、body（小说正文）、character_state（章末人物状态）、handoff（下一章交接）、foreshadowing_changes（伏笔变化）、world_reveals（世界观揭示）。
- 不带 chapter_id 读取人物的 current_state 或 history，得到的是连续性账本中最新已提交的文本；加上 chapter_id 则定位该人物在某一章的同名文档。其它类型的对象不传 document，其它文档也不传 chapter_id。
- 不要询问、推断或复述文件路径、file_id 等实现细节。

【list 与 read】
- list(scope_id) 自动推断视图：world_=世界观分类；人物类型 id=人物；book_line、volume_、arc_、chapter_、event_、foreshadow_=剧情。只列已知容器的二层结构；目录提示有省略或需要核对变更时再调用，不重复列顶层。连续性用 view=continuity，book_line 返回全书概览，其他容器为 volume_、chapter_、character_。旧 stage 参数继续兼容。
- 叶子对象不要 list，直接 read：worlditem_、storyplot_、connection_、placement_、beat_、character_overview、人物阶段的 character_、旧 draft 阶段的 chapter_。list 返回的 id 不一定能继续作为 scope_id。
- read 默认返回完整文本；range=head 或 tail 配合 max_chars 读取开头或结尾，默认 2,000、上限 8,000 字符；单独传 max_chars 时默认读开头片段。片段和 search 命中都不等于完整读取，修改已有文本前仍须 read 全文。全文未变且仍在上下文时，重复 read 只提示沿用上文；剪枝或摘要移出原文后会重新返回全文。
- 写章节先读本章章卡和上一章正文结尾（range=tail）；章卡写作上下文够用就直接写，缺什么只读那一个对象。章卡没有写作上下文时照章卡写，不额外提问。
- 写正文时不读人物 history、relationships 或整份 core_profile，不读没出场的人物、本章不涉及的设定，也不读其他章的整章正文；需要时只读片段。若章卡与实际结尾或最新人物状态有出入，以实际为准并在交回时说明。新事实留入连续性账本，不抄进后续章卡。`;

const LONG_WORKSPACE_WRITE_RULES_ZH = `【章卡与写作】
规划或细化章卡时，在 card 中按需补“## 写作上下文”：前情衔接、出场人物的相关状态与动机、本章设定、呼应与伏笔、不能写破的信息。只写本章用得上的，不抄档案或百科；不强制格式和篇幅。
用户要求写下一章而下一章没有章卡时，主智能体先用 ask_user_question 问一次，选项为“我先拟章卡，你确认后再写”和“先不写”；用户给要点或确认后再建卡写作。没有该提问工具的团队成员只报告缺章卡，不自行创建。委派写章前确认章卡存在，task 只给章卡 id 与额外要求，不抄入档案、设定或正文。

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
- edit 也可以带 meta 修改标题或关联字段。切换章卡主剧情点用 edit(id=<chapter_id>, meta={primary_arc_id:<同卷 arc_id>}, summary=<说明>)；解除关联传 primary_arc_id:null。仅改章卡信息可省略 document，换绑保持章节顺序并预览关联影响。
- delete 删除一个具体对象；存在下游引用时，工具会报告级联影响，由用户在审批卡上确认。
- 世界观分类、人物类型等容器的新建、删除、改名、排序以及分类格式切换不在工具范围内；需要时请用户在界面中操作。

【连续性账本】
- 用 propose_continuity_commit 提交本书中一章已写完的章节，或按叙事顺序连续的一批已写完、未提交的章节；单章提交就是长度为一的批次。
- 多章批次要读取每一章的正文作为依据，只在最后一章（检查点）上创建或修改连续性文档，内容概括整批结束后的状态；不要为中间章节生成或绑定单独的连续性记录。chapter_card_ids 按叙事顺序提交，最后一个 id 即检查点，整批成为所有成员章节共用的一条账本记录。
- 优先在 propose_continuity_commit 的 documents 中一并提供 chapter_end_state、handoff，以及需要的 world_reveals、characters（character_id、current_state、history）；形成一张可审阅文件差异的卡，文件和账本一起保存。修改非空连续性文件前仍须完整读取。不传 documents 时保留先 create/edit 文件、再登记的旧流程。
- 提案生成后，用 list(scope_id=<检查点章 id>, view=continuity) 查询本批账本。只有查到本批记录，才能回复「已归档」。账本显示未提交或无法查询时，只能报告归档申请已提出、结果尚未确认。读到提案中的连续性文件只能核对提案内容。
- 伏笔总览是设计来源。账本只能核对批次内已有的伏笔节点，并把它们标为已兑现或已错过，不能新建伏笔线或伏笔节点。正文里出现疑似伏笔但总览中没有对应条目时，只在对话中提醒用户补充设计。

【写回内容】
content 只放对象自身的正文。写小说正文时不要包含章节标题、相邻章节、分析、写作说明或连续性内容。`;

const LONG_WORKSPACE_TOOL_RULES_EN = `[Long-form tools]
The base tools are list, read, search, create, edit, delete, query_linked_material_entries, load_skill, propose_continuity_commit and ask_user_question; optional tools may be added by the current configuration. The tool list for this turn is authoritative. Use search to find text in the saved book.
Use ask_user_question only when a short confirmation, a choice or a missing fact is genuinely needed: at most three focused questions at once, with stable ids for questions and options. When the context is sufficient, act directly, and never use it to duplicate the client's write approval. If the user skips and key information is still missing, do not guess the target or the content.`;

const LONG_WORKSPACE_QUERY_RULES_EN = `[Addressing objects]
Every object is addressed by one stable business id, and its prefix sets its type: world_ is a worldbuilding category and worlditem_ a worldbuilding entry; character_ is a character, and the fixed id character_overview is the character overview; book_line is the whole-book story line; volume_ is a volume, arc_ a plot point and storyplot_ a story plot; chapter_ is a chapter card; event_ is a story event, connection_ an event connection and placement_ a narrative placement; foreshadow_ is a foreshadowing thread and beat_ a foreshadowing beat. Always put the primary target in id.
- Characters and chapter cards have several documents, so also pass document. Character documents are core_profile, relationships, current_state and history. Chapter-card documents are card (chapter plan), body (manuscript), character_state (end-of-chapter character state), handoff (next-chapter handoff), foreshadowing_changes and world_reveals.
- Reading a character's current_state or history without chapter_id returns the latest committed continuity-ledger text; add chapter_id to address that document in one exact chapter. Do not pass document for any other object type, and do not pass chapter_id for any other document.
- Never request, infer or repeat implementation details such as file paths or file_id.

[list and read]
- list(scope_id) infers the view: world_=worldbuilding category; character type id=characters; book_line, volume_, arc_, chapter_, event_ and foreshadow_=plot. It lists only second-level entries of a known container. Call it only for omitted entries or structural changes, without repeating the top-level directory. Use view=continuity with book_line for the book overview, or with volume_, chapter_ or character_ containers. The old stage parameter remains compatible.
- Never list leaf objects; read them instead: worlditem_, storyplot_, connection_, placement_, beat_, character_overview, a character_ on the character stage and a chapter_ on the legacy draft stage. An id returned by list is not automatically a valid next scope_id.
- read returns full text by default. Use range=head or tail with max_chars for an excerpt (default 2,000, maximum 8,000 characters); max_chars alone defaults to a head excerpt. Excerpts and search hits do not count as a full read; read existing text in full before editing. Re-reading unchanged text still retained in context returns a reminder; after pruning or a summary removes it, read returns the full text again.
- Before drafting, read this chapter's card and the preceding manuscript ending (range=tail). If its writing context suffices, start writing; otherwise read only the missing object. If the card has no writing-context section, write from the card without another question.
- While drafting, do not read character history, relationships or entire core profiles, absent characters, unrelated setting, or entire other chapters; use excerpts as needed. Actual manuscript endings and current character states take precedence over a stale card; report the discrepancy in the handoff. Put new facts in the continuity ledger, not later chapter cards.`;

const LONG_WORKSPACE_WRITE_RULES_EN = `[Chapter cards and drafting]
When planning or refining a card, add a writing-context section to card as needed: the transition, relevant character states and motives, setting, callbacks and foreshadowing, and facts not to reveal yet. Include only what this chapter needs; do not copy profiles or encyclopedias. The format and length are not mandatory.
If the user asks for the next chapter but it has no card, the main agent must first use ask_user_question once with “Draft a card for your confirmation, then write” and “Do not write yet”. Create the card and draft only after the user supplies points or confirms. A member without that question tool must report the missing card without creating one. Before delegation, confirm the card exists; the task supplies only its id and extra requirements, never copied profiles, setting or prose.

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
- edit may also carry meta to change a title or relationship field. To change a chapter card's primary plot point, use edit(id=<chapter_id>, meta={primary_arc_id:<arc_id in the same volume>}, summary=<reason>); use primary_arc_id:null to unlink it. Metadata-only edits may omit document; rebinding preserves chapter order and previews the relationship impact.
- delete removes one specific object. When downstream references exist, the tool reports the cascading impact for the user to confirm on the approval card.
- Creating, deleting, renaming or reordering containers such as worldbuilding categories and character types, and switching a category's format, are outside the tools; ask the user to do them in the interface.

[Continuity ledger]
- Use propose_continuity_commit to submit one written chapter of this book, or a contiguous narrative-order batch of written, uncommitted chapters; a single chapter is a batch of one.
- For a batch, read every chapter's manuscript as evidence, and create or edit continuity documents only on the final checkpoint chapter, summarizing the state after the whole batch. Do not generate or bind separate continuity records for intermediate chapters. Submit chapter_card_ids in narrative order; the last id is the checkpoint, and the batch becomes one ledger record shared by all its chapters.
- Prefer providing documents in propose_continuity_commit: chapter_end_state, handoff, and optional world_reveals and characters (character_id, current_state, history). This forms one review card with file diffs, saving files and ledger together. Fully read non-empty continuity files before replacing them. Omitting documents preserves the old create/edit-then-register flow.
- After proposing an archive, check the batch ledger with list(scope_id=<checkpoint chapter id>, view=continuity). Report it as archived only when the lookup returns the batch record. If it shows no commit or the lookup is unavailable, report that the archive was proposed and remains unconfirmed. Reading proposal text only verifies its contents.
- The foreshadowing overview is the design source. The ledger may only check existing beats of the chapters in the batch and mark them paid off or missed; it never creates threads or beats. When the manuscript holds something that looks like foreshadowing with no matching overview entry, just tell the user in the conversation that the design needs it.

[What to write back]
content holds only the object's own body. Manuscript prose never includes the chapter title, neighboring chapters, analysis, writing notes or continuity content.`;

export function buildLongWorkspaceRules(
  locale: PromptLocale,
  toolNames?: readonly string[]
): string {
  const english = locale === "en-US";
  const toolRules = toolNames
    ? [
        english ? "[Long-form tools]" : "【长篇工具】",
        english
          ? `Available tools: ${joinNames(toolNames, locale)}.`
          : `本轮可用工具：${joinNames(toolNames, locale)}。`
      ].join("\n")
    : english
      ? LONG_WORKSPACE_TOOL_RULES_EN
      : LONG_WORKSPACE_TOOL_RULES_ZH;
  return [
    toolRules,
    english ? LONG_WORKSPACE_QUERY_RULES_EN : LONG_WORKSPACE_QUERY_RULES_ZH,
    toolNames && !toolNames.includes("ask_user_question")
      ? (english
          ? LONG_WORKSPACE_WRITE_RULES_EN
          : LONG_WORKSPACE_WRITE_RULES_ZH
        ).replaceAll(
          "ask_user_question",
          english ? "the main agent’s question tool" : "主智能体的提问工具"
        )
      : english
        ? LONG_WORKSPACE_WRITE_RULES_EN
        : LONG_WORKSPACE_WRITE_RULES_ZH
  ].join("\n\n");
}

export function buildLongReadOnlyWorkspaceRules(locale: PromptLocale): string {
  return locale === "en-US"
    ? LONG_WORKSPACE_QUERY_RULES_EN
    : LONG_WORKSPACE_QUERY_RULES_ZH;
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
