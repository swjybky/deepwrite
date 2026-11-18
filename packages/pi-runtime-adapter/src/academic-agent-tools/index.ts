import type { AgentTool } from "@earendil-works/pi-agent-core";
import { SHORT_MATERIAL_KINDS } from "@deepwrite/contracts";
import { Type } from "typebox";
import { buildAskUserQuestionTool } from "../ask-user-question-tool";
import {
  MATERIAL_QUERY_DESCRIPTION,
  queryAttachedMaterials
} from "../material-catalog";
import {
  LOAD_SKILL_NAME_PARAMETER,
  LOAD_SKILL_TOOL_DESCRIPTION,
  formatLoadSkillToolResult,
  resolveAttachedSkill,
  type LoadSkillCandidate
} from "../resolve-attached-skill";
import { literalUnion } from "../short-agent-tools/schema";
import { buildAcademicCreateTool } from "./create";
import { buildAcademicDeleteTool } from "./delete";
import { buildAcademicEditTool } from "./edit";
import { buildAcademicReadTool } from "./read";
import { buildAcademicSearchTool } from "./search";
import {
  academicTextResult,
  createAcademicReadState,
  createAcademicWorkspaceToolSharedState,
  defineAcademicTool,
  type AcademicToolDetails,
  type AcademicWorkspaceToolSharedState,
  type BuildAcademicWorkspaceToolsInput
} from "./shared";

export { createAcademicWritingReader } from "./core-reader";
export type { AcademicWritingReader } from "./core-reader";
export {
  createAcademicWorkspaceToolSharedState,
  currentAcademicWorkspaceContext,
  settleAcademicMutations
} from "./shared";
export type {
  AcademicToolDetails,
  AcademicWorkspaceToolSharedState,
  BuildAcademicWorkspaceToolsInput
} from "./shared";

function buildAcademicQueryLinkedMaterialsTool(
  input: BuildAcademicWorkspaceToolsInput
): AgentTool {
  const allowedKinds = SHORT_MATERIAL_KINDS;
  return defineAcademicTool({
    name: "query_linked_material_entries",
    label:
      input.promptLocale === "en-US"
        ? "Query linked materials"
        : "查询关联素材条目",
    description:
      input.promptLocale === "en-US"
        ? "List, search, or read material entries linked to this academic work. Prefer entry_id; a unique entry_name also works."
        : MATERIAL_QUERY_DESCRIPTION,
    parameters: Type.Object({
      mode: Type.Union([
        Type.Literal("list"),
        Type.Literal("search"),
        Type.Literal("read")
      ]),
      cursor: Type.Optional(Type.Integer({ minimum: 0 })),
      query: Type.Optional(Type.String()),
      entry_id: Type.Optional(Type.String()),
      entry_name: Type.Optional(Type.String()),
      material_kind: Type.Optional(literalUnion(SHORT_MATERIAL_KINDS))
    }),
    execute: async (_toolCallId, params, signal) => {
      if (input.queryMaterials) {
        return academicTextResult(
          await input.queryMaterials(params, allowedKinds, signal)
        );
      }
      const items = input.attachedMaterials ?? [];
      return academicTextResult(
        queryAttachedMaterials(items, params, input.promptLocale === "en-US")
      );
    }
  });
}

function buildAcademicLoadSkillTool(
  input: BuildAcademicWorkspaceToolsInput
): AgentTool {
  return defineAcademicTool({
    name: "load_skill",
    label: input.promptLocale === "en-US" ? "Load skill" : "加载技能",
    description:
      input.promptLocale === "en-US"
        ? "Load an attached skill by full title, unique short name, or library name."
        : LOAD_SKILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      name: Type.String({
        ...LOAD_SKILL_NAME_PARAMETER,
        ...(input.promptLocale === "en-US"
          ? {
              description:
                "Full skill title, unique short name, or library name."
            }
          : {})
      })
    }),
    execute: async (_toolCallId, params) => {
      const name = String(params.name ?? "");
      const attached = input.attachedSkills ?? [];
      const isReadable = (_item: LoadSkillCandidate): boolean => true;
      const result = resolveAttachedSkill(name, attached, isReadable);
      return academicTextResult(
        formatLoadSkillToolResult(
          name,
          result,
          attached,
          input.promptLocale === "en-US"
        )
      );
    }
  });
}

export function buildAcademicWorkspaceTools(
  input: BuildAcademicWorkspaceToolsInput
): AgentTool[] {
  const sharedState: AcademicWorkspaceToolSharedState =
    input.sharedState ??
    createAcademicWorkspaceToolSharedState(input.workspace);
  const readState = createAcademicReadState();
  input.onContextCompacted?.(() => readState.fullyRead.clear());

  return [
    buildAcademicReadTool(input, sharedState, readState),
    buildAcademicSearchTool(input, sharedState),
    buildAcademicCreateTool(input, sharedState, readState),
    buildAcademicEditTool(input, sharedState, readState),
    buildAcademicDeleteTool(input, sharedState),
    buildAcademicQueryLinkedMaterialsTool(input),
    buildAcademicLoadSkillTool(input),
    ...(input.includeAskUserQuestion === false
      ? []
      : [buildAskUserQuestionTool(input.requestUserInput, input.promptLocale)])
  ];
}

export function isAcademicWorkspaceToolDetails(
  value: unknown
): value is AcademicToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "none" || kind === "academic-workspace-mutation";
}
