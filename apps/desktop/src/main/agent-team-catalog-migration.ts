import {
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  AgentTeamCatalogSnapshotSchema,
  AgentTeamProfileIdSchema,
  AgentTeamProfileNameSchema,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfile
} from "@deepwrite/contracts";
import { invalidAgentTeamConfig } from "./agent-team-config-error";
import {
  createAgentTeamProfile,
  defaultAgentTeamName
} from "./agent-team-profile-factory";
import { migrateLegacyLongAgentTeamSettings } from "./legacy-long-agent-team-migration";
import { migrateLegacyScriptAgentTeamSettings } from "./legacy-script-agent-team-migration";
import { migrateLegacyShortAgentTeamSettings } from "./legacy-short-agent-team-migration";
import { isRecord } from "@deepwrite/shared";

function availableMigrationName(
  baseName: string,
  suffix: string,
  usedNames: Set<string>
): string {
  for (let sequence = 1; ; sequence += 1) {
    const discriminator =
      sequence === 1 ? suffix : `${suffix || " · 迁移"}-${sequence}`;
    const name = `${baseName.slice(
      0,
      AGENT_TEAM_PROFILE_NAME_MAX_LENGTH - discriminator.length
    )}${discriminator}`;
    if (!usedNames.has(name.toLocaleLowerCase())) {
      usedNames.add(name.toLocaleLowerCase());
      return name;
    }
  }
}

export function migrateVersionOneCatalog(
  raw: Record<string, unknown>
): AgentTeamCatalogSnapshot {
  const active = AgentTeamProfileIdSchema.safeParse(raw.activeTeamId);
  if (!active.success || !Array.isArray(raw.teams) || raw.teams.length === 0) {
    throw invalidAgentTeamConfig(
      active.success ? undefined : active.error.issues[0]
    );
  }
  const teams: AgentTeamProfile[] = [];
  const enabledTeamIds: AgentTeamCatalogSnapshot["enabledTeamIds"] = {};
  const usedNames = new Set<string>();
  for (const candidate of raw.teams) {
    if (!isRecord(candidate)) throw invalidAgentTeamConfig();
    const id = AgentTeamProfileIdSchema.safeParse(candidate.id);
    const name = AgentTeamProfileNameSchema.safeParse(candidate.name);
    const short = isRecord(candidate.shortSettings)
      ? migrateLegacyShortAgentTeamSettings(candidate.shortSettings)
      : undefined;
    const script = isRecord(candidate.scriptSettings)
      ? migrateLegacyScriptAgentTeamSettings(candidate.scriptSettings)
      : undefined;
    const long = isRecord(candidate.longSettings)
      ? migrateLegacyLongAgentTeamSettings(candidate.longSettings)
      : undefined;
    if (!id.success || !name.success || !short || !script || !long) {
      throw invalidAgentTeamConfig();
    }
    const names =
      raw.teams.length === 1 && name.data === "默认团队"
        ? [
            availableMigrationName(
              defaultAgentTeamName("short"),
              "",
              usedNames
            ),
            availableMigrationName(
              defaultAgentTeamName("script"),
              "",
              usedNames
            ),
            availableMigrationName(defaultAgentTeamName("long"), "", usedNames)
          ]
        : [
            availableMigrationName(name.data, " · 短篇", usedNames),
            availableMigrationName(name.data, " · 剧本", usedNames),
            availableMigrationName(name.data, " · 长篇", usedNames)
          ];
    const split = [
      ...short.map((settings, index) =>
        createAgentTeamProfile(
          "short",
          index === 0
            ? names[0]!
            : availableMigrationName(
                names[0]!,
                ` · 迁移 ${index + 1}`,
                usedNames
              ),
          settings
        )
      ),
      ...script.map((settings, index) =>
        createAgentTeamProfile(
          "script",
          index === 0
            ? names[1]!
            : availableMigrationName(
                names[1]!,
                ` · 迁移 ${index + 1}`,
                usedNames
              ),
          settings
        )
      ),
      ...long.map((settings, index) =>
        createAgentTeamProfile(
          "long",
          index === 0
            ? names[2]!
            : availableMigrationName(
                names[2]!,
                ` · 迁移 ${index + 1}`,
                usedNames
              ),
          settings
        )
      )
    ];
    teams.push(...split);
    if (id.data === active.data) {
      enabledTeamIds.short = split[0]!.id;
      enabledTeamIds.script = split[short.length]!.id;
      enabledTeamIds.long = split[short.length + script.length]!.id;
    }
  }
  teams.push(
    createAgentTeamProfile(
      "academic",
      availableMigrationName(defaultAgentTeamName("academic"), "", usedNames)
    ),
    createAgentTeamProfile(
      "mystery",
      availableMigrationName(defaultAgentTeamName("mystery"), "", usedNames)
    )
  );
  return AgentTeamCatalogSnapshotSchema.parse({ enabledTeamIds, teams });
}

