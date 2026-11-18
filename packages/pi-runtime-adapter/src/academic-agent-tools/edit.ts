import {
  ACADEMIC_CHAPTER_TITLE_MAX_LENGTH,
  ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH,
  ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH,
  ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH,
  ACADEMIC_REFERENCE_CARD_TYPES,
  ACADEMIC_SECTION_FILE_KINDS,
  ACADEMIC_SECTION_TITLE_MAX_LENGTH,
  ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH,
  ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
  ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
  AcademicCiteKeySchema,
  AcademicReferenceCardTypeSchema,
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
  type AcademicSectionFileKind
} from "@deepwrite/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { literalUnion } from "../short-agent-tools/schema";
import { appendWritingContentCounts } from "../writing-content-counts";
import {
  overwriteModeParameter,
  REPLACE_ALL_OVERWRITE_MODE
} from "../writing-edit-guidance";
import { findAcademicCardByIdOrCiteKey } from "./read";
import {
  academicProposalNote,
  academicTextResult,
  defineAcademicTool,
  ensureAcademicOverlayFileLoaded,
  hasAcademicFullRead,
  recordAcademicFullRead,
  syncAcademicSharedStateFromCore,
  updateAcademicOverlayFile,
  type AcademicOverlayFile,
  type AcademicReadState,
  type AcademicWorkspaceToolSharedState,
  type BuildAcademicWorkspaceToolsInput
} from "./shared";

export const ACADEMIC_EDIT_KINDS = [
  "foundation",
  "reference_card",
  "framework_stage",
  "chapter",
  "section"
] as const;

const AcademicEditMetaParameters = {
  title: Type.Optional(Type.String({ description: "新标题。" })),
  cite_key: Type.Optional(
    Type.String({ description: "仅 reference_card：更新引用键 citeKey。" })
  ),
  card_type: Type.Optional(
    literalUnion(ACADEMIC_REFERENCE_CARD_TYPES, {
      description: "仅 reference_card：更新卡片类型（literature | evidence）。"
    })
  ),
  description: Type.Optional(
    Type.String({
      description: "仅 framework_stage：更新阶段说明（<= 20000 字）。"
    })
  ),
  stage_status: Type.Optional(
    StringEnum(["enabled", "disabled"] as const, {
      description: "仅 framework_stage：enabled 启用，disabled 停用。"
    })
  ),
  direction: Type.Optional(
    literalUnion(["up", "down"] as const, {
      description: "上移或下移一位（支持 framework_stage、chapter、section）。"
    })
  ),
  chapter_id: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: "仅 section：调整所属章 id（传 null 移出所属章）。"
    })
  ),
  after_section_id: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: "仅 section：移动到指定小节之后（传 null 移至首位）。"
    })
  ),
  word_count_requirement: Type.Optional(
    Type.String({ description: "仅 section：更新目标字数说明（<= 1000 字）。" })
  )
};

function moveOrderItem(
  order: string[],
  targetId: string,
  direction: "up" | "down"
): void {
  const index = order.indexOf(targetId);
  if (index < 0) return;
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= order.length) return;
  const other = order[swapIndex]!;
  order[swapIndex] = targetId;
  order[index] = other;
}

