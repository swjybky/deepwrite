import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "@deepwrite/contracts";
import { Type } from "typebox";
import type { BuildWritingWorkspaceToolsInput } from "./shared";
import {
  WRITING_DRAFT_SECTION_RENAME_GUIDANCE,
  WRITING_DRAFT_SECTION_RENAME_GUIDANCE_EN
} from "../writing-edit-guidance";
import { literalUnion } from "./schema";

export const WRITING_TARGET_KINDS = [
  "character_overview",
  "character",
  "plot_stage",
  "draft_section"
] as const;

export const WRITING_READ_KINDS = [
  ...WRITING_TARGET_KINDS,
  "draft",
  "workspace"
] as const;

export const WRITING_CREATE_KINDS = [
  "character",
  "plot_stage",
  "draft_section"
] as const;

export const WRITING_DOCUMENTS = ["body", "state", "character_state"] as const;

export function writingParameters(
  input: Pick<BuildWritingWorkspaceToolsInput, "promptLocale">
) {
  const stableWritingIdParameter = Type.String({
    minLength: 1,
    maxLength: 512,
    description:
      input.promptLocale === "en-US"
        ? "Stable business id, not a name or title. Use workspace for the object directory, character_design for the character overview, and draft for the manuscript directory. Other ids must come from the directory, create results or read."
        : "稳定业务 id，不接受人名或标题。作品对象目录固定为 workspace，人物概览固定为 character_design，正文目录固定为 draft；其余 id 必须来自运行时索引、create 返回值或上一次 read。"
  });

  const writingEditKindParameter = literalUnion(WRITING_TARGET_KINDS, {
    description:
      input.promptLocale === "en-US"
        ? "Target kind. Always provide it explicitly; use draft_section to edit or rename a section or episode."
        : "显式提供对象类型。修改小节或剧集的正文、状态或标题时使用 draft_section。"
  });
  const writingReadKindParameter = literalUnion(WRITING_READ_KINDS, {
    description:
      input.promptLocale === "en-US"
        ? "Match kind to the id in the directory: character_overview with character_design; character with a card id; plot_stage with a stage id copied exactly from the directory (such as plot_design or plot-stage-8f6f2d36) regardless of its title; draft_section with a section id; draft with draft; workspace with workspace."
        : "目标对象类型，必须与目录中该 id 的类型一致，不按标题或正文内容猜测。character_overview 仅配 id=character_design；character 配人物条目 id；plot_stage 配目录中的剧情结构 id（如 plot_design、plot-stage-8f6f2d36，下划线与连字符按目录原样复制），即使阶段标题涉及人物也仍用 plot_stage；draft_section 配正文小节 id；draft 仅配 id=draft；workspace 仅配 id=workspace。"
  });
  const writingCreateKindParameter = literalUnion(WRITING_CREATE_KINDS, {
    description:
      input.promptLocale === "en-US"
        ? "character creates a card only in card layout; in text layout edit character_overview instead. plot_stage creates shared global structure. draft_section creates a section or episode."
        : "character 仅在人物为条目样式时使用，为单个人物创建独立条目；文本样式禁止使用 character，应把所有人物写入 character_overview。plot_stage 新建全局剧情结构。draft_section 新建正文小节或剧集。"
  });
  const writingDocumentParameter = literalUnion(WRITING_DOCUMENTS, {
    description:
      input.promptLocale === "en-US"
        ? "For draft_section or draft with section_scope=all_sections: body is the manuscript; state is State, for character, plot, emotional or any other continuity information. Required for file reads/edits; omit for meta-only renames and other kinds."
        : "仅 draft_section，或 kind=draft 且 section_scope=all_sections 时使用：body 为正文，state 为状态，可记录人物、剧情、情感及其他需要延续的信息。读取、写入或修改 draft_section 的正文/状态时必须指定；edit 只用 meta.title 改名时可省略；其他 kind 不要传。"
  });

  const writingContentParameter = Type.String({
    maxLength: SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
    description:
      input.promptLocale === "en-US"
        ? 'Final content for this object only. content="" clears its text while keeping the object, or creates it empty. Do not include titles, analysis, instructions or chat replies.'
        : '目标对象自身的正式内容；传入空字符串（content=""）表示清空目标内容，保留对象；创建时表示初始内容为空。不得混入标题、分析过程、操作说明或聊天回复。'
  });

  const writingSummaryParameter = Type.String({
    minLength: 1,
    maxLength: 1_000,
    description:
      input.promptLocale === "en-US"
        ? "A one-sentence change summary shown on the approval card."
        : "本次改动的一句话说明，会显示在审批卡上。"
  });

  /**
   * One provider-portable flat meta object. Per-kind required/forbidden fields
   * are enforced at runtime so providers never receive conditional root schemas.
   */
  const writingCreateMetaParameter = Type.Object(
    {
      title: Type.String({
        minLength: 1,
        maxLength: 240,
        description:
          input.promptLocale === "en-US"
            ? "Title of the character, plot stage, section or episode."
            : "人物、剧情结构或正文小节的标题。"
      }),
      description: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 20_000,
          description:
            input.promptLocale === "en-US"
              ? "plot_stage only: its purpose, input evidence and delivery standard."
              : "仅 plot_stage 使用：说明该剧情结构的职责、输入依据与交付标准。"
        })
      ),
      word_count_requirement: Type.Optional(
        Type.String({
          maxLength: 1_000,
          description:
            input.promptLocale === "en-US"
              ? "draft_section only: length target for this section or episode."
              : "仅 draft_section 使用：该小节或剧集的字数要求。"
        })
      ),
      after_id: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 512,
          description:
            input.promptLocale === "en-US"
              ? "draft_section only: insert after this stable section id; omit to append."
              : "仅 draft_section 使用：插入到该稳定小节 id 之后；不传则追加到末尾。"
        })
      )
    },
    { additionalProperties: false }
  );

  const writingEditMetaParameter = Type.Object(
    {
      title: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 240,
          description:
            input.promptLocale === "en-US"
              ? "New title of the character, plot stage, section or episode."
              : "人物、剧情结构或正文小节的新标题。"
        })
      ),
      description: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 20_000,
          description:
            input.promptLocale === "en-US"
              ? "plot_stage only: new description and delivery standard."
              : "仅 plot_stage 使用：新的结构说明与交付标准。"
        })
      ),
      word_count_requirement:
        writingCreateMetaParameter.properties.word_count_requirement,
      after_id: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 120,
          description:
            input.promptLocale === "en-US"
              ? "Move this section or episode after this section id."
              : "将当前小节或剧集移动到该目录 id 之后。"
        })
      ),
      move: Type.Optional(
        literalUnion(["up", "down"] as const, {
          description:
            input.promptLocale === "en-US"
              ? "Move a character card, section or episode one position up or down."
              : "人物条目、小节或剧集在目录中上移或下移一位。"
        })
      )
    },
    {
      additionalProperties: false,
      minProperties: 1,
      description:
        (input.promptLocale === "en-US"
          ? "Structural fields only; mutually exclusive with content and replacements."
          : "只修改结构字段，与 content、replacements 互斥。") +
        (input.promptLocale === "en-US"
          ? WRITING_DRAFT_SECTION_RENAME_GUIDANCE_EN
          : WRITING_DRAFT_SECTION_RENAME_GUIDANCE)
    }
  );

  return {
    stableWritingIdParameter,
    writingEditKindParameter,
    writingReadKindParameter,
    writingCreateKindParameter,
    writingDocumentParameter,
    writingContentParameter,
    writingSummaryParameter,
    writingCreateMetaParameter,
    writingEditMetaParameter
  };
}
