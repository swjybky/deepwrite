import {
  MATERIAL_QUERY_DESCRIPTION,
  queryAttachedMaterials
} from "../material-catalog";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  SHORT_MATERIAL_KINDS,
  resolveScriptWorkspaceStageReadAccess,
  resolveShortWorkspaceStageReadAccess
} from "@deepwrite/contracts";
import {
  LOAD_SKILL_NAME_PARAMETER,
  LOAD_SKILL_TOOL_DESCRIPTION,
  formatLoadSkillToolResult,
  resolveAttachedSkill,
  type LoadSkillCandidate
} from "../resolve-attached-skill";
import { defineTool, literalUnion } from "./schema";
import { textResult, type BuildWritingWorkspaceToolsInput } from "./shared";

export function buildQueryLinkedMaterialEntriesTool(
  input: BuildWritingWorkspaceToolsInput
): AgentTool {
  const stageAccess =
    input.workspaceType === "script"
      ? resolveScriptWorkspaceStageReadAccess(input.workspace.activeStageId)
      : resolveShortWorkspaceStageReadAccess(input.workspace.activeStageId);
  const allowedKinds = input.profile.readAccess.material.filter(
    (kind) => !stageAccess || stageAccess.material.includes(kind)
  );
  return defineTool({
    name: "query_linked_material_entries",
    label: "查询关联素材条目",
    description: MATERIAL_QUERY_DESCRIPTION,
    parameters: Type.Object({
      mode: Type.Union([
        Type.Literal("list"),
        Type.Literal("search"),
        Type.Literal("read")
      ]),
      cursor: Type.Optional(Type.Integer({ minimum: 0 })),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 1200 })),
      entry_name: Type.Optional(Type.String({ maxLength: 512 })),
      material_kind: Type.Optional(
        literalUnion(allowedKinds.length ? allowedKinds : SHORT_MATERIAL_KINDS)
      )
    }),
    execute: async (_toolCallId, params, signal) => {
      if (input.queryMaterials)
        return textResult(
          await input.queryMaterials(params, allowedKinds, signal)
        );
      const items = (input.attachedMaterials ?? []).filter(
        (item) => item.kind !== undefined && allowedKinds.includes(item.kind)
      );
      return textResult(queryAttachedMaterials(items, params));
    }
  });
}

export function buildLoadSkillTool(
  input: BuildWritingWorkspaceToolsInput
): AgentTool {
  const stageAccess =
    input.workspaceType === "script"
      ? resolveScriptWorkspaceStageReadAccess(input.workspace.activeStageId)
      : resolveShortWorkspaceStageReadAccess(input.workspace.activeStageId);
  const allowedKinds = input.profile.readAccess.skill.filter(
    (kind) => !stageAccess || stageAccess.skill.includes(kind)
  );
  return defineTool({
    name: "load_skill",
    label: "加载技能",
    description: LOAD_SKILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      name: Type.String(LOAD_SKILL_NAME_PARAMETER)
    }),
    execute: async (_toolCallId, params) => {
      const name = String(params.name ?? "");
      const attached = input.attachedSkills ?? [];
      const isReadable = (item: LoadSkillCandidate): boolean =>
        item.kind !== undefined &&
        (allowedKinds as readonly string[]).includes(item.kind);
      const result = resolveAttachedSkill(name, attached, isReadable);
      return textResult(
        formatLoadSkillToolResult(name, result, attached.filter(isReadable))
      );
    }
  });
}
