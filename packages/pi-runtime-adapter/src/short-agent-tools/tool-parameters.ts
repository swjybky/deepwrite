import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "@deepwrite/contracts";
import { Type } from "typebox";
import { literalUnion } from "./schema";

export const WRITING_TARGET_KINDS = [
  "character_overview",
  "character",
  "plot_stage",
  "draft_section"
] as const;

export const WRITING_READ_KINDS = [...WRITING_TARGET_KINDS, "draft"] as const;

export const WRITING_CREATE_KINDS = [
  "character",
  "plot_stage",
  "draft_section"
] as const;

export const WRITING_DOCUMENTS = ["body", "character_state"] as const;

export const stableWritingIdParameter = Type.String({
  minLength: 1,
  maxLength: 512,
  description:
    "稳定业务 id。人物概览固定为 character_design，正文目录固定为 draft；其余 id 必须来自运行时索引、create 返回值或上一次 read。"
});

export const writingKindParameter = literalUnion(WRITING_TARGET_KINDS);
export const writingReadKindParameter = literalUnion(WRITING_READ_KINDS);
export const writingCreateKindParameter = literalUnion(WRITING_CREATE_KINDS, {
  description:
    "character 仅在人物为条目样式时使用，为单个人物创建独立条目；文本样式禁止使用 character，应把所有人物写入 character_overview。plot_stage 新建全局剧情结构。draft_section 新建正文小节或剧集。"
});
export const writingDocumentParameter = literalUnion(WRITING_DOCUMENTS, {
  description:
    "仅 draft_section，或 kind=draft 且 include_all_sections=true 时使用：body 为正文，character_state 为人物状态。读取、写入或修改 draft_section 必须指定；其他 kind 不要传。"
});

export const writingContentParameter = Type.String({
  maxLength: SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
  description:
    '目标对象自身的正式正文；传入空字符串（content=""）表示清空目标正文，保留对象；创建时表示初始正文为空。不得混入标题、分析过程、操作说明或聊天回复。'
});

export const writingSummaryParameter = Type.String({
  minLength: 1,
  maxLength: 1_000,
  description: "本次改动的一句话说明，会显示在审批卡上。"
});

/**
 * One provider-portable flat meta object. Per-kind required/forbidden fields
 * are enforced at runtime so providers never receive conditional root schemas.
 */
export const writingCreateMetaParameter = Type.Object(
  {
    title: Type.String({
      minLength: 1,
      maxLength: 240,
      description: "人物、剧情结构或正文小节的标题。"
    }),
    description: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 20_000,
        description:
          "仅 plot_stage 使用：说明该剧情结构的职责、输入依据与交付标准。"
      })
    ),
    word_count_requirement: Type.Optional(
      Type.String({
        maxLength: 1_000,
        description: "仅 draft_section 使用：该小节或剧集的字数要求。"
      })
    ),
    after_id: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        description:
          "仅 draft_section 使用：插入到该稳定小节 id 之后；不传则追加到末尾。"
      })
    )
  },
  { additionalProperties: false }
);

export const writingEditMetaParameter = Type.Object(
  {
    title: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 240,
        description: "人物、剧情结构或正文小节的新标题。"
      })
    ),
    description: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 20_000,
        description: "仅 plot_stage 使用：新的结构说明与交付标准。"
      })
    ),
    move: Type.Optional(literalUnion(["up", "down"] as const))
  },
  { additionalProperties: false, minProperties: 1 }
);

export const explicitTrueParameter = Type.Literal(true, {
  description: "必须显式传 true。"
});
