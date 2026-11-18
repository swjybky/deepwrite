import {
  ACADEMIC_BATCH_CREATE_MAX_ITEMS,
  ACADEMIC_CHAPTER_TITLE_MAX_LENGTH,
  ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH,
  ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT,
  ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH,
  ACADEMIC_MAX_CHAPTERS,
  ACADEMIC_MAX_REFERENCE_CARDS,
  ACADEMIC_MAX_SECTIONS,
  ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH,
  ACADEMIC_REFERENCE_CARD_TYPES,
  ACADEMIC_SECTION_TITLE_MAX_LENGTH,
  ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH,
  AcademicCiteKeySchema,
  AcademicReferenceCardTypeSchema,
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createShortWorkspaceContentRevision,
  PROVISIONAL_ACADEMIC_CARD_ID_PREFIX,
  PROVISIONAL_ACADEMIC_CHAPTER_ID_PREFIX,
  PROVISIONAL_ACADEMIC_SECTION_ID_PREFIX,
  PROVISIONAL_ACADEMIC_STAGE_ID_PREFIX,
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS
} from "@deepwrite/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { literalUnion } from "../short-agent-tools/schema";
import { countWritingContentCharacters } from "../writing-content-counts";
import {
  academicProposalNote,
  academicTextResult,
  defineAcademicTool,
  recordAcademicFullRead,
  syncAcademicSharedStateFromCore,
  type AcademicOverlayFile,
  type AcademicReadState,
  type AcademicWorkspaceToolSharedState,
  type BuildAcademicWorkspaceToolsInput
} from "./shared";

export const ACADEMIC_CREATE_KINDS = [
  "reference_card",
  "framework_stage",
  "chapter",
  "section"
] as const;

const CreateItemParameters = {
  title: Type.Optional(
    Type.String({
      description:
        "标题（reference_card/chapter <= 256 字，section <= 240 字，framework_stage <= 120 字）。"
    })
  ),
  cite_key: Type.Optional(
    Type.String({
      description:
        "仅 reference_card 必填：唯一引用键（仅限字母、数字、下划线、冒号、连字符，<= 120 字，如 Vaswani2017）。"
    })
  ),
  card_type: Type.Optional(
    literalUnion(ACADEMIC_REFERENCE_CARD_TYPES, {
      description:
        "仅 reference_card 使用：literature（文献卡，默认）或 evidence（实验/证据卡）。"
    })
  ),
  description: Type.Optional(
    Type.String({
      description:
        "仅 framework_stage 必填：该自定义论证阶段的职责与交付标准（<= 20000 字）。"
    })
  ),
  content: Type.Optional(
    Type.String({
      description:
        "reference_card 或 framework_stage 的初始正文内容（<= 200000 字，可省略默认为空）。"
    })
  ),
  chapter_id: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: "仅 section 可选：所属章 id（省略或传 null 表示不归属章）。"
    })
  ),
  after_section_id: Type.Optional(
    Type.String({
      description: "仅 section 可选：插入到该小节 id 之后（省略则追加到末尾）。"
    })
  ),
  word_count_requirement: Type.Optional(
    Type.String({
      description: "仅 section 可选：本节目标字数说明（<= 1000 字）。"
    })
  ),
  brief: Type.Optional(
    Type.String({
      description: "仅 section 可选：初始本节写作要旨（brief，<= 200000 字）。"
    })
  ),
  body: Type.Optional(
    Type.String({
      description: "仅 section 可选：初始本节正文（body，<= 200000 字）。"
    })
  ),
  state: Type.Optional(
    Type.String({
      description: "仅 section 可选：初始本节论证状态（state，<= 200000 字）。"
    })
  )
};

function makeProvisionalFile(
  id: string,
  title: string,
  content: string
): AcademicOverlayFile {
  return {
    id,
    title,
    content,
    revision: createShortWorkspaceContentRevision(content),
    characters: countWritingContentCharacters(content),
    length: content.length,
    loaded: true,
    dirty: true
  };
}

function assertMaxLen(value: string, max: number, fieldPath: string): void {
  if (value.length > max) {
    throw new Error(`${fieldPath}：当前 ${value.length} 字，上限 ${max}。`);
  }
}

