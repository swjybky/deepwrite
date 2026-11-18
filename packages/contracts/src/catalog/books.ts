import { z } from "zod";
import {
  CurrentAcademicBookSchema,
  validateAcademicBookState
} from "../academic-book";

import {
  BOOK_CHARACTER_OVERVIEW_DOCUMENT_ID,
  BOOK_CHARACTER_OVERVIEW_TITLE,
  BookCharacterStructureSchema,
  LEGACY_BOOK_CHARACTER_OVERVIEW_TITLE,
  createDefaultBookCharacterStructure,
  type BookCharacterStructure
} from "./character-structure";
import {
  CatalogDraftDirectorySchema,
  migrateCatalogDraftDocument,
  type CatalogDraftDirectory
} from "./draft-directory";
import {
  CATALOG_DRAFT_DIRECTORY_ID,
  CatalogDocumentSchema,
  CatalogIdSchema,
  CatalogTitleSchema,
  LinkedMaterialIdsByKindSchema,
  LinkedSkillIdsByKindSchema,
  ScriptBookGenreSchema,
  ShortBookGenreSchema,
  TimestampSchema,
  uniqueIds
} from "./kinds";
import {
  BookPlotStagesSchema,
  DEFAULT_CREATIVE_PLOT_STAGES,
  createDefaultBookPlotStages
} from "./plot-stages";

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

export function migrateBookPlotStageEnabled(value: unknown): unknown {
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

export function migrateLegacyCharacterOverviewTitle(value: unknown): unknown {
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
  if (
    value &&
    typeof value === "object" &&
    (value as { bookType?: unknown }).bookType === "academic"
  ) {
    return value;
  }
  return migrateLegacyCharacterOverviewTitle(
    migrateMissingCharacterStructure(
      migrateBookPlotStageEnabled(
        migrateMissingPlotStages(migrateLegacyShortBook(value))
      )
    )
  );
}

export function validateCharacterStructureDocuments(
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

export function validatePlotStageDocuments(
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

export const CreativeBookSchema = z.union([ShortBookSchema, ScriptBookSchema]);
export type CreativeBook = z.infer<typeof CreativeBookSchema>;

export const CurrentBookSchema = z.discriminatedUnion("bookType", [
  CurrentShortBookSchema,
  CurrentScriptBookSchema,
  CurrentAcademicBookSchema
]);

/** Current books are discriminated by `bookType`; legacy short books migrate first. */
export const BookSchema = z
  .preprocess(migrateBook, CurrentBookSchema)
  .superRefine((book, context) => {
    if (book.bookType === "academic") {
      validateAcademicBookState(book, context);
      return;
    }
    validateUniqueBookDocumentIds(book, context);
    validateCharacterStructureDocuments(book, context);
    validatePlotStageDocuments(book, context);
  });
export type Book = z.infer<typeof BookSchema>;
