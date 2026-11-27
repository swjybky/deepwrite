export const BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID =
  "builtin-material-group-basic-long" as const;

export const BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID =
  "builtin-material-basic-long-naming" as const;
export const BUILTIN_MATERIAL_BASIC_LONG_DRAFT_ID =
  "builtin-material-basic-long-draft" as const;
export const BUILTIN_MATERIAL_BASIC_LONG_PLOT_ID =
  "builtin-material-basic-long-plot" as const;

export const BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID =
  "builtin-skill-basic-long-team-ops" as const;

export const BUILTIN_TEAM_BASIC_LONG_DEFAULT_ID =
  "builtin_team_basic_long_default" as const;

export const BUILTIN_MATERIAL_LIBRARY_IDS = [
  BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
  BUILTIN_MATERIAL_BASIC_LONG_DRAFT_ID,
  BUILTIN_MATERIAL_BASIC_LONG_PLOT_ID
] as const;

export const BUILTIN_MATERIAL_GROUP_IDS = [
  BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID
] as const;

export const BUILTIN_SKILL_LIBRARY_IDS = [
  BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID
] as const;

export const BUILTIN_SKILL_GROUP_IDS = [] as const;

export const BUILTIN_AGENT_TEAM_IDS = [
  BUILTIN_TEAM_BASIC_LONG_DEFAULT_ID
] as const;

const builtinMaterialLibraryIdSet = new Set<string>(
  BUILTIN_MATERIAL_LIBRARY_IDS
);
const builtinMaterialGroupIdSet = new Set<string>(BUILTIN_MATERIAL_GROUP_IDS);
const builtinSkillLibraryIdSet = new Set<string>(BUILTIN_SKILL_LIBRARY_IDS);
const builtinSkillGroupIdSet = new Set<string>(BUILTIN_SKILL_GROUP_IDS);
const builtinAgentTeamIdSet = new Set<string>(BUILTIN_AGENT_TEAM_IDS);

export function isBuiltinMaterialLibraryId(id: string): boolean {
  return builtinMaterialLibraryIdSet.has(id);
}

export function isBuiltinMaterialGroupId(id: string): boolean {
  return builtinMaterialGroupIdSet.has(id);
}

export function isBuiltinSkillLibraryId(id: string): boolean {
  return builtinSkillLibraryIdSet.has(id);
}

export function isBuiltinSkillGroupId(id: string): boolean {
  return builtinSkillGroupIdSet.has(id);
}

export function isBuiltinCatalogProjectId(id: string): boolean {
  return (
    builtinMaterialLibraryIdSet.has(id) ||
    builtinMaterialGroupIdSet.has(id) ||
    builtinSkillLibraryIdSet.has(id) ||
    builtinSkillGroupIdSet.has(id)
  );
}

export function isBuiltinAgentTeamId(id: string): boolean {
  return builtinAgentTeamIdSet.has(id);
}
