import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema,
  MarketplaceSourceSchema
} from "./marketplace";
import {
  DraftSectionIdSchema,
  DraftSectionTitleSchema,
  createDefaultExpertDraft,
  createDefaultScriptDraft,
  parseExpertDraftMarkdown,
  type ExpertDraft
} from "./expert-draft";
import {
  CatalogReadWritingContextCommandEnvelopeSchema,
  CatalogWriteWritingContextCommandEnvelopeSchema
} from "./writing-context";

const CatalogIdSchema = z.string().trim().min(1).max(512);
const CatalogTitleSchema = z.string().trim().min(1).max(256);
const TimestampSchema = z.string().datetime();

export const CATALOG_PROJECT_MANIFEST_FILENAME = "deepwrite.json" as const;
export const CATALOG_PROJECT_MAX_CONTENT_ITEMS = 4_096;
export const CATALOG_DRAFT_DIRECTORY_ID = "draft" as const;

export const CATALOG_PROJECT_DOMAINS = ["book", "material", "skill"] as const;
export const CatalogProjectDomainSchema = z.enum(CATALOG_PROJECT_DOMAINS);
export type CatalogProjectDomain = z.infer<typeof CatalogProjectDomainSchema>;

export const CatalogLibraryProjectDomainSchema = z.enum(["material", "skill"]);
export type CatalogLibraryProjectDomain = z.infer<
  typeof CatalogLibraryProjectDomainSchema
>;
/** Recommended length for library entries; save is not blocked above this. */
export const CATALOG_LIBRARY_ENTRY_MAX_CHARACTERS = 40_000;
/** Recommended length for library overviews; save is not blocked above this. */
export const CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS = 40_000;

export const CATALOG_PROJECT_KINDS = [
  "deepwrite.book",
  "deepwrite.material-library",
  "deepwrite.skill-library",
  "deepwrite.material-group",
  "deepwrite.skill-group"
] as const;
export const CatalogProjectKindSchema = z.enum(CATALOG_PROJECT_KINDS);
export type CatalogProjectKind = z.infer<typeof CatalogProjectKindSchema>;

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

export const CatalogProjectContentPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(isRelativeMarkdownPath, {
    message: "Catalog project content paths must be relative Markdown paths."
  });
export type CatalogProjectContentPath = z.infer<
  typeof CatalogProjectContentPathSchema
>;

function uniqueIds(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const UniqueIdListSchema = z.array(CatalogIdSchema).refine(uniqueIds, {
  message: "Catalog id lists cannot contain duplicates."
});

export const SHORT_BOOK_GENRES = [
  "世情",
  "追妻",
  "科幻",
  "悬疑",
  "其他"
] as const;
export const ShortBookGenreSchema = z.enum(SHORT_BOOK_GENRES);
export type ShortBookGenre = z.infer<typeof ShortBookGenreSchema>;

/** Kept separate so script genres can evolve without changing short books. */
export const SCRIPT_BOOK_GENRES = [...SHORT_BOOK_GENRES] as const;
export const ScriptBookGenreSchema = z.enum(SCRIPT_BOOK_GENRES);
export type ScriptBookGenre = z.infer<typeof ScriptBookGenreSchema>;

export const CREATIVE_PLOT_STAGE_MAX_COUNT = 32;
export const CreativePlotStageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    "Plot stage ids may contain only letters, numbers, dots, underscores, colons, and hyphens."
  )
  .refine((value) => value !== "character_design" && value !== "draft", {
    message: "Plot stage ids cannot use reserved workspace stage ids."
  });
export type CreativePlotStageId = z.infer<typeof CreativePlotStageIdSchema>;

export const CreativePlotStageSchema = z
  .object({
    id: CreativePlotStageIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(20_000)
  })
  .strict();
export type CreativePlotStage = z.infer<typeof CreativePlotStageSchema>;

