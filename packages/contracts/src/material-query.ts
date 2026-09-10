import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { MaterialMetadataSchema } from "./material-metadata";
import { MaterialKindSchema } from "./catalog";

const MaterialQueryKindSchema = MaterialKindSchema;

/** Main creates this scope from the accepted workspace and saved agent profile. */
export const MaterialReadScopeSchema = z
  .object({
    bookId: z.string().min(1).max(512),
    bookType: z.enum(["short", "script", "long"]),
    stageId: z.string().min(1).max(120),
    kinds: z.array(MaterialQueryKindSchema).max(5)
  })
  .strict();
export type MaterialReadScope = z.infer<typeof MaterialReadScopeSchema>;

export const MaterialCatalogEntrySchema = z
  .object({
    id: z.string().min(1).max(1200),
    title: z.string().min(1).max(240),
    libraryId: z.string().min(1).max(512),
    entryId: z.string().min(1).max(512),
    kind: MaterialQueryKindSchema,
    metadata: MaterialMetadataSchema,
    revision: z.string().min(1).max(256),
    matchSnippet: z.string().max(220).optional()
  })
  .strict();
export type MaterialCatalogEntry = z.infer<typeof MaterialCatalogEntrySchema>;

export const MaterialQueryInputSchema = z
  .object({
    scope: MaterialReadScopeSchema,
    mode: z.enum(["list", "search", "read"]),
    query: z.string().max(300).optional(),
    entry_name: z.string().max(512).optional(),
    entry_id: z.string().max(1200).optional(),
    material_kind: MaterialQueryKindSchema.optional(),
    expected_revision: z.string().max(256).optional(),
    cursor: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(64).default(32)
  })
  .strict();
export type MaterialQueryInput = z.infer<typeof MaterialQueryInputSchema>;

export const MaterialQueryResultSchema = z
  .object({
    status: z.enum(["ok", "not_found", "ambiguous"]),
    entries: z.array(MaterialCatalogEntrySchema).max(64),
    total: z.number().int().nonnegative(),
    nextCursor: z.number().int().nonnegative().optional(),
    content: z.string().optional(),
    revisionChanged: z.boolean().optional(),
    notices: z.array(z.string().max(600)).max(20).default([])
  })
  .strict();
export type MaterialQueryResult = z.infer<typeof MaterialQueryResultSchema>;

export const MaterialCatalogContextSchema = z
  .object({
    scope: MaterialReadScopeSchema,
    entries: z.array(MaterialCatalogEntrySchema).max(64),
    total: z.number().int().nonnegative(),
    nextCursor: z.number().int().nonnegative().optional(),
    notices: z.array(z.string().max(600)).max(20).default([])
  })
  .strict();
export type MaterialCatalogContext = z.infer<
  typeof MaterialCatalogContextSchema
>;

/** Internal Main/Agent -> Core command. Not exposed by the Preload API. */
export const CatalogQueryMaterialsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.queryMaterials"),
    payload: MaterialQueryInputSchema
  });
export type CatalogQueryMaterialsCommand = z.infer<
  typeof CatalogQueryMaterialsCommandEnvelopeSchema
>;
