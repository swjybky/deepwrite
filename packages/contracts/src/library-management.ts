import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  LibraryAgentDomainSchema,
  LibraryAgentProfileSchema,
  LibraryAgentWorkspaceSnapshotSchema
} from "./library-agent";
import { LibraryManagementScopeSchema } from "./library-management-scope";

import { BuiltinSubagentSettingSchema } from "./builtin-subagents";

export const LibraryManagementCandidateSchema = z
  .object({
    libraryId: z.string().min(1).max(512),
    domain: LibraryAgentDomainSchema,
    title: z.string().min(1).max(256),
    readOnly: z.boolean()
  })
  .strict();
export type LibraryManagementCandidate = z.infer<
  typeof LibraryManagementCandidateSchema
>;
export const LibraryManagementQueryInputSchema = z
  .object({
    scope: LibraryManagementScopeSchema,
    domain: LibraryAgentDomainSchema.optional(),
    libraryId: z.string().min(1).max(512).optional()
  })
  .strict()
  .refine(
    (value) => !value.libraryId || !!value.domain,
    "Target library requires domain."
  );
export type LibraryManagementQueryInput = z.infer<
  typeof LibraryManagementQueryInputSchema
>;
export const LibraryManagementQueryResultSchema = z
  .object({
    libraries: z.array(LibraryManagementCandidateSchema),
    workspace: LibraryAgentWorkspaceSnapshotSchema.optional()
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
            description: BuiltinSubagentSettingSchema.shape.description,
            profile: LibraryAgentProfileSchema
          })
          .strict()
      )
      .max(2)
  })
  .strict()
  .superRefine((value, ctx) => {
    const domains = new Set<string>();
    for (const [index, manager] of value.managers.entries()) {
      if (
        manager.domain !== manager.profile.domain ||
        domains.has(manager.domain)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["managers", index],
          message: "Manager domains must be unique and match their profile."
        });
      }
      domains.add(manager.domain);
    }
  });
export type LibraryManagementRuntimeContext = z.infer<
  typeof LibraryManagementRuntimeContextSchema
>;
