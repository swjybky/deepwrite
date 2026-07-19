import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

const CatalogIdSchema = z.string().trim().min(1).max(512);
const CatalogTitleSchema = z.string().trim().min(1).max(256);
const TimestampSchema = z.string().datetime();

export const CATALOG_PROJECT_MANIFEST_FILENAME = "deepwrite.json" as const;
export const CATALOG_PROJECT_MAX_CONTENT_ITEMS = 4_096;

export const CATALOG_PROJECT_DOMAINS = ["book", "material", "skill"] as const;
export const CatalogProjectDomainSchema = z.enum(CATALOG_PROJECT_DOMAINS);
export type CatalogProjectDomain = z.infer<typeof CatalogProjectDomainSchema>;

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
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
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

export const ShortBookSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  bookType: z.literal("short"),
  genre: ShortBookGenreSchema,
  status: z.enum(["editing", "completed"]),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
  linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
  documents: z.array(CatalogDocumentSchema),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type ShortBook = z.infer<typeof ShortBookSchema>;

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

export const BookProjectManifestSchema = CatalogProjectManifestBaseSchema.extend({
  kind: z.literal("deepwrite.book"),
  bookType: z.literal("short"),
  genre: ShortBookGenreSchema,
  status: z.enum(["editing", "completed"]),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
  linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
  documents: z.array(BookProjectDocumentManifestSchema).max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
});
export type BookProjectManifest = z.infer<typeof BookProjectManifestSchema>;

export const MaterialLibraryProjectManifestSchema =
  CatalogProjectManifestBaseSchema.extend({
    kind: z.literal("deepwrite.material-library"),
    materialType: LibraryTypeSchema,
    materialKind: MaterialLibraryKindSchema,
    parentGenre: z.string(),
    subGenre: z.string(),
    overview: z.string(),
    entries: z.array(MaterialProjectEntryManifestSchema).max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
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
    entries: z.array(SkillProjectEntryManifestSchema).max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
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
    })
  });
export type SkillGroupProjectManifest = z.infer<
  typeof SkillGroupProjectManifestSchema
>;

export const CatalogProjectManifestSchema = z.discriminatedUnion("kind", [
  BookProjectManifestSchema,
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

export const CatalogSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    books: z.array(ShortBookSchema),
    materials: z.array(MaterialLibrarySchema),
    materialGroups: z.array(MaterialLibraryGroupSchema),
    skills: z.array(SkillLibrarySchema),
    skillGroups: z.array(SkillLibraryGroupSchema),
    updatedAt: TimestampSchema,
    legacyImport: CatalogLegacyImportSchema.optional(),
    projectDiagnostics: z.array(CatalogProjectDiagnosticSchema).optional()
  })
  .superRefine((snapshot, context) => {
    const collections: Array<
      [string, ReadonlyArray<{ id: string }>]
    > = [
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
    for (const [bookIndex, book] of snapshot.books.entries()) {
      if (!uniqueIds(book.documents.map(({ id }) => id))) {
        context.addIssue({
          code: "custom",
          path: ["books", bookIndex, "documents"],
          message: "Book documents cannot contain duplicate ids."
        });
      }
    }
  });
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;

export const CreateShortBookInputSchema = z.object({
  title: CatalogTitleSchema,
  genre: ShortBookGenreSchema,
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindInputSchema.optional(),
  linkedSkillIdsByKind: LinkedSkillIdsByKindInputSchema.optional()
});
export type CreateShortBookInput = z.infer<typeof CreateShortBookInputSchema>;

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
    }) =>
      Object.values(patch).some((value) => value !== undefined),
    { message: "Book update must contain at least one changed field." }
  );
export type UpdateBookInput = z.infer<typeof UpdateBookInputSchema>;

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
  baseRevision: z.string().min(1).optional(),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});
export type SaveDocumentInput = z.infer<typeof SaveDocumentInputSchema>;

export const CatalogLibraryProjectDomainSchema = z.enum(["material", "skill"]);
export type CatalogLibraryProjectDomain = z.infer<
  typeof CatalogLibraryProjectDomainSchema
>;