function applyAcademicReplacements(
  current: string,
  replacements: Array<{
    old_text?: string | undefined;
    original_text?: string | undefined;
    new_text: string;
    match_scope?: "all_matches" | undefined;
  }>,
  english: boolean
): string {
  let next = current;
  for (let i = 0; i < replacements.length; i += 1) {
    const item = replacements[i]!;
    const target = item.old_text ?? item.original_text ?? "";
    if (!target) {
      throw new Error(
        english
          ? `replacements.${i}: old_text (or original_text) cannot be empty.`
          : `replacements.${i}：old_text（或 original_text）不能为空。`
      );
    }
    const first = next.indexOf(target);
    if (first < 0) {
      throw new Error(
        english
          ? `replacements.${i}: passage not found: ${target.slice(0, 80)}`
          : `replacements.${i}：未在文稿中找到原文片段：${target.slice(0, 80)}`
      );
    }
    if (item.match_scope === "all_matches") {
      next = next.split(target).join(item.new_text);
      continue;
    }
    if (next.indexOf(target, first + 1) >= 0) {
      throw new Error(
        english
          ? `replacements.${i}: passage appears multiple times; provide longer unique context or set match_scope=all_matches: ${target.slice(0, 80)}`
          : `replacements.${i}：原文片段出现多次，请提供更长且唯一的上下文，或显式传 match_scope=all_matches：${target.slice(0, 80)}`
      );
    }
    next = `${next.slice(0, first)}${item.new_text}${next.slice(first + target.length)}`;
  }
  return next;
}

