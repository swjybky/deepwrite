import { z } from "zod";
import {
  AcademicCitationStyleSchema,
  type AcademicCitationStyle
} from "./academic-citation-style";
import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "./expert-draft";
import { DocumentVersionOriginSchema } from "./document-version-origin";

const CatalogIdSchema = z.string().trim().min(1).max(512);
const CatalogTitleSchema = z.string().trim().min(1).max(256);
const TimestampSchema = z.string().datetime();
const MAX_CONTENT_ITEMS = 4_096;

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const UniqueCatalogIdListSchema = z
  .array(CatalogIdSchema)
  .refine(uniqueStrings, {
    message: "Catalog id lists cannot contain duplicates."
  });

function isRelativeMarkdownPath(value: string): boolean {
  if (
    value.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    !value.endsWith(".md")
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    );
}

const AcademicContentPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(isRelativeMarkdownPath, {
    message: "Catalog project content paths must be relative Markdown paths."
  });

const AcademicDocumentSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  content: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

const AcademicDocumentManifestSchema = z
  .object({
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    path: AcademicContentPathSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

const AcademicIndexDocumentSchema = z
  .object({
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    content: z.literal(""),
    contentBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    contentStamp: z
      .string()
      .min(1)
      .max(256)
      .regex(/^(?:fs|manifest)-v1:/u),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

export const ACADEMIC_BOOK_SUBTYPES = [
  "empirical_paper",
  "humanities_paper",
  "literature_review",
  "thesis_dissertation",
  "proposal_grant",
  "tech_report_article"
] as const;

export const AcademicBookSubtypeSchema = z.enum(ACADEMIC_BOOK_SUBTYPES);
export type AcademicBookSubtype = z.infer<typeof AcademicBookSubtypeSchema>;

export const ACADEMIC_REFERENCE_CARD_TYPES = [
  "literature",
  "evidence"
] as const;

export const AcademicReferenceCardTypeSchema = z.enum(
  ACADEMIC_REFERENCE_CARD_TYPES
);
export type AcademicReferenceCardType = z.infer<
  typeof AcademicReferenceCardTypeSchema
>;

export const ACADEMIC_CITE_KEY_MAX_LENGTH = 120;
export const ACADEMIC_MAX_REFERENCE_CARDS = 1_000;
export const ACADEMIC_MAX_CHAPTERS = 100;
export const ACADEMIC_MAX_SECTIONS = 500;
export const ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT = 32;

export const AcademicCiteKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(ACADEMIC_CITE_KEY_MAX_LENGTH)
  .regex(
    /^[A-Za-z0-9_:-]+$/u,
    "CiteKey may contain only letters, numbers, underscores, colons, and hyphens."
  );
export type AcademicCiteKey = z.infer<typeof AcademicCiteKeySchema>;

export const ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID = "thesis_overview" as const;
export const ACADEMIC_TERMINOLOGY_DOCUMENT_ID = "terminology" as const;
export const ACADEMIC_THESIS_OVERVIEW_TITLE = "研究立意与核心贡献" as const;
export const ACADEMIC_TERMINOLOGY_TITLE = "术语与符号表" as const;

export const ACADEMIC_FOUNDATION_DOCUMENT_IDS = [
  ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
  ACADEMIC_TERMINOLOGY_DOCUMENT_ID
] as const;

export const ACADEMIC_SECTION_FILE_KINDS = ["brief", "body", "state"] as const;
export const AcademicSectionFileKindSchema = z.enum(
  ACADEMIC_SECTION_FILE_KINDS
);
export type AcademicSectionFileKind = z.infer<
  typeof AcademicSectionFileKindSchema
>;

const ACADEMIC_CARD_DOC_PREFIX = "academic-card:";
const ACADEMIC_SECTION_DOC_PREFIX = "academic-section:";

export function createAcademicCardDocumentId(cardId: string): string {
  return `${ACADEMIC_CARD_DOC_PREFIX}${cardId}`;
}

export function parseAcademicCardDocumentId(
  documentId: string
): { cardId: string } | undefined {
  if (!documentId.startsWith(ACADEMIC_CARD_DOC_PREFIX)) {
    return undefined;
  }
  const cardId = documentId.slice(ACADEMIC_CARD_DOC_PREFIX.length);
  if (!cardId || createAcademicCardDocumentId(cardId) !== documentId) {
    return undefined;
  }
  return { cardId };
}

export function createAcademicSectionDocumentId(
  sectionId: string,
  kind: AcademicSectionFileKind
): string {
  return `${ACADEMIC_SECTION_DOC_PREFIX}${sectionId}:${kind}`;
}

export function parseAcademicSectionDocumentId(
  documentId: string
): { sectionId: string; fileKind: AcademicSectionFileKind } | undefined {
  if (!documentId.startsWith(ACADEMIC_SECTION_DOC_PREFIX)) {
    return undefined;
  }
  for (const kind of ACADEMIC_SECTION_FILE_KINDS) {
    const suffix = `:${kind}`;
    if (documentId.endsWith(suffix)) {
      const sectionId = documentId.slice(
        ACADEMIC_SECTION_DOC_PREFIX.length,
        documentId.length - suffix.length
      );
      if (
        !sectionId ||
        createAcademicSectionDocumentId(sectionId, kind) !== documentId
      ) {
        return undefined;
      }
      return { sectionId, fileKind: kind };
    }
  }
  return undefined;
}

export const AcademicFrameworkStageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    "Academic framework stage ids may contain only letters, numbers, dots, underscores, colons, and hyphens."
  )
  .refine(
    (value) =>
      value !== ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID &&
      value !== ACADEMIC_TERMINOLOGY_DOCUMENT_ID &&
      value !== "draft" &&
      !value.startsWith(ACADEMIC_CARD_DOC_PREFIX) &&
      !value.startsWith(ACADEMIC_SECTION_DOC_PREFIX),
    {
      message: "Academic framework stage ids cannot use reserved document ids."
    }
  );
export type AcademicFrameworkStageId = z.infer<
  typeof AcademicFrameworkStageIdSchema
>;

export const AcademicFrameworkStageSchema = z
  .object({
    id: AcademicFrameworkStageIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(20_000),
    enabled: z.boolean()
  })
  .strict();
export type AcademicFrameworkStage = z.infer<
  typeof AcademicFrameworkStageSchema
>;

export const AcademicFrameworkStagesSchema = z
  .array(AcademicFrameworkStageSchema)
  .min(1)
  .max(ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT)
  .superRefine((stages, context) => {
    const ids = new Set<string>();
    const titles = new Set<string>();
    stages.forEach((stage, index) => {
      if (ids.has(stage.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate academic framework stage id: ${stage.id}`
        });
      }
      ids.add(stage.id);
      const normalizedTitle = stage.title.toLocaleLowerCase();
      if (titles.has(normalizedTitle)) {
        context.addIssue({
          code: "custom",
          path: [index, "title"],
          message: `Duplicate academic framework stage title: ${stage.title}`
        });
      }
      titles.add(normalizedTitle);
    });
    if (!stages.some((stage) => stage.enabled)) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "At least one academic framework stage must remain enabled."
      });
    }
  });

export const DEFAULT_ACADEMIC_FRAMEWORK_STAGES = [
  {
    id: "problem_and_gap",
    title: "立题与文献脉络",
    description:
      "梳理研究领域的学术演进流派与代表路线，指出已有方案的边界，导出本文聚焦的 Research Gap，明确不做什么。",
    enabled: true
  },
  {
    id: "method_framework",
    title: "方法与理论框架",
    description:
      "定义问题形式化符号、核心模型架构/算法流程，或社科理论视角、分析维度与核心研究假设，写清关键设计的理由（Rationale）。",
    enabled: true
  },
  {
    id: "evidence_plan",
    title: "实验与论据规划",
    description:
      "建立「核心贡献 ↔ 证据/实验」一一映射表，规划数据集/案例来源、对比基线、消融或稳健性检验、图表清单（Figure/Table 占位与预期结论）及研究局限性。",
    enabled: true
  },
  {
    id: "argument_outline",
    title: "全文论证大纲",
    description:
      "切分具体章/节结构，明确每节核心论点（Takeaway）、上下节承接逻辑、分配的文献/证据卡 citeKey、图表编号与目标字数。",
    enabled: true
  }
] as const satisfies readonly AcademicFrameworkStage[];

export const BUILTIN_ACADEMIC_FRAMEWORK_STAGE_IDS = new Set<string>(
  DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map((stage) => stage.id)
);

export function isBuiltinAcademicFrameworkStageId(stageId: string): boolean {
  return BUILTIN_ACADEMIC_FRAMEWORK_STAGE_IDS.has(stageId);
}

export interface AcademicPresetSectionSpec {
  id: string;
  chapterId?: string | undefined;
  title: string;
  wordCountRequirement?: string | undefined;
}

export interface AcademicPresetChapterSpec {
  id: string;
  title: string;
}

export interface AcademicSubtypePreset {
  subtype: AcademicBookSubtype;
  defaultCitationStyle: AcademicCitationStyle;
  enabledStageIds: readonly string[];
  chaptered: boolean;
  chapters: readonly AcademicPresetChapterSpec[];
  sections: readonly AcademicPresetSectionSpec[];
}

export function getAcademicSubtypePreset(
  subtype: AcademicBookSubtype,
  citationStyleOverride?: AcademicCitationStyle
): AcademicSubtypePreset {
  const defaultCitationStyle: AcademicCitationStyle =
    subtype === "empirical_paper"
      ? "ieee"
      : subtype === "tech_report_article"
        ? "none"
        : "gbt7714";
  const effectiveCitationStyle = citationStyleOverride ?? defaultCitationStyle;
  const includeReferences = effectiveCitationStyle !== "none";
  const referencesTail: AcademicPresetSectionSpec[] = includeReferences
    ? [{ id: "references", title: "参考文献" }]
    : [];

  switch (subtype) {
    case "empirical_paper":
      return {
        subtype,
        defaultCitationStyle,
        enabledStageIds: DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map((s) => s.id),
        chaptered: false,
        chapters: [],
        sections: [
          { id: "abstract", title: "摘要" },
          { id: "sec-intro", title: "1 引言" },
          { id: "sec-related", title: "2 相关工作" },
          { id: "sec-method", title: "3 方法设计" },
          { id: "sec-experiments", title: "4 实验与结果分析" },
          { id: "sec-conclusion", title: "5 结论" },
          ...referencesTail
        ]
      };
    case "humanities_paper":
      return {
        subtype,
        defaultCitationStyle,
        enabledStageIds: DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map((s) => s.id),
        chaptered: false,
        chapters: [],
        sections: [
          { id: "abstract", title: "摘要" },
          { id: "sec-problem", title: "一、问题的提出与文献回顾" },
          { id: "sec-theory", title: "二、理论视角与分析框架" },
          { id: "sec-analysis", title: "三、核心论证与案例分析" },
          { id: "sec-discussion", title: "四、结论与讨论" },
          ...referencesTail
        ]
      };
    case "literature_review":
      return {
        subtype,
        defaultCitationStyle,
        enabledStageIds: DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map((s) => s.id),
        chaptered: false,
        chapters: [],
        sections: [
          { id: "abstract", title: "摘要" },
          { id: "sec-scope", title: "1 引言与综述范围" },
          { id: "sec-taxonomy", title: "2 研究脉络与分类体系" },
          { id: "sec-comparison", title: "3 核心方法与路线对比" },
          { id: "sec-challenges", title: "4 开放挑战与未来方向" },
          { id: "sec-conclusion", title: "5 结论" },
          ...referencesTail
        ]
      };
    case "thesis_dissertation":
      return {
        subtype,
        defaultCitationStyle,
        enabledStageIds: DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map((s) => s.id),
        chaptered: true,
        chapters: [
          { id: "ch-1", title: "第一章 绪论" },
          { id: "ch-2", title: "第二章 相关工作与理论基础" },
          { id: "ch-3", title: "第三章 核心方法与模型设计" },
          { id: "ch-4", title: "第四章 实验验证与结果分析" },
          { id: "ch-5", title: "第五章 总结与展望" }
        ],
        sections: [
          { id: "abstract-zh", title: "中文摘要" },
          { id: "abstract-en", title: "Abstract" },
          {
            id: "sec-1-1",
            chapterId: "ch-1",
            title: "1.1 研究背景与意义"
          },
          {
            id: "sec-1-2",
            chapterId: "ch-1",
            title: "1.2 国内外研究现状"
          },
          {
            id: "sec-1-3",
            chapterId: "ch-1",
            title: "1.3 本文主要贡献与组织结构"
          },
          {
            id: "sec-2-1",
            chapterId: "ch-2",
            title: "2.1 基本概念与问题定义"
          },
          {
            id: "sec-2-2",
            chapterId: "ch-2",
            title: "2.2 代表性方法评述"
          },
          {
            id: "sec-3-1",
            chapterId: "ch-3",
            title: "3.1 总体框架设计"
          },
          {
            id: "sec-3-2",
            chapterId: "ch-3",
            title: "3.2 关键机制与理论分析"
          },
          {
            id: "sec-4-1",
            chapterId: "ch-4",
            title: "4.1 实验设置与评估指标"
          },
          {
            id: "sec-4-2",
            chapterId: "ch-4",
            title: "4.2 主实验与消融分析"
          },
          {
            id: "sec-5-1",
            chapterId: "ch-5",
            title: "5.1 全文工作总结"
          },
          {
            id: "sec-5-2",
            chapterId: "ch-5",
            title: "5.2 研究局限与未来展望"
          },
          ...referencesTail
        ]
      };
    case "proposal_grant":
      return {
        subtype,
        defaultCitationStyle,
        enabledStageIds: DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map((s) => s.id),
        chaptered: false,
        chapters: [],
        sections: [
          { id: "sec-rationale", title: "一、立项依据与研究现状" },
          {
            id: "sec-objectives",
            title: "二、研究内容、研究目标与关键科学问题"
          },
          { id: "sec-plan", title: "三、拟采取的研究方案及可行性分析" },
          { id: "sec-innovation", title: "四、本项目的特色与创新之处" },
          { id: "sec-schedule", title: "五、年度研究计划与预期研究成果" },
          ...referencesTail
        ]
      };
    case "tech_report_article":
      return {
        subtype,
        defaultCitationStyle,
        enabledStageIds: ["problem_and_gap", "argument_outline"],
        chaptered: false,
        chapters: [],
        sections: [
          { id: "sec-overview", title: "核心导读与问题背景" },
          { id: "sec-mechanism", title: "关键方法与原理拆解" },
          { id: "sec-evaluation", title: "实践验证与边界分析" },
          { id: "sec-takeaways", title: "总结与延伸思考" },
          ...referencesTail
        ]
      };
  }
}

export function createDefaultAcademicFrameworkStages(options?: {
  subtype?: AcademicBookSubtype | undefined;
  enabledStageIds?: ReadonlySet<string> | readonly string[] | undefined;
}): AcademicFrameworkStage[] {
  const fallbackIds = options?.subtype
    ? getAcademicSubtypePreset(options.subtype).enabledStageIds
    : DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map((stage) => stage.id);
  const requestedSet = new Set(options?.enabledStageIds ?? fallbackIds);
  const stages = DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map((stage) => ({
    ...stage,
    enabled: requestedSet.has(stage.id)
  }));
  if (!stages.some((stage) => stage.enabled)) {
    stages[0]!.enabled = true;
  }
  return stages;
}

export function enabledAcademicFrameworkStages(
  stages: readonly AcademicFrameworkStage[]
): AcademicFrameworkStage[] {
  return stages.filter((stage) => stage.enabled);
}

export const AcademicReferenceCardSchema = z
  .object({
    id: CatalogIdSchema,
    citeKey: AcademicCiteKeySchema,
    cardType: AcademicReferenceCardTypeSchema,
    title: CatalogTitleSchema,
    document: AcademicDocumentSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .superRefine((card, context) => {
    if (card.document.id !== createAcademicCardDocumentId(card.id)) {
      context.addIssue({
        code: "custom",
        path: ["document", "id"],
        message: "Academic reference card document id must match its card id."
      });
    }
    if (card.document.title !== card.title) {
      context.addIssue({
        code: "custom",
        path: ["document", "title"],
        message:
          "Academic reference card document title must match its card title."
      });
    }
  });
export type AcademicReferenceCard = z.infer<typeof AcademicReferenceCardSchema>;

export const AcademicReferenceCardManifestSchema = z
  .object({
    id: CatalogIdSchema,
    citeKey: AcademicCiteKeySchema,
    cardType: AcademicReferenceCardTypeSchema,
    title: CatalogTitleSchema,
    document: AcademicDocumentManifestSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict()
  .superRefine((card, context) => {
    if (card.document.id !== createAcademicCardDocumentId(card.id)) {
      context.addIssue({
        code: "custom",
        path: ["document", "id"],
        message: "Academic reference card file id must match its card id."
      });
    }
    if (card.document.title !== card.title) {
      context.addIssue({
        code: "custom",
        path: ["document", "title"],
        message: "Academic reference card file title must match its card title."
      });
    }
  });
export type AcademicReferenceCardManifest = z.infer<
  typeof AcademicReferenceCardManifestSchema
>;

export const CatalogIndexAcademicReferenceCardSchema = z
  .object({
    id: CatalogIdSchema,
    citeKey: AcademicCiteKeySchema,
    cardType: AcademicReferenceCardTypeSchema,
    title: CatalogTitleSchema,
    document: AcademicIndexDocumentSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type CatalogIndexAcademicReferenceCard = z.infer<
  typeof CatalogIndexAcademicReferenceCardSchema
>;

export const AcademicFoundationSchema = z.object({
  thesisOverview: AcademicDocumentSchema,
  terminology: AcademicDocumentSchema,
  cards: z.array(AcademicReferenceCardSchema).max(ACADEMIC_MAX_REFERENCE_CARDS)
});
export type AcademicFoundation = z.infer<typeof AcademicFoundationSchema>;

export const AcademicFoundationManifestSchema = z
  .object({
    thesisOverview: AcademicDocumentManifestSchema,
    terminology: AcademicDocumentManifestSchema,
    cards: z
      .array(AcademicReferenceCardManifestSchema)
      .max(ACADEMIC_MAX_REFERENCE_CARDS)
  })
  .strict();
export type AcademicFoundationManifest = z.infer<
  typeof AcademicFoundationManifestSchema
>;

export const CatalogIndexAcademicFoundationSchema = z
  .object({
    thesisOverview: AcademicIndexDocumentSchema,
    terminology: AcademicIndexDocumentSchema,
    cards: z
      .array(CatalogIndexAcademicReferenceCardSchema)
      .max(ACADEMIC_MAX_REFERENCE_CARDS)
  })
  .strict();

export const AcademicManuscriptChapterSchema = z
  .object({
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type AcademicManuscriptChapter = z.infer<
  typeof AcademicManuscriptChapterSchema
>;

const AcademicSectionIdSchema = z.string().trim().min(1).max(120);
const AcademicSectionTitleSchema = z.string().trim().min(1).max(240);

export const AcademicManuscriptSectionSchema = z
  .object({
    id: AcademicSectionIdSchema,
    chapterId: CatalogIdSchema.optional(),
    title: AcademicSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    brief: AcademicDocumentSchema,
    body: AcademicDocumentSchema,
    state: AcademicDocumentSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .superRefine((section, context) => {
    for (const kind of ACADEMIC_SECTION_FILE_KINDS) {
      if (
        section[kind].id !== createAcademicSectionDocumentId(section.id, kind)
      ) {
        context.addIssue({
          code: "custom",
          path: [kind, "id"],
          message: `Academic section ${kind} document id must match its canonical section id.`
        });
      }
    }
  });
export type AcademicManuscriptSection = z.infer<
  typeof AcademicManuscriptSectionSchema
>;

export const AcademicManuscriptSectionManifestSchema = z
  .object({
    id: AcademicSectionIdSchema,
    chapterId: CatalogIdSchema.optional(),
    title: AcademicSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    brief: AcademicDocumentManifestSchema,
    body: AcademicDocumentManifestSchema,
    state: AcademicDocumentManifestSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict()
  .superRefine((section, context) => {
    for (const kind of ACADEMIC_SECTION_FILE_KINDS) {
      if (
        section[kind].id !== createAcademicSectionDocumentId(section.id, kind)
      ) {
        context.addIssue({
          code: "custom",
          path: [kind, "id"],
          message: `Academic section ${kind} file id must match its canonical section id.`
        });
      }
    }
    const paths = [section.brief.path, section.body.path, section.state.path];
    if (!uniqueStrings(paths)) {
      context.addIssue({
        code: "custom",
        path: ["body", "path"],
        message:
          "Academic section brief, body, and state files must have distinct paths."
      });
    }
  });
export type AcademicManuscriptSectionManifest = z.infer<
  typeof AcademicManuscriptSectionManifestSchema
>;

export const CatalogIndexAcademicManuscriptSectionSchema = z
  .object({
    id: AcademicSectionIdSchema,
    chapterId: CatalogIdSchema.optional(),
    title: AcademicSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    brief: AcademicIndexDocumentSchema,
    body: AcademicIndexDocumentSchema,
    state: AcademicIndexDocumentSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type CatalogIndexAcademicManuscriptSection = z.infer<
  typeof CatalogIndexAcademicManuscriptSectionSchema
>;

export const AcademicManuscriptSchema = z.object({
  chapters: z.array(AcademicManuscriptChapterSchema).max(ACADEMIC_MAX_CHAPTERS),
  sections: z
    .array(AcademicManuscriptSectionSchema)
    .min(1)
    .max(ACADEMIC_MAX_SECTIONS)
});
export type AcademicManuscript = z.infer<typeof AcademicManuscriptSchema>;

export const AcademicManuscriptManifestSchema = z
  .object({
    chapters: z
      .array(AcademicManuscriptChapterSchema)
      .max(ACADEMIC_MAX_CHAPTERS),
    sections: z
      .array(AcademicManuscriptSectionManifestSchema)
      .min(1)
      .max(ACADEMIC_MAX_SECTIONS)
  })
  .strict();
export type AcademicManuscriptManifest = z.infer<
  typeof AcademicManuscriptManifestSchema
>;

export const CatalogIndexAcademicManuscriptSchema = z
  .object({
    chapters: z
      .array(AcademicManuscriptChapterSchema)
      .max(ACADEMIC_MAX_CHAPTERS),
    sections: z
      .array(CatalogIndexAcademicManuscriptSectionSchema)
      .min(1)
      .max(ACADEMIC_MAX_SECTIONS)
  })
  .strict();

export function validateAcademicBookState(
  book: {
    foundation: {
      thesisOverview: { id: string; title: string };
      terminology: { id: string; title: string };
      cards: ReadonlyArray<{
        id: string;
        citeKey: string;
        document: { id: string };
      }>;
    };
    frameworkStages: ReadonlyArray<{ id: string; title: string }>;
    documents: ReadonlyArray<{ id: string; title: string }>;
    manuscript: {
      chapters: ReadonlyArray<{ id: string; title: string }>;
      sections: ReadonlyArray<{
        id: string;
        chapterId?: string | undefined;
        brief: { id: string };
        body: { id: string };
        state: { id: string };
      }>;
    };
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  if (
    book.foundation.thesisOverview.id !== ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID
  ) {
    context.addIssue({
      code: "custom",
      path: ["foundation", "thesisOverview", "id"],
      message: `Academic thesis overview document id must be ${ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID}.`
    });
  }
  if (book.foundation.terminology.id !== ACADEMIC_TERMINOLOGY_DOCUMENT_ID) {
    context.addIssue({
      code: "custom",
      path: ["foundation", "terminology", "id"],
      message: `Academic terminology document id must be ${ACADEMIC_TERMINOLOGY_DOCUMENT_ID}.`
    });
  }
  if (!uniqueStrings(book.foundation.cards.map((card) => card.id))) {
    context.addIssue({
      code: "custom",
      path: ["foundation", "cards"],
      message: "Academic reference cards cannot contain duplicate ids."
    });
  }
  const seenCiteKeys = new Set<string>();
  book.foundation.cards.forEach((card, index) => {
    const normalizedKey = card.citeKey.toLocaleLowerCase("en-US");
    if (seenCiteKeys.has(normalizedKey)) {
      context.addIssue({
        code: "custom",
        path: ["foundation", "cards", index, "citeKey"],
        message: `Duplicate academic reference card citeKey: ${card.citeKey}`
      });
    }
    seenCiteKeys.add(normalizedKey);
  });

  for (const [index, stage] of book.frameworkStages.entries()) {
    const doc = book.documents.find((candidate) => candidate.id === stage.id);
    if (!doc) {
      context.addIssue({
        code: "custom",
        path: ["frameworkStages", index, "id"],
        message: `Academic framework stage ${stage.id} must reference a book document.`
      });
    } else if (doc.title !== stage.title) {
      context.addIssue({
        code: "custom",
        path: ["frameworkStages", index, "title"],
        message: `Academic framework stage ${stage.id} title must match its document title.`
      });
    }
  }

  const chapterIds = new Set<string>();
  book.manuscript.chapters.forEach((chapter, index) => {
    if (chapterIds.has(chapter.id)) {
      context.addIssue({
        code: "custom",
        path: ["manuscript", "chapters", index, "id"],
        message: `Duplicate academic chapter id: ${chapter.id}`
      });
    }
    chapterIds.add(chapter.id);
  });

  const sectionIds = new Set<string>();
  book.manuscript.sections.forEach((section, index) => {
    if (sectionIds.has(section.id)) {
      context.addIssue({
        code: "custom",
        path: ["manuscript", "sections", index, "id"],
        message: `Duplicate academic section id: ${section.id}`
      });
    }
    sectionIds.add(section.id);
    if (section.chapterId !== undefined && !chapterIds.has(section.chapterId)) {
      context.addIssue({
        code: "custom",
        path: ["manuscript", "sections", index, "chapterId"],
        message: `Academic section ${section.id} references unknown chapter ${section.chapterId}.`
      });
    }
  });

  const allDocumentIds = [
    book.foundation.thesisOverview.id,
    book.foundation.terminology.id,
    ...book.foundation.cards.map((card) => card.document.id),
    ...book.documents.map((doc) => doc.id),
    ...book.manuscript.sections.flatMap((section) => [
      section.brief.id,
      section.body.id,
      section.state.id
    ])
  ];
  if (!uniqueStrings(allDocumentIds)) {
    context.addIssue({
      code: "custom",
      path: ["documents"],
      message: "Academic book files cannot contain duplicate document ids."
    });
  }
  if (allDocumentIds.length > MAX_CONTENT_ITEMS) {
    context.addIssue({
      code: "custom",
      path: ["documents"],
      message: `Academic book exceeds maximum content item limit (${MAX_CONTENT_ITEMS}).`
    });
  }
}

export function validateAcademicBookManifestFiles(
  manifest: {
    foundation: AcademicFoundationManifest;
    frameworkStages: ReadonlyArray<{ id: string; title: string }>;
    documents: ReadonlyArray<{ id: string; title: string; path: string }>;
    manuscript: AcademicManuscriptManifest;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  validateAcademicBookState(manifest, context);
  const allPaths = [
    manifest.foundation.thesisOverview.path,
    manifest.foundation.terminology.path,
    ...manifest.foundation.cards.map((card) => card.document.path),
    ...manifest.documents.map((doc) => doc.path),
    ...manifest.manuscript.sections.flatMap((section) => [
      section.brief.path,
      section.body.path,
      section.state.path
    ])
  ];
  if (!uniqueStrings(allPaths)) {
    context.addIssue({
      code: "custom",
      path: ["documents"],
      message: "Academic book files cannot contain duplicate paths."
    });
  }
}

export const CurrentAcademicBookSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  bookType: z.literal("academic"),
  subtype: AcademicBookSubtypeSchema,
  citationStyle: AcademicCitationStyleSchema,
  status: z.enum(["editing", "completed"]),
  linkedMaterialIds: UniqueCatalogIdListSchema,
  linkedSkillIds: UniqueCatalogIdListSchema,
  foundation: AcademicFoundationSchema,
  frameworkStages: AcademicFrameworkStagesSchema,
  documents: z.array(AcademicDocumentSchema).max(MAX_CONTENT_ITEMS),
  manuscript: AcademicManuscriptSchema,
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const AcademicBookSchema = CurrentAcademicBookSchema.superRefine(
  validateAcademicBookState
);
export type AcademicBook = z.infer<typeof AcademicBookSchema>;

export const CurrentAcademicBookProjectManifestObjectSchema = z
  .object({
    schemaVersion: z.literal(4),
    revision: z.number().int().nonnegative(),
    writeReceipts: z
      .array(
        z.object({
          id: CatalogIdSchema,
          path: z.string().regex(/^receipts\/[a-z0-9_-]+\.md$/iu)
        })
      )
      .max(100_000)
      .optional(),
    kind: z.literal("deepwrite.book"),
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    bookType: z.literal("academic"),
    subtype: AcademicBookSubtypeSchema,
    citationStyle: AcademicCitationStyleSchema,
    status: z.enum(["editing", "completed"]),
    linkedMaterialIds: UniqueCatalogIdListSchema,
    linkedSkillIds: UniqueCatalogIdListSchema,
    foundation: AcademicFoundationManifestSchema,
    frameworkStages: AcademicFrameworkStagesSchema,
    documents: z.array(AcademicDocumentManifestSchema).max(MAX_CONTENT_ITEMS),
    manuscript: AcademicManuscriptManifestSchema
  })
  .strict();

export const CurrentAcademicBookProjectManifestSchema =
  CurrentAcademicBookProjectManifestObjectSchema.superRefine(
    validateAcademicBookManifestFiles
  );
export type CurrentAcademicBookProjectManifest = z.infer<
  typeof CurrentAcademicBookProjectManifestSchema
>;

export const CatalogIndexAcademicBookSchema = CurrentAcademicBookSchema.extend({
  foundation: CatalogIndexAcademicFoundationSchema,
  documents: z.array(AcademicIndexDocumentSchema),
  manuscript: CatalogIndexAcademicManuscriptSchema
}).strict();
export type CatalogIndexAcademicBook = z.infer<
  typeof CatalogIndexAcademicBookSchema
>;

export const CreateAcademicBookInputSchema = z.object({
  title: CatalogTitleSchema,
  subtype: AcademicBookSubtypeSchema,
  citationStyle: AcademicCitationStyleSchema.optional(),
  defaultFrameworkStageIds: z
    .array(AcademicFrameworkStageIdSchema)
    .min(1)
    .max(ACADEMIC_FRAMEWORK_STAGE_MAX_COUNT)
    .refine(uniqueStrings, {
      message: "Default academic framework stage ids cannot contain duplicates."
    })
    .optional(),
  linkedMaterialIds: UniqueCatalogIdListSchema.optional(),
  linkedSkillIds: UniqueCatalogIdListSchema.optional()
});
export type CreateAcademicBookInput = z.infer<
  typeof CreateAcademicBookInputSchema
>;

export const CreateAcademicBookAtPathInputSchema = z.object({
  parentDirectory: z.string().trim().min(1),
  input: CreateAcademicBookInputSchema
});
export type CreateAcademicBookAtPathInput = z.infer<
  typeof CreateAcademicBookAtPathInputSchema
>;

export const AcademicFrameworkMutationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("create"),
      stageId: AcademicFrameworkStageIdSchema.optional(),
      title: AcademicFrameworkStageSchema.shape.title,
      description: AcademicFrameworkStageSchema.shape.description
    })
    .strict(),
  z
    .object({
      type: z.literal("update"),
      stageId: AcademicFrameworkStageIdSchema,
      title: AcademicFrameworkStageSchema.shape.title,
      description: AcademicFrameworkStageSchema.shape.description
    })
    .strict(),
  z
    .object({
      type: z.literal("move"),
      stageId: AcademicFrameworkStageIdSchema,
      direction: z.enum(["up", "down"])
    })
    .strict(),
  z
    .object({
      type: z.literal("setEnabled"),
      stageId: AcademicFrameworkStageIdSchema,
      enabled: z.boolean()
    })
    .strict(),
  z
    .object({
      type: z.literal("delete"),
      stageId: AcademicFrameworkStageIdSchema
    })
    .strict()
]);
export type AcademicFrameworkMutation = z.infer<
  typeof AcademicFrameworkMutationSchema
>;

export const MutateAcademicFrameworkInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional(),
    mutation: AcademicFrameworkMutationSchema
  })
  .strict();
export type MutateAcademicFrameworkInput = z.infer<
  typeof MutateAcademicFrameworkInputSchema
>;

export const CreateAcademicReferenceCardInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    cardId: CatalogIdSchema.optional(),
    citeKey: AcademicCiteKeySchema,
    cardType: AcademicReferenceCardTypeSchema,
    title: CatalogTitleSchema,
    content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS).optional(),
    versionOrigin: DocumentVersionOriginSchema.optional(),
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional()
  })
  .strict();
export type CreateAcademicReferenceCardInput = z.infer<
  typeof CreateAcademicReferenceCardInputSchema
>;

export const CreateAcademicReferenceCardResultSchema = z
  .object({
    book: AcademicBookSchema,
    card: AcademicReferenceCardSchema
  })
  .strict();
export type CreateAcademicReferenceCardResult = z.infer<
  typeof CreateAcademicReferenceCardResultSchema
>;

export const UpdateAcademicReferenceCardInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    cardId: CatalogIdSchema,
    citeKey: AcademicCiteKeySchema.optional(),
    cardType: AcademicReferenceCardTypeSchema.optional(),
    title: CatalogTitleSchema.optional(),
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional()
  })
  .strict()
  .refine(
    (input) =>
      input.citeKey !== undefined ||
      input.cardType !== undefined ||
      input.title !== undefined,
    {
      message:
        "Academic reference card update must include at least one changed field."
    }
  );
export type UpdateAcademicReferenceCardInput = z.infer<
  typeof UpdateAcademicReferenceCardInputSchema
>;

export const UpdateAcademicReferenceCardResultSchema = z
  .object({
    book: AcademicBookSchema,
    card: AcademicReferenceCardSchema
  })
  .strict();
export type UpdateAcademicReferenceCardResult = z.infer<
  typeof UpdateAcademicReferenceCardResultSchema
>;

export const DeleteAcademicReferenceCardInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    cardId: CatalogIdSchema,
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional()
  })
  .strict();
export type DeleteAcademicReferenceCardInput = z.infer<
  typeof DeleteAcademicReferenceCardInputSchema
>;

export const DeleteAcademicReferenceCardResultSchema = z
  .object({
    book: AcademicBookSchema,
    cardId: CatalogIdSchema,
    deleted: z.boolean()
  })
  .strict();
export type DeleteAcademicReferenceCardResult = z.infer<
  typeof DeleteAcademicReferenceCardResultSchema
>;

export const AcademicManuscriptMutationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("create-chapter"),
      chapterId: CatalogIdSchema.optional(),
      afterChapterId: CatalogIdSchema.optional(),
      title: CatalogTitleSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("rename-chapter"),
      chapterId: CatalogIdSchema,
      title: CatalogTitleSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("move-chapter"),
      chapterId: CatalogIdSchema,
      direction: z.enum(["up", "down"])
    })
    .strict(),
  z
    .object({
      type: z.literal("delete-chapter"),
      chapterId: CatalogIdSchema,
      sectionAction: z.enum(["unassign", "reject"]).optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("create-section"),
      sectionId: AcademicSectionIdSchema.optional(),
      chapterId: CatalogIdSchema.nullable().optional(),
      afterSectionId: AcademicSectionIdSchema.optional(),
      title: AcademicSectionTitleSchema.optional(),
      wordCountRequirement: z.string().max(1_000).optional(),
      briefContent: z
        .string()
        .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        .optional(),
      bodyContent: z
        .string()
        .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        .optional(),
      stateContent: z
        .string()
        .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        .optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("move-section"),
      sectionId: AcademicSectionIdSchema,
      direction: z.enum(["up", "down"]).optional(),
      chapterId: CatalogIdSchema.nullable().optional(),
      afterSectionId: AcademicSectionIdSchema.nullable().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("update-section-meta"),
      sectionId: AcademicSectionIdSchema,
      title: AcademicSectionTitleSchema.optional(),
      wordCountRequirement: z.string().max(1_000).optional(),
      chapterId: CatalogIdSchema.nullable().optional()
    })
    .strict()
    .refine(
      (mutation) =>
        mutation.title !== undefined ||
        mutation.wordCountRequirement !== undefined ||
        mutation.chapterId !== undefined,
      {
        message: "Section metadata update must specify at least one field."
      }
    ),
  z
    .object({
      type: z.literal("delete-section"),
      sectionId: AcademicSectionIdSchema
    })
    .strict()
]);
export type AcademicManuscriptMutation = z.infer<
  typeof AcademicManuscriptMutationSchema
>;

export const MutateAcademicManuscriptInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional(),
    versionOrigin: DocumentVersionOriginSchema.optional(),
    mutation: AcademicManuscriptMutationSchema
  })
  .strict();
export type MutateAcademicManuscriptInput = z.infer<
  typeof MutateAcademicManuscriptInputSchema
>;

export const MutateAcademicManuscriptResultSchema = z
  .object({
    book: AcademicBookSchema,
    chapterId: CatalogIdSchema.optional(),
    sectionId: AcademicSectionIdSchema.optional()
  })
  .strict();
export type MutateAcademicManuscriptResult = z.infer<
  typeof MutateAcademicManuscriptResultSchema
>;
