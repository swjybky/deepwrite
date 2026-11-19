import { z } from "zod";
import {
  LongAgentIdSchema,
  LongBookIdSchema,
  LongChapterCardIdSchema,
  LongCharacterIdSchema,
  LongFileIdSchema,
  LongProjectRelativePathSchema
} from "../long-workspace";
import { LongWorkspaceOperationBatchSchema } from "../long-workspace-operations";
import { LongCommitChapterInputSchema } from "../long-ledger";
import { AgentRuntimeRefSchema } from "./agent-event-identity";

const LongProposalBasePayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  bookId: LongBookIdSchema,
  agentId: LongAgentIdSchema,
  summary: z.string().trim().min(1).max(1_000),
  runtime: AgentRuntimeRefSchema
});

export const LONG_MUTATION_REVIEW_TARGET_KINDS = [
  "worldbuilding_category",
  "worldbuilding_item",
  "character",
  "character_overview",
  "book_line",
  "volume",
  "arc",
  "story_plot",
  "chapter_card",
  "story_event",
  "event_connection",
  "narrative_placement",
  "foreshadowing",
  "foreshadowing_beat",
  "continuity_file"
] as const;
export const LongMutationReviewTargetKindSchema = z.enum(
  LONG_MUTATION_REVIEW_TARGET_KINDS
);
export type LongMutationReviewTargetKind = z.infer<
  typeof LongMutationReviewTargetKindSchema
>;

export const LongMutationContentChangeSchema = z
  .object({
    fileId: LongFileIdSchema.optional(),
    filePath: LongProjectRelativePathSchema.optional(),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(10_000_000),
    afterText: z.string().max(10_000_000)
  })
  .strict();
export type LongMutationContentChange = z.infer<
  typeof LongMutationContentChangeSchema
>;

export const LongMutationReviewSchema = z
  .object({
    targetKey: z.string().trim().min(1).max(320),
    targetKind: LongMutationReviewTargetKindSchema,
    targetId: z.string().trim().min(1).max(200),
    action: z.enum(["create", "edit", "meta", "delete"]),
    title: z.string().trim().min(1).max(600),
    content: LongMutationContentChangeSchema.optional()
  })
  .strict();
export type LongMutationReview = z.infer<typeof LongMutationReviewSchema>;

export const LongMutationProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    review: LongMutationReviewSchema.optional()
  });
export type LongMutationProposalPayload = z.infer<
  typeof LongMutationProposalPayloadSchema
>;

export const LongWorldbuildingFileChangeSchema = z
  .object({
    categoryId: z.string().trim().min(3).max(160),
    itemId: z.string().trim().min(3).max(160).optional(),
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(1_000_000),
    afterText: z.string().max(1_000_000)
  })
  .strict();
export type LongWorldbuildingFileChange = z.infer<
  typeof LongWorldbuildingFileChangeSchema
>;

export const LongWorldbuildingFileProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    files: z.array(LongWorldbuildingFileChangeSchema).min(1).max(100)
  }).superRefine((value, context) => {
    const fileIds = new Set(value.files.map(({ fileId }) => fileId));
    if (fileIds.size !== value.files.length) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Worldbuilding file proposals must target unique files."
      });
    }
    const proposedFileIds = new Set(
      value.batch.documentWrites.map(({ fileId }) => fileId)
    );
    for (const [index, file] of value.files.entries()) {
      if (file.operation !== "create" && !proposedFileIds.has(file.fileId)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "fileId"],
          message:
            "Worldbuilding write and edit changes must have a document write proposal."
        });
      }
    }
  });
export type LongWorldbuildingFileProposalPayload = z.infer<
  typeof LongWorldbuildingFileProposalPayloadSchema
>;

export const LONG_CHARACTER_DOCUMENTS = [
  "core_profile",
  "relationships"
] as const;
export const LongCharacterDocumentSchema = z.enum(LONG_CHARACTER_DOCUMENTS);
export type LongCharacterDocument = z.infer<typeof LongCharacterDocumentSchema>;

/** Stage-level overview is proposed alongside character file changes. */
export const LONG_CHARACTER_OVERVIEW_CHANGE_ID = "characters_overview" as const;
export const LONG_CHARACTER_FILE_CHANGE_DOCUMENTS = [
  ...LONG_CHARACTER_DOCUMENTS,
  "overview"
] as const;
export const LongCharacterFileChangeDocumentSchema = z.enum(
  LONG_CHARACTER_FILE_CHANGE_DOCUMENTS
);
export type LongCharacterFileChangeDocument = z.infer<
  typeof LongCharacterFileChangeDocumentSchema
>;

