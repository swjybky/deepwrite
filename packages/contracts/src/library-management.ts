import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  LIBRARY_AGENT_ENTRY_MAX_CHARACTERS,
  LibraryAgentDomainSchema
} from "./library-agent";
import { LibraryManagementScopeSchema } from "./library-management-scope";
import {
  LibraryStructureOperationSchema,
  LibraryStructurePlanSchema
} from "./library-structure";

import { BuiltinSubagentSettingSchema } from "./builtin-subagents";

export const LibraryManagementCandidateSchema = z
  .object({
    libraryId: z.string().min(1).max(512),
    domain: LibraryAgentDomainSchema,
    title: z.string().min(1).max(256),
    readOnly: z.boolean(),
    entryCount: z.number().int().nonnegative().optional()
  })
  .strict();
export type LibraryManagementCandidate = z.infer<
  typeof LibraryManagementCandidateSchema
>;
export const LIBRARY_MANAGEMENT_DIRECTORY_MAX_ENTRIES = 512;
export const LIBRARY_MANAGEMENT_READ_MAX_ENTRIES = 10;
export const LIBRARY_MANAGEMENT_SEARCH_MAX_MATCHES = 200;

const Id = z.string().trim().min(1).max(512);
const Revision = z.string().regex(/^v1:\d+:[0-9a-f]{8}$/);
const OrganizeOperationSchema = LibraryStructureOperationSchema.refine(
  (operation) =>
    operation.action === "move-entries" ||
    operation.action === "copy-entries" ||
    operation.action === "archive-entries" ||
    operation.action === "restore-entries",
  "Work-scoped library management only copies, moves, archives or restores entries."
);

/** What the work-scoped tools ask for; the target library is always bound. */
export const LibraryManagementRequestSchema = z.discriminatedUnion("kind", [
  /** Entry list without text; no entry-count or size cap of a snapshot. */
  z
    .object({
      kind: z.literal("directory"),
      offset: z.number().int().nonnegative().optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("read"),
      entryIds: z
        .array(Id)
        .max(LIBRARY_MANAGEMENT_READ_MAX_ENTRIES)
        .default([]),
      overview: z.boolean().optional()
    })
    .strict(),
  /** Searches every bound library of the domain unless libraryId is given. */
  z
    .object({
      kind: z.literal("search"),
      query: z.string().trim().min(1).max(600),
      offset: z.number().int().nonnegative().optional(),
      stageId: z.string().trim().min(1).max(120).optional(),
      maxMatches: z
        .number()
        .int()
        .min(1)
        .max(LIBRARY_MANAGEMENT_SEARCH_MAX_MATCHES),
      contextChars: z.number().int().min(10).max(500)
    })
    .strict(),
  z
    .object({
      kind: z.literal("preview-structure"),
      requestId: Id,
      operations: z.array(OrganizeOperationSchema).min(1).max(32)
    })
    .strict()
]);
export type LibraryManagementOrganizeOperation = Extract<
  z.infer<typeof LibraryStructureOperationSchema>,
  {
    action:
      "copy-entries" | "move-entries" | "archive-entries" | "restore-entries";
  }
>;
export type LibraryManagementRequest = z.infer<
  typeof LibraryManagementRequestSchema
>;

export const LibraryManagementQueryInputSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    domain: LibraryAgentDomainSchema.optional(),
    libraryId: z.string().min(1).max(512).optional(),
    request: LibraryManagementRequestSchema.optional()
  })
  .strict()
  .refine(
    (value) => !value.libraryId || !!value.domain,
    "Target library requires domain."
  )
  .refine(
    (value) =>
      !value.request ||
      (!!value.domain &&
        (value.request.kind === "search" ||
          value.request.kind === "preview-structure" ||
          !!value.libraryId)),
    "Library requests require domain; directory and read need a library."
  );
export type LibraryManagementQueryInput = z.input<
  typeof LibraryManagementQueryInputSchema
