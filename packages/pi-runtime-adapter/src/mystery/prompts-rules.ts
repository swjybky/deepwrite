import type {
  MysteryNarrativePerson,
  PromptLocale
} from "@deepwrite/contracts";
import { WRITING_EDIT_OVERWRITE_RECOVERY } from "../writing-edit-guidance";

function personInstruction(
  narrativePerson: MysteryNarrativePerson,
  locale: PromptLocale
): string {
  if (locale === "en-US") {
    return narrativePerson === "second"
      ? 'Narrative person is fixed to SECOND-PERSON ("you"): every player act body must address the player directly as "you".'
      : 'Narrative person is fixed to FIRST-PERSON ("I"): every player act body must narrate in first-person "I".';
  }
  return narrativePerson === "second"
    ? "人称规范（硬约束）：本剧本人物本正文强制使用第二人称「你」称呼玩家角色。"
    : "人称规范（硬约束）：本剧本人物本正文强制使用第一人称「我」进行自述与沉浸描写。";
}

function buildChineseRules(
  narrativePerson: MysteryNarrativePerson,
  readOnly: boolean,
  toolNames?: readonly string[]
): string {
  const lines = [
    "【DeepWrite 剧本杀工具边界】",
    toolNames
      ? `本轮可用工具：${toolNames.join("、")}。`
      : readOnly
        ? "当前为只读模式，只允许调用检索与读取工具。"
        : "所有写入均通过提案预览进入前端差异审阅（mystery.mutation_proposal），不会绕过用户确认直接写盘。",
    ...(toolNames?.includes("ask_user_question")
      ? [
          "只在缺少核心立意、凶案框架或关键结构偏好时使用 ask_user_question；严禁用它重复写入审批。"
        ]
      : []),
    "",
    "【五阶结构与稳定对象定位】",
    '- truth_doc（上帝真相与设计）：传 kind="truth_doc" 与 id（内置固定：overview、core_truth、timeline_dispatch；或自定义 truthDocId）。',
    '- character_relations（NPC与关系网）：传 kind="character_relations"。',
    '- role（角色双文件）：传 kind="role"、role_id（或 id）以及必填 document："profile"（上帝底牌，含动机/秘密/诡计）或 "pitch"（玩家公开选角页，绝对无剧透）。',
    '- player_act（角色×幕二维矩阵）：传 kind="player_act"、role_id、act_id 以及必填 document："brief"（视角任务卡：本幕已知碎片/目击/暗线任务/禁忌未知项）或 "body"（玩家可见人物本正文）。',
    '- clue_round（搜证轮次卡）：传 kind="clue_round" 与 id（roundId）。',
    '- public_doc（公共序幕/多分支结局）：传 kind="public_doc" 与 id："public_openings"（公共开场与地图）或 "endings"（结局与复盘）。',
    '- dm_manual（DM主持手册）：传 kind="dm_manual"。',
    '- agents_md（作品级创作约定）：传 kind="agents_md"。',
    '- board_spec（盘面规格与人称人数）：传 kind="board_spec"（仅用于 edit 修改 playerCount/actCountTarget/narrativePerson/summary）。',
    "",
    "【多视角绝对隔离铁律】",
    `- ${personInstruction(narrativePerson, "zh-CN")}`,
    '- 撰写或修改任意角色某一幕的玩家正文（player_act / document="body"）前，必须先读取该角色的公开选角页（role/pitch，必要时核对 profile 性格）与同一（角色×幕）的视角任务卡（player_act / document="brief"）。',
    "- 严禁将 truth/、role/profile、player_act/brief、endings、dm_manual 中的上帝真凶逻辑、他角内心活动或作者备注写入任何玩家可见文档（pitch、player_act/body、public_openings、clue_round）。",
    "- 委派「分角代入执笔（pure-bare）」编写玩家人物本正文时，task 中只能放入：角色公开人设与腔调、人称规范、当前幕视角任务卡（brief）摘要与上一幕状态衔接；严禁传入真相文件、他角剧本或上帝底牌。",
    "",
    "【读取与检索规则】",
    '- read 默认全文（上限 50000 字），分段请用 offset/limit 或 range="head"|"tail" + max_chars（1–8000）；片段与 search 命中不授予覆盖已有非空文本的凭据。',
    "- 检索玩家视角或全本撞车/泄密时使用 search（可设 visibility=player_visible 仅检索玩家可见文档，排查是否误入上帝视角秘密）。"
  ];

  if (!readOnly) {
    lines.push(
      "",
      "【写入与修改规范】",
      "- 修改已有非空文本前必须先用 read 完整读取。",
      "- 空白文档可直接用 edit(content=...) 写入；非空正文局部改写优先用 replacements（original_text 必须唯一精确匹配原文），整篇重制或清空时须同时传 content 与 overwrite_mode=replace_all。",
      `- ${WRITING_EDIT_OVERWRITE_RECOVERY}`,
      "- create 可创建自定义真相文档（truth_doc）、角色（role）、幕次（act）或搜证轮次（clue_round）；新增 role 或 act 会自动补齐二维角色×幕矩阵的全部 brief/body 文件。",
      "- delete 可删除非内置 truth_doc、role、act 或 clue_round（系统至少保留 1 个角色与 1 个幕次）。",
      "- 正文写回（pitch、body、clue_round、public_openings、dm_manual 等）不得夹带文件名、目录说明、作者分析或操作步骤。"
    );
  }
  return lines.join("\n");
}

