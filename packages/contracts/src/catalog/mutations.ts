import {
  DraftSectionChangeSchema,
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS
} from "../expert-draft";
import { DocumentVersionOriginSchema } from "../document-version-origin";
import { AcademicCitationStyleSchema } from "../academic-citation-style";
import { AcademicBookSubtypeSchema } from "../academic-book";
import { z } from "zod";

import { DraftSectionIdSchema, DraftSectionTitleSchema } from "../expert-draft";
import { BookCharacterFormatSchema } from "./character-structure";
import { CatalogDraftSectionSchema } from "./draft-directory";
import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  CATALOG_PROJECT_DOMAINS,
  CatalogDocumentSchema,
  CatalogIdSchema,
  CatalogLibraryProjectDomainSchema,
  CatalogProjectDomainSchema,
  CatalogTitleSchema,
  LibraryCustomTagSchema,
  LibraryGroupMemberIdsSchema,
  LibraryTypeSchema,
  LinkedMaterialIdsByKindInputSchema,
  LinkedSkillIdsByKindInputSchema,
  MATERIAL_GROUP_LEGACY_SLOTS,
  MaterialKindSchema,
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
import {
  MaterialEntrySchema,
  MaterialLibraryGroupSchema,
  MaterialLibrarySchema,
  SkillEntrySchema,
  SkillLibraryGroupSchema,
  SkillLibrarySchema
} from "./libraries";
import {
  CREATIVE_PLOT_STAGE_MAX_COUNT,
  CreativePlotStageIdSchema,
  CreativePlotStageSchema
} from "./plot-stages";
import { CatalogContentBytesSchema } from "./snapshot";

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

