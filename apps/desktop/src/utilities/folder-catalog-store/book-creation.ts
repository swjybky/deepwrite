import { mergeCreativePlotStageDefinitions } from "./plot-stage-definitions";
import {
  ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
  ACADEMIC_TERMINOLOGY_TITLE,
  ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
  ACADEMIC_THESIS_OVERVIEW_TITLE,
  AcademicBookSchema,
  createAcademicSectionDocumentId,
  createCatalogDraftDirectory,
  createDefaultAcademicFrameworkStages,
  createDefaultCreativePlotStages,
  DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS,
  getAcademicSubtypePreset,
  type AcademicBook,
  type BookPlotStage,
  createDefaultBookCharacterStructure,
  createDefaultBookPlotStages,
  createScriptCatalogDraftDirectory,
  ScriptBookSchema,
  ShortBookSchema,
  type CreateAcademicBookInput,
  type CreateScriptBookInput,
  type CreateShortBookInput,
  type ScriptBook,
  type ShortBook,
  type CreativePlotStage
} from "@deepwrite/contracts";
import { createCatalogId } from "@deepwrite/shared";
export const DEFAULT_SHORT_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["worldbuilding", "世界观"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["narrative_perspective", "叙事视角"],
  ["outline", "大纲"]
] as const;

export const DEFAULT_SCRIPT_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["worldbuilding", "世界观"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["narrative_perspective", "叙事视角"],
  ["outline", "大纲"]
] as const;

export function linkedMaterialIdsFromInput(
  value:
    | CreateShortBookInput["linkedMaterialIdsByKind"]
    | CreateScriptBookInput["linkedMaterialIdsByKind"]
): ShortBook["linkedMaterialIdsByKind"] {
  return {
    character: [...(value?.character ?? [])],
    gimmick: [...(value?.gimmick ?? [])],
    plot: [...(value?.plot ?? [])],
    draft: [...(value?.draft ?? [])],
    other: [...(value?.other ?? [])]
  };
}

export function linkedSkillIdsFromInput(
  value:
    | CreateShortBookInput["linkedSkillIdsByKind"]
    | CreateScriptBookInput["linkedSkillIdsByKind"]
): ShortBook["linkedSkillIdsByKind"] {
  return {
    general: [...(value?.general ?? [])],
    plot: [...(value?.plot ?? [])],
    style: [...(value?.style ?? [])],
    other: [...(value?.other ?? [])]
  };
}

