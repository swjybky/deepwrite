import { StringEnum, Type, type TSchema } from "@earendil-works/pi-ai";
import { LONG_STAGES, LONG_TOOL_DOCUMENTS } from "./entity-registry";

export const STABLE_ID_SUFFIX_PATTERN =
  "[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?";

export function strictObject<T extends Record<string, TSchema>>(
  properties: T,
  options: Record<string, unknown> = {}
) {
  return Type.Object(properties, {
    additionalProperties: false,
    ...options
  });
}

export function stableIdParameter(prefix: string) {
  return Type.String({
    minLength: 3,
    maxLength: 160,
    pattern: `^${prefix}_${STABLE_ID_SUFFIX_PATTERN}$`
  });
}

export const entityIdParameter = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: `^${STABLE_ID_SUFFIX_PATTERN}$`,
  description:
    "稳定业务 id，前缀决定对象类型；固定单例为 book_line 与 character_overview。"
});

export const chapterContextIdParameter = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: `^chapter_${STABLE_ID_SUFFIX_PATTERN}$`,
  description:
    "可选章节范围，仅用于人物 current_state 或 history；不传时读取最新已提交账本映射，传入时精确定位该章的人物连续性文件。"
});

export const listScopeIdParameter = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: `^${STABLE_ID_SUFFIX_PATTERN}$`,
  description: "容器的稳定业务 id，格式为字母、数字及 . _ : -。"
});

export const stageParameter = StringEnum(LONG_STAGES, {
  description: "阶段名称：worldbuilding、character、plot、draft 或 continuity。"
});

export const documentParameter = StringEnum(LONG_TOOL_DOCUMENTS, {
  description:
    "人物或章卡的具体文档；其余对象不要传。人物：core_profile、relationships、current_state、history。章卡：card、body、character_state、handoff、foreshadowing_changes、world_reveals。人物 current_state/history 可用 chapter_id 精确限定章节；读取章节本身无需 chapter_id，重复且相同会被忽略，不同则拒绝。"
});

export const summaryParameter = Type.String({
  minLength: 1,
  maxLength: 1_000,
  description: "本次改动的一句话说明，会显示在审批卡上。"
});

export const contentParameter = Type.String({
  maxLength: 10_000_000,
  description:
    '该对象自身的正文文本；传入空字符串（content=""）表示清空目标正文，保留对象；创建时表示初始正文为空。写小说正文时不得混入章节标题、相邻章节、分析过程或写作说明。'
});

export const explicitTrueParameter = Type.Boolean({
  description: "必须显式传 true。"
});

export const titleParameter = Type.String({ minLength: 1, maxLength: 256 });

const createTitleParameter = Type.String({
  minLength: 1,
  maxLength: 256,
  description:
    "对象标题。创建 worldbuilding_item、volume、arc、story_plot、chapter_card、story_event 或 foreshadowing 时必填，不能只写在 content 中。"
});

export const characterTypeIdParameter = Type.Union([
  StringEnum([
    "protagonist",
    "major_supporting",
    "minor_supporting",
    "passerby"
  ] as const),
  stableIdParameter("chartype")
]);

export const storyTimeModeParameter = StringEnum([
  "exact",
  "relative",
  "sequence",
  "unknown"
] as const);

export const connectionTypeParameter = StringEnum([
  "before",
  "same_time",
  "overlaps",
  "causes",
  "enables",
  "conceals"
] as const);

export const narrativeModeParameter = StringEnum([
  "scene",
  "flashback",
  "retelling",
  "clue",
  "misdirection",
  "reveal",
  "dream",
  "prophecy"
] as const);

export const disclosureParameter = StringEnum([
  "hint",
  "partial",
  "full",
  "false"
] as const);

export const beatTypeParameter = StringEnum([
  "source",
  "plant",
  "reinforce",
  "misdirect",
  "partial_reveal",
  "reveal",
  "payoff",
  "aftermath"
] as const);

export const foreshadowingSpanParameter = StringEnum([
  "local",
  "within_volume",
  "cross_volume"
] as const);

/**
 * One flat meta shape for every create kind. Required and forbidden fields are
 * decided per kind at runtime so providers only ever see a single object.
 */
