import { z } from "zod";
import {
  CreativePlotStageIdSchema,
  CreativePlotStagesSchema,
  type CreativePlotStageId
} from "./catalog";
import {
  DraftSectionIdSchema,
  DraftSectionTitleSchema,
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS
} from "./expert-draft";
import { WRITING_CONTEXT_MAX_CHARACTERS } from "./writing-context";

export const SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS =
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS;

export const CREATIVE_WORKSPACE_TYPES = ["short", "script"] as const;
export const WorkspaceTypeSchema = z.enum(CREATIVE_WORKSPACE_TYPES);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;
export const CreativeWorkspaceTypeSchema = WorkspaceTypeSchema;
export type CreativeWorkspaceType = WorkspaceType;

export const SCRIPT_WORKSPACE_STAGE_IDS = [
  "character_design",
  "worldbuilding",
  "plot_design",
  "intro_design",
  "plot_refine",
  "narrative_perspective",
  "outline",
  "draft"
] as const;

/** Physical script text stages. `draft` is a virtual episode directory route. */
export const SCRIPT_WORKSPACE_TEXT_STAGE_IDS = [
  "character_design",
  "worldbuilding",
  "plot_design",
  "intro_design",
  "plot_refine",
  "narrative_perspective",
  "outline"
] as const;

export const ScriptWorkspaceStageIdSchema = z.union([
  z.literal("character_design"),
  z.literal("draft"),
  CreativePlotStageIdSchema
]);
export type ScriptWorkspaceStageId =
  "character_design" | "draft" | CreativePlotStageId;
export const ScriptWorkspaceTextStageIdSchema = z.union([
  z.literal("character_design"),
  CreativePlotStageIdSchema
]);
export type ScriptWorkspaceTextStageId = z.infer<
  typeof ScriptWorkspaceTextStageIdSchema
>;

export const SCRIPT_WORKSPACE_AGENT_IDS = ["script"] as const;

/**
 * Historical script-agent ids remain stable conversation lanes only. They are
 * accepted at persistence boundaries and must never be exposed as live parent
 * agent identities again.
 */
export const SCRIPT_WORKSPACE_CONVERSATION_LANE_IDS = [
  "character_design",
  "plot_design",
  "expert_draft_coordinator"
] as const;

export const ScriptWorkspaceConversationLaneIdSchema = z.enum(
  SCRIPT_WORKSPACE_CONVERSATION_LANE_IDS
);
export type ScriptWorkspaceConversationLaneId = z.infer<
  typeof ScriptWorkspaceConversationLaneIdSchema
>;

export const ScriptWorkspaceAgentIdSchema = z.enum(SCRIPT_WORKSPACE_AGENT_IDS);
export type ScriptWorkspaceAgentId = z.infer<
  typeof ScriptWorkspaceAgentIdSchema
>;

export function resolveScriptWorkspaceAgentIdForStage(
  _stageId: ScriptWorkspaceStageId
): ScriptWorkspaceAgentId {
  return "script";
}

export function resolveScriptWorkspaceConversationLaneIdForStage(
  stageId: ScriptWorkspaceStageId
): ScriptWorkspaceConversationLaneId {
  if (stageId === "character_design") return "character_design";
  if (stageId === "draft") return "expert_draft_coordinator";
  return "plot_design";
}

export const SCRIPT_WORKSPACE_PHASE_IDS = [
  "character",
  "plot",
  "draft"
] as const;
export const ScriptWorkspacePhaseIdSchema = z.enum(SCRIPT_WORKSPACE_PHASE_IDS);
export type ScriptWorkspacePhaseId = z.infer<
  typeof ScriptWorkspacePhaseIdSchema
>;

export function resolveScriptWorkspacePhaseId(
  stageId: ScriptWorkspaceStageId
): ScriptWorkspacePhaseId {
  if (stageId === "character_design") return "character";
  if (stageId === "draft") return "draft";
  return "plot";
}

export const SCRIPT_MATERIAL_KINDS = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other"
] as const;
export const ScriptMaterialKindSchema = z.enum(SCRIPT_MATERIAL_KINDS);
export type ScriptMaterialKind = z.infer<typeof ScriptMaterialKindSchema>;

export const SCRIPT_SKILL_KINDS = [
  "general",
  "plot",
  "style",
  "other"
] as const;
export const ScriptSkillKindSchema = z.enum(SCRIPT_SKILL_KINDS);
export type ScriptSkillKind = z.infer<typeof ScriptSkillKindSchema>;

export const ScriptWorkspaceStageSnapshotSchema = z
  .object({
    stageId: ScriptWorkspaceTextStageIdSchema,
    title: z.string().trim().min(1).max(240),
    content: z.string().max(SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    truncated: z.boolean().optional(),
    originalLength: z
      .number()
      .int()
      .nonnegative()
      .max(SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS)
      .optional()
  })
  .superRefine((value, context) => {
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= value.content.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "A truncated stage must report an originalLength larger than content."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "An untruncated stage must omit originalLength."
      });
    }
  });
export type ScriptWorkspaceStageSnapshot = z.infer<
  typeof ScriptWorkspaceStageSnapshotSchema
>;

const ScriptCharacterItemSnapshotSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(256),
    order: z.number().int().positive(),
    content: z.string().max(SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    truncated: z.boolean().optional(),
    originalLength: z
      .number()
      .int()
      .nonnegative()
      .max(SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS)
      .optional()
  })
  .superRefine((value, context) => {
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= value.content.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "A truncated character item must report its original length."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "An untruncated character item must omit originalLength."
      });
    }
  });

const ScriptCharacterStructureSnapshotSchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("text") }),
  z.object({
    format: z.literal("list"),
    items: z.array(ScriptCharacterItemSnapshotSchema).max(4_096)
  })
]);

const ScriptExpertDraftFileSnapshotSchema = z.object({
  documentId: z.string().trim().min(1).max(4_096),
  title: z.string().trim().min(1).max(256),
  content: z.string().max(SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS),
  revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/)
});

const ScriptExpertDraftSectionSnapshotSchema = z
  .object({
    id: DraftSectionIdSchema,
    title: DraftSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    body: ScriptExpertDraftFileSnapshotSchema,
    characterState: ScriptExpertDraftFileSnapshotSchema
  })
  .superRefine((value, context) => {
    if (value.body.documentId === value.characterState.documentId) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "documentId"],
        message: "Script body and character state must use distinct files."
      });
    }
  });

const ScriptExpertDraftDirectorySnapshotSchema = z
  .object({
    id: z.literal("draft"),
    title: z.string().trim().min(1).max(240),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    sections: z.array(ScriptExpertDraftSectionSnapshotSchema).min(1).max(100)
  })
  .superRefine((value, context) => {
    const sectionIds = value.sections.map((section) => section.id);
    sectionIds.forEach((sectionId, index) => {
      if (sectionIds.indexOf(sectionId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: `Duplicate script episode id: ${sectionId}`
        });
      }
    });
    const documentIds = value.sections.flatMap((section) => [
      section.body.documentId,
      section.characterState.documentId
    ]);
    documentIds.forEach((documentId, index) => {
      if (documentIds.indexOf(documentId) !== index) {
        context.addIssue({
          code: "custom",
          path: [
            "sections",
            Math.floor(index / 2),
            index % 2 === 0 ? "body" : "characterState",
            "documentId"
          ],
          message: `Duplicate script document id: ${documentId}`
        });
      }
    });
  });

const ScriptWorkspaceSnapshotAgentIdSchema = z
  .union([
    ScriptWorkspaceAgentIdSchema,
    ScriptWorkspaceConversationLaneIdSchema
  ])
  .transform(() => "script" as const);

export const ScriptWorkspaceSnapshotSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(240),
    categories: z.array(z.string().trim().min(1).max(120)).max(16),
    activeStageId: ScriptWorkspaceStageIdSchema,
    activeAgentId: ScriptWorkspaceSnapshotAgentIdSchema.optional(),
    activeSectionId: z.string().trim().min(1).max(120).optional(),
    readSource: z.literal("core").optional(),
    agentsMd: z.string().max(WRITING_CONTEXT_MAX_CHARACTERS).optional(),
    plotStages: CreativePlotStagesSchema,
    characterStructure: ScriptCharacterStructureSnapshotSchema.default({
      format: "text"
    }),
    expertDraft: ScriptExpertDraftDirectorySnapshotSchema,
    stages: z.array(ScriptWorkspaceStageSnapshotSchema).min(2).max(33)
  })
  .superRefine((value, context) => {
    const stageIds = value.stages.map((stage) => stage.stageId);
    stageIds.forEach((stageId, index) => {
      if (stageIds.indexOf(stageId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["stages", index, "stageId"],
          message: `Duplicate script workspace stage snapshot: ${stageId}`
        });
      }
    });
    const expectedStageIds = [
      "character_design",
      ...value.plotStages.map((stage) => stage.id)
    ];
    if (
      expectedStageIds.length !== stageIds.length ||
      expectedStageIds.some((stageId, index) => stageIds[index] !== stageId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["stages"],
        message:
          "Script text stages must contain character design followed by configured plot stages."
      });
    }
    if (
      value.activeStageId !== "draft" &&
      !stageIds.includes(value.activeStageId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeStageId"],
        message:
          "Active stage must be present in the script workspace snapshot."
      });
    }

    if (value.activeStageId !== "draft") {
      const defaultAgentId = resolveScriptWorkspaceAgentIdForStage(
        value.activeStageId
      );
      if (
        value.activeAgentId !== undefined &&
        value.activeAgentId !== defaultAgentId
      ) {
        context.addIssue({
          code: "custom",
          path: ["activeAgentId"],
          message: `Stage ${value.activeStageId} must use its default agent ${defaultAgentId}.`
        });
      }
      if (value.activeSectionId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["activeSectionId"],
          message: "Only the script draft stage may target an episode."
        });
      }
      return;
    }

    if (value.activeAgentId !== undefined && value.activeAgentId !== "script") {
      context.addIssue({
        code: "custom",
        path: ["activeAgentId"],
        message: "The script draft stage must use the unified script agent."
      });
      return;
    }
    if (value.activeSectionId === undefined) return;
    if (
      !value.expertDraft.sections.some(
        (section) => section.id === value.activeSectionId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeSectionId"],
        message: `Unknown script episode: ${value.activeSectionId}`
      });
    }
  });
export type ScriptWorkspaceSnapshot = z.infer<
  typeof ScriptWorkspaceSnapshotSchema
>;