>;

export const LibraryManagementDirectorySchema = z
  .object({
    libraryId: Id,
    title: z.string().min(1).max(256),
    readOnly: z.boolean(),
    projectRevision: z.number().int().nonnegative().optional(),
    overviewDocumentId: z.string().min(1).max(4_096),
    entries: z
      .array(
        z
          .object({
            entryId: Id,
            documentId: z.string().min(1).max(4_096),
            title: z.string().min(1).max(256),
            stageId: z.string().min(1).max(120),
            contentBytes: z.number().int().nonnegative()
          })
          .strict()
      )
      .max(LIBRARY_MANAGEMENT_DIRECTORY_MAX_ENTRIES),
    nextOffset: z.number().int().positive().optional()
  })
  .strict();
export type LibraryManagementDirectory = z.infer<
  typeof LibraryManagementDirectorySchema
>;

export const LibraryManagementDocumentSchema = z
  .object({
    target: z.enum(["entry", "overview"]),
    entryId: Id.optional(),
    documentId: z.string().min(1).max(4_096),
    title: z.string().min(1).max(256),
    stageId: z.string().min(1).max(120).optional(),
    content: z.string().max(LIBRARY_AGENT_ENTRY_MAX_CHARACTERS),
    /** Revision of the full text, also when the content is cut. */
    revision: Revision,
    truncated: z.boolean().optional(),
    originalLength: z.number().int().nonnegative().optional()
  })
  .strict();
export type LibraryManagementDocument = z.infer<
  typeof LibraryManagementDocumentSchema
>;

export const LibraryManagementSearchResultSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            libraryId: Id,
            entryId: Id,
            title: z.string().min(1).max(256),
            stageId: z.string().min(1).max(120),
            titleHit: z.boolean(),
            hits: z.array(
              z
                .object({
                  line: z.number().int().positive(),
                  column: z.number().int().positive(),
                  excerpt: z.string().max(1_600)
                })
                .strict()
            )
          })
          .strict()
      )
      .max(LIBRARY_MANAGEMENT_SEARCH_MAX_MATCHES),
    /** True when the match limit stopped the scan. */
    limited: z.boolean(),
    nextOffset: z.number().int().positive().optional()
  })
  .strict();
export type LibraryManagementSearchResult = z.infer<
  typeof LibraryManagementSearchResultSchema
>;

export const LibraryManagementQueryResultSchema = z
  .object({
    libraries: z.array(LibraryManagementCandidateSchema),
    directory: LibraryManagementDirectorySchema.optional(),
    documents: z
      .array(LibraryManagementDocumentSchema)
      .max(LIBRARY_MANAGEMENT_READ_MAX_ENTRIES + 1)
      .optional(),
    search: LibraryManagementSearchResultSchema.optional(),
    plan: LibraryStructurePlanSchema.optional()
  })
  .strict();
export type LibraryManagementQueryResult = z.infer<
  typeof LibraryManagementQueryResultSchema
>;
export const CatalogQueryLibraryManagementCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.queryLibraryManagement"),
    payload: LibraryManagementQueryInputSchema
  });
export const LibraryManagementRuntimeContextSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    libraries: z.array(LibraryManagementCandidateSchema),
    managers: z
      .array(
        z
          .object({
            domain: LibraryAgentDomainSchema,
            description: BuiltinSubagentSettingSchema.shape.description
          })
          .strict()
      )
      .max(2)
  })
  .strict()
  .superRefine((value, ctx) => {
    const domains = new Set<string>();
    for (const [index, manager] of value.managers.entries()) {
      if (domains.has(manager.domain)) {
        ctx.addIssue({
          code: "custom",
          path: ["managers", index],
          message: "Manager domains must be unique."
        });
      }
      domains.add(manager.domain);
    }
  });
export type LibraryManagementRuntimeContext = z.infer<
  typeof LibraryManagementRuntimeContextSchema
>;