export const CatalogLibrarySchema = z.union([
  MaterialLibrarySchema,
  SkillLibrarySchema
]);
export type CatalogLibrary = z.infer<typeof CatalogLibrarySchema>;

export const CreateLibraryInputSchema = z.object({
  domain: CatalogLibraryProjectDomainSchema,
  name: CatalogTitleSchema
});
export type CreateLibraryInput = z.infer<typeof CreateLibraryInputSchema>;

export const CreateLibraryAtPathInputSchema = CreateLibraryInputSchema.extend({
  parentDirectory: z.string().trim().min(1)
});
export type CreateLibraryAtPathInput = z.infer<
  typeof CreateLibraryAtPathInputSchema
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

export const UnregisterCatalogProjectInputSchema = z.object({
  domain: CatalogProjectDomainSchema,
  projectId: CatalogIdSchema
});
export type UnregisterCatalogProjectInput = z.infer<
  typeof UnregisterCatalogProjectInputSchema
>;

export const UnregisterCatalogProjectResultSchema = z.object({
  domain: CatalogProjectDomainSchema,
  projectId: CatalogIdSchema,
  unregistered: z.boolean()
});
export type UnregisterCatalogProjectResult = z.infer<
  typeof UnregisterCatalogProjectResultSchema
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
export type SaveLibraryEntryInput = z.infer<
  typeof SaveLibraryEntryInputSchema
>;

export const CatalogLibraryEntrySchema = z.union([
  MaterialEntrySchema,
  SkillEntrySchema
]);
export type CatalogLibraryEntry = z.infer<typeof CatalogLibraryEntrySchema>;

export const CatalogSnapshotCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.snapshot"),
  payload: z.object({})
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

export const CatalogCreateLibraryCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibrary"),
    payload: CreateLibraryInputSchema
  });

export const CatalogOpenProjectCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.openProject"),
  payload: CatalogOpenProjectInputSchema
});

export const CatalogImportLegacyBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.importLegacyBook"),
    payload: z.object({})
  });

export const CatalogCreateShortBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createShortBookAtPath"),
    payload: CreateShortBookAtPathInputSchema
  });

export const CatalogCreateLibraryAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.createLibraryAtPath"),
    payload: CreateLibraryAtPathInputSchema
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

export const CatalogUpdateBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.updateBook"),
  payload: UpdateBookInputSchema
});

export const CatalogDeleteBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.deleteBook"),
  payload: DeleteBookInputSchema
});

export const CatalogSaveDocumentCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.saveDocument"),
  payload: SaveDocumentInputSchema
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

export const CatalogUnregisterProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.unregisterProject"),
    payload: UnregisterCatalogProjectInputSchema
  });

export const CatalogCommandEnvelopeSchema = z.discriminatedUnion("type", [
  CatalogSnapshotCommandEnvelopeSchema,
  CatalogLoadDraftRecoveryCommandEnvelopeSchema,
  CatalogSaveDraftRecoveryCommandEnvelopeSchema,
  CatalogCreateShortBookCommandEnvelopeSchema,
  CatalogCreateLibraryCommandEnvelopeSchema,
  CatalogOpenProjectCommandEnvelopeSchema,
  CatalogImportLegacyBookCommandEnvelopeSchema,
  CatalogCreateShortBookAtPathCommandEnvelopeSchema,
  CatalogCreateLibraryAtPathCommandEnvelopeSchema,
  CatalogOpenProjectAtPathCommandEnvelopeSchema,
  CatalogImportLegacyBookAtPathCommandEnvelopeSchema,
  CatalogUpdateBookCommandEnvelopeSchema,
  CatalogDeleteBookCommandEnvelopeSchema,
  CatalogSaveDocumentCommandEnvelopeSchema,
  CatalogSaveLibraryEntryCommandEnvelopeSchema,
  CatalogCreateLibraryEntryCommandEnvelopeSchema,
  CatalogRemoveLibraryEntryCommandEnvelopeSchema,
  CatalogUnregisterProjectCommandEnvelopeSchema
]);
export type CatalogCommandEnvelope = z.infer<typeof CatalogCommandEnvelopeSchema>;
