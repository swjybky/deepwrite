import { z } from "zod";
import {
  SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH
} from "./agent-team";
import { AcademicAgentIdSchema } from "./academic-agent-settings";
import { LongAgentIdSchema } from "./long-workspace";
import { WorkspaceAgentIdSchema } from "./workspace";

export const SUBAGENT_AUTHORING_MAX_SKILLS = 4;
export const SUBAGENT_AUTHORING_SKILL_BODY_MAX_LENGTH = 20_000;

/**
 * A subagent never receives `load_skill`, so the skill text picked in the
 * wizard has to be baked into the generated system prompt. The runtime context
 * therefore carries the full skill bodies rather than references.
 */
export const SubagentAuthoringSkillSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(240),
  libraryId: z.string().trim().min(1).max(512).optional(),
  entryId: z.string().trim().min(1).max(512).optional(),
  title: z.string().trim().min(1).max(240),
  libraryTitle: z.string().trim().min(1).max(240),
  body: z.string().max(SUBAGENT_AUTHORING_SKILL_BODY_MAX_LENGTH)
});
export type SubagentAuthoringSkillSnapshot = z.infer<
  typeof SubagentAuthoringSkillSnapshotSchema
>;

/**
 * How the generated subagent is expected to deliver its work. This is a
 * generation-time choice only: it shapes the system prompt the wizard writes
 * and is never persisted alongside the subagent definition.
 */
export const SUBAGENT_AUTHORING_OUTPUT_MODES = ["write", "handoff"] as const;
export const SubagentAuthoringOutputModeSchema = z.enum(
  SUBAGENT_AUTHORING_OUTPUT_MODES
);
export type SubagentAuthoringOutputMode = z.infer<
  typeof SubagentAuthoringOutputModeSchema
>;

export const SUBAGENT_AUTHORING_OUTPUT_MODE_LABELS: Record<
  SubagentAuthoringOutputMode,
  string
> = {
  write: "直接写入文档",
  handoff: "只交回结论"
};

export const SubagentAuthoringParentAgentIdSchema = z.union([
  WorkspaceAgentIdSchema,
  LongAgentIdSchema,
  AcademicAgentIdSchema
]);
export type SubagentAuthoringParentAgentId = z.infer<
  typeof SubagentAuthoringParentAgentIdSchema
>;

export const SubagentAuthoringRuntimeContextSchema = z.object({
  parentAgentId: SubagentAuthoringParentAgentIdSchema,
  parentAgentLabel: z.string().trim().min(1).max(80),
  outputMode: SubagentAuthoringOutputModeSchema,
  skills: z
    .array(SubagentAuthoringSkillSnapshotSchema)
    .min(1)
    .max(SUBAGENT_AUTHORING_MAX_SKILLS),
  existingSubagentNames: z
    .array(z.string().trim().min(1).max(SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH))
    .max(SHORT_AGENT_SUBAGENT_MAX_COUNT)
});
export type SubagentAuthoringRuntimeContext = z.infer<
  typeof SubagentAuthoringRuntimeContextSchema
>;

export const SubagentAuthoringDraftSchema = z.object({
  name: z.string().trim().min(1).max(SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH),
  description: z
    .string()
    .trim()
    .min(1)
    .max(SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH),
  systemPrompt: z
    .string()
    .trim()
    .min(1)
    .max(SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH)
});
export type SubagentAuthoringDraft = z.infer<
  typeof SubagentAuthoringDraftSchema
>;