export function createNewShortBook(
  input: CreateShortBookInput,
  now: string
): ShortBook {
  return ShortBookSchema.parse({
    id: createCatalogId("book"),
    title: input.title,
    bookType: "short",
    genre: input.genre,
    status: "editing",
    linkedMaterialIdsByKind: linkedMaterialIdsFromInput(
      input.linkedMaterialIdsByKind
    ),
    linkedSkillIdsByKind: linkedSkillIdsFromInput(input.linkedSkillIdsByKind),
    characterStructure:
      input.characterFormat === "list"
        ? { format: "list", items: [] }
        : createDefaultBookCharacterStructure(),
    plotStages: createDefaultBookPlotStages(),
    documents: DEFAULT_SHORT_DOCUMENTS.map(([id, title]) => ({
      id,
      title:
        id === "character_design" && input.characterFormat === "list"
          ? "概览"
          : title,
      content: "",
      createdAt: now,
      updatedAt: now
    })),
    draft: createCatalogDraftDirectory(now),
    createdAt: now,
    updatedAt: now
  });
}
export function createNewScriptBook(
  input: CreateScriptBookInput,
  now: string
): ScriptBook {
  return ScriptBookSchema.parse({
    id: createCatalogId("book"),
    title: input.title,
    bookType: "script",
    genre: input.genre,
    status: "editing",
    linkedMaterialIdsByKind: linkedMaterialIdsFromInput(
      input.linkedMaterialIdsByKind
    ),
    linkedSkillIdsByKind: linkedSkillIdsFromInput(input.linkedSkillIdsByKind),
    characterStructure:
      input.characterFormat === "list"
        ? { format: "list", items: [] }
        : createDefaultBookCharacterStructure(),
    plotStages: createDefaultBookPlotStages(),
    documents: DEFAULT_SCRIPT_DOCUMENTS.map(([id, title]) => ({
      id,
      title:
        id === "character_design" && input.characterFormat === "list"
          ? "概览"
          : title,
      content: "",
      createdAt: now,
      updatedAt: now
    })),
    draft: createScriptCatalogDraftDirectory(now),
    createdAt: now,
    updatedAt: now
  });
}
export function createInitialAcademicBook(
  input: CreateAcademicBookInput,
  now: string
): AcademicBook {
  const preset = getAcademicSubtypePreset(input.subtype, input.citationStyle);
  const citationStyle = input.citationStyle ?? preset.defaultCitationStyle;
  const frameworkStages = createDefaultAcademicFrameworkStages({
    subtype: input.subtype,
    enabledStageIds: input.defaultFrameworkStageIds
  });
  return AcademicBookSchema.parse({
    id: createCatalogId("book"),
    title: input.title,
    bookType: "academic",
    subtype: input.subtype,
    citationStyle,
    status: "editing",
    linkedMaterialIds: [...(input.linkedMaterialIds ?? [])],
    linkedSkillIds: [...(input.linkedSkillIds ?? [])],
    foundation: {
      thesisOverview: {
        id: ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
        title: ACADEMIC_THESIS_OVERVIEW_TITLE,
        content: "",
        createdAt: now,
        updatedAt: now
      },
      terminology: {
        id: ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
        title: ACADEMIC_TERMINOLOGY_TITLE,
        content: "",
        createdAt: now,
        updatedAt: now
      },
      cards: []
    },
    frameworkStages,
    documents: frameworkStages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      content: "",
      createdAt: now,
      updatedAt: now
    })),
    manuscript: {
      chapters: preset.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        createdAt: now,
        updatedAt: now
      })),
      sections: preset.sections.map((section) => ({
        id: section.id,
        ...(section.chapterId ? { chapterId: section.chapterId } : {}),
        title: section.title,
        wordCountRequirement: section.wordCountRequirement ?? "",
        brief: {
          id: createAcademicSectionDocumentId(section.id, "brief"),
          title: `${section.title} · 写作指引`,
          content: "",
          createdAt: now,
          updatedAt: now
        },
        body: {
          id: createAcademicSectionDocumentId(section.id, "body"),
          title: section.title,
          content: "",
          createdAt: now,
          updatedAt: now
        },
        state: {
          id: createAcademicSectionDocumentId(section.id, "state"),
          title: `${section.title} · 节末状态`,
          content: "",
          createdAt: now,
          updatedAt: now
        },
        createdAt: now,
        updatedAt: now
      }))
    },
    createdAt: now,
    updatedAt: now
  });
}

export function assertCreationPlotStages(
  ids: readonly string[] | undefined,
  stages: readonly CreativePlotStage[]
): void {
  if (ids?.some((id) => !stages.some((stage) => stage.id === id)))
    throw new Error("模板中的剧情阶段已失效，请编辑模板后重试。");
}

export function applyGlobalPlotStagesToNewBook<
  Resource extends ShortBook | ScriptBook
>(
  book: Resource,
  globalStages: readonly CreativePlotStage[],
  defaultPlotStageIds?: readonly string[]
): Resource {
  const definitions =
    globalStages.length > 0
      ? mergeCreativePlotStageDefinitions(globalStages)
      : createDefaultCreativePlotStages();
  const existingDocuments = new Map(
    book.documents.map((document) => [document.id, document])
  );
  const existingStages = new Map(
    book.plotStages.map((stage) => [stage.id, stage])
  );
  const configuredStageIds = defaultPlotStageIds
    ? new Set(defaultPlotStageIds)
    : undefined;
  const plotStages: BookPlotStage[] = definitions.map((stage) => ({
    ...stage,
    enabled:
      configuredStageIds?.has(stage.id) ??
      existingStages.get(stage.id)?.enabled ??
      DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS.has(stage.id)
  }));
  const documents = [
    ...(existingDocuments.get("character_design")
      ? [existingDocuments.get("character_design")!]
      : []),
    ...plotStages.map((stage) => {
      const existing = existingDocuments.get(stage.id);
      return {
        id: stage.id,
        title: stage.title,
        content: existing?.content ?? "",
        createdAt: existing?.createdAt ?? book.createdAt,
        updatedAt: existing?.updatedAt ?? book.updatedAt
      };
    }),
    ...book.documents.filter(
      (document) =>
        document.id !== "character_design" &&
        !plotStages.some((stage) => stage.id === document.id)
    )
  ];
  return {
    ...book,
    plotStages,
    documents
  };
}
