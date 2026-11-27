import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  LongAgentTeamSettingsInputSchema,
  LONG_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
  ShortAgentSubagentDefinitionSchema,
  type LongAgentTeamSettings,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { isRecord } from "@deepwrite/shared";

const LEGACY_LONG_PARENT_LABELS = {
  worldbuilding: "世界观",
  character_design: "人物",
  setting: "设定",
  plot_design: "剧情",
  draft: "正文",
  expert_section_writer: "单章写手",
  continuity_ledger: "连续性账本",
  long: "长篇"
} as const;

type LegacyLongParentId = keyof typeof LEGACY_LONG_PARENT_LABELS;

interface LegacyDefinitionWithParent {
  definition: ShortAgentSubagentDefinition;
  parentAgentId: LegacyLongParentId;
}

function isLegacyLongParentId(value: unknown): value is LegacyLongParentId {
  return typeof value === "string" && value in LEGACY_LONG_PARENT_LABELS;
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
  let sequence = 1;
  while (true) {
    const discriminator = sequence === 1 ? suffix : `${suffix}_${sequence}`;
    const prefix = original.slice(
      0,
      Math.max(1, maxLength - discriminator.length)
    );
    const candidate = `${prefix}${discriminator}`;
    const candidateKey = candidate.toLocaleLowerCase();
    if (!used.has(candidateKey)) {
      used.add(candidateKey);
      return candidate;
    }
    sequence += 1;
  }
}

function collectLegacyDefinitions(
  raw: Record<string, unknown>
): LegacyDefinitionWithParent[] | undefined {
  if (raw.workspaceType !== "long" || !Array.isArray(raw.teams)) {
    return undefined;
  }
  const collected: LegacyDefinitionWithParent[] = [];
  for (const candidate of raw.teams) {
    if (
      !isRecord(candidate) ||
      !isLegacyLongParentId(candidate.parentAgentId)
    ) {
      return undefined;
    }
    if (!Array.isArray(candidate.subagents)) return undefined;
    for (const rawDefinition of candidate.subagents) {
      const parsed =
        ShortAgentSubagentDefinitionSchema.safeParse(rawDefinition);
      if (!parsed.success) return undefined;
      collected.push({
        definition: parsed.data,
        parentAgentId: candidate.parentAgentId
      });
    }
  }
  return collected;
}

function makeDefinitionsUnique(
  entries: readonly LegacyDefinitionWithParent[]
): ShortAgentSubagentDefinition[] {
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  return entries.map(({ definition, parentAgentId }) => {
    const label = LEGACY_LONG_PARENT_LABELS[parentAgentId];
    return {
      ...definition,
      id: uniqueValue(
        definition.id,
        `_${parentAgentId}`,
        SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
        usedIds
      ),
      name: uniqueValue(
        definition.name,
        `（${label}）`,
        SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
        usedNames
      )
    };
  });
}

function chunkDefinitions(
  definitions: readonly ShortAgentSubagentDefinition[]
): ShortAgentSubagentDefinition[][] {
  const chunks: ShortAgentSubagentDefinition[][] = [];
  for (
    let index = 0;
    index < definitions.length;
    index += LONG_AGENT_SUBAGENT_MAX_COUNT
  ) {
    chunks.push(
      definitions.slice(index, index + LONG_AGENT_SUBAGENT_MAX_COUNT)
    );
  }
  return chunks.length > 0 ? chunks : [[]];
}

export function migrateLegacyLongAgentTeamSettings(
  raw: Record<string, unknown>
): LongAgentTeamSettings[] | undefined {
  const current = LongAgentTeamSettingsInputSchema.safeParse(raw);
  if (current.success) return [current.data];
  const legacy = collectLegacyDefinitions(raw);
  if (!legacy) return undefined;
  const chunks = chunkDefinitions(makeDefinitionsUnique(legacy));
  return chunks.map((subagents) =>
    LongAgentTeamSettingsInputSchema.parse({
      workspaceType: "long",
      teams: [{ parentAgentId: "long", subagents }]
    })
  );
}

export function defaultLongAgentTeamSettings(): LongAgentTeamSettings {
  return structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
}
