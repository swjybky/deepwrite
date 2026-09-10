import { LibraryManagementScopeSchema } from "../library-management-scope";
import { z } from "zod";
import { MaterialStageIdSchema, SkillStageIdSchema } from "../catalog";
import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "../expert-draft";
import { ShortWorkspaceStageIdSchema } from "../workspace";
import { AgentRuntimeRefSchema } from "./runtime";

export const WorkspaceEditorMutationTargetSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("expert-draft-file"),
      documentId: z.string().trim().min(1).max(4_096),
      sectionId: z.string().trim().min(1).max(120),
      fileKind: z.enum(["body", "characterState"])
    }),
    z.object({
      kind: z.literal("expert-draft-section-creation"),
      sections: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(240),
            wordCountRequirement: z.string().max(1_000),
            provisionalSectionId: z.string().trim().min(1).max(120),
            bodyContent: z
              .string()
              .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
              .optional(),
            characterStateContent: z
              .string()
              .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
              .optional()
          })
        )
        .min(1)
        .max(100),
      afterSectionId: z.string().trim().min(1).max(120).optional()
    }),
    z.object({
      kind: z.literal("expert-draft-section-rename"),
      sectionId: z.string().trim().min(1).max(120),
      previousTitle: z.string().trim().min(1).max(240),
      title: z.string().trim().min(1).max(240)
    }),
    z.object({
      kind: z.literal("expert-draft-section-deletion"),
      sectionId: z.string().trim().min(1).max(120),
      title: z.string().trim().min(1).max(240)
    }),
    z.object({
      kind: z.literal("character-file"),
      documentId: z.string().trim().min(1).max(4_096),
      itemId: z.string().trim().min(1).max(512).optional()
    }),
    z.object({
      kind: z.literal("character-structure"),
      initialContent: z
        .string()
        .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        .optional(),
      mutation: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("createItem"),
          title: z.string().trim().min(1).max(256),
          provisionalItemId: z.string().trim().min(1).max(512)
        }),
        z.object({
          type: z.literal("updateItem"),
          itemId: z.string().trim().min(1).max(512),
          previousTitle: z.string().trim().min(1).max(256),
          title: z.string().trim().min(1).max(256)
        }),
        z.object({
          type: z.literal("moveItem"),
          itemId: z.string().trim().min(1).max(512),
          direction: z.enum(["up", "down"]),
          title: z.string().trim().min(1).max(256)
        }),
        z.object({
          type: z.literal("deleteItem"),
          itemId: z.string().trim().min(1).max(512),
          title: z.string().trim().min(1).max(256),
          deletedText: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        })
      ])
    }),
    z.object({
      kind: z.literal("plot-structure"),
      mutation: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("create"),
          title: z.string().trim().min(1).max(120),
          description: z.string().trim().min(1).max(20_000),
          provisionalStageId: ShortWorkspaceStageIdSchema,
          content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
        }),
        z.object({
          type: z.literal("update"),
          stageId: ShortWorkspaceStageIdSchema,
          previousTitle: z.string().trim().min(1).max(120),
          title: z.string().trim().min(1).max(120),
          description: z.string().trim().min(1).max(20_000)
        })
      ])
    })
  ]
);
export type WorkspaceEditorMutationTarget = z.infer<
  typeof WorkspaceEditorMutationTargetSchema
>;

export const WorkspaceEditorMutationPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    toolCallId: z.string().min(1),
    workspaceId: z.string().min(1).max(240),
    stageId: ShortWorkspaceStageIdSchema,
    text: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
    mutationTarget: WorkspaceEditorMutationTargetSchema.optional(),
    baseRevision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    summary: z.string().min(1).max(1_000),
    runtime: AgentRuntimeRefSchema
  })
  .superRefine((value, context) => {
    if (
      value.mutationTarget !== undefined &&
      value.mutationTarget.kind.startsWith("expert-draft") &&
      value.stageId !== "draft"
    ) {
      context.addIssue({
        code: "custom",
        path: ["mutationTarget"],
        message: "Expert draft mutations must target the draft stage."
      });
    }
    if (value.stageId === "draft" && value.mutationTarget === undefined) {
      context.addIssue({
        code: "custom",
        path: ["mutationTarget"],
        message:
          "Draft mutations must target a physical file, section creation, section rename, or section deletion."
      });
    }
    if (
      value.mutationTarget?.kind.startsWith("character-") &&
      value.stageId !== "character_design"
    ) {
      context.addIssue({
        code: "custom",
        path: ["mutationTarget"],
        message: "Character mutations must target character_design."
      });
    }
    if (
      value.mutationTarget?.kind === "plot-structure" &&
      (value.stageId === "character_design" || value.stageId === "draft")
    ) {
      context.addIssue({
        code: "custom",
        path: ["mutationTarget"],
        message: "Plot structure mutations must target a plot stage."
      });
    }
  });
export type WorkspaceEditorMutationPayload = z.infer<
  typeof WorkspaceEditorMutationPayloadSchema
>;

const LibraryEditorMutationBaseSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  domain: z.enum(["material", "skill"]),
  managementScope: LibraryManagementScopeSchema.optional(),
  creationId: z.string().min(1).max(512).optional(),
  libraryId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(256),
  text: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
  baseRevision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
  baseProjectRevision: z.number().int().nonnegative().optional(),
  summary: z.string().trim().min(1).max(1_000),
  runtime: AgentRuntimeRefSchema
});

export const LibraryEditorMutationPayloadSchema = z
  .discriminatedUnion("operation", [
    LibraryEditorMutationBaseSchema.extend({
      operation: z.literal("create"),
      stageId: z.string().trim().min(1).max(120)
    }),
    LibraryEditorMutationBaseSchema.extend({
      operation: z.literal("edit"),
      stageId: z.string().trim().min(1).max(120),
      entryId: z.string().trim().min(1).max(512),
      documentId: z.string().trim().min(1).max(4_096)
    }),
    LibraryEditorMutationBaseSchema.extend({
      operation: z.literal("edit-overview"),
      documentId: z.string().trim().min(1).max(4_096)
    })
  ])
  .superRefine((value, context) => {
    if (value.operation === "edit-overview") return;
    const validStage =
      value.domain === "material"
        ? MaterialStageIdSchema.safeParse(value.stageId).success
        : SkillStageIdSchema.safeParse(value.stageId).success;
    if (!validStage) {
      context.addIssue({
        code: "custom",
        path: ["stageId"],
        message: `Stage ${value.stageId} does not belong to ${value.domain}.`
      });
    }
  });
export type LibraryEditorMutationPayload = z.infer<
  typeof LibraryEditorMutationPayloadSchema
>;

export const WorkspaceStageSelectionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  workspaceId: z.string().min(1).max(240),
  stageId: ShortWorkspaceStageIdSchema,
  runtime: AgentRuntimeRefSchema
});
export type WorkspaceStageSelectionPayload = z.infer<
  typeof WorkspaceStageSelectionPayloadSchema
>;
