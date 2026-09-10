import {
  MATERIAL_QUERY_DESCRIPTION,
  queryAttachedMaterials
} from "../material-catalog";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { MATERIAL_KINDS } from "@deepwrite/contracts";
import {
  LOAD_SKILL_NAME_PARAMETER,
  LOAD_SKILL_TOOL_DESCRIPTION,
  formatLoadSkillToolResult,
  resolveAttachedSkill,
  type LoadSkillCandidate
} from "../resolve-attached-skill";
import { defineTool, textResult } from "./shared";
import type { BuildLongWorkspaceToolsInput } from "./index";

export function buildQueryLinkedMaterialEntriesTool(
  input: BuildLongWorkspaceToolsInput
): AgentTool {
  const allowedKinds = input.profile.readAccess.materialKinds;
  return defineTool({
    name: "query_linked_material_entries",
    label: "查询关联素材条目",
    description: MATERIAL_QUERY_DESCRIPTION,
    parameters: Type.Object({
      mode: StringEnum(["list", "search", "read"] as const),
      cursor: Type.Optional(Type.Integer({ minimum: 0 })),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      entry_id: Type.Optional(Type.String({ minLength: 1, maxLength: 1200 })),
      entry_name: Type.Optional(Type.String({ maxLength: 240 })),
      material_kind: Type.Optional(
        StringEnum(allowedKinds.length ? allowedKinds : MATERIAL_KINDS)
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
  input: BuildLongWorkspaceToolsInput
): AgentTool {
  const allowedKinds = input.profile.readAccess.skillKinds;
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
