import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  CreateLongBookAtPathInputSchema,
  CreateLongBookInputSchema,
  LongApplyLegacySyncAtPathInputSchema,
  LongApplyLegacySyncInputSchema,
  LongApplyOperationsInputSchema,
  LongDuplicateBookInputSchema,
  LongImportContinuationAtPathInputSchema,
  LongImportContinuationInputSchema,
  LongImportPortableAtPathInputSchema,
  LongOpenBookAtPathInputSchema,
  LongOpenBookInputSchema,
  LongPreviewContinuationImportAtPathInputSchema,
  LongPreviewLegacySyncAtPathInputSchema,
  LongPreviewOperationsInputSchema,
  LongReadAgentsMdInputSchema,
  LongReadDocumentInputSchema,
  LongRemoveBookInputSchema,
  LongRenameBookInputSchema,
  LongSearchInputSchema,
  LongUpdateBindingsInputSchema,
  LongWriteAgentsMdInputSchema,
  LongWriteDocumentInputSchema
} from "./long-workspace-api";
import {
  LongCommitChapterInputSchema,
  LongDeleteLedgerCommitInputSchema,
  LongWriteChapterInputSchema
} from "./long-ledger";
import { LongResolveConflictsCommandEnvelopeSchema } from "./long-project-recovery";
export const LongCreateBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.createBook"),
  payload: CreateLongBookInputSchema
});
export const LongCreateBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.createBookAtPath"),
    payload: CreateLongBookAtPathInputSchema
  });
export const LongDuplicateBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("long.duplicateBook"),
    payload: LongDuplicateBookInputSchema
  }
);
export const LongChooseLegacySyncSourceCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.chooseLegacySyncSource"),
    payload: z.object({}).strict()
  });
export const LongPreviewLegacySyncAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.previewLegacySyncAtPath"),
    payload: LongPreviewLegacySyncAtPathInputSchema
  });
export const LongApplyLegacySyncCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.applyLegacySync"),
    payload: LongApplyLegacySyncInputSchema
  });
export const LongApplyLegacySyncAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.applyLegacySyncAtPath"),
    payload: LongApplyLegacySyncAtPathInputSchema
  });
export const LongImportPortableCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.importPortable"),
    payload: z.object({}).strict()
  });
export const LongImportPortableAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.importPortableAtPath"),
    payload: LongImportPortableAtPathInputSchema
  });
export const LongChooseContinuationImportSourceCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.chooseContinuationImportSource"),
    payload: z.object({}).strict()
  });
export const LongPreviewContinuationImportAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.previewContinuationImportAtPath"),
    payload: LongPreviewContinuationImportAtPathInputSchema
  });
export const LongImportContinuationCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.importContinuation"),
    payload: LongImportContinuationInputSchema
  });
export const LongImportContinuationAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.importContinuationAtPath"),
    payload: LongImportContinuationAtPathInputSchema
  });
export const LongListBooksCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.list"),
  payload: z.object({}).strict()
});
export const LongOpenBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.open"),
  payload: LongOpenBookInputSchema
});
export const LongRenameBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.rename"),
  payload: LongRenameBookInputSchema
});
export const LongUpdateBindingsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.updateBindings"),
    payload: LongUpdateBindingsInputSchema
  });
export const LongOpenBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.openAtPath"),
    payload: LongOpenBookAtPathInputSchema
  });
export const LongOpenExistingBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.openExisting"),
    payload: z.object({}).strict()
  });
export const LongUnregisterBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.unregister"),
    payload: LongRemoveBookInputSchema
  });
export const LongDeleteBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.delete"),
  payload: LongRemoveBookInputSchema
});
export const LongGetWorkspaceIndexCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.getWorkspaceIndex"),
    payload: LongOpenBookInputSchema
  });
export const LongReadDocumentCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.readDocument"),
  payload: LongReadDocumentInputSchema
});
export const LongSearchCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.search"),
  payload: LongSearchInputSchema
});
export const LongWriteDocumentCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("long.writeDocument"),
    payload: LongWriteDocumentInputSchema
  }
);
export const LongReadAgentsMdCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.readAgentsMd"),
  payload: LongReadAgentsMdInputSchema
});
export const LongWriteAgentsMdCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("long.writeAgentsMd"),
    payload: LongWriteAgentsMdInputSchema
  }
);
export const LongPreviewOperationsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.previewOperations"),
    payload: LongPreviewOperationsInputSchema
  });
export const LongApplyOperationsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.applyOperations"),
    payload: LongApplyOperationsInputSchema
  });
export const LongWriteChapterCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.writeChapter"),
  payload: LongWriteChapterInputSchema
});
export const LongCommitChapterCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("long.commitChapter"),
    payload: LongCommitChapterInputSchema
  }
);
export const LongDeleteLedgerCommitCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.deleteLedgerCommit"),
    payload: LongDeleteLedgerCommitInputSchema
  });
export const LongWorkspaceCommandSchemas = [
  LongResolveConflictsCommandEnvelopeSchema,
  LongCreateBookCommandEnvelopeSchema,
  LongCreateBookAtPathCommandEnvelopeSchema,
  LongDuplicateBookCommandEnvelopeSchema,
  LongChooseLegacySyncSourceCommandEnvelopeSchema,
  LongPreviewLegacySyncAtPathCommandEnvelopeSchema,
  LongApplyLegacySyncCommandEnvelopeSchema,
  LongApplyLegacySyncAtPathCommandEnvelopeSchema,
  LongImportPortableCommandEnvelopeSchema,
  LongImportPortableAtPathCommandEnvelopeSchema,
  LongChooseContinuationImportSourceCommandEnvelopeSchema,
  LongPreviewContinuationImportAtPathCommandEnvelopeSchema,
  LongImportContinuationCommandEnvelopeSchema,
  LongImportContinuationAtPathCommandEnvelopeSchema,
  LongListBooksCommandEnvelopeSchema,
  LongOpenBookCommandEnvelopeSchema,
  LongRenameBookCommandEnvelopeSchema,
  LongUpdateBindingsCommandEnvelopeSchema,
  LongOpenExistingBookCommandEnvelopeSchema,
  LongOpenBookAtPathCommandEnvelopeSchema,
  LongUnregisterBookCommandEnvelopeSchema,
  LongDeleteBookCommandEnvelopeSchema,
  LongGetWorkspaceIndexCommandEnvelopeSchema,
  LongReadDocumentCommandEnvelopeSchema,
  LongSearchCommandEnvelopeSchema,
  LongWriteDocumentCommandEnvelopeSchema,
  LongReadAgentsMdCommandEnvelopeSchema,
  LongWriteAgentsMdCommandEnvelopeSchema,
  LongPreviewOperationsCommandEnvelopeSchema,
  LongApplyOperationsCommandEnvelopeSchema,
  LongWriteChapterCommandEnvelopeSchema,
  LongCommitChapterCommandEnvelopeSchema,
  LongDeleteLedgerCommitCommandEnvelopeSchema
] as const;
export const LongWorkspaceCommandEnvelopeSchema = z.discriminatedUnion(
  "type",
  LongWorkspaceCommandSchemas
);
export type LongWorkspaceCommandEnvelope = z.infer<
  typeof LongWorkspaceCommandEnvelopeSchema
>;