export const createMetaParameter = strictObject({
  title: Type.Optional(createTitleParameter),
  name: Type.Optional(titleParameter),
  aliases: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
      maxItems: 64,
      uniqueItems: true
    })
  ),
  type_id: Type.Optional(characterTypeIdParameter),
  category_id: Type.Optional(stableIdParameter("world")),
  volume_id: Type.Optional(stableIdParameter("volume")),
  arc_id: Type.Optional(stableIdParameter("arc")),
  primary_arc_id: Type.Optional(
    Type.Union([stableIdParameter("arc"), Type.Null()])
  ),
  arc_ids: Type.Optional(
    Type.Array(stableIdParameter("arc"), { maxItems: 200, uniqueItems: true })
  ),
  character_ids: Type.Optional(
    Type.Array(stableIdParameter("character"), {
      maxItems: 200,
      uniqueItems: true
    })
  ),
  character_id: Type.Optional(stableIdParameter("character")),
  chapter_card_id: Type.Optional(stableIdParameter("chapter")),
  document: Type.Optional(
    StringEnum(["current_state", "history"] as const, {
      description:
        "仅 continuity_character：content 写入 current_state 或 history。"
    })
  ),
  event_id: Type.Optional(stableIdParameter("event")),
  source_event_id: Type.Optional(stableIdParameter("event")),
  target_event_id: Type.Optional(stableIdParameter("event")),
  truth_event_id: Type.Optional(
    Type.Union([stableIdParameter("event"), Type.Null()])
  ),
  foreshadowing_id: Type.Optional(stableIdParameter("foreshadow")),
  placement_id: Type.Optional(stableIdParameter("placement")),
  time_mode: Type.Optional(storyTimeModeParameter),
  time_label: Type.Optional(Type.String({ maxLength: 1_000 })),
  location: Type.Optional(Type.String({ maxLength: 1_000 })),
  type: Type.Optional(
    Type.Union([connectionTypeParameter, beatTypeParameter], {
      description: "事件连接类型或伏笔触点类型。"
    })
  ),
  mode: Type.Optional(narrativeModeParameter),
  disclosure: Type.Optional(disclosureParameter),
  planned_span: Type.Optional(foreshadowingSpanParameter),
  planned_scope: Type.Optional(Type.String({ maxLength: 4_000 }))
});

/** Metadata relocations are translated into the corresponding move operations. */
export const editMetaParameter = strictObject(
  {
    title: Type.Optional(titleParameter),
    name: Type.Optional(titleParameter),
    type_id: Type.Optional(characterTypeIdParameter),
    primary_arc_id: Type.Optional(
      Type.Union([stableIdParameter("arc"), Type.Null()], {
        description:
          "仅章卡：切换到同一分卷内的主剧情点，传 null 解除关联；保持章卡顺序。"
      })
    ),
    chapter_order: Type.Optional(
      Type.Array(stableIdParameter("chapter"), {
        minItems: 1,
        maxItems: 10_000,
        uniqueItems: true,
        description:
          "仅分卷：按新的叙事顺序完整列出本卷全部章卡 id，用于调整章节先后；章卡、正文和章末文件随章节一起移动。已写入连续性账本的章节位置固定，其他章节也不能越过它们。"
      })
    ),
    aliases: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
        maxItems: 64,
        uniqueItems: true
      })
    ),
    arc_ids: Type.Optional(
      Type.Array(stableIdParameter("arc"), { maxItems: 200, uniqueItems: true })
    ),
    character_ids: Type.Optional(
      Type.Array(stableIdParameter("character"), {
        maxItems: 200,
        uniqueItems: true
      })
    ),
    time_label: Type.Optional(Type.String({ maxLength: 1_000 })),
    location: Type.Optional(Type.String({ maxLength: 1_000 })),
    source_event_id: Type.Optional(stableIdParameter("event")),
    target_event_id: Type.Optional(stableIdParameter("event")),
    event_id: Type.Optional(stableIdParameter("event")),
    truth_event_id: Type.Optional(
      Type.Union([stableIdParameter("event"), Type.Null()])
    ),
    chapter_card_id: Type.Optional(
      Type.Union([stableIdParameter("chapter"), Type.Null()])
    ),
    volume_id: Type.Optional(
      Type.Union([stableIdParameter("volume"), Type.Null()])
    ),
    arc_id: Type.Optional(Type.Union([stableIdParameter("arc"), Type.Null()])),
    type: Type.Optional(
      Type.Union([connectionTypeParameter, beatTypeParameter])
    ),
    mode: Type.Optional(narrativeModeParameter),
    disclosure: Type.Optional(disclosureParameter),
    planned_span: Type.Optional(foreshadowingSpanParameter),
    planned_scope: Type.Optional(Type.String({ maxLength: 4_000 }))
  },
  { minProperties: 1 }
);
