import {
  CatalogPreviewLibraryStructureCommandEnvelopeSchema,
  CatalogApplyLibraryStructureCommandEnvelopeSchema
} from "./library-structure";
import { CatalogCreateUnboundEntryCommandEnvelopeSchema } from "./library-organization";
import { createBookCreationEnvelope } from "./book-creation";
import { z } from "zod";
import { CatalogReorderLibraryCommandEnvelopeSchema } from "./library-organization";
import { EnvelopeBaseSchema } from "./envelope";
import {
  CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema,
  MarketplaceSourceSchema
} from "./marketplace";
import { CatalogInstallMarketplaceMaterialCommandEnvelopeSchema } from "./material-marketplace";
import { DraftSectionIdSchema, DraftSectionTitleSchema } from "./expert-draft";
import {
  CatalogReadWritingContextCommandEnvelopeSchema,
  CatalogWriteWritingContextCommandEnvelopeSchema
} from "./writing-context";
import {
  CreateAcademicBookAtPathInputSchema,
  CreateAcademicBookInputSchema,
  CreateAcademicReferenceCardInputSchema,
  CurrentAcademicBookProjectManifestObjectSchema,
  DeleteAcademicReferenceCardInputSchema,
  MutateAcademicFrameworkInputSchema,
  MutateAcademicManuscriptInputSchema,
  UpdateAcademicReferenceCardInputSchema,
  validateAcademicBookManifestFiles
} from "./academic-book";
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
} from "./catalog/kinds";
import { BookPlotStagesSchema } from "./catalog/plot-stages";
import {
  type BookCharacterStructure,
  BookCharacterStructureSchema
} from "./catalog/character-structure";
import {
  DraftSectionCreationOperationSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId
} from "./catalog/draft-directory";
import {
  migrateBookPlotStageEnabled,
  migrateLegacyCharacterOverviewTitle,
  validateCharacterStructureDocuments,
  validatePlotStageDocuments
} from "./catalog/books";
import { CatalogDraftRecoverySchema } from "./catalog/snapshot";
import {
  CatalogOpenProjectInputSchema,
  CatalogReadDocumentInputSchema,
  CreateDraftSectionInputSchema,
  CreateDraftSectionsInputSchema,
  CreateLibraryAtPathInputSchema,
  CreateLibraryEntryInputSchema,
  CreateLibraryGroupAtPathInputSchema,
  CreateLibraryGroupInputSchema,
  CreateLibraryInputSchema,
  CreateScriptBookAtPathInputSchema,
  CreateScriptBookInputSchema,
  CreateShortBookAtPathInputSchema,
  CreateShortBookInputSchema,
  DeleteBookInputSchema,
  DeleteCatalogProjectInputSchema,
  DeleteDraftSectionInputSchema,
  DuplicateCatalogProjectAtPathInputSchema,
  DuplicateCatalogProjectInputSchema,
  ExternalLibrarySourceKindSchema,
  ImportLegacyBookAtPathInputSchema,
  ImportLibraryEntriesInputSchema,
  MoveDraftSectionInputSchema,
  MoveLibraryEntryInputSchema,
  MutateCharacterStructureInputSchema,
  MutatePlotStructureInputSchema,
  OpenCatalogProjectAtPathInputSchema,
  RemoveLibraryEntryInputSchema,
  SaveDocumentInputSchema,
  SaveLibraryEntryInputSchema,
  UnregisterCatalogProjectInputSchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  UpdateLibraryInputSchema,
  RestoreBackupFilesInputSchema
} from "./catalog/mutations";
export * from "./catalog/kinds";
export * from "./catalog/plot-stages";
export * from "./catalog/character-structure";
export * from "./catalog/draft-directory";
export * from "./catalog/libraries";
export * from "./catalog/books";
export * from "./catalog/snapshot";
export * from "./catalog/mutations";

export * from "./academic-citation-style";
export * from "./academic-book";

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
    writeReceipts: z
      .array(
        z.object({
          id: CatalogIdSchema,
          path: z.string().regex(/^receipts\/[a-z0-9_-]+\.md$/iu)
        })
      )
      .max(100_000)
      .optional(),
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
  /* @__PURE__ */ createBookCreationEnvelope(
    "catalog.createShortBook",
    CreateShortBookInputSchema
  );

export const CatalogCreateScriptBookCommandEnvelopeSchema =
  /* @__PURE__ */ createBookCreationEnvelope(
    "catalog.createScriptBook",
    CreateScriptBookInputSchema
  );

export const CatalogCreateAcademicBookCommandEnvelopeSchema =
  /* @__PURE__ */ createBookCreationEnvelope(
    "catalog.createAcademicBook",
    CreateAcademicBookInputSchema
  );

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

