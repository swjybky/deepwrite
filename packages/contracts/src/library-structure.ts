import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { AgentRuntimeRefSchema } from "./session/agent-event-identity";

const Id = z.string().trim().min(1).max(512);
const Title = z.string().trim().min(1).max(256);
const Domain = z.enum(["material", "skill"]);
const LibraryType = z.enum(["short", "script", "long"]);
const Kind = z.enum([
  "character",
  "gimmick",
  "plot",
  "draft",
  "other",
  "mixed",
  "general",
  "style"
]);
const Order = {
  id: Id,
  anchorId: Id,
  position: z.enum(["before", "after"]),
  groupId: Id.optional()
};
export const LibraryStructureOperationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create-unbound-entry"),
      ref: Id,
      title: Title,
      content: z.string().max(40000),
      stageId: z.string().min(1).max(120),
      libraryType: LibraryType.optional(),
      skillKind: z.enum(["general", "plot", "style", "other"]).optional()
    })
    .strict(),
  z
    .object({
      action: z.literal("create-library"),
      ref: Id,
      title: Title,
      kind: Kind,
      libraryType: LibraryType.optional()
    })
    .strict(),
  z
    .object({ action: z.literal("rename-library"), id: Id, title: Title })
    .strict(),
  z.object({ action: z.literal("reorder-library"), ...Order }).strict(),
  z.object({ action: z.literal("delete-library"), id: Id }).strict(),
  z
    .object({
      action: z.literal("create-group"),
      ref: Id,
      title: Title,
      members: z.partialRecord(Kind, Id)
    })
    .strict(),
  z
    .object({ action: z.literal("rename-group"), id: Id, title: Title })
    .strict(),
  z
    .object({
      action: z.literal("set-members"),
      id: Id,
      members: z.partialRecord(Kind, Id)
    })
    .strict(),
  z.object({ action: z.literal("reorder-group"), ...Order }).strict(),
  z.object({ action: z.literal("dissolve-group"), id: Id }).strict(),
  z
    .object({
      action: z.literal("delete-group"),
      id: Id,
      includeLibraries: z.boolean()
    })
    .strict(),
  z
    .object({
      action: z.literal("move-entries"),
      targetStageId: z
        .enum([
          "character",
          "gimmick",
          "pacing",
          "intro",
          "plot_refine",
          "draft_excerpt",
          "other"
        ])
        .optional(),
      beforeEntryId: Id.optional(),
      libraryId: Id,
      entryIds: z.array(Id).min(1).max(128),
      target: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("library"), libraryId: Id }).strict(),
        z.object({ kind: z.literal("unbound") }).strict()
      ])
    })
    .strict(),
  z
    .object({
      action: z.literal("reorder-entry"),
      libraryId: Id,
      id: Id,
      anchorId: Id,
      position: z.enum(["before", "after"])
    })
    .strict(),
  z
    .object({
      action: z.literal("delete-entries"),
      libraryId: Id,
      entryIds: z.array(Id).min(1).max(128)
    })
    .strict()
]);
export type LibraryStructureOperation = z.infer<
  typeof LibraryStructureOperationSchema
>;
export const LibraryStructureRequestSchema = z
  .object({
    domain: Domain,
    requestId: Id,
    operations: z.array(LibraryStructureOperationSchema).min(1).max(32)
  })
  .strict();
export type LibraryStructureRequest = z.infer<
  typeof LibraryStructureRequestSchema
>;
export const LibraryStructurePlanSchema = LibraryStructureRequestSchema.extend({
  baseVersion: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.string().min(1).max(64000)
}).strict();
export type LibraryStructurePlan = z.infer<typeof LibraryStructurePlanSchema>;
export const LibraryStructureResultSchema = z
  .object({ requestId: Id, applied: z.literal(true) })
  .strict();
export const CatalogPreviewLibraryStructureCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.previewLibraryStructure"),
    payload: LibraryStructureRequestSchema
  });
export const CatalogApplyLibraryStructureCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.applyLibraryStructure"),
    payload: LibraryStructurePlanSchema
  });
export const LibraryStructureProposalEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("library.structure_proposal"),
    payload: z
      .object({
        sessionId: Id,
        runId: Id,
        toolCallId: Id,
        plan: LibraryStructurePlanSchema,
        runtime: AgentRuntimeRefSchema
      })
      .strict()
  });
export type LibraryStructureProposalEventEnvelope = z.infer<
  typeof LibraryStructureProposalEventEnvelopeSchema
>;

export function libraryStructureOperationJsonSchema(
  actions: readonly LibraryStructureOperation["action"][]
) {
  const options = LibraryStructureOperationSchema.options.filter((schema) =>
    actions.includes(schema.shape.action.value)
  );
  const json = z.toJSONSchema(
    z.union(
      options as [
        (typeof options)[number],
        (typeof options)[number],
        ...(typeof options)[number][]
      ]
    ),
    { target: "draft-7" }
  );
  // Older proposals may still contain this field; new tools no longer offer it.
  for (const option of json.anyOf ?? []) {
    if (option && typeof option === "object" && "properties" in option)
      delete option.properties?.libraryType;
  }
  return json;
}

const TransactionFileSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("write"),
      path: Id,
      content: z.string().max(32 * 1024 * 1024),
      expectedSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable()
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      path: Id,
      expectedSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable()
    })
    .strict(),
  z
    .object({
      action: z.literal("check"),
      path: Id,
      expectedSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable()
    })
    .strict()
]);
/** Internal Core journal; never accepted as a command payload. */
export const LibraryStructureTransactionJournalSchema = z
  .object({
    version: z.literal(1),
    roots: z
      .array(
        z
          .object({
            root: z.string().min(1).max(8192),
            files: z.array(TransactionFileSchema).max(20000)
          })
          .strict()
      )
      .max(1024)
  })
  .strict();