export const LongCharacterFileChangeSchema = z
  .object({
    characterId: z.string().trim().min(3).max(160),
    characterName: z.string().trim().min(1).max(256),
    document: LongCharacterFileChangeDocumentSchema,
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(1_000_000),
    afterText: z.string().max(1_000_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.document === "overview") {
      if (value.characterId !== LONG_CHARACTER_OVERVIEW_CHANGE_ID) {
        context.addIssue({
          code: "custom",
          path: ["characterId"],
          message:
            "Character overview changes must use the stage-level overview id."
        });
      }
      return;
    }
    if (value.characterId === LONG_CHARACTER_OVERVIEW_CHANGE_ID) {
      context.addIssue({
        code: "custom",
        path: ["characterId"],
        message:
          "Stage-level overview id is reserved for character overview changes."
      });
    }
  });
export type LongCharacterFileChange = z.infer<
  typeof LongCharacterFileChangeSchema
>;

export const LongCharacterFileProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    files: z.array(LongCharacterFileChangeSchema).min(1).max(100)
  }).superRefine((value, context) => {
    const fileIds = new Set(value.files.map(({ fileId }) => fileId));
    if (fileIds.size !== value.files.length) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Character file proposals must target unique files."
      });
    }
    const proposedFileIds = new Set(
      value.batch.documentWrites.map(({ fileId }) => fileId)
    );
    for (const [index, file] of value.files.entries()) {
      if (file.operation !== "create" && !proposedFileIds.has(file.fileId)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "fileId"],
          message:
            "Character write and edit changes must have a document write proposal."
        });
      }
    }
  });
export type LongCharacterFileProposalPayload = z.infer<
  typeof LongCharacterFileProposalPayloadSchema
>;

export const LONG_CONTINUITY_FILE_ROLES = [
  "foreshadowing_changes",
  "world_reveals",
  "character_current_state",
  "character_history",
  "chapter_end_state",
  "handoff"
] as const;
export const LongContinuityFileRoleSchema = z.enum(LONG_CONTINUITY_FILE_ROLES);
export type LongContinuityFileRole = z.infer<
  typeof LongContinuityFileRoleSchema
>;

export const LongContinuityFileChangeSchema = z
  .object({
    chapterCardId: LongChapterCardIdSchema,
    role: LongContinuityFileRoleSchema,
    characterId: LongCharacterIdSchema.nullable().default(null),
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(1_000_000),
    afterText: z.string().max(1_000_000)
  })
  .strict()
  .superRefine((file, context) => {
    const isCharacterRole =
      file.role === "character_current_state" ||
      file.role === "character_history";
    if (isCharacterRole !== (file.characterId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["characterId"],
        message: "Only character continuity roles may carry a character id."
      });
    }
  });
export type LongContinuityFileChange = z.infer<
  typeof LongContinuityFileChangeSchema
>;

