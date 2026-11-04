import { z } from "zod";

export const EXTERNAL_DEFAULT_PAGE_CHARACTERS = 12_000;
export const EXTERNAL_MAX_PAGE_CHARACTERS = 50_000;
export const EXTERNAL_DEFAULT_SEARCH_LIMIT = 20;
export const EXTERNAL_MAX_SEARCH_LIMIT = 50;

const IdSchema = z.string().trim().min(1).max(512);
const TimestampSchema = z.string().datetime();
const WorkTypeSchema = z.enum(["short", "script", "long"]);
const LibraryDomainSchema = z.enum(["material", "skill"]);

const pageFields = {
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Character offset to resume from. Use nextOffset from a page."),
  maxCharacters: z
    .number()
    .int()
    .min(1)
    .max(EXTERNAL_MAX_PAGE_CHARACTERS)
    .optional()
    .describe(
      `Page size in characters. Default ${EXTERNAL_DEFAULT_PAGE_CHARACTERS}.`
    )
};

export const ExternalListWorksInputSchema = z
  .object({
    type: WorkTypeSchema.optional().describe("Only list works of this type.")
  })
  .strict();

export const ExternalGetWorkInputSchema = z
  .object({ workId: IdSchema.describe("Work id from list_works.") })
  .strict();

export const ExternalReadDocumentInputSchema = z
  .object({
    workId: IdSchema.describe("Work id from list_works."),
    documentId: IdSchema.describe("Document id from get_work."),
    ...pageFields
  })
  .strict();