function refineUniqueCreativePlotStages(
  stages: ReadonlyArray<{ id: string; title: string }>,
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = new Set<string>();
  const titles = new Set<string>();
  stages.forEach((stage, index) => {
    if (ids.has(stage.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate plot stage id: ${stage.id}`
      });
    }
    ids.add(stage.id);
    const normalizedTitle = stage.title.toLocaleLowerCase();
    if (titles.has(normalizedTitle)) {
      context.addIssue({
        code: "custom",
        path: [index, "title"],
        message: `Duplicate plot stage title: ${stage.title}`
      });
    }
    titles.add(normalizedTitle);
  });
}

export const CreativePlotStagesSchema = z
  .array(CreativePlotStageSchema)
  .min(1)
  .max(CREATIVE_PLOT_STAGE_MAX_COUNT)
  .superRefine(refineUniqueCreativePlotStages);

/** Per-book binding: definition is global; order + enabled are book-local. */
export const BookPlotStageSchema = z
  .object({
    id: CreativePlotStageIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(20_000),
    enabled: z.boolean()
  })
  .strict();
export type BookPlotStage = z.infer<typeof BookPlotStageSchema>;

export const BookPlotStagesSchema = z
  .array(BookPlotStageSchema)
  .min(1)
  .max(CREATIVE_PLOT_STAGE_MAX_COUNT)
  .superRefine((stages, context) => {
    refineUniqueCreativePlotStages(stages, context);
    if (!stages.some((stage) => stage.enabled)) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "At least one plot stage must remain enabled."
      });
    }
  });

export const DEFAULT_CREATIVE_PLOT_STAGES = [
  {
    id: "worldbuilding",
    title: "世界观",
    description:
      "建立故事发生的世界背景、规则体系、地理时空、势力组织、科技或超自然设定，以及会影响人物选择与冲突推进的关键背景约束。只写服务于情节的设定，避免百科式堆砌；与已确认人物、剧情事实保持一致。"
  },
  {
    id: "plot_design",
    title: "剧情设计",
    description:
      "设计核心命题、人物目标、主要冲突、因果链、关键转折、真实时间线和结局兑现。每个重要情节点都要明确触发原因、人物选择、直接后果与后续压力，并区分故事真实时间线和读者看到的信息顺序。"
  },
  {
    id: "intro_design",
    title: "导语设计",
    description:
      "设计书名建议、开篇导语和前十秒钩子。导语必须与主线事实一致，建立人物处境、阅读期待与悬念，但不能替代完整剧情设计，也不能提前泄露尚不该公开的信息。"
  },
  {
    id: "plot_refine",
    title: "剧情细化",
    description:
      "把已确认剧情细化为可供正文直接执行的场景链、节拍、信息投放、人物选择、情绪推进、伏笔与回收。内容应具体到可写场景，同时保持因果、转折、人物状态与结局承诺一致，不直接写成小说正文。"
  },
  {
    id: "narrative_perspective",
    title: "叙事视角",
    description:
      "确定叙事人称、主要视角角色、时态、叙事距离与语言基调；明确读者和各人物在不同阶段的知识边界、可感知信息及视角切换规则，避免越过当前视角泄露未知事实。"
  },
  {
    id: "outline",
    title: "大纲",
    description:
      "把人物与全部剧情结构整理为可直接指导分节写作的完整大纲。保留已确认的人物、因果、时间线、关键情节和结局；列出全文定位、主线目标、核心冲突、正文小节总数与顺序，以及每节标题、字数、出场人物、场景、起始状态、详细剧情、关键选择、转折、信息投放、结尾钩子、人物状态变化和伏笔回收。发现冲突时应标明并采用最小改动方案。"
  }
] as const satisfies readonly CreativePlotStage[];

export const BUILTIN_CREATIVE_PLOT_STAGE_IDS = new Set<string>(
  DEFAULT_CREATIVE_PLOT_STAGES.map((stage) => stage.id)
);

/** Newly created short/script books enable only these three by default. */
export const DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS = new Set<string>([
  "plot_design",
  "intro_design",
  "plot_refine"
]);

export function isBuiltinCreativePlotStageId(stageId: string): boolean {
  return BUILTIN_CREATIVE_PLOT_STAGE_IDS.has(stageId);
}

export function createDefaultCreativePlotStages(): CreativePlotStage[] {
  return DEFAULT_CREATIVE_PLOT_STAGES.map((stage) => ({ ...stage }));
}

export function createDefaultBookPlotStages(options?: {
  /** Existing books migrate with every stage enabled. */
  allEnabled?: boolean;
  /** New books may override the built-in enabled-stage defaults. */
  enabledStageIds?: ReadonlySet<string> | readonly string[];
}): BookPlotStage[] {
  const allEnabled = options?.allEnabled === true;
  const enabledStageIds = new Set(
    options?.enabledStageIds ?? DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS
  );
  return DEFAULT_CREATIVE_PLOT_STAGES.map((stage) => ({
    ...stage,
    enabled: allEnabled || enabledStageIds.has(stage.id)
  }));
}

export function toCreativePlotStage(stage: BookPlotStage): CreativePlotStage {
  return {
    id: stage.id,
    title: stage.title,
    description: stage.description
  };
}

export function enabledCreativePlotStages(
  stages: readonly BookPlotStage[]
): CreativePlotStage[] {
  return stages.filter((stage) => stage.enabled).map(toCreativePlotStage);
}

export const MATERIAL_KINDS = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other"
] as const;
export const MaterialKindSchema = z.enum(MATERIAL_KINDS);
export type MaterialKind = z.infer<typeof MaterialKindSchema>;

export const MaterialLibraryKindSchema = z.enum([...MATERIAL_KINDS, "mixed"]);
export type MaterialLibraryKind = z.infer<typeof MaterialLibraryKindSchema>;

export const SKILL_KINDS = ["general", "plot", "style", "other"] as const;
export const SkillKindSchema = z.enum(SKILL_KINDS);
export type SkillKind = z.infer<typeof SkillKindSchema>;

export const LibraryTypeSchema = z.enum(["short", "long", "script"]);
export type LibraryType = z.infer<typeof LibraryTypeSchema>;

export const MATERIAL_STAGE_IDS = [
  "gimmick",
  "character",
  "pacing",
  "intro",
  "plot_refine",
  "draft_excerpt",
  "other"
] as const;
export const MaterialStageIdSchema = z.enum(MATERIAL_STAGE_IDS);
export type MaterialStageId = z.infer<typeof MaterialStageIdSchema>;

export const SKILL_STAGE_IDS = [
  "character_design",
  "plot_design",
  "outline",
  "draft",
  "expert_section_writer"
] as const;
export const SkillStageIdSchema = z.enum(SKILL_STAGE_IDS);
export type SkillStageId = z.infer<typeof SkillStageIdSchema>;

export const LinkedMaterialIdsByKindSchema = z.object({
  character: UniqueIdListSchema,
  gimmick: UniqueIdListSchema,
  plot: UniqueIdListSchema,
  draft: UniqueIdListSchema,
  other: UniqueIdListSchema
});
export type LinkedMaterialIdsByKind = z.infer<
  typeof LinkedMaterialIdsByKindSchema
>;

export const LinkedMaterialIdsByKindInputSchema = z.object({
  character: UniqueIdListSchema.optional(),
  gimmick: UniqueIdListSchema.optional(),
  plot: UniqueIdListSchema.optional(),
  draft: UniqueIdListSchema.optional(),
  other: UniqueIdListSchema.optional()
});
export type LinkedMaterialIdsByKindInput = z.infer<
  typeof LinkedMaterialIdsByKindInputSchema
>;

export const LinkedSkillIdsByKindSchema = z.object({
  general: UniqueIdListSchema,
  plot: UniqueIdListSchema,
  style: UniqueIdListSchema,
  other: UniqueIdListSchema
});
export type LinkedSkillIdsByKind = z.infer<typeof LinkedSkillIdsByKindSchema>;

export const LinkedSkillIdsByKindInputSchema = z.object({
  general: UniqueIdListSchema.optional(),
  plot: UniqueIdListSchema.optional(),
  style: UniqueIdListSchema.optional(),
  other: UniqueIdListSchema.optional()
});
export type LinkedSkillIdsByKindInput = z.infer<
  typeof LinkedSkillIdsByKindInputSchema
>;

export const CatalogDocumentSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  content: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type CatalogDocument = z.infer<typeof CatalogDocumentSchema>;

export const BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID = "character_design" as const;
export const BOOK_CHARACTER_OVERVIEW_TITLE = "概览" as const;
const LEGACY_BOOK_CHARACTER_OVERVIEW_TITLE = "人物概览" as const;

export const BookCharacterFormatSchema = z.enum(["text", "list"]);
export type BookCharacterFormat = z.infer<typeof BookCharacterFormatSchema>;

export const BookCharacterItemSchema = z
  .object({
    id: CatalogIdSchema.refine(
      (value) =>
        value !== BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID && value !== "draft",
      { message: "Character item ids cannot use reserved document ids." }
    ),
    title: CatalogTitleSchema,
    order: z.number().int().positive()
  })
  .strict();
export type BookCharacterItem = z.infer<typeof BookCharacterItemSchema>;

export const BookCharacterStructureSchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("text") }).strict(),
  z
    .object({
      format: z.literal("list"),
      items: z
        .array(BookCharacterItemSchema)
        .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
    })
    .strict()
    .superRefine((structure, context) => {
      if (!uniqueIds(structure.items.map(({ id }) => id))) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Character items cannot contain duplicate ids."
        });
      }
      if (!uniqueIds(structure.items.map(({ order }) => String(order)))) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Character items cannot contain duplicate order values."
        });
      }
      if (
        !uniqueIds(
          structure.items.map(({ title }) => title.toLocaleLowerCase())
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Character items cannot contain duplicate titles."
        });
      }
    })
]);
export type BookCharacterStructure = z.infer<
  typeof BookCharacterStructureSchema
>;

export function createDefaultBookCharacterStructure(): BookCharacterStructure {
  return { format: "text" };
}

export function catalogDraftBodyDocumentId(sectionId: string): string {
  return `draft-section:${sectionId}:body`;
}

export function catalogDraftCharacterStateDocumentId(
  sectionId: string
): string {
  return `draft-section:${sectionId}:character-state`;
}

const CATALOG_DRAFT_DOCUMENT_ID_PREFIX = "draft-section:";
const CATALOG_DRAFT_BODY_SUFFIX = ":body";
const CATALOG_DRAFT_CHARACTER_STATE_SUFFIX = ":character-state";

export type CatalogDraftFileKind = "body" | "character-state";

/**
 * Inverse of {@link catalogDraftBodyDocumentId} /
 * {@link catalogDraftCharacterStateDocumentId}. Prefers the longer
 * `:character-state` suffix so section ids that contain `:body` are not
 * mis-parsed.
 */
export function parseCatalogDraftDocumentId(
  documentId: string
): { sectionId: string; fileKind: CatalogDraftFileKind } | undefined {
  if (!documentId.startsWith(CATALOG_DRAFT_DOCUMENT_ID_PREFIX)) {
    return undefined;
  }
  if (documentId.endsWith(CATALOG_DRAFT_CHARACTER_STATE_SUFFIX)) {
    const sectionId = documentId.slice(
      CATALOG_DRAFT_DOCUMENT_ID_PREFIX.length,
      documentId.length - CATALOG_DRAFT_CHARACTER_STATE_SUFFIX.length
    );
    if (
      !sectionId ||
      catalogDraftCharacterStateDocumentId(sectionId) !== documentId
    ) {
      return undefined;
    }
    return { sectionId, fileKind: "character-state" };
  }
  if (documentId.endsWith(CATALOG_DRAFT_BODY_SUFFIX)) {
    const sectionId = documentId.slice(
      CATALOG_DRAFT_DOCUMENT_ID_PREFIX.length,
      documentId.length - CATALOG_DRAFT_BODY_SUFFIX.length
    );
    if (!sectionId || catalogDraftBodyDocumentId(sectionId) !== documentId) {
      return undefined;
    }
    return { sectionId, fileKind: "body" };
  }
  return undefined;
}

export const CatalogDraftSectionSchema = z
  .object({
    id: DraftSectionIdSchema,
    title: DraftSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    body: CatalogDocumentSchema,
    characterState: CatalogDocumentSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .superRefine((section, context) => {
    if (section.body.id !== catalogDraftBodyDocumentId(section.id)) {
      context.addIssue({
        code: "custom",
        path: ["body", "id"],
        message: "Draft body document id must match its canonical section id."
      });
    }
    if (
      section.characterState.id !==
      catalogDraftCharacterStateDocumentId(section.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "id"],
        message:
          "Draft character-state document id must match its canonical section id."
      });
    }
    if (section.body.id === section.characterState.id) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "id"],
        message:
          "Draft body and character-state documents must have distinct ids."
      });
    }
  });
export type CatalogDraftSection = z.infer<typeof CatalogDraftSectionSchema>;

const DraftSectionCreationOperationSchema = z
  .object({
    operationId: CatalogIdSchema,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    sections: z
      .array(
        z
          .object({
            clientSectionId: DraftSectionIdSchema,
            sectionId: DraftSectionIdSchema
          })
          .strict()
      )
      .min(1)
      .max(100),
    createdAt: TimestampSchema
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      !uniqueIds(
        operation.sections.map(({ clientSectionId }) => clientSectionId)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft creation client ids cannot contain duplicates."
      });
    }
    if (!uniqueIds(operation.sections.map(({ sectionId }) => sectionId))) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft creation section ids cannot contain duplicates."
      });
    }
  });

export const CatalogDraftDirectorySchema = z
  .object({
    id: z.literal(CATALOG_DRAFT_DIRECTORY_ID),
    title: CatalogTitleSchema,
    sections: z.array(CatalogDraftSectionSchema).min(1).max(100),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .superRefine((draft, context) => {
    const sectionIds = draft.sections.map((section) => section.id);
    if (!uniqueIds(sectionIds)) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft sections cannot contain duplicate ids."
      });
    }
    const documentIds = draft.sections.flatMap((section) => [
      section.body.id,
      section.characterState.id
    ]);
    if (!uniqueIds(documentIds)) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft files cannot contain duplicate document ids."
      });
    }
  });
export type CatalogDraftDirectory = z.infer<typeof CatalogDraftDirectorySchema>;

function catalogDraftDirectoryFromExpertDraft(
  draft: ExpertDraft,
  createdAt: string,
  updatedAt: string,
  title = "正文"
): CatalogDraftDirectory {
  return CatalogDraftDirectorySchema.parse({
    id: CATALOG_DRAFT_DIRECTORY_ID,
    title,
    sections: draft.sections.map((section) => ({
      id: section.id,
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      body: {
        id: catalogDraftBodyDocumentId(section.id),
        title: section.title,
        content: section.body,
        createdAt,
        updatedAt
      },
      characterState: {
        id: catalogDraftCharacterStateDocumentId(section.id),
        title: `${section.title} · 人物状态`,
        content: section.characterState,
        createdAt,
        updatedAt
      },
      createdAt,
      updatedAt
    })),
    createdAt,
    updatedAt
  });
}

export function createCatalogDraftDirectory(
  createdAt: string,
  updatedAt = createdAt
): CatalogDraftDirectory {
  return catalogDraftDirectoryFromExpertDraft(
    createDefaultExpertDraft(),
    createdAt,
    updatedAt
  );
}

export function createScriptCatalogDraftDirectory(
  createdAt: string,
  updatedAt = createdAt
): CatalogDraftDirectory {
  return catalogDraftDirectoryFromExpertDraft(
    createDefaultScriptDraft(),
    createdAt,
    updatedAt,
    "剧集"
  );
}

export function migrateCatalogDraftDocument(
  document: CatalogDocument | undefined,
  fallbackCreatedAt: string,
  fallbackUpdatedAt: string
): CatalogDraftDirectory {
  return catalogDraftDirectoryFromExpertDraft(
    parseExpertDraftMarkdown(document?.content ?? ""),
    document?.createdAt ?? fallbackCreatedAt,
    document?.updatedAt ?? fallbackUpdatedAt
  );
}

export const CurrentShortBookSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  bookType: z.literal("short"),
  genre: ShortBookGenreSchema,
  status: z.enum(["editing", "completed"]),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
  linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
  characterStructure: BookCharacterStructureSchema,
  plotStages: BookPlotStagesSchema,
  documents: z.array(CatalogDocumentSchema),
  draft: CatalogDraftDirectorySchema,
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
const LegacyShortBookSchema = CurrentShortBookSchema.omit({
  draft: true,
  plotStages: true,
  characterStructure: true
});
const V2ShortBookSchema = CurrentShortBookSchema.omit({
  plotStages: true,
  characterStructure: true
});

export const CurrentScriptBookSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  bookType: z.literal("script"),
  genre: ScriptBookGenreSchema,
  status: z.enum(["editing", "completed"]),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
  linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
  characterStructure: BookCharacterStructureSchema,
  plotStages: BookPlotStagesSchema,
  documents: z.array(CatalogDocumentSchema),
  draft: CatalogDraftDirectorySchema,
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
const V2ScriptBookSchema = CurrentScriptBookSchema.omit({
  plotStages: true,
  characterStructure: true
});

function migrateLegacyShortBook(value: unknown): unknown {
  const legacy = LegacyShortBookSchema.safeParse(value);
  if (
    !legacy.success ||
    (value && typeof value === "object" && "draft" in value)
  ) {
    return value;
  }
  const exactDraftIndex = legacy.data.documents.findIndex(
    (document) => document.id === CATALOG_DRAFT_DIRECTORY_ID
  );
  const draftIndex =
    exactDraftIndex >= 0
      ? exactDraftIndex
      : legacy.data.documents.findIndex(
          (document) => document.title === "正文编写"
        );
  const draftDocument =
    draftIndex >= 0 ? legacy.data.documents[draftIndex] : undefined;
  return {
    ...legacy.data,
    documents: legacy.data.documents.filter((_, index) => index !== draftIndex),
    draft: migrateCatalogDraftDocument(
      draftDocument,
      legacy.data.createdAt,
      legacy.data.updatedAt
    )
  };
}

function migrateMissingPlotStages(value: unknown): unknown {
  const parsed = z
    .union([V2ShortBookSchema, V2ScriptBookSchema])
    .safeParse(value);
  if (
    !parsed.success ||
    (value && typeof value === "object" && "plotStages" in value)
  ) {
    return value;
  }
  const documentIds = new Set(
    parsed.data.documents.map((document) => document.id)
  );
  const missingDocuments = DEFAULT_CREATIVE_PLOT_STAGES.filter(
    (stage) => !documentIds.has(stage.id)
  ).map((stage) => ({
    id: stage.id,
    title: stage.title,
    content: "",
    createdAt: parsed.data.createdAt,
    updatedAt: parsed.data.updatedAt
  }));
  return {
    ...parsed.data,
    // Existing books without plotStages migrate with every stage enabled.
    plotStages: createDefaultBookPlotStages({ allEnabled: true }),
    documents: [...parsed.data.documents, ...missingDocuments]
  };
}

function migrateBookPlotStageEnabled(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("plotStages" in value)) {
    return value;
  }
  const plotStages = (value as { plotStages?: unknown }).plotStages;
  if (!Array.isArray(plotStages) || plotStages.length === 0) {
    return value;
  }
  if (
    plotStages.every(
      (stage) =>
        stage &&
        typeof stage === "object" &&
        "enabled" in stage &&
        typeof (stage as { enabled?: unknown }).enabled === "boolean"
    )
  ) {
    return value;
  }
  return {
    ...(value as Record<string, unknown>),
    plotStages: plotStages.map((stage) => {
      if (!stage || typeof stage !== "object") {
        return stage;
      }
      const record = stage as Record<string, unknown>;
      return {
        ...record,
        enabled: typeof record.enabled === "boolean" ? record.enabled : true
      };
    })
  };
}

function migrateMissingCharacterStructure(value: unknown): unknown {
  if (!value || typeof value !== "object" || "characterStructure" in value) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const documents = Array.isArray(record.documents) ? record.documents : [];
  const hasOverview = documents.some(
    (document) =>
      document &&
      typeof document === "object" &&
      (document as { id?: unknown }).id === BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID
  );
  return {
    ...record,
    characterStructure: createDefaultBookCharacterStructure(),
    documents: hasOverview
      ? documents
      : [
          ...documents,
          {
            id: BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID,
            title: "人物设计",
            content: "",
            createdAt: record.createdAt,
            updatedAt: record.updatedAt
          }
        ]
  };
}

function migrateLegacyCharacterOverviewTitle(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const characterStructure = record.characterStructure;
  if (
    !characterStructure ||
    typeof characterStructure !== "object" ||
    (characterStructure as { format?: unknown }).format !== "list"
  ) {
    return value;
  }
  if (!Array.isArray(record.documents)) return value;
  let changed = false;
  const documents = record.documents.map((document) => {
    if (
      !document ||
      typeof document !== "object" ||
      (document as { id?: unknown }).id !==
        BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID ||
      (document as { title?: unknown }).title !==
        LEGACY_BOOK_CHARACTER_OVERVIEW_TITLE
    ) {
      return document;
    }
    changed = true;
    return {
      ...document,
      title: BOOK_CHARACTER_OVERVIEW_TITLE
    };
  });
  return changed ? { ...record, documents } : value;
}

function migrateBook(value: unknown): unknown {
  return migrateLegacyCharacterOverviewTitle(
    migrateMissingCharacterStructure(
      migrateBookPlotStageEnabled(
        migrateMissingPlotStages(migrateLegacyShortBook(value))
      )
    )
  );
}

function validateCharacterStructureDocuments(
  book: {
    characterStructure: BookCharacterStructure;
    documents: ReadonlyArray<{ id: string; title: string }>;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  const overview = book.documents.find(
    ({ id }) => id === BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID
  );
  if (!overview) {
    context.addIssue({
      code: "custom",
      path: ["characterStructure"],
      message:
        "Character structure must reference the character overview document."
    });
    return;
  }
  if (book.characterStructure.format !== "list") return;
  if (overview.title !== BOOK_CHARACTER_OVERVIEW_TITLE) {
    context.addIssue({
      code: "custom",
      path: ["documents"],
      message: "List character structure must use the fixed overview title."
    });
  }
  for (const [index, item] of book.characterStructure.items.entries()) {
    const document = book.documents.find(({ id }) => id === item.id);
    if (!document) {
      context.addIssue({
        code: "custom",
        path: ["characterStructure", "items", index, "id"],
        message: `Character item ${item.id} must reference a book document.`
      });
    } else if (document.title !== item.title) {
      context.addIssue({
        code: "custom",
        path: ["characterStructure", "items", index, "title"],
        message: `Character item ${item.id} title must match its document title.`
      });
    }
  }
}

function validatePlotStageDocuments(
  book: {
    plotStages: ReadonlyArray<{ id: string; title: string }>;
    documents: ReadonlyArray<{ id: string; title: string }>;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  for (const [index, stage] of book.plotStages.entries()) {
    const document = book.documents.find(
      (candidate) => candidate.id === stage.id
    );
    if (!document) {
      context.addIssue({
        code: "custom",
        path: ["plotStages", index, "id"],
        message: `Plot stage ${stage.id} must reference a book document.`
      });
    } else if (document.title !== stage.title) {
      context.addIssue({
        code: "custom",
        path: ["plotStages", index, "title"],
        message: `Plot stage ${stage.id} title must match its document title.`
      });
    }
  }
}

function validateUniqueBookDocumentIds(
  book: {
    documents: ReadonlyArray<{ id: string }>;
    draft: CatalogDraftDirectory;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  const documentIds = [
    ...book.documents.map((document) => document.id),
    ...book.draft.sections.flatMap((section) => [
      section.body.id,
      section.characterState.id
    ])
  ];
  if (!uniqueIds(documentIds)) {
    context.addIssue({
      code: "custom",
      path: ["documents"],
      message: "Book files cannot contain duplicate document ids."
    });
  }
}

export const ShortBookSchema = z
  .preprocess(migrateBook, CurrentShortBookSchema)
  .superRefine((book, context) => {
    validateUniqueBookDocumentIds(book, context);
    validateCharacterStructureDocuments(book, context);
    validatePlotStageDocuments(book, context);
  });
export type ShortBook = z.infer<typeof ShortBookSchema>;

export const ScriptBookSchema = z
  .preprocess((value) => migrateBook(value), CurrentScriptBookSchema)
  .superRefine((book, context) => {
    validateUniqueBookDocumentIds(book, context);
    validateCharacterStructureDocuments(book, context);
    validatePlotStageDocuments(book, context);
  });
export type ScriptBook = z.infer<typeof ScriptBookSchema>;

export const CurrentBookSchema = z.discriminatedUnion("bookType", [
  CurrentShortBookSchema,
  CurrentScriptBookSchema
]);

/** Current books are discriminated by `bookType`; legacy short books migrate first. */
export const BookSchema = z
  .preprocess(migrateBook, CurrentBookSchema)
  .superRefine((book, context) => {
    validateUniqueBookDocumentIds(book, context);
    validateCharacterStructureDocuments(book, context);
    validatePlotStageDocuments(book, context);
  });
export type Book = z.infer<typeof BookSchema>;

export const MaterialEntrySchema = z.object({
  id: CatalogIdSchema,
  stageId: MaterialStageIdSchema,
  title: CatalogTitleSchema,
  body: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type MaterialEntry = z.infer<typeof MaterialEntrySchema>;

export const MaterialLibrarySchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  materialType: LibraryTypeSchema,
  materialKind: MaterialLibraryKindSchema,
  parentGenre: z.string(),
  subGenre: z.string(),
  overview: z.string(),
  entries: z.array(MaterialEntrySchema),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type MaterialLibrary = z.infer<typeof MaterialLibrarySchema>;

export const MaterialLibraryGroupSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  members: z.object({
    character: CatalogIdSchema.optional(),
    gimmick: CatalogIdSchema.optional(),
    plot: CatalogIdSchema.optional(),
    draft: CatalogIdSchema.optional(),
    other: CatalogIdSchema.optional()
  }),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type MaterialLibraryGroup = z.infer<typeof MaterialLibraryGroupSchema>;

export const SkillEntrySchema = z.object({
  id: CatalogIdSchema,
  stageId: SkillStageIdSchema,
  title: CatalogTitleSchema,
  body: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  marketplaceSource: MarketplaceSourceSchema.optional(),
  sourceCommonSkillId: CatalogIdSchema.optional(),
  sourceSkillId: CatalogIdSchema.optional(),
  sourceSkillEntryId: CatalogIdSchema.optional()
});
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const SkillLibrarySchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  skillType: LibraryTypeSchema,
  skillKind: SkillKindSchema,
  overview: z.string(),
  isBuiltin: z.boolean(),
  marketplaceSource: MarketplaceSourceSchema.optional(),
  entries: z.array(SkillEntrySchema),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type SkillLibrary = z.infer<typeof SkillLibrarySchema>;

export const SkillLibraryGroupSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  members: z.object({
    general: CatalogIdSchema.optional(),
    plot: CatalogIdSchema.optional(),
    style: CatalogIdSchema.optional(),
    other: CatalogIdSchema.optional()
  }),
  marketplaceSource: MarketplaceSourceSchema.optional(),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type SkillLibraryGroup = z.infer<typeof SkillLibraryGroupSchema>;

export const BookProjectDocumentManifestSchema = z
  .object({
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    path: CatalogProjectContentPathSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type BookProjectDocumentManifest = z.infer<
  typeof BookProjectDocumentManifestSchema
>;

export const MaterialProjectEntryManifestSchema = z
  .object({
    id: CatalogIdSchema,
    stageId: MaterialStageIdSchema,
    title: CatalogTitleSchema,
    path: CatalogProjectContentPathSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type MaterialProjectEntryManifest = z.infer<
  typeof MaterialProjectEntryManifestSchema
>;

export const SkillProjectEntryManifestSchema = z
  .object({
    id: CatalogIdSchema,
    stageId: SkillStageIdSchema,
    title: CatalogTitleSchema,
    path: CatalogProjectContentPathSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    marketplaceSource: MarketplaceSourceSchema.optional(),
    sourceCommonSkillId: CatalogIdSchema.optional(),
    sourceSkillId: CatalogIdSchema.optional(),
    sourceSkillEntryId: CatalogIdSchema.optional()
  })
  .strict();
export type SkillProjectEntryManifest = z.infer<
  typeof SkillProjectEntryManifestSchema
>;

export const CatalogProjectManifestBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    kind: CatalogProjectKindSchema,
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

export const LegacyBookProjectManifestSchema =
  CatalogProjectManifestBaseSchema.extend({
    kind: z.literal("deepwrite.book"),
    bookType: z.literal("short"),
    genre: ShortBookGenreSchema,
    status: z.enum(["editing", "completed"]),
    linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
    linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
    documents: z
      .array(BookProjectDocumentManifestSchema)
      .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
  });
export type LegacyBookProjectManifest = z.infer<
  typeof LegacyBookProjectManifestSchema
>;

export const BookProjectDraftSectionManifestSchema = z
  .object({
    id: DraftSectionIdSchema,
    title: DraftSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    body: BookProjectDocumentManifestSchema,
    characterState: BookProjectDocumentManifestSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict()
  .superRefine((section, context) => {
    if (section.body.id !== catalogDraftBodyDocumentId(section.id)) {
      context.addIssue({
        code: "custom",
        path: ["body", "id"],
        message: "Draft body file id must match its canonical section id."
      });
    }
    if (
      section.characterState.id !==
      catalogDraftCharacterStateDocumentId(section.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "id"],
        message:
          "Draft character-state file id must match its canonical section id."
      });
    }
    if (section.body.id === section.characterState.id) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "id"],
        message: "Draft body and character-state files must have distinct ids."
      });
    }
    if (section.body.path === section.characterState.path) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "path"],
        message:
          "Draft body and character-state files must have distinct paths."
      });
    }
  });
export type BookProjectDraftSectionManifest = z.infer<
  typeof BookProjectDraftSectionManifestSchema
>;

export const BookProjectDraftDirectoryManifestSchema = z
  .object({
    id: z.literal(CATALOG_DRAFT_DIRECTORY_ID),
    title: CatalogTitleSchema,
    sections: z.array(BookProjectDraftSectionManifestSchema).min(1).max(100),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict()
  .superRefine((draft, context) => {
    if (!uniqueIds(draft.sections.map((section) => section.id))) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft sections cannot contain duplicate ids."
      });
    }
    const files = draft.sections.flatMap((section) => [
      section.body,
      section.characterState
    ]);
    if (!uniqueIds(files.map((file) => file.id))) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft files cannot contain duplicate document ids."
      });
    }
    if (!uniqueIds(files.map((file) => file.path))) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft files cannot contain duplicate paths."
      });
    }
  });
export type BookProjectDraftDirectoryManifest = z.infer<
  typeof BookProjectDraftDirectoryManifestSchema
>;

const V2BookProjectManifestSharedShape = {
  schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(),
  kind: z.literal("deepwrite.book"),
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  status: z.enum(["editing", "completed"]),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
  linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
  documents: z
    .array(BookProjectDocumentManifestSchema)
    .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS),
  draft: BookProjectDraftDirectoryManifestSchema,
  draftSectionCreationOperations: z
    .array(DraftSectionCreationOperationSchema)
    .max(256)
    .optional()
} as const;

const V2ShortBookProjectManifestObjectSchema = z
  .object({
    ...V2BookProjectManifestSharedShape,
    bookType: z.literal("short"),
    genre: ShortBookGenreSchema
  })
  .strict();

const V2ScriptBookProjectManifestObjectSchema = z
  .object({
    ...V2BookProjectManifestSharedShape,
    bookType: z.literal("script"),
    genre: ScriptBookGenreSchema
  })
  .strict();

export const V2BookProjectManifestSchema = z
  .discriminatedUnion("bookType", [
    V2ShortBookProjectManifestObjectSchema,
    V2ScriptBookProjectManifestObjectSchema
  ])
  .superRefine(validateUniqueBookManifestFiles);
export type V2BookProjectManifest = z.infer<typeof V2BookProjectManifestSchema>;

const V3BookProjectManifestSharedShape = {
  ...V2BookProjectManifestSharedShape,
  schemaVersion: z.literal(3),
  plotStages: BookPlotStagesSchema
} as const;

const V3ShortBookProjectManifestObjectSchema = z
  .object({
    ...V3BookProjectManifestSharedShape,
    bookType: z.literal("short"),
    genre: ShortBookGenreSchema
  })
  .strict();

const V3ScriptBookProjectManifestObjectSchema = z
  .object({
    ...V3BookProjectManifestSharedShape,
    bookType: z.literal("script"),
    genre: ScriptBookGenreSchema
  })
  .strict();

export const V3BookProjectManifestSchema = z
  .preprocess(
    migrateBookPlotStageEnabled,
    z.discriminatedUnion("bookType", [
      V3ShortBookProjectManifestObjectSchema,
      V3ScriptBookProjectManifestObjectSchema
    ])
  )
  .superRefine((manifest, context) => {
    validateUniqueBookManifestFiles(manifest, context);
    validatePlotStageManifestFiles(manifest, context);
  });
export type V3BookProjectManifest = z.infer<typeof V3BookProjectManifestSchema>;

const CurrentBookProjectManifestSharedShape = {
  ...V2BookProjectManifestSharedShape,
  schemaVersion: z.literal(4),
  characterStructure: BookCharacterStructureSchema,
  plotStages: BookPlotStagesSchema
} as const;

const CurrentShortBookProjectManifestObjectSchema = z
  .object({
    ...CurrentBookProjectManifestSharedShape,
    bookType: z.literal("short"),
    genre: ShortBookGenreSchema
  })
  .strict();

const ScriptBookProjectManifestObjectSchema = z
  .object({
    ...CurrentBookProjectManifestSharedShape,
    bookType: z.literal("script"),
    genre: ScriptBookGenreSchema
  })
  .strict();

function validateUniqueBookManifestFiles(
  manifest: {
    documents: ReadonlyArray<{ id: string; path: string }>;
    draft: BookProjectDraftDirectoryManifest;
    draftSectionCreationOperations?:
      ReadonlyArray<{ operationId: string }> | undefined;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  const files = [
    ...manifest.documents,
    ...manifest.draft.sections.flatMap((section) => [
      section.body,
      section.characterState
    ])
  ];
  if (!uniqueIds(files.map((file) => file.id))) {
    context.addIssue({
      code: "custom",
      path: ["documents"],
      message: "Book files cannot contain duplicate document ids."
    });
  }
  if (!uniqueIds(files.map((file) => file.path))) {
    context.addIssue({
      code: "custom",
      path: ["documents"],
      message: "Book files cannot contain duplicate paths."
    });
  }
  if (
    manifest.draftSectionCreationOperations &&
    !uniqueIds(
      manifest.draftSectionCreationOperations.map(
        ({ operationId }) => operationId
      )
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["draftSectionCreationOperations"],
      message: "Draft creation operation ids cannot contain duplicates."
    });
  }
}

function validatePlotStageManifestFiles(
  manifest: {
    plotStages: ReadonlyArray<{ id: string; title: string }>;
    documents: ReadonlyArray<{ id: string; title: string }>;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  validatePlotStageDocuments(manifest, context);
}

function validateCharacterStructureManifestFiles(
  manifest: {
    characterStructure: BookCharacterStructure;
    documents: ReadonlyArray<{ id: string; title: string }>;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  validateCharacterStructureDocuments(manifest, context);
}

function preprocessBookProjectManifestPlotStages(value: unknown): unknown {
  return migrateLegacyCharacterOverviewTitle(
    migrateBookPlotStageEnabled(value)
  );
}

export const CurrentShortBookProjectManifestSchema = z
  .preprocess(
    preprocessBookProjectManifestPlotStages,
    CurrentShortBookProjectManifestObjectSchema
  )
  .superRefine((manifest, context) => {
    validateUniqueBookManifestFiles(manifest, context);
    validateCharacterStructureManifestFiles(manifest, context);
    validatePlotStageManifestFiles(manifest, context);
  });
export type CurrentShortBookProjectManifest = z.infer<
  typeof CurrentShortBookProjectManifestSchema
>;

export const ScriptBookProjectManifestSchema = z
  .preprocess(
    preprocessBookProjectManifestPlotStages,
    ScriptBookProjectManifestObjectSchema
  )
  .superRefine((manifest, context) => {
    validateUniqueBookManifestFiles(manifest, context);
    validateCharacterStructureManifestFiles(manifest, context);
    validatePlotStageManifestFiles(manifest, context);
  });
export const CurrentScriptBookProjectManifestSchema =
  ScriptBookProjectManifestSchema;
export type ScriptBookProjectManifest = z.infer<
  typeof ScriptBookProjectManifestSchema
>;
export type CurrentScriptBookProjectManifest = ScriptBookProjectManifest;

export const CurrentBookProjectManifestSchema = z
  .preprocess(
    preprocessBookProjectManifestPlotStages,
    z.discriminatedUnion("bookType", [
      CurrentShortBookProjectManifestObjectSchema,
      ScriptBookProjectManifestObjectSchema
    ])
  )
  .superRefine((manifest, context) => {
    validateUniqueBookManifestFiles(manifest, context);
    validateCharacterStructureManifestFiles(manifest, context);
    validatePlotStageManifestFiles(manifest, context);
  });
export type CurrentBookProjectManifest = z.infer<
  typeof CurrentBookProjectManifestSchema
>;

export const BookProjectManifestSchema = z.union([
  CurrentBookProjectManifestSchema,
  V3BookProjectManifestSchema,
  V2BookProjectManifestSchema,
  LegacyBookProjectManifestSchema
]);
export type BookProjectManifest = z.infer<typeof BookProjectManifestSchema>;

export const MaterialLibraryProjectManifestSchema =
  CatalogProjectManifestBaseSchema.extend({
    kind: z.literal("deepwrite.material-library"),
    materialType: LibraryTypeSchema,
    materialKind: MaterialLibraryKindSchema,
    parentGenre: z.string(),
    subGenre: z.string(),
    overview: z.string(),
    entries: z
      .array(MaterialProjectEntryManifestSchema)
      .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
  });
export type MaterialLibraryProjectManifest = z.infer<
  typeof MaterialLibraryProjectManifestSchema
>;

export const SkillLibraryProjectManifestSchema =
  CatalogProjectManifestBaseSchema.extend({
    kind: z.literal("deepwrite.skill-library"),
    skillType: LibraryTypeSchema,
    skillKind: SkillKindSchema,
    overview: z.string(),
    isBuiltin: z.boolean(),
    marketplaceSource: MarketplaceSourceSchema.optional(),
    entries: z
      .array(SkillProjectEntryManifestSchema)
      .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
  });
export type SkillLibraryProjectManifest = z.infer<
  typeof SkillLibraryProjectManifestSchema
>;

export const MaterialGroupProjectManifestSchema =
  CatalogProjectManifestBaseSchema.extend({
    kind: z.literal("deepwrite.material-group"),
    members: z.object({
      character: CatalogIdSchema.optional(),
      gimmick: CatalogIdSchema.optional(),
      plot: CatalogIdSchema.optional(),
      draft: CatalogIdSchema.optional(),
      other: CatalogIdSchema.optional()
    })
  });
export type MaterialGroupProjectManifest = z.infer<
  typeof MaterialGroupProjectManifestSchema
>;

export const SkillGroupProjectManifestSchema =
  CatalogProjectManifestBaseSchema.extend({
    kind: z.literal("deepwrite.skill-group"),
    members: z.object({
      general: CatalogIdSchema.optional(),
      plot: CatalogIdSchema.optional(),
      style: CatalogIdSchema.optional(),
      other: CatalogIdSchema.optional()
    }),
    marketplaceSource: MarketplaceSourceSchema.optional()
  });
export type SkillGroupProjectManifest = z.infer<
  typeof SkillGroupProjectManifestSchema
>;

export const CatalogProjectManifestSchema = z.union([
  CurrentBookProjectManifestSchema,
  V3BookProjectManifestSchema,
  V2BookProjectManifestSchema,
  LegacyBookProjectManifestSchema,
  MaterialLibraryProjectManifestSchema,
  SkillLibraryProjectManifestSchema,
  MaterialGroupProjectManifestSchema,
  SkillGroupProjectManifestSchema
]);
export type CatalogProjectManifest = z.infer<
  typeof CatalogProjectManifestSchema
>;

export const CatalogLegacyImportSchema = z.object({
  sourceRoot: CatalogIdSchema,
  sourceRoots: z.array(CatalogIdSchema).min(1).optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: TimestampSchema,
  materials: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  materialGroups: z.number().int().nonnegative(),
  skillGroups: z.number().int().nonnegative()
});
export type CatalogLegacyImport = z.infer<typeof CatalogLegacyImportSchema>;

export const CatalogProjectDiagnosticSchema = z.object({
  projectId: CatalogIdSchema,
  kind: CatalogProjectKindSchema,
  code: z.enum(["unavailable", "invalid"]),
  message: z.string().trim().min(1)
});
export type CatalogProjectDiagnostic = z.infer<
  typeof CatalogProjectDiagnosticSchema
>;

export const CatalogDraftRecoveryEntrySchema = z.object({
  title: z.string(),
  content: z.string(),
  dirty: z.literal(true),
  recoveryUpdatedAt: TimestampSchema.optional(),
  baseRevision: z.string().min(1).optional(),
  baseProjectRevision: z.number().int().nonnegative().optional()
});
export type CatalogDraftRecoveryEntry = z.infer<
  typeof CatalogDraftRecoveryEntrySchema
>;
export const CatalogDraftRecoveryKeySchema = z.string().min(1).max(32_768);
export const CatalogDraftRecoverySchema = z.record(
  CatalogDraftRecoveryKeySchema,
  CatalogDraftRecoveryEntrySchema
);
export type CatalogDraftRecovery = z.infer<typeof CatalogDraftRecoverySchema>;
export const CatalogDraftRecoverySaveResultSchema = z.object({
  saved: z.literal(true)
});
export type CatalogDraftRecoverySaveResult = z.infer<
  typeof CatalogDraftRecoverySaveResultSchema
>;

function migrateCatalogSnapshotCreativePlotStages(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (
    Array.isArray(record.creativePlotStages) &&
    record.creativePlotStages.length > 0
  ) {
    return value;
  }
  const books = Array.isArray(record.books) ? record.books : [];
  const definitions = new Map<string, CreativePlotStage>();
  for (const stage of DEFAULT_CREATIVE_PLOT_STAGES) {
    definitions.set(stage.id, { ...stage });
  }
  for (const book of books) {
    if (!book || typeof book !== "object") continue;
    const plotStages = (book as { plotStages?: unknown }).plotStages;
    if (!Array.isArray(plotStages)) continue;
    for (const stage of plotStages) {
      if (!stage || typeof stage !== "object") continue;
      const candidate = stage as {
        id?: unknown;
        title?: unknown;
        description?: unknown;
      };
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.title !== "string" ||
        typeof candidate.description !== "string"
      ) {
        continue;
      }
      if (!definitions.has(candidate.id)) {
        definitions.set(candidate.id, {
          id: candidate.id,
          title: candidate.title,
          description: candidate.description
        });
      }
    }
  }
  return {
    ...record,
    creativePlotStages: [...definitions.values()]
  };
}

export const CatalogSnapshotSchema = z
  .preprocess(
    migrateCatalogSnapshotCreativePlotStages,
    z.object({
      schemaVersion: z.literal(1),
      revision: z.number().int().nonnegative(),
      creativePlotStages: CreativePlotStagesSchema,
      books: z.array(BookSchema),
      materials: z.array(MaterialLibrarySchema),
      materialGroups: z.array(MaterialLibraryGroupSchema),
      skills: z.array(SkillLibrarySchema),
      skillGroups: z.array(SkillLibraryGroupSchema),
      updatedAt: TimestampSchema,
      legacyImport: CatalogLegacyImportSchema.optional(),
      projectDiagnostics: z.array(CatalogProjectDiagnosticSchema).optional()
    })
  )
  .superRefine((snapshot, context) => {
    const collections: Array<[string, ReadonlyArray<{ id: string }>]> = [
      ["books", snapshot.books],
      ["materials", snapshot.materials],
      ["materialGroups", snapshot.materialGroups],
      ["skills", snapshot.skills],
      ["skillGroups", snapshot.skillGroups]
    ];
    for (const [name, values] of collections) {
      if (!uniqueIds(values.map(({ id }) => id))) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: `${name} cannot contain duplicate ids.`
        });
      }
    }
    const globalIds = new Set(
      snapshot.creativePlotStages.map((stage) => stage.id)
    );
    for (const [bookIndex, book] of snapshot.books.entries()) {
      if (!uniqueIds(book.documents.map(({ id }) => id))) {
        context.addIssue({
          code: "custom",
          path: ["books", bookIndex, "documents"],
          message: "Book documents cannot contain duplicate ids."
        });
      }
      for (const [stageIndex, stage] of book.plotStages.entries()) {
        if (!globalIds.has(stage.id)) {
          context.addIssue({
            code: "custom",
            path: ["books", bookIndex, "plotStages", stageIndex, "id"],
            message: `Book plot stage ${stage.id} must exist in creativePlotStages.`
          });
        }
      }
    }
  });
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;

const CatalogContentBytesSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const CatalogContentStampSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^(?:fs|manifest)-v1:/u);

/**
 * Catalog index documents deliberately omit Markdown text while retaining
 * enough metadata for the Renderer to distinguish unloaded content from a
 * genuinely empty file.
 */
export const CatalogIndexDocumentSchema = z
  .object({
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    content: z.literal(""),
    contentBytes: CatalogContentBytesSchema,
    contentStamp: CatalogContentStampSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type CatalogIndexDocument = z.infer<typeof CatalogIndexDocumentSchema>;

const CatalogIndexDraftSectionSchema = z
  .object({
    id: DraftSectionIdSchema,
    title: DraftSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    body: CatalogIndexDocumentSchema,
    characterState: CatalogIndexDocumentSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

const CatalogIndexDraftDirectorySchema = z
  .object({
    id: z.literal(CATALOG_DRAFT_DIRECTORY_ID),
    title: CatalogTitleSchema,
    sections: z.array(CatalogIndexDraftSectionSchema).min(1).max(100),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();

const CatalogIndexShortBookSchema = CurrentShortBookSchema.extend({
  documents: z.array(CatalogIndexDocumentSchema),
  draft: CatalogIndexDraftDirectorySchema
}).strict();

const CatalogIndexScriptBookSchema = CurrentScriptBookSchema.extend({
  documents: z.array(CatalogIndexDocumentSchema),
  draft: CatalogIndexDraftDirectorySchema
}).strict();

export const CatalogIndexBookSchema = z.discriminatedUnion("bookType", [
  CatalogIndexShortBookSchema,
  CatalogIndexScriptBookSchema
]);
export type CatalogIndexBook = z.infer<typeof CatalogIndexBookSchema>;

export const CatalogIndexMaterialEntrySchema = MaterialEntrySchema.extend({
  body: z.literal(""),
  contentBytes: CatalogContentBytesSchema,
  contentStamp: CatalogContentStampSchema
}).strict();

export const CatalogIndexMaterialLibrarySchema = MaterialLibrarySchema.extend({
  overview: z.literal(""),
  overviewContentBytes: CatalogContentBytesSchema,
  overviewContentStamp: CatalogContentStampSchema,
  entries: z.array(CatalogIndexMaterialEntrySchema)
}).strict();

export const CatalogIndexSkillEntrySchema = SkillEntrySchema.extend({
  body: z.literal(""),
  contentBytes: CatalogContentBytesSchema,
  contentStamp: CatalogContentStampSchema
}).strict();

export const CatalogIndexSkillLibrarySchema = SkillLibrarySchema.extend({
  overview: z.literal(""),
  overviewContentBytes: CatalogContentBytesSchema,
  overviewContentStamp: CatalogContentStampSchema,
  entries: z.array(CatalogIndexSkillEntrySchema)
}).strict();

const CatalogIndexSnapshotObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    creativePlotStages: CreativePlotStagesSchema,
    books: z.array(CatalogIndexBookSchema),
    materials: z.array(CatalogIndexMaterialLibrarySchema),
    materialGroups: z.array(MaterialLibraryGroupSchema),
    skills: z.array(CatalogIndexSkillLibrarySchema),
    skillGroups: z.array(SkillLibraryGroupSchema),
    updatedAt: TimestampSchema,
    legacyImport: CatalogLegacyImportSchema.optional(),
    projectDiagnostics: z.array(CatalogProjectDiagnosticSchema).optional()
  })
  .strict();

/**
 * A metadata-only structural projection of CatalogSnapshot. All Markdown and
 * library overview text is fixed to an empty string; byte counts describe the
 * source content without loading it.
 */
export const CatalogIndexSnapshotSchema =
  CatalogIndexSnapshotObjectSchema.superRefine((snapshot, context) => {
    const compatible = CatalogSnapshotSchema.safeParse(snapshot);
    if (!compatible.success) {
      context.addIssue({
        code: "custom",
        message:
          "Catalog index must remain structurally compatible with CatalogSnapshot."
      });
    }
  });
export type CatalogIndexSnapshot = z.infer<typeof CatalogIndexSnapshotSchema>;

export const CatalogReadDocumentInputSchema = z.discriminatedUnion("target", [
  z
    .object({
      projectId: CatalogIdSchema,
      target: z.literal("document"),
      documentId: CatalogIdSchema
    })
    .strict(),
  z
    .object({
      projectId: CatalogIdSchema,
      target: z.literal("overview")
    })
    .strict()
]);
export type CatalogReadDocumentInput = z.infer<
  typeof CatalogReadDocumentInputSchema
>;

const CatalogContentRevisionSchema = z.string().regex(/^v1:\d+:[0-9a-f]{8}$/u);

const CatalogReadDocumentResultSharedShape = {
  projectId: CatalogIdSchema,
  title: CatalogTitleSchema,
  content: z.string(),
  contentBytes: CatalogContentBytesSchema,
  revision: CatalogContentRevisionSchema,
  projectRevision: z.number().int().nonnegative(),
  updatedAt: TimestampSchema
} as const;

export const CatalogReadDocumentResultSchema = z.discriminatedUnion("target", [
  z
    .object({
      ...CatalogReadDocumentResultSharedShape,
      target: z.literal("document"),
      documentId: CatalogIdSchema
    })
    .strict(),
  z
    .object({
      ...CatalogReadDocumentResultSharedShape,
      target: z.literal("overview")
    })
    .strict()
]);
export type CatalogReadDocumentResult = z.infer<
  typeof CatalogReadDocumentResultSchema
>;

export const CreateShortBookInputSchema = z.object({
  title: CatalogTitleSchema,
  genre: ShortBookGenreSchema,
  defaultPlotStageIds: z
    .array(CreativePlotStageIdSchema)
    .min(1)
    .max(CREATIVE_PLOT_STAGE_MAX_COUNT)
    .optional(),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindInputSchema.optional(),
  linkedSkillIdsByKind: LinkedSkillIdsByKindInputSchema.optional()
});
export type CreateShortBookInput = z.infer<typeof CreateShortBookInputSchema>;

export const CreateScriptBookInputSchema = z.object({
  title: CatalogTitleSchema,
  genre: ScriptBookGenreSchema,
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindInputSchema.optional(),
  linkedSkillIdsByKind: LinkedSkillIdsByKindInputSchema.optional()
});
export type CreateScriptBookInput = z.infer<typeof CreateScriptBookInputSchema>;

export const CatalogOpenProjectInputSchema = z.object({
  domain: CatalogProjectDomainSchema
});
export type CatalogOpenProjectInput = z.infer<
  typeof CatalogOpenProjectInputSchema
>;

export const CreateShortBookAtPathInputSchema = z.object({
  parentDirectory: z.string().trim().min(1),
  input: CreateShortBookInputSchema
});
export type CreateShortBookAtPathInput = z.infer<
  typeof CreateShortBookAtPathInputSchema
>;

export const CreateScriptBookAtPathInputSchema = z.object({
  parentDirectory: z.string().trim().min(1),
  input: CreateScriptBookInputSchema
});
export type CreateScriptBookAtPathInput = z.infer<
  typeof CreateScriptBookAtPathInputSchema
>;

export const OpenCatalogProjectAtPathInputSchema = z.object({
  projectDirectory: z.string().trim().min(1),
  domain: CatalogProjectDomainSchema
});
export type OpenCatalogProjectAtPathInput = z.infer<
  typeof OpenCatalogProjectAtPathInputSchema
>;

export const CatalogOpenProjectResultSchema = z.object({
  domain: CatalogProjectDomainSchema,
  id: CatalogIdSchema,
  title: CatalogTitleSchema
});
export type CatalogOpenProjectResult = z.infer<
  typeof CatalogOpenProjectResultSchema
>;

export const ImportLegacyBookAtPathInputSchema = z.object({
  archivePath: z.string().trim().min(1),
  parentDirectory: z.string().trim().min(1)
});
export type ImportLegacyBookAtPathInput = z.infer<
  typeof ImportLegacyBookAtPathInputSchema
>;

export const ImportLegacyLibraryInputSchema = z.object({
  domain: CatalogLibraryProjectDomainSchema
});
export type ImportLegacyLibraryInput = z.infer<
  typeof ImportLegacyLibraryInputSchema
>;

export const ImportLegacyLibraryAtPathInputSchema =
  ImportLegacyLibraryInputSchema.extend({
    archivePath: z.string().trim().min(1),
    parentDirectory: z.string().trim().min(1)
  });
export type ImportLegacyLibraryAtPathInput = z.infer<
  typeof ImportLegacyLibraryAtPathInputSchema
>;

export const UpdateBookInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional(),
    title: CatalogTitleSchema.optional(),
    genre: ShortBookGenreSchema.optional(),
    status: z.enum(["editing", "completed"]).optional(),
    linkedMaterialIdsByKind: LinkedMaterialIdsByKindInputSchema.optional(),
    linkedSkillIdsByKind: LinkedSkillIdsByKindInputSchema.optional()
  })
  .refine(
    ({
      bookId: _bookId,
      baseProjectRevision: _baseProjectRevision,
      force: _force,
      ...patch
    }) => Object.values(patch).some((value) => value !== undefined),
    { message: "Book update must contain at least one changed field." }
  );
export type UpdateBookInput = z.infer<typeof UpdateBookInputSchema>;

export const PlotStructureMutationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("create"),
      stageId: CreativePlotStageIdSchema.optional(),
      title: CreativePlotStageSchema.shape.title,
      description: CreativePlotStageSchema.shape.description
    })
    .strict(),
  z
    .object({
      type: z.literal("update"),
      stageId: CreativePlotStageIdSchema,
      title: CreativePlotStageSchema.shape.title,
      description: CreativePlotStageSchema.shape.description
    })
    .strict(),
  z
    .object({
      type: z.literal("move"),
      stageId: CreativePlotStageIdSchema,
      direction: z.enum(["up", "down"])
    })
    .strict(),
  z
    .object({
      type: z.literal("setEnabled"),
      stageId: CreativePlotStageIdSchema,
      enabled: z.boolean()
    })
    .strict(),
  z
    .object({
      type: z.literal("delete"),
      stageId: CreativePlotStageIdSchema,
      /** Custom stages are hard-deleted globally; content is always removed. */
      deleteContent: z.boolean().optional()
    })
    .strict()
]);
export type PlotStructureMutation = z.infer<typeof PlotStructureMutationSchema>;

export const MutatePlotStructureInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    baseProjectRevision: z.number().int().nonnegative(),
    force: z.boolean().optional(),
    mutation: PlotStructureMutationSchema
  })
  .strict();
export type MutatePlotStructureInput = z.infer<
  typeof MutatePlotStructureInputSchema
>;

export const CharacterStructureMutationSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("setFormat"), format: BookCharacterFormatSchema })
    .strict(),
  z
    .object({
      type: z.literal("createItem"),
      title: CatalogTitleSchema,
      itemId: CatalogIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("updateItem"),
      itemId: CatalogIdSchema,
      title: CatalogTitleSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("moveItem"),
      itemId: CatalogIdSchema,
      direction: z.enum(["up", "down"])
    })
    .strict(),
  z.object({ type: z.literal("deleteItem"), itemId: CatalogIdSchema }).strict()
]);
export type CharacterStructureMutation = z.infer<
  typeof CharacterStructureMutationSchema
>;

export const MutateCharacterStructureInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    baseProjectRevision: z.number().int().nonnegative(),
    force: z.boolean().optional(),
    mutation: CharacterStructureMutationSchema
  })
  .strict();
export type MutateCharacterStructureInput = z.infer<
  typeof MutateCharacterStructureInputSchema
>;

export const DeleteBookInputSchema = z.object({
  bookId: CatalogIdSchema
});
export type DeleteBookInput = z.infer<typeof DeleteBookInputSchema>;

export const DeleteBookResultSchema = z.object({
  bookId: CatalogIdSchema,
  deleted: z.boolean()
});
export type DeleteBookResult = z.infer<typeof DeleteBookResultSchema>;

export const SaveDocumentInputSchema = z.object({
  bookId: CatalogIdSchema,
  documentId: CatalogIdSchema,
  title: CatalogTitleSchema.optional(),
  content: z.string(),
  preserveCurrentContent: z.boolean().optional(),
  baseRevision: z.string().min(1).optional(),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});
export type SaveDocumentInput = z.infer<typeof SaveDocumentInputSchema>;

/**
 * The saved document together with the authoritative revision committed by the
 * catalog store. Consumers must use this revision for subsequent writes rather
 * than deriving it from the requested base revision.
 */
export const SaveDocumentResultSchema = CatalogDocumentSchema.extend({
  projectRevision: z.number().int().nonnegative()
}).strict();
export type SaveDocumentResult = z.infer<typeof SaveDocumentResultSchema>;

export const CreateDraftSectionInputSchema = z.object({
  bookId: CatalogIdSchema,
  afterSectionId: DraftSectionIdSchema.optional(),
  title: DraftSectionTitleSchema.optional(),
  wordCountRequirement: z.string().max(1_000).optional(),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});
export type CreateDraftSectionInput = z.infer<
  typeof CreateDraftSectionInputSchema
>;

export const CreateDraftSectionsSectionInputSchema = z
  .object({
    clientSectionId: DraftSectionIdSchema,
    title: DraftSectionTitleSchema.optional(),
    wordCountRequirement: z.string().max(1_000).optional()
  })
  .strict();
export type CreateDraftSectionsSectionInput = z.infer<
  typeof CreateDraftSectionsSectionInputSchema
>;

export const CreateDraftSectionsInputSchema = z
  .object({
    operationId: CatalogIdSchema,
    bookId: CatalogIdSchema,
    afterSectionId: DraftSectionIdSchema.optional(),
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional(),
    sections: z.array(CreateDraftSectionsSectionInputSchema).min(1).max(100)
  })
  .strict()
  .superRefine((input, context) => {
    const clientSectionIds = input.sections.map(
      ({ clientSectionId }) => clientSectionId
    );
    if (!uniqueIds(clientSectionIds)) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft section client ids cannot contain duplicates."
      });
    }
  });
export type CreateDraftSectionsInput = z.infer<
  typeof CreateDraftSectionsInputSchema
>;

export const CreateDraftSectionsResultSchema = z
  .object({
    operationId: CatalogIdSchema,
    bookId: CatalogIdSchema,
    projectRevision: z.number().int().nonnegative(),
    sections: z
      .array(
        z
          .object({
            clientSectionId: DraftSectionIdSchema,
            section: CatalogDraftSectionSchema
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict()
  .superRefine((result, context) => {
    if (
      !uniqueIds(result.sections.map(({ clientSectionId }) => clientSectionId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft section result client ids cannot contain duplicates."
      });
    }
    if (!uniqueIds(result.sections.map(({ section }) => section.id))) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Draft section result ids cannot contain duplicates."
      });
    }
  });
export type CreateDraftSectionsResult = z.infer<
  typeof CreateDraftSectionsResultSchema
>;

export const DeleteDraftSectionInputSchema = z.object({
  bookId: CatalogIdSchema,
  sectionId: DraftSectionIdSchema,
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});
export type DeleteDraftSectionInput = z.infer<
  typeof DeleteDraftSectionInputSchema
>;

export const DeleteDraftSectionResultSchema = z.object({
  bookId: CatalogIdSchema,
  sectionId: DraftSectionIdSchema,
  deleted: z.boolean()
});
export type DeleteDraftSectionResult = z.infer<
  typeof DeleteDraftSectionResultSchema
>;

export const MoveDraftSectionInputSchema = z.object({
  bookId: CatalogIdSchema,
  sectionId: DraftSectionIdSchema,
  direction: z.enum(["up", "down"]),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});
export type MoveDraftSectionInput = z.infer<typeof MoveDraftSectionInputSchema>;

export const MoveDraftSectionResultSchema = z.object({
  bookId: CatalogIdSchema,
  sectionId: DraftSectionIdSchema,
  direction: z.enum(["up", "down"]),
  moved: z.boolean(),
  projectRevision: z.number().int().nonnegative()
});
export type MoveDraftSectionResult = z.infer<
  typeof MoveDraftSectionResultSchema
>;

export const CatalogLibrarySchema = z.union([
  MaterialLibrarySchema,
  SkillLibrarySchema
]);
export type CatalogLibrary = z.infer<typeof CatalogLibrarySchema>;

export const ImportLegacyLibraryResultSchema = z.object({
  imported: z.array(CatalogLibrarySchema),
  failures: z.array(
    z.object({
      fileName: z.string().trim().min(1),
      message: z.string().trim().min(1)
    })
  )
});
export type ImportLegacyLibraryResult = z.infer<
  typeof ImportLegacyLibraryResultSchema
>;

export const CatalogLibraryGroupSchema = z.union([
  MaterialLibraryGroupSchema,
  SkillLibraryGroupSchema
]);
export type CatalogLibraryGroup = z.infer<typeof CatalogLibraryGroupSchema>;

const CreateMaterialLibraryInputSchema = z.object({
  domain: z.literal("material"),
  name: CatalogTitleSchema,
  materialKind: MaterialKindSchema,
  libraryType: LibraryTypeSchema.optional()
});

const CreateSkillLibraryInputSchema = z.object({
  domain: z.literal("skill"),
  name: CatalogTitleSchema,
  skillKind: SkillKindSchema,
  libraryType: LibraryTypeSchema.optional()
});

export const CreateLibraryInputSchema = z.discriminatedUnion("domain", [
  CreateMaterialLibraryInputSchema,
  CreateSkillLibraryInputSchema
]);
export type CreateLibraryInput = z.infer<typeof CreateLibraryInputSchema>;

export const UpdateLibraryInputSchema = z
  .object({
    domain: CatalogLibraryProjectDomainSchema,
    libraryId: CatalogIdSchema,
    title: CatalogTitleSchema.optional(),
    overview: z.string().optional(),
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional()
  })
  .refine(
    (value) => value.title !== undefined || value.overview !== undefined,
    {
      message: "Library updates must include a title or overview."
    }
  );
export type UpdateLibraryInput = z.infer<typeof UpdateLibraryInputSchema>;

const LibraryParentDirectorySchema = z.string().trim().min(1);
export const CreateLibraryAtPathInputSchema = z.discriminatedUnion("domain", [
  CreateMaterialLibraryInputSchema.extend({
    parentDirectory: LibraryParentDirectorySchema
  }),
  CreateSkillLibraryInputSchema.extend({
    parentDirectory: LibraryParentDirectorySchema
  })
]);
export type CreateLibraryAtPathInput = z.infer<
  typeof CreateLibraryAtPathInputSchema
>;

const CreateMaterialLibraryGroupInputSchema = z.object({
  domain: z.literal("material"),
  name: CatalogTitleSchema,
  members: MaterialLibraryGroupSchema.shape.members
});

const CreateSkillLibraryGroupInputSchema = z.object({
  domain: z.literal("skill"),
  name: CatalogTitleSchema,
  members: SkillLibraryGroupSchema.shape.members
});

export const CreateLibraryGroupInputSchema = z.discriminatedUnion("domain", [
  CreateMaterialLibraryGroupInputSchema,
  CreateSkillLibraryGroupInputSchema
]);
export type CreateLibraryGroupInput = z.infer<
  typeof CreateLibraryGroupInputSchema
>;

const UpdateMaterialLibraryGroupInputSchema = z.object({
  domain: z.literal("material"),
  groupId: CatalogIdSchema,
  title: CatalogTitleSchema.optional(),
  members: MaterialLibraryGroupSchema.shape.members,
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});

const UpdateSkillLibraryGroupInputSchema = z.object({
  domain: z.literal("skill"),
  groupId: CatalogIdSchema,
  title: CatalogTitleSchema.optional(),
  members: SkillLibraryGroupSchema.shape.members,
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});

export const UpdateLibraryGroupInputSchema = z.discriminatedUnion("domain", [
  UpdateMaterialLibraryGroupInputSchema,
  UpdateSkillLibraryGroupInputSchema
]);
export type UpdateLibraryGroupInput = z.infer<
  typeof UpdateLibraryGroupInputSchema
>;

export const CreateLibraryGroupAtPathInputSchema = z.object({
  parentDirectory: z.string().trim().min(1),
  input: CreateLibraryGroupInputSchema
});
export type CreateLibraryGroupAtPathInput = z.infer<
  typeof CreateLibraryGroupAtPathInputSchema
>;

const CreateMaterialLibraryEntryInputSchema = z.object({
  domain: z.literal("material"),
  libraryId: CatalogIdSchema,
  title: CatalogTitleSchema,
  content: z.string(),
  stageId: MaterialStageIdSchema.optional(),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});

const CreateSkillLibraryEntryInputSchema = z.object({
  domain: z.literal("skill"),
  libraryId: CatalogIdSchema,
  title: CatalogTitleSchema,
  content: z.string(),
  stageId: SkillStageIdSchema.optional(),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});

export const CreateLibraryEntryInputSchema = z.discriminatedUnion("domain", [
  CreateMaterialLibraryEntryInputSchema,
  CreateSkillLibraryEntryInputSchema
]);
export type CreateLibraryEntryInput = z.infer<
  typeof CreateLibraryEntryInputSchema
>;

export const ExternalLibrarySourceKindSchema = z.enum(["directory", "file"]);
export type ExternalLibrarySourceKind = z.infer<
  typeof ExternalLibrarySourceKindSchema
>;

export const ExternalLibraryCandidateSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  sourceName: z.string().trim().min(1).max(512),
  content: z.string()
});
export type ExternalLibraryCandidate = z.infer<
  typeof ExternalLibraryCandidateSchema
>;

export const ExternalLibrarySelectionResultSchema = z.object({
  candidates: z
    .array(ExternalLibraryCandidateSchema)
    .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS),
  scanned: z.number().int().nonnegative(),
  skipped: z.object({
    unsupported: z.number().int().nonnegative(),
    unreadable: z.number().int().nonnegative(),
    empty: z.number().int().nonnegative(),
    tooLarge: z.number().int().nonnegative(),
    limitExceeded: z.number().int().nonnegative()
  })
});
export type ExternalLibrarySelectionResult = z.infer<
  typeof ExternalLibrarySelectionResultSchema
>;

export const ImportLibraryEntriesInputSchema = z.object({
  domain: CatalogLibraryProjectDomainSchema,
  libraryId: CatalogIdSchema,
  entries: z
    .array(ExternalLibraryCandidateSchema.pick({ title: true, content: true }))
    .min(1)
    .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS),
  baseProjectRevision: z.number().int().nonnegative()
});
export type ImportLibraryEntriesInput = z.infer<
  typeof ImportLibraryEntriesInputSchema
>;

export const RemoveLibraryEntryInputSchema = z.object({
  domain: CatalogLibraryProjectDomainSchema,
  libraryId: CatalogIdSchema,
  entryId: CatalogIdSchema,
  baseRevision: z.string().min(1).optional(),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});
export type RemoveLibraryEntryInput = z.infer<
  typeof RemoveLibraryEntryInputSchema
>;

export const RemoveLibraryEntryResultSchema = z.object({
  libraryId: CatalogIdSchema,
  entryId: CatalogIdSchema,
  deleted: z.boolean()
});
export type RemoveLibraryEntryResult = z.infer<
  typeof RemoveLibraryEntryResultSchema
>;

export const MoveLibraryEntryInputSchema = z.object({
  domain: CatalogLibraryProjectDomainSchema,
  sourceLibraryId: CatalogIdSchema,
  targetLibraryId: CatalogIdSchema,
  entryId: CatalogIdSchema,
  beforeEntryId: CatalogIdSchema.optional(),
  targetStageId: MaterialStageIdSchema.optional(),
  sourceBaseProjectRevision: z.number().int().nonnegative().optional(),
  targetBaseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});
export type MoveLibraryEntryInput = z.infer<typeof MoveLibraryEntryInputSchema>;

export const MoveLibraryEntryResultSchema = z.object({
  domain: CatalogLibraryProjectDomainSchema,
  sourceLibraryId: CatalogIdSchema,
  targetLibraryId: CatalogIdSchema,
  entryId: CatalogIdSchema
});
export type MoveLibraryEntryResult = z.infer<
  typeof MoveLibraryEntryResultSchema
>;

export const UnregisterCatalogProjectDomainSchema = z.enum([
  ...CATALOG_PROJECT_DOMAINS,
  "material-group",
  "skill-group"
]);
export type UnregisterCatalogProjectDomain = z.infer<
  typeof UnregisterCatalogProjectDomainSchema
>;

export const UnregisterCatalogProjectInputSchema = z.object({
  domain: UnregisterCatalogProjectDomainSchema,
  projectId: CatalogIdSchema
});
export type UnregisterCatalogProjectInput = z.infer<
  typeof UnregisterCatalogProjectInputSchema
>;

export const UnregisterCatalogProjectResultSchema = z.object({
  domain: UnregisterCatalogProjectDomainSchema,
  projectId: CatalogIdSchema,
  unregistered: z.boolean()
});
export type UnregisterCatalogProjectResult = z.infer<
  typeof UnregisterCatalogProjectResultSchema
>;

export const DeleteCatalogProjectInputSchema = z.object({
  domain: CatalogProjectDomainSchema,
  projectId: CatalogIdSchema
});
export type DeleteCatalogProjectInput = z.infer<
  typeof DeleteCatalogProjectInputSchema
>;

export const DeleteCatalogProjectResultSchema = z.object({
  domain: CatalogProjectDomainSchema,
  projectId: CatalogIdSchema,
  deleted: z.boolean()
});
export type DeleteCatalogProjectResult = z.infer<
  typeof DeleteCatalogProjectResultSchema
>;

export const DuplicateCatalogProjectDomainSchema = z.enum([
  "book",
  "material",
  "skill",
  "material-group",
  "skill-group"
]);
export type DuplicateCatalogProjectDomain = z.infer<
  typeof DuplicateCatalogProjectDomainSchema
>;

export const DuplicateCatalogProjectInputSchema = z.object({
  domain: DuplicateCatalogProjectDomainSchema,
  projectId: CatalogIdSchema
});
export type DuplicateCatalogProjectInput = z.infer<
  typeof DuplicateCatalogProjectInputSchema
>;

export const DuplicateCatalogProjectResultSchema = z.object({
  sourceProjectId: CatalogIdSchema,
  projectId: CatalogIdSchema,
  domain: DuplicateCatalogProjectDomainSchema,
  title: CatalogTitleSchema,
  copiedMemberLibraryIds: z.array(CatalogIdSchema)
});
export type DuplicateCatalogProjectResult = z.infer<
  typeof DuplicateCatalogProjectResultSchema
>;

export const SaveLibraryEntryInputSchema = z.object({
  domain: CatalogLibraryProjectDomainSchema,
  libraryId: CatalogIdSchema,
  entryId: CatalogIdSchema,
  title: CatalogTitleSchema.optional(),
  content: z.string(),
  baseRevision: z.string().min(1).optional(),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});
export type SaveLibraryEntryInput = z.infer<typeof SaveLibraryEntryInputSchema>;

export const CatalogLibraryEntrySchema = z.union([
  MaterialEntrySchema,
  SkillEntrySchema
]);
export type CatalogLibraryEntry = z.infer<typeof CatalogLibraryEntrySchema>;

export const ImportLibraryEntriesResultSchema = z.object({
  entries: z
    .array(CatalogLibraryEntrySchema)
    .min(1)
    .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
});
export type ImportLibraryEntriesResult = z.infer<
  typeof ImportLibraryEntriesResultSchema
>;

export const CatalogSnapshotCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.snapshot"),
  payload: z.object({})
});

export const CatalogIndexCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.index"),
  payload: z.object({}).strict()
});

export const CatalogReadDocumentCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.readDocument"),
    payload: CatalogReadDocumentInputSchema
  });

export const CatalogLoadDraftRecoveryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.loadDraftRecovery"),
    payload: z.object({})
  });

export const CatalogSaveDraftRecoveryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.saveDraftRecovery"),
    payload: z.object({ drafts: CatalogDraftRecoverySchema })
  });

export const CatalogCreateShortBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createShortBook"),
    payload: CreateShortBookInputSchema
  });

export const CatalogCreateScriptBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createScriptBook"),
    payload: CreateScriptBookInputSchema
  });

export const CatalogCreateLibraryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibrary"),
    payload: CreateLibraryInputSchema
  });

export const CatalogUpdateLibraryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.updateLibrary"),
    payload: UpdateLibraryInputSchema
  });

export const CatalogCreateLibraryGroupCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryGroup"),
    payload: CreateLibraryGroupInputSchema
  });

export const CatalogOpenProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.openProject"),
    payload: CatalogOpenProjectInputSchema
  });

export const CatalogImportLegacyBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyBook"),
    payload: z.object({})
  });

export const CatalogImportLegacyLibraryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyLibrary"),
    payload: ImportLegacyLibraryInputSchema
  });

export const CatalogCreateShortBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createShortBookAtPath"),
    payload: CreateShortBookAtPathInputSchema
  });

export const CatalogCreateScriptBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createScriptBookAtPath"),
    payload: CreateScriptBookAtPathInputSchema
  });

export const CatalogCreateLibraryAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryAtPath"),
    payload: CreateLibraryAtPathInputSchema
  });

export const CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryGroupAtPath"),
    payload: CreateLibraryGroupAtPathInputSchema
  });

export const CatalogOpenProjectAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.openProjectAtPath"),
    payload: OpenCatalogProjectAtPathInputSchema
  });

export const CatalogImportLegacyBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyBookAtPath"),
    payload: ImportLegacyBookAtPathInputSchema
  });

export const CatalogImportLegacyLibraryAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyLibraryAtPath"),
    payload: ImportLegacyLibraryAtPathInputSchema
  });

export const CatalogUpdateBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("catalog.updateBook"),
    payload: UpdateBookInputSchema
  }
);

export const CatalogMutatePlotStructureCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.mutatePlotStructure"),
    payload: MutatePlotStructureInputSchema
  });

export const CatalogMutateCharacterStructureCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.mutateCharacterStructure"),
    payload: MutateCharacterStructureInputSchema
  });

export const CatalogUpdateLibraryGroupCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.updateLibraryGroup"),
    payload: UpdateLibraryGroupInputSchema
  });

export const CatalogDeleteBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("catalog.deleteBook"),
    payload: DeleteBookInputSchema
  }
);

export const CatalogSaveDocumentCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.saveDocument"),
    payload: SaveDocumentInputSchema
  });

export const CatalogCreateDraftSectionCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createDraftSection"),
    payload: CreateDraftSectionInputSchema
  });

export const CatalogCreateDraftSectionsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createDraftSections"),
    payload: CreateDraftSectionsInputSchema
  });

export const CatalogDeleteDraftSectionCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.deleteDraftSection"),
    payload: DeleteDraftSectionInputSchema
  });

export const CatalogMoveDraftSectionCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.moveDraftSection"),
    payload: MoveDraftSectionInputSchema
  });

export const CatalogSaveLibraryEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.saveLibraryEntry"),
    payload: SaveLibraryEntryInputSchema
  });

export const CatalogCreateLibraryEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryEntry"),
    payload: CreateLibraryEntryInputSchema
  });

export const CatalogRemoveLibraryEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.removeLibraryEntry"),
    payload: RemoveLibraryEntryInputSchema
  });

export const CatalogMoveLibraryEntryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.moveLibraryEntry"),
    payload: MoveLibraryEntryInputSchema
  });

export const CatalogUnregisterProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.unregisterProject"),
    payload: UnregisterCatalogProjectInputSchema
  });

export const CatalogDeleteProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.deleteProject"),
    payload: DeleteCatalogProjectInputSchema
  });

export const CatalogDuplicateProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.duplicateProject"),
    payload: DuplicateCatalogProjectInputSchema
  });

export const CatalogChooseExternalLibraryEntriesCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.chooseExternalLibraryEntries"),
    payload: z.object({ sourceKind: ExternalLibrarySourceKindSchema })
  });

export const CatalogImportLibraryEntriesCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLibraryEntries"),
    payload: ImportLibraryEntriesInputSchema
  });

export const CatalogCommandEnvelopeSchema = z.discriminatedUnion("type", [
  CatalogIndexCommandEnvelopeSchema,
  CatalogReadDocumentCommandEnvelopeSchema,
  CatalogReadWritingContextCommandEnvelopeSchema,
  CatalogSnapshotCommandEnvelopeSchema,
  CatalogLoadDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDraftRecoveryCommandEnvelopeSchema,
  CatalogCreateShortBookCommandEnvelopeSchema,
  CatalogCreateScriptBookCommandEnvelopeSchema,
  CatalogCreateLibraryCommandEnvelopeSchema,
  CatalogUpdateLibraryCommandEnvelopeSchema,
  CatalogCreateLibraryGroupCommandEnvelopeSchema,
  CatalogOpenProjectCommandEnvelopeSchema,
  CatalogImportLegacyLibraryCommandEnvelopeSchema,
  CatalogCreateShortBookAtPathCommandEnvelopeSchema,
  CatalogCreateScriptBookAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema,
  CatalogOpenProjectAtPathCommandEnvelopeSchema,
  CatalogImportLegacyLibraryAtPathCommandEnvelopeSchema,
  CatalogUpdateBookCommandEnvelopeSchema,
  CatalogMutatePlotStructureCommandEnvelopeSchema,
  CatalogMutateCharacterStructureCommandEnvelopeSchema,
  CatalogUpdateLibraryGroupCommandEnvelopeSchema,
  CatalogDeleteBookCommandEnvelopeSchema,
  CatalogSaveDocumentCommandEnvelopeSchema,
  CatalogCreateDraftSectionCommandEnvelopeSchema,
  CatalogCreateDraftSectionsCommandEnvelopeSchema,
  CatalogDeleteDraftSectionCommandEnvelopeSchema,
  CatalogMoveDraftSectionCommandEnvelopeSchema,
  CatalogSaveLibraryEntryCommandEnvelopeSchema,
  CatalogCreateLibraryEntryCommandEnvelopeSchema,
  CatalogRemoveLibraryEntryCommandEnvelopeSchema,
  CatalogMoveLibraryEntryCommandEnvelopeSchema,
  CatalogUnregisterProjectCommandEnvelopeSchema,
  CatalogDeleteProjectCommandEnvelopeSchema,
  CatalogDuplicateProjectCommandEnvelopeSchema,
  CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema,
  CatalogChooseExternalLibraryEntriesCommandEnvelopeSchema,
  CatalogImportLibraryEntriesCommandEnvelopeSchema,
  CatalogWriteWritingContextCommandEnvelopeSchema
]);
export type CatalogCommandEnvelope = z.infer<
  typeof CatalogCommandEnvelopeSchema
>;
