import {
  type BuildLibraryAgentToolsInput,
  type LibraryAgentToolDetails
} from "./library-agent-tools/types";
import { type AgentTool } from "@earendil-works/pi-agent-core";
import { defineTool, textResult } from "./library-agent-tools/shared";
import {
  LOAD_SKILL_TOOL_DESCRIPTION,
  LOAD_SKILL_NAME_PARAMETER,
  resolveAttachedSkill,
  formatLoadSkillToolResult
} from "./resolve-attached-skill";
import { Type } from "@earendil-works/pi-ai";
import {
  workspaceDomain,
  profileDomain,
  isReadOnly,
  allowedStageIds,
  readableLibraries,
  mutableEntries,
  mutableOverview
} from "./library-agent-tools/workspace";
import {
  buildListTool,
  buildReadTool,
  buildSearchTool
} from "./library-agent-tools/read-tools";
import { buildCreateTool } from "./library-agent-tools/create-tool";
import {
  buildEditTool,
  buildEditOverviewTool
} from "./library-agent-tools/edit-tools";

export const LIBRARY_AGENT_TOOL_MANIFEST = {
  material: [
    "list_material_entries",
    "read_material_entry",
    "search_material_entries",
    "load_skill",
    "create_material_entry",
    "edit_material_entry",
    "edit_material_library_overview"
  ],
  skill: [
    "list_skill_entries",
    "read_skill_entry",
    "search_skill_entries",
    "load_skill",
    "create_skill_entry",
    "edit_skill_entry",
    "edit_skill_library_overview"
  ]
} as const;

function buildLoadSkillTool(input: BuildLibraryAgentToolsInput): AgentTool {
  const configuredNames = new Set(
    input.profile.readAccess.skills.map((skill) => skill.name)
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
      const isReadable = (item: { title: string }) =>
        configuredNames.has(item.title);
      const result = resolveAttachedSkill(name, attached, isReadable);
      return textResult(
        formatLoadSkillToolResult(name, result, attached.filter(isReadable))
      );
    }
  });
}

export function buildLibraryAgentTools(
  input: BuildLibraryAgentToolsInput
): AgentTool[] {
  const domain = workspaceDomain(input.workspace);
  if (profileDomain(input.profile) !== domain) {
    throw new Error(
      "Library agent profile domain does not match the workspace snapshot."
    );
  }
  const readOnly = isReadOnly(input.workspace, input.profile);
  const writeStages = allowedStageIds(input.workspace, domain);
  if (!writeStages.length) {
    throw new Error(
      "Library workspace snapshot does not expose any allowed stages."
    );
  }
  const libraries = readableLibraries(input.workspace);
  const entries =
    input.sharedState?.entries ?? mutableEntries(input.workspace, readOnly);
  const overview =
    input.sharedState?.overview ?? mutableOverview(input.workspace);
  const readStages = [
    ...new Set([
      ...writeStages,
      ...entries.map((entry) => entry.stageId).filter(Boolean)
    ])
  ];
  const accessedEntryIds = new Set<string>();
  const readTools = [
    buildListTool(input, domain, entries, readStages, libraries),
    buildReadTool(
      input,
      domain,
      entries,
      readStages,
      libraries,
      accessedEntryIds
    ),
    buildSearchTool(
      input,
      domain,
      entries,
      readStages,
      libraries,
      accessedEntryIds
    ),
    buildLoadSkillTool(input)
  ];
  return readOnly
    ? readTools
    : [
        ...readTools,
        buildCreateTool(input, domain, entries, writeStages, accessedEntryIds),
        buildEditTool(input, domain, entries, readStages, accessedEntryIds),
        buildEditOverviewTool(input, domain, overview)
      ];
}

export function isLibraryAgentToolDetails(
  value: unknown
): value is LibraryAgentToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "none" ||
    kind === "library-entry-mutation" ||
    kind === "library-overview-mutation"
  );
}

export type {
  BuildLibraryAgentToolsInput,
  LibraryAgentToolDetails
} from "./library-agent-tools/types";
