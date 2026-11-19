import { z } from "zod";
import {
  LibraryCustomTagSchema,
  MATERIAL_GROUP_LEGACY_SLOTS,
  MaterialStageIdSchema,
  extractLegacyGroupMemberIds
} from "./catalog/kinds";
import { LibraryManagementScopeSchema } from "./library-management-scope";
import { EnvelopeBaseSchema } from "./envelope";
import { AgentRuntimeRefSchema } from "./session/agent-event-identity";

const Id = z.string().trim().min(1).max(512);
const Title = z.string().trim().min(1).max(256);
const Domain = z.enum(["material", "skill"]);
const LibraryTarget = z
  .object({ kind: z.literal("library"), libraryId: Id })
  .strict();
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

function migrateLegacyStructureOperation(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (record.action !== "create-group" && record.action !== "set-members") {
    return value;
  }
  if (Array.isArray(record.memberIds)) {
    if ("members" in record) {
      const { members: _members, ...rest } = record;
      return rest;
    }
    return value;
  }
  if (
    record.members !== null &&
    typeof record.members === "object" &&
    !Array.isArray(record.members)
  ) {
    const { members, ...rest } = record;
    return {
      ...rest,
      memberIds: extractLegacyGroupMemberIds(
        members,
        MATERIAL_GROUP_LEGACY_SLOTS
      )
    };
  }
  return value;
}

const DeleteGroupOperationSchema = z.strictObject({
  action: z.literal("delete-group"),
  id: Id,
  includeLibraries: z.boolean()
});
export const DeleteGroupToolOperationSchema = DeleteGroupOperationSchema.omit({
  includeLibraries: true
})
  .extend({
    deletion_scope: z
      .enum(["group_only", "group_and_libraries"])
      .describe("group_only 保留成员库，group_and_libraries 同时移除成员库。")
  })
  .transform(({ deletion_scope, ...operation }) => ({
    ...operation,
    includeLibraries: deletion_scope === "group_and_libraries"
  }));

const LibraryStructureOperationUnionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("copy-entries"),
      libraryId: Id,
      entryIds: z.array(Id).min(1).max(128),
      target: LibraryTarget,
      targetStageId: MaterialStageIdSchema.optional()
    })
    .strict(),
  z
    .object({
      action: z.literal("archive-entries"),
      libraryId: Id,
      entryIds: z.array(Id).min(1).max(128)
    })
    .strict(),
  z
    .object({
      action: z.literal("restore-entries"),
      libraryId: Id,
      recoveryId: Id,
      entryIds: z.array(Id).min(1).max(128)
    })
    .strict(),
  z
    .object({
      action: z.literal("create-unbound-entry"),
      ref: Id,
      title: Title,
      content: z.string().max(40000),
      stageId: z.string().min(1).max(120),
      libraryType: LibraryType.optional(),
      /** Accepted when replaying proposals generated before loose skills were shared. */
      skillKind: z.enum(["general", "plot", "style", "other"]).optional()
    })
    .strict(),
  z
    .object({
      action: z.literal("create-library"),
      ref: Id,
      title: Title,
      kind: Kind,
      customTag: LibraryCustomTagSchema.optional(),
      libraryType: LibraryType.optional()
    })
    .strict(),
  z
    .object({
      action: z.literal("rename-library"),
      id: Id,
      title: Title,
      customTag: LibraryCustomTagSchema.nullable().optional()
    })
    .strict(),
  z.object({ action: z.literal("reorder-library"), ...Order }).strict(),
  z.object({ action: z.literal("delete-library"), id: Id }).strict(),
  z
    .object({
      action: z.literal("create-group"),
      ref: Id,
      title: Title,
      memberIds: z.array(Id).max(512)
    })
    .strict(),
  z
    .object({ action: z.literal("rename-group"), id: Id, title: Title })
    .strict(),
  z
    .object({
      action: z.literal("set-members"),
      id: Id,
      memberIds: z.array(Id).max(512)
    })
    .strict(),
  z.object({ action: z.literal("reorder-group"), ...Order }).strict(),
  z.object({ action: z.literal("dissolve-group"), id: Id }).strict(),
  DeleteGroupOperationSchema,
  z
    .object({
      action: z.literal("move-entries"),
      targetStageId: MaterialStageIdSchema.optional(),
      beforeEntryId: Id.optional(),
      libraryId: Id,
      entryIds: z.array(Id).min(1).max(128),
      target: z.discriminatedUnion("kind", [
        LibraryTarget,
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
export const LibraryStructureOperationSchema = z.preprocess(
  migrateLegacyStructureOperation,
  LibraryStructureOperationUnionSchema
);
export type LibraryStructureOperation = z.infer<
  typeof LibraryStructureOperationSchema
>;
export type LibraryStructureToolOperation =
  | Exclude<LibraryStructureOperation, { action: "delete-group" }>
  | z.input<typeof DeleteGroupToolOperationSchema>;
export const LibraryStructureRequestSchema = z
  .object({
    domain: Domain,
    requestId: Id,
    managementScope: LibraryManagementScopeSchema.optional(),
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
  const options = LibraryStructureOperationUnionSchema.options
    .filter((schema) => actions.includes(schema.shape.action.value))
    .map((schema) =>
      schema === DeleteGroupOperationSchema
        ? DeleteGroupToolOperationSchema
        : schema
    );
  const json = z.toJSONSchema(
    z.union(
      options as [
        (typeof options)[number],
        (typeof options)[number],
        ...(typeof options)[number][]
      ]
    ),
    { target: "draft-7", io: "input" }
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
