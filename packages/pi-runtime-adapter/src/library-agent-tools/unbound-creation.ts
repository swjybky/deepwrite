import { Type, StringEnum } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  MATERIAL_STAGE_IDS,
  SKILL_STAGE_IDS,
  type LibraryStructureOperation
} from "@deepwrite/contracts";
import { buildLibraryAgentTools } from "../library-agent-tools";
import type { BuildLibraryAgentToolsInput } from "./types";
import { piStrictToolSampling } from "../pi-tool-schema";
import { textResult } from "./shared";
import type { buildLibraryStructureTools } from "./structure-tools";

export function wrapUnboundCreation(
  tool: AgentTool,
  input: BuildLibraryAgentToolsInput,
  propose: ReturnType<typeof buildLibraryStructureTools>["propose"]
): AgentTool {
  if (tool.name !== `create_${input.workspace.domain}_entry`) return tool;
  const schema = tool.parameters as ReturnType<typeof Type.Object>;
  const parameters = Type.Object(
    {
      ...schema.properties,
      target: Type.Optional(
        StringEnum(["library", "unbound"], {
          description: "明确为 unbound 时创建尚未归档的条目；缺省为当前位置。"
        })
      ),
      skill_kind: Type.Optional(
        StringEnum(["general", "plot", "style", "other"])
      )
    },
    { required: schema.required ?? [] }
  );
  return {
    ...tool,
    parameters,
    ...piStrictToolSampling(parameters),
    description: `${tool.description} target=unbound 可新增未归档条目，所有创作类型共用资料库，技能 skill_kind 缺省 general。`,
    execute: async (id, raw, signal, onUpdate) => {
      const params = raw as Record<string, unknown>;
      if (params.target !== "unbound")
        return tool.execute(id, params, signal, onUpdate);
      if (params.library_id)
        return textResult("未绑定目标不能同时指定 library_id。");
      // Use the normal entry tool for Markdown metadata, stages and size checks.
      const domain = input.workspace.domain;
      const workspace =
        domain === "material"
          ? {
              ...input.workspace,
              domain: "material" as const,
              kind: "mixed" as const,
              readOnly: false,
              entries: [],
              readableLibraries: undefined
            }
          : {
              ...input.workspace,
              domain: "skill" as const,
              kind: "general" as const,
              readOnly: false,
              entries: [],
              readableLibraries: undefined
            };
      const local = buildLibraryAgentTools({ ...input, workspace }).find(
        (item) => item.name === tool.name
      )!;
      const stages: readonly string[] =
        domain === "material" ? MATERIAL_STAGE_IDS : SKILL_STAGE_IDS;
      if (!stages.includes(String(params.stage_id)))
        return textResult("条目阶段不属于当前领域。");
      const result = await local.execute(id, params, signal);
      const details = result.details as
        | {
            kind?: string;
            operation?: string;
            text?: string;
            title?: string;
            stageId?: string;
          }
        | undefined;
      if (
        details?.kind !== "library-entry-mutation" ||
        details.operation !== "create"
      )
        return result;
      const operation: LibraryStructureOperation = {
        action: "create-unbound-entry",
        ref: id,
        title: details.title!,
        content: details.text!,
        stageId: details.stageId!,
        ...(domain === "skill"
          ? {
              skillKind: (params.skill_kind ?? "general") as
                "general" | "plot" | "style" | "other"
            }
          : {})
      };
      return propose(id, [operation], signal);
    }
  };
}
