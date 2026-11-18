import { z } from "zod";
import { CatalogIdSchema } from "./catalog/kinds";
import { SaveDocumentResultSchema } from "./catalog/mutations";
import { DocumentVersionOriginSchema } from "./document-version-origin";
import { EnvelopeBaseSchema } from "./envelope";
import { LongBookIdSchema, LongFileIdSchema } from "./long-workspace";
import { LongWriteDocumentResultSchema } from "./long-workspace-api";
import {
  MysteryBookIdSchema,
  MysteryDocumentTargetSchema,
  MysteryWriteDocumentResultSchema
} from "./mystery";

export { DocumentVersionOriginSchema } from "./document-version-origin";
export type { DocumentVersionOrigin } from "./document-version-origin";

export const DOCUMENT_VERSION_LIMIT = 100;
export const DocumentVersionTargetSchema = z.discriminatedUnion("workspace", [
  z
    .object({
      workspace: z.literal("catalog"),
      bookId: CatalogIdSchema,
      documentId: CatalogIdSchema
    })
    .strict(),
  z
    .object({
      workspace: z.literal("long"),
      bookId: LongBookIdSchema,
      fileId: LongFileIdSchema
    })
    .strict(),
  z
    .object({
      workspace: z.literal("mystery"),
      bookId: MysteryBookIdSchema,
      targetKey: z.string().min(1).max(512),
      target: MysteryDocumentTargetSchema
    })
    .strict()
]);
export type DocumentVersionTarget = z.infer<typeof DocumentVersionTargetSchema>;

export const DocumentVersionIdSchema = z
  .string()
  .regex(/^v[1-9]\d*-[0-9a-f]{8}$/u);
export const DocumentVersionCurrentSchema = z
  .object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    charCount: z.number().int().nonnegative()
  })
  .strict();
export type DocumentVersionCurrent = z.infer<
  typeof DocumentVersionCurrentSchema
>;

export const DocumentVersionSummarySchema = DocumentVersionCurrentSchema.extend(
  {
    id: DocumentVersionIdSchema,
    seq: z.number().int().positive(),
    kind: z.enum(["pre_conversation", "conversation", "restore"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    origin: DocumentVersionOriginSchema.optional(),
    reason: z.literal("restore").optional(),
    restoredFromSeq: z.number().int().positive().optional()
  }
)
  .strict()
  .superRefine((version, context) => {
    if (version.kind === "conversation" && !version.origin) {
      context.addIssue({
        code: "custom",
        path: ["origin"],
        message: "Conversation versions require an origin."
      });
    }
    if (version.kind === "restore" && !version.restoredFromSeq) {
      context.addIssue({
        code: "custom",
        path: ["restoredFromSeq"],
        message: "Restore versions require a source sequence."
      });
    }
    if (version.reason && version.kind !== "pre_conversation") {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Only pre-conversation versions have a reason."
      });
    }
  });
export type DocumentVersionSummary = z.infer<
  typeof DocumentVersionSummarySchema
>;

export const DocumentVersionIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    target: DocumentVersionTargetSchema,
    nextSeq: z.number().int().positive(),
    versions: z.array(DocumentVersionSummarySchema).max(DOCUMENT_VERSION_LIMIT)
  })
  .strict();
export type DocumentVersionIndex = z.infer<typeof DocumentVersionIndexSchema>;

export const ListDocumentVersionsInputSchema = z
  .object({ target: DocumentVersionTargetSchema })
  .strict();
export type ListDocumentVersionsInput = z.infer<
  typeof ListDocumentVersionsInputSchema
>;
export const ListDocumentVersionsResultSchema = z
  .object({
    versions: z.array(DocumentVersionSummarySchema).max(DOCUMENT_VERSION_LIMIT),
    current: DocumentVersionCurrentSchema.nullable()
  })
  .strict();
export type ListDocumentVersionsResult = z.infer<
  typeof ListDocumentVersionsResultSchema
>;

export const ReadDocumentVersionInputSchema =
  ListDocumentVersionsInputSchema.extend({
    versionId: DocumentVersionIdSchema
  }).strict();
export type ReadDocumentVersionInput = z.infer<
  typeof ReadDocumentVersionInputSchema
>;
export const ReadDocumentVersionResultSchema = z
  .object({ version: DocumentVersionSummarySchema, content: z.string() })
  .strict();
export type ReadDocumentVersionResult = z.infer<
  typeof ReadDocumentVersionResultSchema
>;

export const RestoreDocumentVersionInputSchema =
  ReadDocumentVersionInputSchema.extend({
    expectedCurrentSha256: DocumentVersionCurrentSchema.shape.sha256
  }).strict();
export type RestoreDocumentVersionInput = z.infer<
  typeof RestoreDocumentVersionInputSchema
>;
const restoreResultShape = {
  version: DocumentVersionSummarySchema.nullable(),
  current: DocumentVersionCurrentSchema
};
export const RestoreDocumentVersionResultSchema = z.discriminatedUnion(
  "workspace",
  [
    z
      .object({
        ...restoreResultShape,
        workspace: z.literal("catalog"),
        document: SaveDocumentResultSchema
      })
      .strict(),
    z
      .object({
        ...restoreResultShape,
        workspace: z.literal("long"),
        document: LongWriteDocumentResultSchema
      })
      .strict(),
    z
      .object({
        ...restoreResultShape,
        workspace: z.literal("mystery"),
        document: MysteryWriteDocumentResultSchema
      })
      .strict()
  ]
);
export type RestoreDocumentVersionResult = z.infer<
  typeof RestoreDocumentVersionResultSchema
>;

export interface DocumentVersionsApi {
  list(input: ListDocumentVersionsInput): Promise<ListDocumentVersionsResult>;
  read(input: ReadDocumentVersionInput): Promise<ReadDocumentVersionResult>;
  restore(
    input: RestoreDocumentVersionInput
  ): Promise<RestoreDocumentVersionResult>;
}

export const DocumentVersionCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("versions.list"),
    payload: ListDocumentVersionsInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("versions.read"),
    payload: ReadDocumentVersionInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("versions.restore"),
    payload: RestoreDocumentVersionInputSchema
  })
] as const;
export const DocumentVersionCommandEnvelopeSchema = z.discriminatedUnion(
  "type",
  DocumentVersionCommandSchemas
);
export type DocumentVersionCommandEnvelope = z.infer<
  typeof DocumentVersionCommandEnvelopeSchema
>;

export const DOCUMENT_VERSION_ERROR_CODES = [
  "version.unavailable",
  "version.conflict",
  "version.busy",
  "version.disabled"
] as const;
