import { z } from "zod";
import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "../expert-draft";
import { LongWorkspaceRuntimeContextSchema } from "../long-workspace-api";
import { LearningImitationRuntimeContextSchema } from "../learning-imitation";
import { LongBookAnalysisRuntimeContextSchema } from "../long-book-analysis";
import { LibraryAgentWorkspaceSnapshotSchema } from "../library-agent";
import { SubagentAuthoringRuntimeContextSchema } from "../subagent-authoring";
import { ScriptWorkspaceSnapshotSchema } from "../script-workspace";
import {
  ShortMaterialKindSchema,
  ShortSkillKindSchema,
  ShortWorkspaceSnapshotSchema
} from "../workspace";

export const AgentWriteApprovalModeSchema = z.enum([
  "request-approval",
  "auto-approve"
]);
export type AgentWriteApprovalMode = z.infer<
  typeof AgentWriteApprovalModeSchema
>;

export const AgentTeamRunModeSchema = z.enum(["normal", "team"]);
export type AgentTeamRunMode = z.infer<typeof AgentTeamRunModeSchema>;

export const AgentRuntimeRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  mode: z.enum(["local-faux", "provider"]),
  /**
   * The local model-configuration id that resolved this runtime. It is kept
   * optional for the built-in faux runtime and for historical event payloads.
   */
  configId: z.string().trim().min(1).max(120).optional()
});
export type AgentRuntimeRef = z.infer<typeof AgentRuntimeRefSchema>;

export const ActiveResourceSnapshotSchema = z
  .object({
    id: z.string().min(1),
    domain: z.enum(["creation", "skill", "material"]),
    title: z.string().min(1).max(240),
    path: z.array(z.string().min(1).max(240)).max(16),
    format: z.string().min(1).max(80).optional(),
    source: z.literal("live-editor"),
    content: z.string().max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS),
    truncated: z.boolean().optional(),
    originalLength: z
      .number()
      .int()
      .nonnegative()
      .max(SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
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
          "A truncated resource must report an originalLength larger than content."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "An untruncated resource must omit originalLength."
      });
    }
  });
export type ActiveResourceSnapshot = z.infer<
  typeof ActiveResourceSnapshotSchema
>;

interface ComparableTextSnapshot {
  content: string;
  truncated?: boolean | undefined;
  originalLength?: number | undefined;
}

function matchesActiveResourceContent(
  candidate: string | ComparableTextSnapshot,
  active: ActiveResourceSnapshot
): boolean {
  const snapshot =
    typeof candidate === "string" ? { content: candidate } : candidate;
  const candidateLength =
    snapshot.truncated === true
      ? snapshot.originalLength
      : snapshot.content.length;
  const activeLength =
    active.truncated === true ? active.originalLength : active.content.length;
  if (
    candidateLength === undefined ||
    activeLength === undefined ||
    candidateLength !== activeLength
  ) {
    return false;
  }
  const sharedLength = Math.min(snapshot.content.length, active.content.length);
  return (
    (sharedLength > 0 || candidateLength === 0) &&
    snapshot.content.slice(0, sharedLength) ===
      active.content.slice(0, sharedLength)
  );
}

export const ATTACHED_CONTEXT_MAX_ITEMS = 64;
export const ATTACHED_CONTEXT_MAX_CONTENT_LENGTH = 100_000;

const AttachedContextSnapshotBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(240),
  content: z.string().max(ATTACHED_CONTEXT_MAX_CONTENT_LENGTH)
});

export const AttachedSkillSnapshotSchema =
  AttachedContextSnapshotBaseSchema.extend({
    source: z.literal("attached-skill"),
    kind: ShortSkillKindSchema.optional()
  });

export const AttachedMaterialSnapshotSchema =
  AttachedContextSnapshotBaseSchema.extend({
    source: z.literal("attached-material"),
    kind: ShortMaterialKindSchema.optional()
  });

export const AttachedContextSnapshotSchema = z.discriminatedUnion("source", [
  AttachedSkillSnapshotSchema,
  AttachedMaterialSnapshotSchema
]);
export type AttachedContextSnapshot = z.infer<
  typeof AttachedContextSnapshotSchema
>;

