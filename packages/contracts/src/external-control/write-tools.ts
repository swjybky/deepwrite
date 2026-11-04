import { z } from "zod";
import { SHORT_BOOK_GENRES } from "../catalog";

const IdSchema = z.string().trim().min(1).max(512);
const TitleSchema = z.string().trim().min(1).max(256);
const WorkTypeSchema = z.enum(["short", "script", "long"]);
const LibraryDomainSchema = z.enum(["material", "skill"]);
/** Matches the store limit on one Markdown file. */
const ContentSchema = z.string().max(16 * 1024 * 1024);
const BaseRevisionSchema = z
  .string()
  .min(1)
  .max(256)
  .describe("revision returned when this text was last read.");

export const ExternalWriteDocumentInputSchema = z
  .object({
    workId: IdSchema.describe("Work id from list_works."),
    documentId: IdSchema.describe("Document id from get_work."),
    content: ContentSchema.describe("The document's complete new text."),
    baseRevision: BaseRevisionSchema
  })
  .strict();

export const ExternalManageDocumentInputSchema = z
  .object({
    action: z
      .enum(["create", "rename", "move", "duplicate", "delete"])
      .describe(
        "create adds a draft section. rename applies to any document. move, duplicate and delete apply to draft sections."
      ),
    workId: IdSchema.describe("A short or script work id."),
    documentId: IdSchema.optional().describe(
      "Target document. Required except for create, where it places the new section after this one."
    ),
    title: TitleSchema.optional().describe("Title for create and rename."),
    direction: z.enum(["up", "down"]).optional().describe("Direction for move.")
  })
  .strict();

export const ExternalManageWorkInputSchema = z
  .object({
    action: z.enum(["create", "rename", "duplicate", "delete"]),
    workId: IdSchema.optional().describe("Required except for create."),
    type: WorkTypeSchema.optional().describe("Work type for create."),
    title: TitleSchema.optional().describe("Title for create and rename."),
    genre: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        `Genre for create. Short and script works must use one of: ${SHORT_BOOK_GENRES.join(", ")}. Long works take any short label.`
      )
  })
  .strict();

export const ExternalWriteEntryInputSchema = z
  .object({
    libraryId: IdSchema.describe("Library id from list_libraries."),
    entryId: IdSchema.describe("Entry id from get_library."),
    content: ContentSchema.describe("The entry's complete new text."),
    baseRevision: BaseRevisionSchema
  })
  .strict();

export const ExternalManageEntryInputSchema = z
  .object({
    action: z.enum(["create", "rename", "move", "duplicate", "delete"]),
    libraryId: IdSchema.describe("Library id from list_libraries."),
    entryId: IdSchema.optional().describe("Required except for create."),
    title: TitleSchema.optional().describe("Title for create and rename."),
    content: ContentSchema.optional().describe("Text for create."),
    stageId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Category for create and move."),
    targetLibraryId: IdSchema.optional().describe(
      "Destination library for move. Must be the same domain."
    )
  })
  .strict();

export const ExternalManageLibraryInputSchema = z
  .object({
    action: z.enum(["create", "rename", "duplicate", "delete"]),
    libraryId: IdSchema.optional().describe("Required except for create."),
    domain: LibraryDomainSchema.optional().describe("Domain for create."),
    title: TitleSchema.optional().describe("Title for create and rename."),
    kind: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Library kind for create, such as character or general.")
  })
  .strict();

const TeamIdSchema = z.string().trim().min(1).max(120);

export const ExternalSaveAgentTeamInputSchema = z
  .object({
    teamId: TeamIdSchema.describe("Team id from list_agent_teams."),
    settings: z
      .record(z.string(), z.unknown())
      .describe("The team's complete settings, edited from list_agent_teams."),
    baseRevision: BaseRevisionSchema
  })
  .strict();

export const ExternalManageAgentTeamInputSchema = z
  .object({
    action: z.enum(["create", "rename", "enable", "disable", "delete"]),
    teamId: TeamIdSchema.optional().describe("Required except for create."),
    type: WorkTypeSchema.optional().describe("Work type for create."),
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Name for create and rename.")
  })
  .strict();

export const ExternalListTrashInputSchema = z.object({}).strict();

export const ExternalRestoreTrashItemInputSchema = z
  .object({ trashId: IdSchema.describe("Id from list_trash.") })
  .strict();

export type ExternalWriteDocumentInput = z.infer<
  typeof ExternalWriteDocumentInputSchema
>;
export type ExternalManageDocumentInput = z.infer<
  typeof ExternalManageDocumentInputSchema
>;
export type ExternalManageWorkInput = z.infer<
  typeof ExternalManageWorkInputSchema
>;
export type ExternalWriteEntryInput = z.infer<
  typeof ExternalWriteEntryInputSchema
>;
export type ExternalManageEntryInput = z.infer<
  typeof ExternalManageEntryInputSchema
>;
export type ExternalManageLibraryInput = z.infer<
  typeof ExternalManageLibraryInputSchema
>;
export type ExternalSaveAgentTeamInput = z.infer<
  typeof ExternalSaveAgentTeamInputSchema
>;
export type ExternalManageAgentTeamInput = z.infer<
  typeof ExternalManageAgentTeamInputSchema
>;
export type ExternalRestoreTrashItemInput = z.infer<
  typeof ExternalRestoreTrashItemInputSchema
>;

export const ExternalMutationResultSchema = z
  .object({
    id: IdSchema.optional(),
    title: z.string().min(1).optional(),
    /** Pass as baseRevision to write the same text again. */
    revision: z.string().min(1).optional(),
    /** Present after a delete; restores it through restore_trash_item. */
    trashId: IdSchema.optional()
  })
  .strict();
export type ExternalMutationResult = z.infer<
  typeof ExternalMutationResultSchema
>;

const TrashBaseSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  deletedAt: z.string().datetime(),
  client: z.string().min(1)
});

/**
 * Sections and entries are saved here before deletion. Projects are only taken
 * off the list: their folders stay put, so a project record holds just a path.
 */
export const ExternalTrashRecordSchema = z.discriminatedUnion("kind", [
  TrashBaseSchema.extend({
    kind: z.literal("section"),
    bookId: IdSchema,
    body: z.string(),
    characterState: z.string(),
    wordCountRequirement: z.string().optional()
  }),
  TrashBaseSchema.extend({
    kind: z.literal("entry"),
    domain: LibraryDomainSchema,
    libraryId: IdSchema,
    stageId: z.string().min(1),
    content: z.string()
  }),
  TrashBaseSchema.extend({
    kind: z.literal("team"),
    workspaceType: WorkTypeSchema,
    settings: z.unknown()
  }),
  TrashBaseSchema.extend({
    kind: z.literal("project"),
    domain: z.enum(["book", "long", "material", "skill"]),
    projectId: IdSchema,
    projectDirectory: z.string().min(1)
  })
]);
export type ExternalTrashRecord = z.infer<typeof ExternalTrashRecordSchema>;

export const ExternalListTrashResultSchema = z
  .object({
    items: z.array(
      z
        .object({
          trashId: IdSchema,
          kind: z.enum(["section", "entry", "team", "project"]),
          title: z.string().min(1),
          deletedAt: z.string().datetime(),
          /** Null for projects, whose folders are never removed. */
          expiresAt: z.string().datetime().nullable()
        })
        .strict()
    )
  })
  .strict();