function buildEnglishRules(
  narrativePerson: MysteryNarrativePerson,
  readOnly: boolean,
  toolNames?: readonly string[]
): string {
  const lines = [
    "[DeepWrite Murder-Mystery Tool Boundary]",
    toolNames
      ? `Tools available this turn: ${toolNames.join(", ")}.`
      : readOnly
        ? "Read-only mode: only search and read tools are permitted."
        : "All writes are staged as review proposals (mystery.mutation_proposal) and never bypass user approval.",
    ...(toolNames?.includes("ask_user_question")
      ? [
          "Use ask_user_question only for missing premise, core trick or structural choices; never duplicate write approval."
        ]
      : []),
    "",
    "[Addressing Objects]",
    '- truth_doc: kind="truth_doc", id=("overview" | "core_truth" | "timeline_dispatch" | custom docId).',
    '- character_relations: kind="character_relations".',
    '- role: kind="role", role_id (or id), document="profile" (secret God-view) | "pitch" (spoiler-free casting sheet).',
    '- player_act: kind="player_act", role_id, act_id, document="brief" (perspective task card) | "body" (player-visible prose).',
    '- clue_round: kind="clue_round", id=roundId.',
    '- public_doc: kind="public_doc", id="public_openings" | "endings".',
    '- dm_manual: kind="dm_manual"; agents_md: kind="agents_md"; board_spec: kind="board_spec" (edit only).',
    "",
    "[Multi-Perspective Isolation Rules]",
    `- ${personInstruction(narrativePerson, "en-US")}`,
    "- Before writing any player act body (player_act / body), read the role pitch and the corresponding act brief first.",
    "- Never leak secrets from truth_doc, role/profile, player_act/brief, endings, or dm_manual into player-visible files (pitch, player_act/body, public_openings, clue_round).",
    "- When delegating player script prose to a pure-bare writer subagent, supply only the character's public persona, narrative person, that act's brief, and prior act continuity — never truth files or other roles' scripts."
  ];
  if (!readOnly) {
    lines.push(
      "",
      "[Write & Edit Rules]",
      "- Always full-read a non-empty document before overwriting (content + overwrite_mode=replace_all) or applying replacements.",
      "- Adding a role or act expands the entire roles x acts brief/body matrix automatically; at least 1 role and 1 act must always remain."
    );
  }
  return lines.join("\n");
}

export function buildMysteryWorkspaceRules(
  locale: PromptLocale,
  narrativePerson: MysteryNarrativePerson,
  toolNames?: readonly string[]
): string {
  return locale === "en-US"
    ? buildEnglishRules(narrativePerson, false, toolNames)
    : buildChineseRules(narrativePerson, false, toolNames);
}

export function buildMysteryReadOnlyWorkspaceRules(
  locale: PromptLocale,
  narrativePerson: MysteryNarrativePerson
): string {
  return locale === "en-US"
    ? buildEnglishRules(narrativePerson, true)
    : buildChineseRules(narrativePerson, true);
}
