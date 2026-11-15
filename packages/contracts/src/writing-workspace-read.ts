import { z } from "zod";
import { EnvelopeBaseSchema, EnvelopeContextSchema } from "./envelope";
import {
  CreativePlotStagesSchema,
  BookCharacterStructureSchema
} from "./catalog";
import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "./expert-draft";

const id = z.string().min(1).max(4096);
const file = z.object({ id, title: z.string() });
const scope = { bookId: id, bookType: z.enum(["short", "script"]) };

export const WritingReadQuerySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("index"),
      counts: z.enum(["workspace", "draft"]).optional()
    })
    .strict(),
  z
    .object({
      mode: z.literal("file"),
      documentId: id,
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(50000).optional()
    })
    .strict()
]);
export type WritingReadQuery = z.infer<typeof WritingReadQuerySchema>;
export const WritingReadCommandSchema = EnvelopeBaseSchema.extend({
  type: z.literal("catalog.readWritingWorkspace"),
  context: EnvelopeContextSchema.extend({
    sessionId: id,
    runId: id,
    resourceId: id
  }),
  payload: z.object({ ...scope, query: WritingReadQuerySchema }).strict()
});
export type WritingReadCommand = z.infer<typeof WritingReadCommandSchema>;

export const WritingIndexSchema = z.object({
  mode: z.literal("index"),
  title: z.string(),
  overview: file,
  characterStructure: BookCharacterStructureSchema,
  plotStages: CreativePlotStagesSchema,
  sections: z.array(
    z.object({
      id,
      title: z.string(),
      wordCountRequirement: z.string(),
      body: file,
      characterState: file
    })
  ),
  createdSections: z.array(z.object({ clientSectionId: id, sectionId: id })),
  counts: z.array(
    z.object({
      id,
      revision: z.string(),
      length: z.number().int().nonnegative(),
      characters: z.number().int().nonnegative()
    })
  )
});
export type WritingIndex = z.infer<typeof WritingIndexSchema>;
export const WritingFileSchema = z.object({
  mode: z.literal("file"),
  id,
  content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
  revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
  length: z.number().int().nonnegative(),
  characters: z.number().int().nonnegative()
});
export type WritingFile = z.infer<typeof WritingFileSchema>;