export function buildAcademicEditTool(
  input: BuildAcademicWorkspaceToolsInput,
  sharedState: AcademicWorkspaceToolSharedState,
  readState: AcademicReadState
): AgentTool {
  const english = input.promptLocale === "en-US";
  return defineAcademicTool({
    name: "edit",
    label: english ? "Edit academic object" : "修改学术作品对象",
    description: english
      ? "Propose editing foundation documents, reference_card (content and/or citeKey/cardType/title), framework_stage, chapter title/order, or section (brief/body/state text or structural meta). Replacing non-empty text with content=... strictly requires a prior full read (without head/tail/offset/limit) AND overwrite_mode=replace_all; prefer replacements, insert, or append for targeted edits."
      : "提交学术作品对象修改提案，覆盖 foundation（研究立意、术语表）、reference_card（正文及/或 citeKey/cardType/title）、framework_stage（正文或标题/说明/启停/排序）、chapter（改名或排序）以及 section（document=brief|body|state 文稿或标题/归属章/顺序/字数要求）。使用 content 全文覆盖已有非空内容前，必须先完整 read 全文（不带 head/tail/offset/limit）并传入 overwrite_mode=replace_all；局部修改优先使用 replacements、insert 或 append。",
    parameters: Type.Object({
      kind: literalUnion(ACADEMIC_EDIT_KINDS, {
        description: english
          ? "Target object kind."
          : "目标类型：foundation、reference_card、framework_stage、chapter 或 section。"
      }),
      id: Type.Optional(
        Type.String({
          description: english
            ? "Stable target id (or citeKey for reference_card)."
            : "稳定目标 id（reference_card 支持传卡片 id 或 citeKey）。"
        })
      ),
      document: Type.Optional(
        literalUnion(ACADEMIC_SECTION_FILE_KINDS, {
          description: english
            ? "Required when editing section text: brief, body, or state."
            : "修改 section 文稿时必填：brief、body 或 state；仅改 section 结构元信息时可省略。"
        })
      ),
      content: Type.Optional(
        Type.String({
          description: english
            ? "Full replacement text (<= 200000 chars). Non-empty targets require prior full read + overwrite_mode=replace_all."
            : "全文覆盖内容（<= 200000 字）。覆盖已有非空内容前须先完整 read 并设 overwrite_mode=replace_all。"
        })
      ),
      replacements: Type.Optional(
        Type.Array(
          Type.Object({
            old_text: Type.Optional(
              Type.String({ description: "要替换的原文片段。" })
            ),
            original_text: Type.Optional(
              Type.String({ description: "old_text 的同义字段。" })
            ),
            new_text: Type.String({ description: "替换后的新文本。" }),
            match_scope: Type.Optional(
              StringEnum(["all_matches"] as const, {
                description:
                  "all_matches 替换所有匹配处；省略时要求原文片段唯一。"
              })
            )
          }),
          {
            description: english
              ? "Targeted substring replacements (1–100 items)."
              : "局部片段替换列表（1–100 处）。"
          }
        )
      ),
      append: Type.Optional(
        Type.String({
          description: english
            ? "Verbatim suffix appended to existing text."
            : "在现有文稿末尾原样追加的文本。"
        })
      ),
      insert: Type.Optional(
        Type.Object({
          anchor: Type.String({ description: "文稿中唯一匹配的锚点文本。" }),
          position: literalUnion(["before", "after"] as const, {
            description: "在锚点前（before）或后（after）插入。"
          }),
          text: Type.String({ description: "要插入的文本。" })
        })
      ),
      meta: Type.Optional(
        Type.Object(AcademicEditMetaParameters, {
          description: english
            ? "Structural/metadata updates."
            : "结构或元信息字段修改。"
        })
      ),
      ...AcademicEditMetaParameters,
      overwrite_mode: overwriteModeParameter(
        english
          ? "Set replace_all only with content after a full read when replacing or clearing non-empty text. Omit for blank targets and local edits."
          : "仅在已完整 read 全文且需用 content 替换或清空非空文稿时传 replace_all。空白目标或局部修改时省略。"
      ),
      summary: Type.Optional(
        Type.String({
          description: english
            ? "Optional one-sentence change summary (<= 1000 chars)."
            : "可选的一句话改动说明（<= 1000 字）。"
        })
      )
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      if (
        Object.hasOwn(params, "enabled") ||
        (params.meta && Object.hasOwn(params.meta, "enabled"))
      ) {
        throw new Error(
          "请用 stage_status=enabled 启用阶段，或用 stage_status=disabled 停用阶段。"
        );
      }
      if (
        params.replacements?.some((item) => Object.hasOwn(item, "replace_all"))
      ) {
        throw new Error(
          "请用 replacements[].match_scope=all_matches 替换所有匹配处；原文片段唯一时可省略 match_scope。"
        );
      }
      await syncAcademicSharedStateFromCore(input, sharedState, signal);

      const rawSummary = params.summary?.trim();
      if (rawSummary && rawSummary.length > 1_000) {
        throw new Error(`summary：当前 ${rawSummary.length} 字，上限 1000。`);
      }
      const baseProjectRevision = input.workspace.projectRevision;

      const mergedMeta = {
        title: params.meta?.title ?? params.title,
        cite_key: params.meta?.cite_key ?? params.cite_key,
        card_type: params.meta?.card_type ?? params.card_type,
        description: params.meta?.description ?? params.description,
        stage_status: params.meta?.stage_status ?? params.stage_status,
        direction: params.meta?.direction ?? params.direction,
        chapter_id:
          params.meta?.chapter_id !== undefined
            ? params.meta.chapter_id
            : params.chapter_id,
        after_section_id:
          params.meta?.after_section_id !== undefined
            ? params.meta.after_section_id
            : params.after_section_id,
        word_count_requirement:
          params.meta?.word_count_requirement ?? params.word_count_requirement
      };
      const hasAnyMeta = Object.values(mergedMeta).some(
        (value) => value !== undefined
      );

      const textModeCount =
        Number(params.content !== undefined) +
        Number(Boolean(params.replacements?.length)) +
        Number(params.append !== undefined) +
        Number(params.insert !== undefined);

      if (textModeCount > 1) {
        throw new Error(
          english
            ? "Choose at most one text edit mode: content, replacements, append, or insert."
            : "content、replacements、append、insert 只能选择其中一种文本修改方式。"
        );
      }
      if (textModeCount === 0 && !hasAnyMeta) {
        throw new Error(
          english
            ? "edit requires a text edit (content/replacements/append/insert) or meta fields."
            : "edit 须提供文本修改参数（content / replacements / append / insert）或元信息字段（meta）。"
        );
      }
      if (params.replacements && params.replacements.length > 100) {
        throw new Error(
          `replacements：当前 ${params.replacements.length} 处，单次上限 100。`
        );
      }

      const rawId = (params.id ?? "").trim();

      if (params.kind === "chapter") {
        if (textModeCount > 0) {
          throw new Error(
            "chapter 仅包含章标题与顺序，没有独立正文；正文请编辑其下属 section。"
          );
        }
        if (!rawId) throw new Error("id：修改 chapter 须提供章 id。");
        const chapter = sharedState.chapters.get(rawId);
        if (!chapter) {
          throw new Error(`未找到章（id=${rawId}）。`);
        }
        if (mergedMeta.direction) {
          moveOrderItem(
            sharedState.chapterOrder,
            chapter.id,
            mergedMeta.direction
          );
          const summary =
            rawSummary ||
            `调整章「${chapter.title}」顺序（${mergedMeta.direction === "up" ? "上移" : "下移"}）`;
          return academicTextResult(
            `${summary}。${academicProposalNote(input)}`,
            {
              kind: "academic-workspace-mutation",
              workspaceId: input.workspace.id,
              summary,
              ...(baseProjectRevision !== undefined
                ? { baseProjectRevision }
                : {}),
              target: {
                kind: "chapter-mutation",
                mutation: {
                  type: "move",
                  chapterId: chapter.id,
                  title: chapter.title,
                  direction: mergedMeta.direction
                }
              }
            }
          );
        }
        const nextTitle = (mergedMeta.title ?? "").trim();
        if (!nextTitle) {
          throw new Error("title：修改 chapter 须提供新标题或 direction。");
        }
        if (nextTitle.length > ACADEMIC_CHAPTER_TITLE_MAX_LENGTH) {
          throw new Error(
            `title：当前 ${nextTitle.length} 字，上限 ${ACADEMIC_CHAPTER_TITLE_MAX_LENGTH}。`
          );
        }
        const previousTitle = chapter.title;
        chapter.title = nextTitle;
        const summary =
          rawSummary || `将章「${previousTitle}」重命名为「${nextTitle}」`;
        return academicTextResult(
          `${summary}。${academicProposalNote(input)}`,
          {
            kind: "academic-workspace-mutation",
            workspaceId: input.workspace.id,
            summary,
            ...(baseProjectRevision !== undefined
              ? { baseProjectRevision }
              : {}),
            target: {
              kind: "chapter-mutation",
              mutation: {
                type: "rename",
                chapterId: chapter.id,
                previousTitle,
                title: nextTitle
              }
            }
          }
        );
      }

      if (params.kind === "framework_stage" && hasAnyMeta) {
        if (textModeCount > 0) {
          throw new Error(
            "framework_stage 的结构元信息（title/description/enabled/direction）与正文修改请分两次调用。"
          );
        }
        const stageId =
          rawId ||
          (input.workspace.activeTarget?.kind === "framework_stage"
            ? input.workspace.activeTarget.targetId
            : "");
        const stage = sharedState.frameworkStages.get(stageId);
        if (!stage) {
          throw new Error(`未找到论证框架阶段（id=${stageId || "空"}）。`);
        }
        if (mergedMeta.direction) {
          moveOrderItem(
            sharedState.frameworkStageOrder,
            stage.id,
            mergedMeta.direction
          );
          const summary =
            rawSummary ||
            `调整论证阶段「${stage.title}」顺序（${mergedMeta.direction === "up" ? "上移" : "下移"}）`;
          return academicTextResult(
            `${summary}。${academicProposalNote(input)}`,
            {
              kind: "academic-workspace-mutation",
              workspaceId: input.workspace.id,
              summary,
              ...(baseProjectRevision !== undefined
                ? { baseProjectRevision }
                : {}),
              target: {
                kind: "framework-stage-mutation",
                mutation: {
                  type: "move",
                  stageId: stage.id,
                  title: stage.title,
                  direction: mergedMeta.direction
                }
              }
            }
          );
        }
        const nextTitle = (mergedMeta.title ?? stage.title).trim();
        const nextDescription = (
          mergedMeta.description ?? stage.description
        ).trim();
        const nextEnabled =
          mergedMeta.stage_status === undefined
            ? stage.enabled
            : mergedMeta.stage_status === "enabled";
        if (!nextTitle) throw new Error("title：阶段标题不能为空。");
        if (nextTitle.length > ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH) {
          throw new Error(
            `title：当前 ${nextTitle.length} 字，上限 ${ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH}。`
          );
        }
        if (!nextDescription)
          throw new Error("description：阶段说明不能为空。");
        if (
          nextDescription.length >
          ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH
        ) {
          throw new Error(
            `description：当前 ${nextDescription.length} 字，上限 ${ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH}。`
          );
        }
        if (
          !nextEnabled &&
          ![...sharedState.frameworkStages.values()].some(
            (other) => other.id !== stage.id && other.enabled
          )
        ) {
          throw new Error("至少须保留 1 个处于启用状态的论证框架阶段。");
        }
        const previousTitle = stage.title;
        const previousDescription = stage.description;
        stage.title = nextTitle;
        stage.description = nextDescription;
        stage.enabled = nextEnabled;
        stage.file.title = nextTitle;
        const summary = rawSummary || `更新论证阶段「${nextTitle}」配置`;
        return academicTextResult(
          `${summary}。${academicProposalNote(input)}`,
          {
            kind: "academic-workspace-mutation",
            workspaceId: input.workspace.id,
            summary,
            ...(baseProjectRevision !== undefined
              ? { baseProjectRevision }
              : {}),
            target: {
              kind: "framework-stage-mutation",
              mutation: {
                type: "update",
                stageId: stage.id,
                previousTitle,
                previousDescription,
                title: nextTitle,
                description: nextDescription,
                ...(mergedMeta.stage_status !== undefined
                  ? { enabled: nextEnabled }
                  : {})
              }
            }
          }
        );
      }

      if (params.kind === "section" && hasAnyMeta) {
        if (textModeCount > 0) {
          throw new Error(
            "section 的目录元信息（title/chapter_id/after_section_id/word_count_requirement/direction）与文稿修改请分两次调用。"
          );
        }
        const sectionId =
          rawId ||
          (input.workspace.activeTarget?.kind === "section"
            ? input.workspace.activeTarget.targetId
            : "");
        const section = sharedState.sections.get(sectionId);
        if (!section) {
          throw new Error(`未找到正文小节（id=${sectionId || "空"}）。`);
        }
        const nextTitle = (mergedMeta.title ?? section.title).trim();
        if (!nextTitle) throw new Error("title：小节标题不能为空。");
        if (nextTitle.length > ACADEMIC_SECTION_TITLE_MAX_LENGTH) {
          throw new Error(
            `title：当前 ${nextTitle.length} 字，上限 ${ACADEMIC_SECTION_TITLE_MAX_LENGTH}。`
          );
        }
        if (
          typeof mergedMeta.chapter_id === "string" &&
          mergedMeta.chapter_id.trim() &&
          !sharedState.chapters.has(mergedMeta.chapter_id.trim())
        ) {
          throw new Error(
            `chapter_id：未找到章（id=${mergedMeta.chapter_id.trim()}）。`
          );
        }
        if (
          typeof mergedMeta.after_section_id === "string" &&
          mergedMeta.after_section_id.trim() &&
          (!sharedState.sections.has(mergedMeta.after_section_id.trim()) ||
            mergedMeta.after_section_id.trim() === section.id)
        ) {
          throw new Error(
            `after_section_id：目标参照小节无效（${mergedMeta.after_section_id}）。`
          );
        }
        if (
          mergedMeta.word_count_requirement !== undefined &&
          mergedMeta.word_count_requirement.length >
            ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH
        ) {
          throw new Error(
            `word_count_requirement：当前 ${mergedMeta.word_count_requirement.length} 字，上限 ${ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH}。`
          );
        }

        const previousTitle = section.title;
        section.title = nextTitle;
        section.body.title = nextTitle;
        if (mergedMeta.chapter_id === null) {
          delete section.chapterId;
        } else if (typeof mergedMeta.chapter_id === "string") {
          section.chapterId = mergedMeta.chapter_id.trim();
        }
        if (mergedMeta.word_count_requirement !== undefined) {
          section.wordCountRequirement =
            mergedMeta.word_count_requirement.trim();
        }
        if (mergedMeta.direction) {
          moveOrderItem(
            sharedState.sectionOrder,
            section.id,
            mergedMeta.direction
          );
        } else if (mergedMeta.after_section_id !== undefined) {
          const currentIdx = sharedState.sectionOrder.indexOf(section.id);
          if (currentIdx >= 0) sharedState.sectionOrder.splice(currentIdx, 1);
          if (mergedMeta.after_section_id === null) {
            sharedState.sectionOrder.unshift(section.id);
          } else {
            const afterIdx = sharedState.sectionOrder.indexOf(
              mergedMeta.after_section_id.trim()
            );
            if (afterIdx >= 0) {
              sharedState.sectionOrder.splice(afterIdx + 1, 0, section.id);
            } else {
              sharedState.sectionOrder.push(section.id);
            }
          }
        }
        sharedState.lastEditedSectionId = section.id;

        const summary = rawSummary || `更新正文小节「${nextTitle}」目录属性`;
        return academicTextResult(
          `${summary}。${academicProposalNote(input)}`,
          {
            kind: "academic-workspace-mutation",
            workspaceId: input.workspace.id,
            summary,
            ...(baseProjectRevision !== undefined
              ? { baseProjectRevision }
              : {}),
            target: {
              kind: "section-mutation",
              mutation: {
                type: "update",
                sectionId: section.id,
                previousTitle,
                title: nextTitle,
                ...(mergedMeta.chapter_id !== undefined
                  ? {
                      chapterId:
                        mergedMeta.chapter_id === null
                          ? null
                          : mergedMeta.chapter_id.trim()
                    }
                  : {}),
                ...(mergedMeta.after_section_id !== undefined
                  ? {
                      afterSectionId:
                        mergedMeta.after_section_id === null
                          ? null
                          : mergedMeta.after_section_id.trim()
                    }
                  : {}),
                ...(mergedMeta.word_count_requirement !== undefined
                  ? {
                      wordCountRequirement:
                        mergedMeta.word_count_requirement.trim()
                    }
                  : {}),
                ...(mergedMeta.direction
                  ? { direction: mergedMeta.direction }
                  : {})
              }
            }
          }
        );
      }

      if (params.kind === "foundation" && hasAnyMeta) {
        throw new Error(
          "foundation 文档（thesis_overview / terminology）不支持修改标题或结构元信息，请直接编辑正文。"
        );
      }

      let file: AcademicOverlayFile;
      let resolvedTargetId: string;
      let sectionDocument: AcademicSectionFileKind | undefined;
      let cardMeta:
        | {
            citeKey?: string;
            cardType?: "literature" | "evidence";
            title?: string;
          }
        | undefined;

      if (params.kind === "foundation") {
        const targetId =
          rawId ||
          (input.workspace.activeTarget?.kind === "thesis_overview" ||
          input.workspace.activeTarget?.kind === "terminology"
            ? input.workspace.activeTarget.targetId
            : "");
        if (targetId === ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID) {
          file = sharedState.thesisOverview;
          resolvedTargetId = ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID;
        } else if (targetId === ACADEMIC_TERMINOLOGY_DOCUMENT_ID) {
          file = sharedState.terminology;
          resolvedTargetId = ACADEMIC_TERMINOLOGY_DOCUMENT_ID;
        } else {
          throw new Error(
            "id：编辑 foundation 须指定 thesis_overview 或 terminology。"
          );
        }
      } else if (params.kind === "reference_card") {
        if (!rawId) {
          throw new Error("id：编辑 reference_card 须提供卡片 id 或 citeKey。");
        }
        const card = findAcademicCardByIdOrCiteKey(sharedState, rawId);
        if (!card) {
          throw new Error(`未找到文献/证据卡（${rawId}）。`);
        }
        if (hasAnyMeta) {
          const nextMeta: NonNullable<typeof cardMeta> = {};
          if (mergedMeta.cite_key !== undefined) {
            const parsed = AcademicCiteKeySchema.safeParse(mergedMeta.cite_key);
            if (!parsed.success) {
              throw new Error(
                "cite_key：格式无效（须为 1–120 位字母、数字、下划线、冒号或连字符）。"
              );
            }
            const conflict = [...sharedState.cards.values()].find(
              (other) =>
                other.id !== card.id &&
                other.citeKey.toLowerCase() === parsed.data.toLowerCase()
            );
            if (conflict) {
              throw new Error(
                `cite_key：「${parsed.data}」已被另一张卡片占用。`
              );
            }
            nextMeta.citeKey = parsed.data;
          }
          if (mergedMeta.card_type !== undefined) {
            const parsed = AcademicReferenceCardTypeSchema.safeParse(
              mergedMeta.card_type
            );
            if (!parsed.success) {
              throw new Error("card_type：须为 literature 或 evidence。");
            }
            nextMeta.cardType = parsed.data;
          }
          if (mergedMeta.title !== undefined) {
            const trimmed = mergedMeta.title.trim();
            if (!trimmed) throw new Error("title：卡片标题不能为空。");
            if (trimmed.length > ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH) {
              throw new Error(
                `title：当前 ${trimmed.length} 字，上限 ${ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH}。`
              );
            }
            nextMeta.title = trimmed;
          }
          if (Object.keys(nextMeta).length > 0) {
            cardMeta = nextMeta;
          }
        }
        file = card.file;
        resolvedTargetId = card.id;
      } else if (params.kind === "framework_stage") {
        const stageId =
          rawId ||
          (input.workspace.activeTarget?.kind === "framework_stage"
            ? input.workspace.activeTarget.targetId
            : "");
        const stage = sharedState.frameworkStages.get(stageId);
        if (!stage) {
          throw new Error(`未找到论证框架阶段（id=${stageId || "空"}）。`);
        }
        file = stage.file;
        resolvedTargetId = stage.id;
      } else {
        const sectionId =
          rawId ||
          (input.workspace.activeTarget?.kind === "section"
            ? input.workspace.activeTarget.targetId
            : "");
        const section = sharedState.sections.get(sectionId);
        if (!section) {
          throw new Error(`未找到正文小节（id=${sectionId || "空"}）。`);
        }
        if (!params.document) {
          throw new Error(
            "document：编辑 section 文稿须显式指定 document=brief、body 或 state。"
          );
        }
        sectionDocument = params.document;
        file = section[params.document];
        resolvedTargetId = section.id;
      }

      const loaded = await ensureAcademicOverlayFileLoaded(input, file, signal);
      const beforeText = loaded.content;
      const baseRevision = loaded.revision;

      let nextText = beforeText;
      if (params.content !== undefined) {
        if (beforeText.trim().length > 0) {
          if (!hasAcademicFullRead(readState, loaded)) {
            return academicTextResult(
              english
                ? `Not changed: "${loaded.title}" is non-empty and has not been read in full in the current context. Call read (without head/tail/offset/limit) first and set overwrite_mode=replace_all, or use replacements/insert/append.`
                : `未修改：「${loaded.title}」已有非空内容，且当前上下文尚未完整读取全文（分段/预览读取或压缩后均不授予覆盖凭证）。请先调用不带 head/tail/offset/limit 的 read 完整读取全文并设 overwrite_mode=replace_all，或改用 replacements / insert / append 做局部修改。`
            );
          }
          if (params.overwrite_mode !== REPLACE_ALL_OVERWRITE_MODE) {
            return academicTextResult(
              english
                ? `Not changed: pass overwrite_mode=replace_all to confirm replacing non-empty "${loaded.title}", or use replacements for local edits.`
                : `未修改：替换非空文稿「${loaded.title}」必须显式传入 overwrite_mode=replace_all；若只需局部修订，请改用 replacements。`
            );
          }
        }
        nextText = params.content;
      } else if (params.append !== undefined) {
        nextText = `${beforeText}${params.append}`;
      } else if (params.insert !== undefined) {
        nextText = applyAcademicReplacements(
          beforeText,
          [
            {
              old_text: params.insert.anchor,
              new_text:
                params.insert.position === "before"
                  ? `${params.insert.text}${params.insert.anchor}`
                  : `${params.insert.anchor}${params.insert.text}`
            }
          ],
          english
        );
      } else if (params.replacements?.length) {
        nextText = applyAcademicReplacements(
          beforeText,
          params.replacements,
          english
        );
      }

      if (nextText.length > SHORT_WORKSPACE_FILE_MAX_CHARACTERS) {
        throw new Error(
          `content：修改后长度 ${nextText.length} 字，超过单文件上限 ${SHORT_WORKSPACE_FILE_MAX_CHARACTERS}。`
        );
      }

      const cardRecord =
        params.kind === "reference_card"
          ? sharedState.cards.get(resolvedTargetId)
          : undefined;
      const cardMetaChanged =
        cardRecord &&
        cardMeta &&
        ((cardMeta.citeKey && cardMeta.citeKey !== cardRecord.citeKey) ||
          (cardMeta.cardType && cardMeta.cardType !== cardRecord.cardType) ||
          (cardMeta.title && cardMeta.title !== cardRecord.title));

      if (nextText === beforeText && !cardMetaChanged) {
        return academicTextResult(
          english
            ? "Not changed: target already matches requested content/metadata."
            : "未修改：目标文稿与元信息已是所要求的状态。"
        );
      }

      const wasFullyRead = hasAcademicFullRead(readState, loaded);
      updateAcademicOverlayFile(loaded, nextText);
      if (
        wasFullyRead ||
        params.content !== undefined ||
        beforeText.length === 0
      ) {
        recordAcademicFullRead(readState, loaded);
      }
      if (cardRecord && cardMeta) {
        if (cardMeta.citeKey) cardRecord.citeKey = cardMeta.citeKey;
        if (cardMeta.cardType) cardRecord.cardType = cardMeta.cardType;
        if (cardMeta.title) {
          cardRecord.title = cardMeta.title;
          loaded.title = cardMeta.title;
        }
      }
      if (params.kind === "section") {
        sharedState.lastEditedSectionId = resolvedTargetId;
      }

      const summary =
        rawSummary ||
        (english ? `Edit "${loaded.title}"` : `修改「${loaded.title}」`);
      const message = appendWritingContentCounts(
        `${summary}。${academicProposalNote(input)}`,
        [{ title: loaded.title, id: loaded.id, content: nextText }],
        input.promptLocale
      );

      return academicTextResult(message, {
        kind: "academic-workspace-mutation",
        workspaceId: input.workspace.id,
        summary,
        ...(baseProjectRevision !== undefined ? { baseProjectRevision } : {}),
        target: {
          kind: "document-edit",
          objectKind: params.kind,
          targetId: resolvedTargetId,
          ...(sectionDocument ? { sectionDocument } : {}),
          catalogDocumentId: loaded.id,
          title: loaded.title,
          beforeText,
          text: nextText,
          baseRevision,
          ...(cardMetaChanged && cardMeta ? { cardMeta } : {})
        }
      });
    }
  });
}