export const CatalogCreateShortBookAtPathCommandEnvelopeSchema =
  /* @__PURE__ */ createBookCreationEnvelope(
    "catalog.createShortBookAtPath",
    CreateShortBookAtPathInputSchema
  );

export const CatalogCreateScriptBookAtPathCommandEnvelopeSchema =
  /* @__PURE__ */ createBookCreationEnvelope(
    "catalog.createScriptBookAtPath",
    CreateScriptBookAtPathInputSchema
  );

export const CatalogCreateAcademicBookAtPathCommandEnvelopeSchema =
  /* @__PURE__ */ createBookCreationEnvelope(
    "catalog.createAcademicBookAtPath",
    CreateAcademicBookAtPathInputSchema
  );

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

export const CatalogRestoreBackupFilesCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.restoreBackupFiles"),
    payload: RestoreBackupFilesInputSchema
  });

export const CatalogImportLegacyBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyBookAtPath"),
    payload: ImportLegacyBookAtPathInputSchema
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

export const CatalogMutateAcademicFrameworkCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.mutateAcademicFramework"),
    payload: MutateAcademicFrameworkInputSchema
  });

export const CatalogCreateAcademicReferenceCardCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createAcademicReferenceCard"),
    payload: CreateAcademicReferenceCardInputSchema
  });

export const CatalogUpdateAcademicReferenceCardCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.updateAcademicReferenceCard"),
    payload: UpdateAcademicReferenceCardInputSchema
  });

export const CatalogDeleteAcademicReferenceCardCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.deleteAcademicReferenceCard"),
    payload: DeleteAcademicReferenceCardInputSchema
  });

export const CatalogMutateAcademicManuscriptCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.mutateAcademicManuscript"),
    payload: MutateAcademicManuscriptInputSchema
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

export const CatalogDuplicateProjectAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.duplicateProjectAtPath"),
    payload: DuplicateCatalogProjectAtPathInputSchema
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

// Schema construction has no registration side effects; Renderer does not need command envelopes.
export const CatalogCommandEnvelopeSchema =
  /* @__PURE__ */ z.discriminatedUnion("type", [
    CatalogPreviewLibraryStructureCommandEnvelopeSchema,
    CatalogApplyLibraryStructureCommandEnvelopeSchema,
    CatalogCreateUnboundEntryCommandEnvelopeSchema,
    CatalogReorderLibraryCommandEnvelopeSchema,
    CatalogIndexCommandEnvelopeSchema,
    CatalogReadDocumentCommandEnvelopeSchema,
    CatalogReadWritingContextCommandEnvelopeSchema,
    CatalogSnapshotCommandEnvelopeSchema,
    CatalogLoadDraftRecoveryCommandEnvelopeSchema,
    CatalogSaveDraftRecoveryCommandEnvelopeSchema,
    CatalogCreateShortBookCommandEnvelopeSchema,
    CatalogCreateScriptBookCommandEnvelopeSchema,
    CatalogCreateAcademicBookCommandEnvelopeSchema,
    CatalogCreateLibraryCommandEnvelopeSchema,
    CatalogUpdateLibraryCommandEnvelopeSchema,
    CatalogCreateLibraryGroupCommandEnvelopeSchema,
    CatalogOpenProjectCommandEnvelopeSchema,
    CatalogCreateShortBookAtPathCommandEnvelopeSchema,
    CatalogCreateScriptBookAtPathCommandEnvelopeSchema,
    CatalogCreateAcademicBookAtPathCommandEnvelopeSchema,
    CatalogCreateLibraryAtPathCommandEnvelopeSchema,
    CatalogCreateLibraryGroupAtPathCommandEnvelopeSchema,
    CatalogOpenProjectAtPathCommandEnvelopeSchema,
    CatalogRestoreBackupFilesCommandEnvelopeSchema,
    CatalogUpdateBookCommandEnvelopeSchema,
    CatalogMutatePlotStructureCommandEnvelopeSchema,
    CatalogMutateCharacterStructureCommandEnvelopeSchema,
    CatalogMutateAcademicFrameworkCommandEnvelopeSchema,
    CatalogCreateAcademicReferenceCardCommandEnvelopeSchema,
    CatalogUpdateAcademicReferenceCardCommandEnvelopeSchema,
    CatalogDeleteAcademicReferenceCardCommandEnvelopeSchema,
    CatalogMutateAcademicManuscriptCommandEnvelopeSchema,
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
    CatalogDuplicateProjectAtPathCommandEnvelopeSchema,
    CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema,
    CatalogInstallMarketplaceMaterialCommandEnvelopeSchema,
    CatalogChooseExternalLibraryEntriesCommandEnvelopeSchema,
    CatalogImportLibraryEntriesCommandEnvelopeSchema,
    CatalogWriteWritingContextCommandEnvelopeSchema
  ]);
export type CatalogCommandEnvelope = z.infer<
  typeof CatalogCommandEnvelopeSchema
>;