export const WorkspaceRuntimeContextSchema = z
  .object({
    activeResource: ActiveResourceSnapshotSchema.optional(),
    shortWorkspace: ShortWorkspaceSnapshotSchema.optional(),
    scriptWorkspace: ScriptWorkspaceSnapshotSchema.optional(),
    longWorkspace: LongWorkspaceRuntimeContextSchema.optional(),
    libraryWorkspace: LibraryAgentWorkspaceSnapshotSchema.optional(),
    learningImitation: LearningImitationRuntimeContextSchema.optional(),
    longBookAnalysis: LongBookAnalysisRuntimeContextSchema.optional(),
    subagentAuthoring: SubagentAuthoringRuntimeContextSchema.optional(),
    attachedSkills: z
      .array(AttachedSkillSnapshotSchema)
      .max(ATTACHED_CONTEXT_MAX_ITEMS)
      .optional(),
    attachedMaterials: z
      .array(AttachedMaterialSnapshotSchema)
      .max(ATTACHED_CONTEXT_MAX_ITEMS)
      .optional()
  })
  .superRefine((value, context) => {
    const exclusiveContexts = [
      value.shortWorkspace,
      value.scriptWorkspace,
      value.longWorkspace,
      value.libraryWorkspace,
      value.learningImitation,
      value.longBookAnalysis,
      value.subagentAuthoring
    ].filter(Boolean).length;
    if (exclusiveContexts > 1) {
      context.addIssue({
        code: "custom",
        path: ["libraryWorkspace"],
        message: "A run can use only one managed workspace context."
      });
    }
    if (value.libraryWorkspace && value.activeResource) {
      if (value.libraryWorkspace.domain !== value.activeResource.domain) {
        context.addIssue({
          code: "custom",
          path: ["libraryWorkspace", "domain"],
          message:
            "The active resource must match the library workspace domain."
        });
      }
      if (value.libraryWorkspace.activeEntryId) {
        const activeEntry = value.libraryWorkspace.entries.find(
          (entry) => entry.id === value.libraryWorkspace?.activeEntryId
        );
        if (
          !activeEntry ||
          activeEntry.documentId !== value.activeResource.id ||
          !matchesActiveResourceContent(activeEntry, value.activeResource)
        ) {
          context.addIssue({
            code: "custom",
            path: ["libraryWorkspace", "activeEntryId"],
            message:
              "The active library entry must match the live active resource snapshot."
          });
        }
      } else if (
        value.libraryWorkspace.overviewDocumentId !== value.activeResource.id ||
        !matchesActiveResourceContent(
          {
            content: value.libraryWorkspace.overview,
            ...(value.libraryWorkspace.overviewTruncated === undefined
              ? {}
              : { truncated: value.libraryWorkspace.overviewTruncated }),
            ...(value.libraryWorkspace.overviewOriginalLength === undefined
              ? {}
              : {
                  originalLength: value.libraryWorkspace.overviewOriginalLength
                })
          },
          value.activeResource
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["libraryWorkspace", "overviewDocumentId"],
          message:
            "The active library overview must match the live active resource snapshot."
        });
      }
    }
    const active = value.activeResource;
    if (!active) return;

    if (
      value.longWorkspace?.activeFileId &&
      active.id !== value.longWorkspace.activeFileId
    ) {
      context.addIssue({
        code: "custom",
        path: ["longWorkspace", "activeFileId"],
        message:
          "The active long-form file must match the live active resource snapshot."
      });
    }

    const creativeWorkspaces = [
      {
        key: "shortWorkspace",
        label: "short",
        workspace: value.shortWorkspace
      },
      {
        key: "scriptWorkspace",
        label: "script",
        workspace: value.scriptWorkspace
      }
    ] as const;
    for (const { key, label, workspace } of creativeWorkspaces) {
      if (!workspace) continue;
      const matchesActiveStage =
        workspace.activeStageId === "draft"
          ? (workspace.activeSectionId === undefined &&
              active.id === workspace.expertDraft.id &&
              active.content === "") ||
            workspace.expertDraft.sections
              .filter(
                (section) =>
                  workspace.activeSectionId === undefined ||
                  section.id === workspace.activeSectionId
              )
              .some((section) =>
                [section.body, section.characterState].some(
                  (file) =>
                    file.documentId === active.id &&
                    matchesActiveResourceContent(file, active)
                )
              )
          : workspace.stages.some(
              (stage) =>
                stage.stageId === workspace.activeStageId &&
                matchesActiveResourceContent(stage, active)
            );
      if (!matchesActiveStage) {
        context.addIssue({
          code: "custom",
          path: [key, "activeStageId"],
          message: `The active ${label} stage must match the live active resource snapshot.`
        });
      }
    }
  });
export type WorkspaceRuntimeContext = z.infer<
  typeof WorkspaceRuntimeContextSchema
>;