export function buildAcademicCreateTool(
  input: BuildAcademicWorkspaceToolsInput,
  sharedState: AcademicWorkspaceToolSharedState,
  readState: AcademicReadState
): AgentTool {
  const english = input.promptLocale === "en-US";
  return defineAcademicTool({
    name: "create",
    label: english ? "Create academic object" : "新建学术作品对象",
    description: english
      ? "Propose creating reference_card (single or batch items <= 50), custom framework_stage, chapter (single or batch <= 50), or section (single or batch <= 50). Allocates provisional pending:academic-* IDs immediately usable in the current run."
      : "提交新建文献与证据卡（reference_card）、自定义论证阶段（framework_stage）、章（chapter）或正文小节（section）的修改提案。支持单条顶层字段或 items 数组批量创建（单次最多 50 项）；本轮立即分配 pending:academic-* 临时 ID 供同轮后续读写与子智能体引用。",
    parameters: Type.Object({
      kind: literalUnion(ACADEMIC_CREATE_KINDS, {
        description: english
          ? "Object kind to create."
          : "新建对象类型：reference_card、framework_stage、chapter 或 section。"
      }),
      ...CreateItemParameters,
      items: Type.Optional(
        Type.Array(Type.Object(CreateItemParameters), {
          description: english
            ? "Optional batch items (1–50). Omit when creating a single object via top-level fields."
            : "批量创建列表（最多 50 项）；单个创建时可直接填顶层字段。"
        })
      ),
      summary: Type.Optional(
        Type.String({
          description: english
            ? "Optional one-sentence summary for the approval card (<= 1000 chars)."
            : "可选的一句话改动说明（<= 1000 字）。"
        })
      )
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      await syncAcademicSharedStateFromCore(input, sharedState, signal);

      const rawItems = params.items?.length
        ? params.items
        : [
            {
              title: params.title,
              cite_key: params.cite_key,
              card_type: params.card_type,
              description: params.description,
              content: params.content,
              chapter_id: params.chapter_id,
              after_section_id: params.after_section_id,
              word_count_requirement: params.word_count_requirement,
              brief: params.brief,
              body: params.body,
              state: params.state
            }
          ];

      if (rawItems.length === 0) {
        throw new Error("items：至少需要提交 1 项。");
      }
      if (rawItems.length > ACADEMIC_BATCH_CREATE_MAX_ITEMS) {
        throw new Error(
          `items：当前 ${rawItems.length} 项，单次上限 ${ACADEMIC_BATCH_CREATE_MAX_ITEMS}。请分批提交。`
        );
      }

      const rawSummary = params.summary?.trim();
      if (rawSummary && rawSummary.length > 1_000) {
        throw new Error(`summary：当前 ${rawSummary.length} 字，上限 1000。`);
      }
      const baseProjectRevision = input.workspace.projectRevision;

      if (params.kind === "reference_card") {
        if (
          sharedState.cardOrder.length + rawItems.length >
          ACADEMIC_MAX_REFERENCE_CARDS
        ) {
          throw new Error(
            `文献与证据卡总数不能超过 ${ACADEMIC_MAX_REFERENCE_CARDS} 张（当前 ${sharedState.cardOrder.length} 张，本次新增 ${rawItems.length} 张）。`
          );
        }
        const seenCiteKeys = new Set(
          [...sharedState.cards.values()].map((card) =>
            card.citeKey.toLowerCase()
          )
        );
        const validatedCards: Array<{
          provisionalCardId: string;
          citeKey: string;
          cardType: "literature" | "evidence";
          title: string;
          content: string;
        }> = [];

        rawItems.forEach((item, idx) => {
          const prefix = params.items?.length ? `items.${idx}.` : "";
          const title = (item.title ?? "").trim();
          if (!title) {
            throw new Error(`${prefix}title：缺少必填标题。`);
          }
          assertMaxLen(
            title,
            ACADEMIC_REFERENCE_CARD_TITLE_MAX_LENGTH,
            `${prefix}title`
          );
          const citeKeyParsed = AcademicCiteKeySchema.safeParse(
            item.cite_key ?? ""
          );
          if (!citeKeyParsed.success) {
            throw new Error(
              `${prefix}cite_key：格式无效（须为 1–120 位字母、数字、下划线、冒号或连字符，如 Vaswani2017）。`
            );
          }
          const citeKey = citeKeyParsed.data;
          if (seenCiteKeys.has(citeKey.toLowerCase())) {
            throw new Error(
              `${prefix}cite_key：「${citeKey}」已存在或在本批重复，请使用唯一 citeKey。`
            );
          }
          seenCiteKeys.add(citeKey.toLowerCase());

          const cardTypeParsed = AcademicReferenceCardTypeSchema.safeParse(
            item.card_type ?? "literature"
          );
          if (!cardTypeParsed.success) {
            throw new Error(
              `${prefix}card_type：须为 literature 或 evidence。`
            );
          }
          const content = item.content ?? "";
          assertMaxLen(
            content,
            SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
            `${prefix}content`
          );
          sharedState.pendingCardSeq += 1;
          validatedCards.push({
            provisionalCardId: `${PROVISIONAL_ACADEMIC_CARD_ID_PREFIX}${sharedState.pendingCardSeq}`,
            citeKey,
            cardType: cardTypeParsed.data,
            title,
            content
          });
        });

        for (const card of validatedCards) {
          const docId = createAcademicCardDocumentId(card.provisionalCardId);
          const file = makeProvisionalFile(docId, card.title, card.content);
          sharedState.cards.set(card.provisionalCardId, {
            id: card.provisionalCardId,
            citeKey: card.citeKey,
            cardType: card.cardType,
            title: card.title,
            documentId: docId,
            file,
            provisional: true
          });
          sharedState.cardOrder.push(card.provisionalCardId);
          recordAcademicFullRead(readState, file);
        }

        const summary =
          rawSummary ||
          (validatedCards.length === 1
            ? `新建文献与证据卡「${validatedCards[0]!.title}」（${validatedCards[0]!.citeKey}）`
            : `批量新建 ${validatedCards.length} 张文献与证据卡`);

        return academicTextResult(
          [
            `${summary}。${academicProposalNote(input)}`,
            ...validatedCards.map(
              (card) =>
                `- citeKey=${card.citeKey} | id=${card.provisionalCardId} | cardType=${card.cardType} | title=${card.title}`
            )
          ].join("\n"),
          {
            kind: "academic-workspace-mutation",
            workspaceId: input.workspace.id,
            summary,
            ...(baseProjectRevision !== undefined
              ? { baseProjectRevision }
              : {}),
            target: {
              kind: "reference-card-create",
              cards: validatedCards
            }
          }
        );
      }

      if (params.kind === "framework_stage") {
        if (rawItems.length > 1) {
          throw new Error(
            "items：framework_stage 每次调用创建一个自定义阶段，请逐个创建。"
          );
        }
        if (
          sharedState.frameworkStageOrder.length + 1 >
          ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT
        ) {
          throw new Error(
            `论证框架阶段总数不能超过 ${ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT} 个。`
          );
        }
        const item = rawItems[0]!;
        const title = (item.title ?? "").trim();
        if (!title) {
          throw new Error("title：缺少自定义论证框架阶段标题。");
        }
        assertMaxLen(title, ACADEMIC_FRAMEWORK_STAGE_TITLE_MAX_LENGTH, "title");
        if (
          [...sharedState.frameworkStages.values()].some(
            (stage) =>
              stage.title.toLocaleLowerCase() === title.toLocaleLowerCase()
          )
        ) {
          throw new Error(`title：论证框架阶段标题「${title}」已存在。`);
        }
        const description = (item.description ?? "").trim();
        if (!description) {
          throw new Error(
            "description：创建 framework_stage 须填写阶段职责与交付标准说明。"
          );
        }
        assertMaxLen(
          description,
          ACADEMIC_FRAMEWORK_STAGE_DESCRIPTION_MAX_LENGTH,
          "description"
        );
        const content = item.content ?? "";
        assertMaxLen(content, SHORT_WORKSPACE_FILE_MAX_CHARACTERS, "content");

        sharedState.pendingStageSeq += 1;
        const provisionalStageId = `${PROVISIONAL_ACADEMIC_STAGE_ID_PREFIX}${sharedState.pendingStageSeq}`;
        const file = makeProvisionalFile(provisionalStageId, title, content);
        sharedState.frameworkStages.set(provisionalStageId, {
          id: provisionalStageId,
          title,
          description,
          enabled: true,
          builtin: false,
          file,
          provisional: true
        });
        sharedState.frameworkStageOrder.push(provisionalStageId);
        recordAcademicFullRead(readState, file);

        const summary = rawSummary || `新建自定义论证阶段「${title}」`;
        return academicTextResult(
          `${summary}（id=${provisionalStageId}）。${academicProposalNote(input)}`,
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
                type: "create",
                provisionalStageId,
                title,
                description,
                content
              }
            }
          }
        );
      }

      if (params.kind === "chapter") {
        if (
          sharedState.chapterOrder.length + rawItems.length >
          ACADEMIC_MAX_CHAPTERS
        ) {
          throw new Error(
            `章总数不能超过 ${ACADEMIC_MAX_CHAPTERS} 章（当前 ${sharedState.chapterOrder.length} 章，本次新增 ${rawItems.length} 章）。`
          );
        }
        const chapters: Array<{ provisionalChapterId: string; title: string }> =
          [];
        rawItems.forEach((item, idx) => {
          const prefix = params.items?.length ? `items.${idx}.` : "";
          const title = (item.title ?? "").trim();
          if (!title) {
            throw new Error(`${prefix}title：缺少章标题。`);
          }
          assertMaxLen(
            title,
            ACADEMIC_CHAPTER_TITLE_MAX_LENGTH,
            `${prefix}title`
          );
          sharedState.pendingChapterSeq += 1;
          chapters.push({
            provisionalChapterId: `${PROVISIONAL_ACADEMIC_CHAPTER_ID_PREFIX}${sharedState.pendingChapterSeq}`,
            title
          });
        });

        for (const chapter of chapters) {
          sharedState.chapters.set(chapter.provisionalChapterId, {
            id: chapter.provisionalChapterId,
            title: chapter.title,
            provisional: true
          });
          sharedState.chapterOrder.push(chapter.provisionalChapterId);
        }

        const summary =
          rawSummary ||
          (chapters.length === 1
            ? `新建章「${chapters[0]!.title}」`
            : `批量新建 ${chapters.length} 章`);
        return academicTextResult(
          [
            `${summary}。${academicProposalNote(input)}`,
            ...chapters.map(
              (chapter) =>
                `- id=${chapter.provisionalChapterId} | title=${chapter.title}`
            )
          ].join("\n"),
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
                type: "create",
                chapters
              }
            }
          }
        );
      }

      if (
        sharedState.sectionOrder.length + rawItems.length >
        ACADEMIC_MAX_SECTIONS
      ) {
        throw new Error(
          `正文小节总数不能超过 ${ACADEMIC_MAX_SECTIONS} 节（当前 ${sharedState.sectionOrder.length} 节，本次新增 ${rawItems.length} 节）。`
        );
      }

      const createdSections: Array<{
        provisionalSectionId: string;
        title: string;
        chapterId?: string | null;
        afterSectionId?: string;
        wordCountRequirement: string;
        briefContent?: string;
        bodyContent?: string;
        stateContent?: string;
      }> = [];

      rawItems.forEach((item, idx) => {
        const prefix = params.items?.length ? `items.${idx}.` : "";
        const title = (item.title ?? "").trim();
        if (!title) {
          throw new Error(`${prefix}title：缺少小节标题。`);
        }
        assertMaxLen(
          title,
          ACADEMIC_SECTION_TITLE_MAX_LENGTH,
          `${prefix}title`
        );
        const chapterId =
          item.chapter_id === null
            ? null
            : item.chapter_id?.trim()
              ? item.chapter_id.trim()
              : undefined;
        if (
          typeof chapterId === "string" &&
          !sharedState.chapters.has(chapterId)
        ) {
          throw new Error(
            `${prefix}chapter_id：未找到章（id=${chapterId}），请先创建章或核对目录。`
          );
        }
        const afterSectionId = item.after_section_id?.trim() || undefined;
        if (
          afterSectionId &&
          !sharedState.sections.has(afterSectionId) &&
          !createdSections.some(
            (prev) => prev.provisionalSectionId === afterSectionId
          )
        ) {
          throw new Error(
            `${prefix}after_section_id：未找到参照小节（id=${afterSectionId}）。`
          );
        }
        const wordCountRequirement = (item.word_count_requirement ?? "").trim();
        assertMaxLen(
          wordCountRequirement,
          ACADEMIC_SECTION_WORD_COUNT_MAX_LENGTH,
          `${prefix}word_count_requirement`
        );
        const briefContent = item.brief;
        const bodyContent = item.body !== undefined ? item.body : item.content;
        const stateContent = item.state;
        if (briefContent !== undefined) {
          assertMaxLen(
            briefContent,
            SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
            `${prefix}brief`
          );
        }
        if (bodyContent !== undefined) {
          assertMaxLen(
            bodyContent,
            SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
            `${prefix}body`
          );
        }
        if (stateContent !== undefined) {
          assertMaxLen(
            stateContent,
            SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
            `${prefix}state`
          );
        }
        sharedState.pendingSectionSeq += 1;
        createdSections.push({
          provisionalSectionId: `${PROVISIONAL_ACADEMIC_SECTION_ID_PREFIX}${sharedState.pendingSectionSeq}`,
          title,
          ...(chapterId !== undefined ? { chapterId } : {}),
          ...(afterSectionId ? { afterSectionId } : {}),
          wordCountRequirement,
          ...(briefContent !== undefined ? { briefContent } : {}),
          ...(bodyContent !== undefined ? { bodyContent } : {}),
          ...(stateContent !== undefined ? { stateContent } : {})
        });
      });

      for (const sec of createdSections) {
        const briefFile = makeProvisionalFile(
          createAcademicSectionDocumentId(sec.provisionalSectionId, "brief"),
          `${sec.title} · 写作要旨`,
          sec.briefContent ?? ""
        );
        const bodyFile = makeProvisionalFile(
          createAcademicSectionDocumentId(sec.provisionalSectionId, "body"),
          sec.title,
          sec.bodyContent ?? ""
        );
        const stateFile = makeProvisionalFile(
          createAcademicSectionDocumentId(sec.provisionalSectionId, "state"),
          `${sec.title} · 论证状态`,
          sec.stateContent ?? ""
        );
        sharedState.sections.set(sec.provisionalSectionId, {
          id: sec.provisionalSectionId,
          ...(typeof sec.chapterId === "string"
            ? { chapterId: sec.chapterId }
            : {}),
          title: sec.title,
          wordCountRequirement: sec.wordCountRequirement,
          brief: briefFile,
          body: bodyFile,
          state: stateFile,
          provisional: true
        });
        const afterIdx = sec.afterSectionId
          ? sharedState.sectionOrder.indexOf(sec.afterSectionId)
          : -1;
        if (afterIdx >= 0) {
          sharedState.sectionOrder.splice(
            afterIdx + 1,
            0,
            sec.provisionalSectionId
          );
        } else {
          sharedState.sectionOrder.push(sec.provisionalSectionId);
        }
        recordAcademicFullRead(readState, briefFile);
        recordAcademicFullRead(readState, bodyFile);
        recordAcademicFullRead(readState, stateFile);
        sharedState.lastEditedSectionId = sec.provisionalSectionId;
      }

      const summary =
        rawSummary ||
        (createdSections.length === 1
          ? `新建正文小节「${createdSections[0]!.title}」`
          : `批量新建 ${createdSections.length} 个正文小节`);

      return academicTextResult(
        [
          `${summary}。${academicProposalNote(input)}`,
          ...createdSections.map(
            (sec) =>
              `- id=${sec.provisionalSectionId}${sec.chapterId ? ` | chapterId=${sec.chapterId}` : ""} | title=${sec.title}`
          )
        ].join("\n"),
        {
          kind: "academic-workspace-mutation",
          workspaceId: input.workspace.id,
          summary,
          ...(baseProjectRevision !== undefined ? { baseProjectRevision } : {}),
          target: {
            kind: "section-mutation",
            mutation: {
              type: "create",
              sections: createdSections
            }
          }
        }
      );
    }
  });
}