function migrateProfileCatalog(
  raw: Record<string, unknown>
): AgentTeamCatalogSnapshot | undefined {
  if (!isRecord(raw.enabledTeamIds) || !Array.isArray(raw.teams)) {
    return undefined;
  }
  const teams: AgentTeamProfile[] = [];
  const usedNames = new Set<string>();
  for (const candidate of raw.teams) {
    if (!isRecord(candidate)) return undefined;
    const name = AgentTeamProfileNameSchema.safeParse(candidate.name);
    if (!name.success) return undefined;
    const normalizedName = name.data.toLocaleLowerCase();
    if (usedNames.has(normalizedName)) return undefined;
    usedNames.add(normalizedName);
  }
  for (const candidate of raw.teams) {
    if (!isRecord(candidate) || !isRecord(candidate.settings)) {
      return undefined;
    }
    const id = AgentTeamProfileIdSchema.safeParse(candidate.id);
    const name = AgentTeamProfileNameSchema.safeParse(candidate.name);
    if (!id.success || !name.success) return undefined;
    const migrated =
      candidate.workspaceType === "short"
        ? migrateLegacyShortAgentTeamSettings(candidate.settings)
        : candidate.workspaceType === "script"
          ? migrateLegacyScriptAgentTeamSettings(candidate.settings)
          : candidate.workspaceType === "long"
            ? migrateLegacyLongAgentTeamSettings(candidate.settings)
            : undefined;
    if (!migrated) return undefined;
    teams.push(
      ...migrated.map((settings, index) => {
        const profile = createAgentTeamProfile(
          candidate.workspaceType as "short" | "script" | "long",
          index === 0
            ? name.data
            : availableMigrationName(
                name.data,
                ` · 迁移 ${index + 1}`,
                usedNames
              ),
          settings
        );
        if (index === 0) profile.id = id.data;
        return profile;
      })
    );
  }
  for (const workspaceType of ["academic", "mystery"] as const) {
    if (!teams.some((team) => team.workspaceType === workspaceType)) {
      teams.push(
        createAgentTeamProfile(
          workspaceType,
          availableMigrationName(
            defaultAgentTeamName(workspaceType),
            "",
            usedNames
          )
        )
      );
    }
  }
  const enabled = raw.enabledTeamIds;
  const parsed = AgentTeamCatalogSnapshotSchema.safeParse({
    enabledTeamIds: {
      ...(typeof enabled.short === "string" ? { short: enabled.short } : {}),
      ...(typeof enabled.script === "string" ? { script: enabled.script } : {}),
      ...(typeof enabled.long === "string" ? { long: enabled.long } : {}),
      ...(typeof enabled.academic === "string"
        ? { academic: enabled.academic }
        : {}),
      ...(typeof enabled.mystery === "string"
        ? { mystery: enabled.mystery }
        : {})
    },
    teams
  });
  return parsed.success ? parsed.data : undefined;
}

export function tryMigrateCombinedCatalog(
  raw: Record<string, unknown>
): AgentTeamCatalogSnapshot | undefined {
  const profileCatalog = migrateProfileCatalog(raw);
  if (profileCatalog) return profileCatalog;
  try {
    return migrateVersionOneCatalog(raw);
  } catch {
    return undefined;
  }
}
