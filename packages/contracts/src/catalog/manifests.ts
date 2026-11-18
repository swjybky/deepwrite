import { z } from "zod";
import {
  CurrentAcademicBookProjectManifestObjectSchema,
  validateAcademicBookManifestFiles
} from "../academic-book";

import { DraftSectionIdSchema, DraftSectionTitleSchema } from "../expert-draft";
import { MarketplaceSourceSchema } from "../marketplace";
import {
  migrateBookPlotStageEnabled,
  migrateLegacyCharacterOverviewTitle,
  validateCharacterStructureDocuments,
  validatePlotStageDocuments
} from "./books";
import {
  BookCharacterStructureSchema,
  type BookCharacterStructure
} from "./character-structure";
import {
  DraftSectionCreationOperationSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId
} from "./draft-directory";
import {
  CATALOG_DRAFT_DIRECTORY_ID,
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  CatalogIdSchema,
  CatalogProjectContentPathSchema,
  CatalogProjectKindSchema,
  CatalogTitleSchema,
  LibraryCustomTagSchema,
  LibraryGroupMemberIdsSchema,
  LibraryTypeSchema,
  LinkedMaterialIdsByKindSchema,
  LinkedSkillIdsByKindSchema,
  MATERIAL_GROUP_LEGACY_SLOTS,
  MaterialLibraryKindSchema,
  MaterialStageIdSchema,
  SKILL_GROUP_LEGACY_SLOTS,
  ScriptBookGenreSchema,
  ShortBookGenreSchema,
  SkillKindSchema,
  SkillStageIdSchema,
  TimestampSchema,
  migrateLegacyGroupMembers,
  uniqueIds
} from "./kinds";
import { BookPlotStagesSchema } from "./plot-stages";

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
  if (
    value &&
    typeof value === "object" &&
    (value as { bookType?: unknown }).bookType === "academic"
  ) {
    return value;
  }
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
      ScriptBookProjectManifestObjectSchema,
      CurrentAcademicBookProjectManifestObjectSchema
    ])
  )
  .superRefine((manifest, context) => {
    if (manifest.bookType === "academic") {
      validateAcademicBookManifestFiles(manifest, context);
      return;
    }
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
    customTag: LibraryCustomTagSchema.optional(),
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
    customTag: LibraryCustomTagSchema.optional(),
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

export const MaterialGroupProjectManifestSchema = z.preprocess(
  migrateLegacyGroupMembers(MATERIAL_GROUP_LEGACY_SLOTS),
  CatalogProjectManifestBaseSchema.extend({
    kind: z.literal("deepwrite.material-group"),
    memberIds: LibraryGroupMemberIdsSchema
  })
);
export type MaterialGroupProjectManifest = z.infer<
  typeof MaterialGroupProjectManifestSchema
>;

export const SkillGroupProjectManifestSchema = z.preprocess(
  migrateLegacyGroupMembers(SKILL_GROUP_LEGACY_SLOTS),
  CatalogProjectManifestBaseSchema.extend({
    kind: z.literal("deepwrite.skill-group"),
    memberIds: LibraryGroupMemberIdsSchema,
    marketplaceSource: MarketplaceSourceSchema.optional()
  })
);
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