export const LongContinuityFileProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    files: z.array(LongContinuityFileChangeSchema).min(1).max(1_024)
  }).superRefine((value, context) => {
    const fileIds = new Set(value.files.map(({ fileId }) => fileId));
    if (fileIds.size !== value.files.length) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Continuity file proposals must target unique files."
      });
    }
    const createdTargets = new Map<
      string,
      {
        chapterCardId: string;
        role: LongContinuityFileRole;
        characterId: string | null;
        filePath: string;
      }
    >();
    const addCreatedTarget = (
      target: {
        chapterCardId: string;
        role: LongContinuityFileRole;
        characterId: string | null;
        fileId: string;
        filePath: string;
      },
      operationIndex: number
    ): void => {
      if (createdTargets.has(target.fileId)) {
        context.addIssue({
          code: "custom",
          path: ["batch", "operations", operationIndex],
          message:
            "Continuity file proposals cannot create the same file twice."
        });
        return;
      }
      createdTargets.set(target.fileId, target);
    };
    value.batch.operations.forEach((operation, operationIndex) => {
      if (operation.type === "chapterContinuity.worldReveals.create") {
        addCreatedTarget(
          {
            chapterCardId: operation.chapterCardId,
            role: "world_reveals",
            characterId: null,
            fileId: operation.file.id,
            filePath: operation.file.path
          },
          operationIndex
        );
        return;
      }
      if (operation.type === "chapterContinuity.character.create") {
        addCreatedTarget(
          {
            chapterCardId: operation.chapterCardId,
            role: "character_current_state",
            characterId: operation.characterId,
            fileId: operation.currentState.id,
            filePath: operation.currentState.path
          },
          operationIndex
        );
        addCreatedTarget(
          {
            chapterCardId: operation.chapterCardId,
            role: "character_history",
            characterId: operation.characterId,
            fileId: operation.history.id,
            filePath: operation.history.path
          },
          operationIndex
        );
        return;
      }
      context.addIssue({
        code: "custom",
        path: ["batch", "operations", operationIndex, "type"],
        message:
          "Continuity file proposals may only create chapter continuity files."
      });
    });
    if (value.batch.documentWrites.length !== value.files.length) {
      context.addIssue({
        code: "custom",
        path: ["batch", "documentWrites"],
        message:
          "Continuity file proposals require exactly one document write per file change."
      });
    }
    for (const [index, file] of value.files.entries()) {
      const write = value.batch.documentWrites.find(
        ({ fileId }) => fileId === file.fileId
      );
      const modeMatches =
        file.operation === "create"
          ? write?.mode === "create"
          : write?.mode !== "create";
      const createdTarget = createdTargets.get(file.fileId);
      if (!write || !modeMatches || write.content !== file.afterText) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "fileId"],
          message: "Each continuity file change must match its document write."
        });
      }
      if (file.operation === "create") {
        if (
          !createdTarget ||
          createdTarget.chapterCardId !== file.chapterCardId ||
          createdTarget.role !== file.role ||
          createdTarget.characterId !== file.characterId ||
          createdTarget.filePath !== file.filePath ||
          file.beforeText !== ""
        ) {
          context.addIssue({
            code: "custom",
            path: ["files", index],
            message:
              "Created continuity file metadata must match its chapter operation and start empty."
          });
        }
      } else if (createdTarget) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "operation"],
          message:
            "A newly created continuity file must be displayed as a create operation."
        });
      }
    }
    for (const fileId of createdTargets.keys()) {
      if (!fileIds.has(fileId)) {
        context.addIssue({
          code: "custom",
          path: ["batch", "operations"],
          message:
            "Every created continuity file must have a matching displayed file change."
        });
      }
    }
  });
export type LongContinuityFileProposalPayload = z.infer<
  typeof LongContinuityFileProposalPayloadSchema
>;

export const LongChapterBodyChangeSchema = z
  .object({
    chapterCardId: LongChapterCardIdSchema,
    chapterTitle: z.string().trim().min(1).max(256),
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(10_000_000),
    afterText: z.string().max(10_000_000)
  })
  .strict();
export type LongChapterBodyChange = z.infer<typeof LongChapterBodyChangeSchema>;

export const LongChapterWriteProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    file: LongChapterBodyChangeSchema
  }).superRefine((value, context) => {
    const documentWrite = value.batch.documentWrites.find(
      ({ fileId }) => fileId === value.file.fileId
    );
    if (
      value.batch.operations.length !== 0 ||
      value.batch.documentWrites.length !== 1 ||
      !documentWrite ||
      documentWrite.mode !== "replace" ||
      documentWrite.content !== value.file.afterText
    ) {
      context.addIssue({
        code: "custom",
        path: ["batch", "documentWrites"],
        message:
          "Chapter proposals must contain exactly one matching body document write."
      });
    }
  });
export type LongChapterWriteProposalPayload = z.infer<
  typeof LongChapterWriteProposalPayloadSchema
>;

export const LongLedgerCommitProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    input: LongCommitChapterInputSchema,
    files: z.array(LongContinuityFileChangeSchema).min(1).max(1_024).optional()
  }).superRefine((value, context) => {
    if (value.input.bookId !== value.bookId) {
      context.addIssue({
        code: "custom",
        path: ["input", "bookId"],
        message: "Ledger proposal input must belong to the proposal book."
      });
    }
    const preparation =
      value.input.mode === "text_files_batch"
        ? value.input.preparation
        : undefined;
    if (Boolean(preparation) !== Boolean(value.files)) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message:
          "Combined continuity proposals require both preparation and file changes."
      });
    }
    if (preparation && value.files) {
      const validated = LongContinuityFileProposalPayloadSchema.safeParse({
        ...value,
        input: undefined,
        batch: preparation.batch,
        files: value.files
      });
      if (!validated.success) {
        for (const issue of validated.error.issues)
          context.addIssue({
            code: "custom",
            path: issue.path,
            message: issue.message
          });
      }
      if (
        value.files.some(
          (file) =>
            file.chapterCardId !==
            (value.input.mode === "text_files_batch"
              ? value.input.checkpointChapterCardId
              : undefined)
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["files"],
          message:
            "Combined continuity files must belong to the checkpoint chapter."
        });
      }
    }
  });
export type LongLedgerCommitProposalPayload = z.infer<
  typeof LongLedgerCommitProposalPayloadSchema
>;
