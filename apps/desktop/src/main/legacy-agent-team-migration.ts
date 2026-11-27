import {
  SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  ShortAgentSubagentDefinitionSchema,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { isRecord } from "@deepwrite/shared";

const LEGACY_PARENT_SUBAGENT_MAX_COUNT = 20;

export interface LegacyAgentTeamMigrationOptions {
  workspaceType: "short" | "script";
  parentLabels: Readonly<Record<string, string>>;
  parentSets: readonly (readonly string[])[];
}

function matchesParentSet(
  parentIds: ReadonlySet<string>,
  expected: readonly string[]
): boolean {
  return (
    parentIds.size === expected.length &&
    expected.every((parentId) => parentIds.has(parentId))
  );
}

function uniqueValue(
  original: string,
  suffix: string,
  maxLength: number,
  used: Set<string>
): string {
  const normalized = original.toLocaleLowerCase();
  if (!used.has(normalized)) {
    used.add(normalized);
    return original;
  }
  for (let sequence = 1; ; sequence += 1) {
    const discriminator = sequence === 1 ? suffix : `${suffix}_${sequence}`;
    const prefix = original.slice(
      0,
      Math.max(1, maxLength - discriminator.length)
    );
    const candidate = `${prefix}${discriminator}`;
    const key = candidate.toLocaleLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
  }
}

export function collectLegacyAgentTeamDefinitions(
  raw: Record<string, unknown>,
  options: LegacyAgentTeamMigrationOptions
): ShortAgentSubagentDefinition[] | undefined {
  if (
    raw.workspaceType !== options.workspaceType ||
    !Array.isArray(raw.teams) ||
    raw.teams.length === 0
  ) {
    return undefined;
  }
  const entries: Array<{
    definition: ShortAgentSubagentDefinition;
    parentId: string;
  }> = [];
  const parentIds = new Set<string>();
  for (const team of raw.teams) {
    if (
      !isRecord(team) ||
      typeof team.parentAgentId !== "string" ||
      !Object.hasOwn(options.parentLabels, team.parentAgentId) ||
      parentIds.has(team.parentAgentId) ||
      !Array.isArray(team.subagents) ||
      team.subagents.length > LEGACY_PARENT_SUBAGENT_MAX_COUNT
    ) {
      return undefined;
    }
    parentIds.add(team.parentAgentId);
    for (const candidate of team.subagents) {
      const parsed = ShortAgentSubagentDefinitionSchema.safeParse(candidate);
      if (!parsed.success) return undefined;
      entries.push({ definition: parsed.data, parentId: team.parentAgentId });
    }
  }
  if (
    !options.parentSets.some((expected) =>
      matchesParentSet(parentIds, expected)
    )
  ) {
    return undefined;
  }
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  return entries.map(({ definition, parentId }) => ({
    ...definition,
    id: uniqueValue(
      definition.id,
      `_${parentId}`,
      SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
      usedIds
    ),
    name: uniqueValue(
      definition.name,
      `（${options.parentLabels[parentId]}）`,
      SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
      usedNames
    )
  }));
}

export function chunkLegacyAgentTeamDefinitions(
  definitions: readonly ShortAgentSubagentDefinition[],
  maxCount: number
): ShortAgentSubagentDefinition[][] {
  const chunks: ShortAgentSubagentDefinition[][] = [];
  for (let index = 0; index < definitions.length; index += maxCount) {
    chunks.push(definitions.slice(index, index + maxCount));
  }
  return chunks.length > 0 ? chunks : [[]];
}