export const UpdateBookInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional(),
    title: CatalogTitleSchema.optional(),
    genre: ShortBookGenreSchema.optional(),
    subtype: AcademicBookSubtypeSchema.optional(),
    citationStyle: AcademicCitationStyleSchema.optional(),
    status: z.enum(["editing", "completed"]).optional(),
    linkedMaterialIdsByKind: LinkedMaterialIdsByKindInputSchema.optional(),
    linkedSkillIdsByKind: LinkedSkillIdsByKindInputSchema.optional(),
    linkedMaterialIds: z
      .array(CatalogIdSchema)
      .refine(uniqueIds, {
        message: "Catalog id lists cannot contain duplicates."
      })
      .optional(),
    linkedSkillIds: z
      .array(CatalogIdSchema)
      .refine(uniqueIds, {
        message: "Catalog id lists cannot contain duplicates."
      })
      .optional()
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
      type: z.literal("reorder"),
      stageId: CreativePlotStageIdSchema,
      anchorId: CreativePlotStageIdSchema,
      position: z.enum(["before", "after"])
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
  z
    .object({
      type: z.literal("reorderItem"),
      itemId: CatalogIdSchema,
      anchorId: CatalogIdSchema,
      position: z.enum(["before", "after"])
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
  versionOrigin: DocumentVersionOriginSchema.optional(),
  bookId: CatalogIdSchema,
  documentId: CatalogIdSchema,
  title: CatalogTitleSchema.optional(),
  content: z.string(),
  preserveCurrentContent: z.boolean().optional(),
  draftSectionChange: DraftSectionChangeSchema.optional(),
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
    bodyContent: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS).optional(),
    stateContent: z
      .string()
      .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
      .optional(),
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
    versionOrigin: DocumentVersionOriginSchema.optional(),
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

export const MoveDraftSectionInputSchema = z
  .object({
    bookId: CatalogIdSchema,
    sectionId: DraftSectionIdSchema,
    direction: z.enum(["up", "down"]).optional(),
    anchorSectionId: DraftSectionIdSchema.optional(),
    position: z.enum(["before", "after"]).optional(),
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional()
  })
  .superRefine((input, context) => {
    const hasDirection = input.direction !== undefined;
    const hasAnchorId = input.anchorSectionId !== undefined;
    const hasPosition = input.position !== undefined;
    const hasAnchor = hasAnchorId || hasPosition;
    if (hasDirection === hasAnchor) {
      context.addIssue({
        code: "custom",
        path: [hasDirection ? "direction" : "anchorSectionId"],
        message: "Specify either direction or anchorSectionId with position."
      });
      return;
    }
    if (hasAnchor && (!hasAnchorId || !hasPosition)) {
      context.addIssue({
        code: "custom",
        path: [hasAnchorId ? "position" : "anchorSectionId"],
        message: "Both anchorSectionId and position are required together."
      });
      return;
    }
    if (hasAnchorId && input.anchorSectionId === input.sectionId) {
      context.addIssue({
        code: "custom",
        path: ["anchorSectionId"],
        message: "Cannot move a section relative to itself."
      });
    }
  });
export type MoveDraftSectionInput = z.infer<typeof MoveDraftSectionInputSchema>;

export const MoveDraftSectionResultSchema = z.object({
  bookId: CatalogIdSchema,
  sectionId: DraftSectionIdSchema,
  direction: z.enum(["up", "down"]).optional(),
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

export const CatalogLibraryGroupSchema = z.union([
  MaterialLibraryGroupSchema,
  SkillLibraryGroupSchema
]);
export type CatalogLibraryGroup = z.infer<typeof CatalogLibraryGroupSchema>;

const CreateMaterialLibraryInputSchema = z.object({
  domain: z.literal("material"),
  name: CatalogTitleSchema,
  materialKind: MaterialKindSchema,
  customTag: LibraryCustomTagSchema.optional(),
  libraryType: LibraryTypeSchema.optional()
});

const CreateSkillLibraryInputSchema = z.object({
  domain: z.literal("skill"),
  name: CatalogTitleSchema,
  skillKind: SkillKindSchema,
  customTag: LibraryCustomTagSchema.optional(),
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
    customTag: LibraryCustomTagSchema.nullable().optional(),
    materialKind: MaterialLibraryKindSchema.optional(),
    skillKind: SkillKindSchema.optional(),
    baseProjectRevision: z.number().int().nonnegative().optional(),
    force: z.boolean().optional()
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.overview !== undefined ||
      value.customTag !== undefined ||
      value.materialKind !== undefined ||
      value.skillKind !== undefined,
    {
      message: "Library updates must include a title, overview, or tag."
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

function migrateGroupMutationInput(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const domain = (value as Record<string, unknown>).domain;
  return migrateLegacyGroupMembers(
    domain === "skill" ? SKILL_GROUP_LEGACY_SLOTS : MATERIAL_GROUP_LEGACY_SLOTS
  )(value);
}

const CreateMaterialLibraryGroupInputSchema = z.object({
  domain: z.literal("material"),
  name: CatalogTitleSchema,
  memberIds: LibraryGroupMemberIdsSchema
});

const CreateSkillLibraryGroupInputSchema = z.object({
  domain: z.literal("skill"),
  name: CatalogTitleSchema,
  memberIds: LibraryGroupMemberIdsSchema
});

export const CreateLibraryGroupInputSchema = z.preprocess(
  migrateGroupMutationInput,
  z.discriminatedUnion("domain", [
    CreateMaterialLibraryGroupInputSchema,
    CreateSkillLibraryGroupInputSchema
  ])
);
export type CreateLibraryGroupInput = z.infer<
  typeof CreateLibraryGroupInputSchema
>;

const UpdateMaterialLibraryGroupInputSchema = z.object({
  domain: z.literal("material"),
  groupId: CatalogIdSchema,
  title: CatalogTitleSchema.optional(),
  memberIds: LibraryGroupMemberIdsSchema,
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});

const UpdateSkillLibraryGroupInputSchema = z.object({
  domain: z.literal("skill"),
  groupId: CatalogIdSchema,
  title: CatalogTitleSchema.optional(),
  memberIds: LibraryGroupMemberIdsSchema,
  baseProjectRevision: z.number().int().nonnegative().optional(),
  force: z.boolean().optional()
});

export const UpdateLibraryGroupInputSchema = z.preprocess(
  migrateGroupMutationInput,
  z.discriminatedUnion("domain", [
    UpdateMaterialLibraryGroupInputSchema,
    UpdateSkillLibraryGroupInputSchema
  ])
);
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
    .array(
      ExternalLibraryCandidateSchema.pick({
        title: true,
        content: true
      }).extend({ stageId: z.string().min(1).max(120).optional() })
    )
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