/** Exactly one of workId and libraryId; checked by the route. */
export const ExternalSearchTextInputSchema = z
  .object({
    query: z.string().trim().min(1).max(256).describe("Text to find."),
    workId: IdSchema.optional().describe("Search inside this work."),
    libraryId: IdSchema.optional().describe("Search inside this library."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(EXTERNAL_MAX_SEARCH_LIMIT)
      .optional()
      .describe(`Maximum hits. Default ${EXTERNAL_DEFAULT_SEARCH_LIMIT}.`),
    cursor: z
      .string()
      .min(1)
      .max(2_048)
      .optional()
      .describe("nextCursor from the previous page of the same search.")
  })
  .strict();

export const ExternalListLibrariesInputSchema = z
  .object({
    domain: LibraryDomainSchema.optional().describe(
      "Only list material libraries or skill libraries."
    )
  })
  .strict();

export const ExternalGetLibraryInputSchema = z
  .object({ libraryId: IdSchema.describe("Library id from list_libraries.") })
  .strict();

export const ExternalReadEntryInputSchema = z
  .object({
    libraryId: IdSchema.describe("Library id from list_libraries."),
    entryId: IdSchema.optional().describe(
      "Entry id from get_library. Omit to read the library overview."
    ),
    ...pageFields
  })
  .strict();

export const ExternalListAgentTeamsInputSchema = z
  .object({
    type: WorkTypeSchema.optional().describe(
      "Only list teams for this work type."
    ),
    teamId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Also return this team's full settings.")
  })
  .strict();

export type ExternalListWorksInput = z.infer<
  typeof ExternalListWorksInputSchema
>;
export type ExternalGetWorkInput = z.infer<typeof ExternalGetWorkInputSchema>;
export type ExternalReadDocumentInput = z.infer<
  typeof ExternalReadDocumentInputSchema
>;
export type ExternalSearchTextInput = z.infer<
  typeof ExternalSearchTextInputSchema
>;
export type ExternalListLibrariesInput = z.infer<
  typeof ExternalListLibrariesInputSchema
>;
export type ExternalGetLibraryInput = z.infer<
  typeof ExternalGetLibraryInputSchema
>;
export type ExternalReadEntryInput = z.infer<
  typeof ExternalReadEntryInputSchema
>;
export type ExternalListAgentTeamsInput = z.infer<
  typeof ExternalListAgentTeamsInputSchema
>;

/* Strict results double as the output allowlist: an internal field that is
   not named here fails loudly instead of reaching an external agent. */

export const ExternalWorkSummarySchema = z
  .object({
    id: IdSchema,
    type: WorkTypeSchema,
    title: z.string().min(1),
    genre: z.string(),
    status: z.enum(["editing", "completed"]),
    updatedAt: TimestampSchema
  })
  .strict();

export const ExternalListWorksResultSchema = z
  .object({
    works: z.array(ExternalWorkSummarySchema),
    /** Registered works that could not be read right now. */
    unavailableWorkIds: z.array(IdSchema)
  })
  .strict();

export const ExternalWorkDocumentSchema = z
  .object({
    id: IdSchema,
    title: z.string().min(1),
    /** Which part of the work this belongs to, such as draft or worldbuilding. */
    group: z.string().min(1),
    bytes: z.number().int().nonnegative().optional(),
    updatedAt: TimestampSchema
  })
  .strict();

export const ExternalWorkDetailSchema = ExternalWorkSummarySchema.extend({
  stages: z
    .array(
      z
        .object({
          id: IdSchema,
          title: z.string().min(1),
          enabled: z.boolean()
        })
        .strict()
    )
    .optional(),
  documents: z.array(ExternalWorkDocumentSchema),
  linkedMaterialLibraryIds: z.array(IdSchema),
  linkedSkillLibraryIds: z.array(IdSchema)
}).strict();

const pageResultFields = {
  title: z.string().min(1),
  content: z.string(),
  offset: z.number().int().nonnegative(),
  totalCharacters: z.number().int().nonnegative(),
  nextOffset: z.number().int().positive().nullable(),
  /** Pass back as baseRevision when writing. */
  revision: z.string().min(1).optional()
};

export const ExternalDocumentPageSchema = z
  .object({ workId: IdSchema, documentId: IdSchema, ...pageResultFields })
  .strict();

export const ExternalEntryPageSchema = z
  .object({
    libraryId: IdSchema,
    entryId: IdSchema.optional(),
    ...pageResultFields
  })
  .strict();

export const ExternalSearchResultSchema = z
  .object({
    query: z.string().min(1),
    hits: z.array(
      z
        .object({
          documentId: IdSchema,
          title: z.string().min(1),
          offset: z.number().int().nonnegative(),
          snippet: z.string()
        })
        .strict()
    ),
    nextCursor: z.string().min(1).nullable()
  })
  .strict();

const ExternalLibrarySummarySchema = z
  .object({
    id: IdSchema,
    domain: LibraryDomainSchema,
    title: z.string().min(1),
    type: WorkTypeSchema,
    kind: z.string().min(1),
    entryCount: z.number().int().nonnegative(),
    updatedAt: TimestampSchema
  })
  .strict();

export const ExternalListLibrariesResultSchema = z
  .object({
    libraries: z.array(ExternalLibrarySummarySchema),
    groups: z.array(
      z
        .object({
          id: IdSchema,
          domain: LibraryDomainSchema,
          title: z.string().min(1),
          libraryIds: z.array(IdSchema)
        })
        .strict()
    )
  })
  .strict();

export const ExternalLibraryDetailSchema = ExternalLibrarySummarySchema.extend({
  overviewBytes: z.number().int().nonnegative(),
  entries: z.array(
    z
      .object({
        id: IdSchema,
        stageId: z.string().min(1),
        title: z.string().min(1),
        bytes: z.number().int().nonnegative(),
        updatedAt: TimestampSchema
      })
      .strict()
  )
}).strict();

const ExternalAgentTeamSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: WorkTypeSchema,
    enabled: z.boolean(),
    fromMarketplace: z.boolean()
  })
  .strict();

export const ExternalListAgentTeamsResultSchema = z
  .object({
    teams: z.array(ExternalAgentTeamSummarySchema),
    team: ExternalAgentTeamSummarySchema.extend({
      settings: z.unknown(),
      /** Pass back as baseRevision when saving. */
      revision: z.string().min(1)
    })
      .strict()
      .optional()
  })
  .strict();
