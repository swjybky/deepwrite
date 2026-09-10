import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AgentTeamCatalogSnapshotSchema,
  LongAgentTeamSettingsInputSchema,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfileSaveInput,
  type AgentTeamWorkspaceType,
  type LongAgentTeamSettings
} from "@deepwrite/contracts";
import { invalidAgentTeamConfig } from "./agent-team-config-error";
import {
  createAgentTeamProfile,
  defaultAgentTeamName
} from "./agent-team-profile-factory";
import { migrateLegacyLongAgentTeamSettings } from "./legacy-long-agent-team-migration";
import { migrateLegacyScriptAgentTeamSettings } from "./legacy-script-agent-team-migration";
import { migrateLegacyShortAgentTeamSettings } from "./legacy-short-agent-team-migration";

export {
  migrateVersionOneCatalog,
  tryMigrateCombinedCatalog
} from "./agent-team-catalog-migration";
export { invalidAgentTeamConfig } from "./agent-team-config-error";
export { createAgentTeamProfile } from "./agent-team-profile-factory";

export const AGENT_TEAM_CATALOG_DISK_VERSION = 5 as const;

export interface AgentTeamDiskCatalog extends AgentTeamCatalogSnapshot {
  version: typeof AGENT_TEAM_CATALOG_DISK_VERSION;
}

export interface LegacyAgentTeamPaths {
  short: string;
  script: string;
  long: string;
}

export async function readAgentTeamJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function atomicWriteAgentTeamJson(
  path: string,
  value: unknown
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

export async function createCatalogFromLegacyFiles(
  paths: LegacyAgentTeamPaths
): Promise<AgentTeamCatalogSnapshot> {
  const [shortRaw, scriptRaw, longRaw] = await Promise.all([
    readAgentTeamJson(paths.short),
    readAgentTeamJson(paths.script),
    readAgentTeamJson(paths.long)
  ]);
  let shortProfiles = [createAgentTeamProfile("short")];
  let scriptProfiles = [createAgentTeamProfile("script")];

  if (shortRaw !== undefined) {
    if (!shortRaw || typeof shortRaw !== "object" || Array.isArray(shortRaw)) {
      throw invalidAgentTeamConfig();
    }
    const { version: _version, ...settings } = shortRaw as Record<
      string,
      unknown
    >;
    const migrated = migrateLegacyShortAgentTeamSettings(settings);
    if (!migrated) throw invalidAgentTeamConfig();
    shortProfiles = migrated.map((shortSettings, index) =>
      createAgentTeamProfile(
        "short",
        index === 0
          ? defaultAgentTeamName("short")
          : `迁移短篇团队 ${index + 1}`,
        shortSettings
      )
    );
  }
  if (scriptRaw !== undefined) {
    if (
      !scriptRaw ||
      typeof scriptRaw !== "object" ||
      Array.isArray(scriptRaw)
    ) {
      throw invalidAgentTeamConfig();
    }
    const { version: _version, ...settings } = scriptRaw as Record<
      string,
      unknown
    >;
    const migrated = migrateLegacyScriptAgentTeamSettings(settings);
    if (!migrated) throw invalidAgentTeamConfig();
    scriptProfiles = migrated.map((scriptSettings, index) =>
      createAgentTeamProfile(
        "script",
        index === 0
          ? defaultAgentTeamName("script")
          : `迁移剧本团队 ${index + 1}`,
        scriptSettings
      )
    );
  }
  let longProfiles = [createAgentTeamProfile("long")];
  if (longRaw !== undefined) {
    if (!longRaw || typeof longRaw !== "object" || Array.isArray(longRaw)) {
      throw invalidAgentTeamConfig();
    }
    const { version: _version, ...settings } = longRaw as Record<
      string,
      unknown
    >;
    const migrated = migrateLegacyLongAgentTeamSettings(settings);
    if (!migrated) {
      const parsed = LongAgentTeamSettingsInputSchema.safeParse(settings);
      throw invalidAgentTeamConfig(
        parsed.success ? undefined : parsed.error.issues[0]
      );
    }
    longProfiles = migrated.map((longSettings, index) =>
      createAgentTeamProfile(
        "long",
        index === 0
          ? defaultAgentTeamName("long")
          : `迁移长篇团队 ${index + 1}`,
        longSettings
      )
    );
  }
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: {
      ...(shortRaw === undefined ? {} : { short: shortProfiles[0]!.id }),
      ...(scriptRaw === undefined ? {} : { script: scriptProfiles[0]!.id }),
      ...(longRaw === undefined ? {} : { long: longProfiles[0]!.id })
    },
    teams: [...shortProfiles, ...scriptProfiles, ...longProfiles]
  });
}

function catalogFromStandaloneSettings(
  workspaceType: Exclude<AgentTeamWorkspaceType, "long">,
  settings: readonly AgentTeamProfileSaveInput["settings"][]
): AgentTeamCatalogSnapshot {
  const migratedProfiles = settings.map((candidate, index) =>
    createAgentTeamProfile(
      workspaceType,
      index === 0
        ? defaultAgentTeamName(workspaceType)
        : `迁移${workspaceType === "short" ? "短篇" : "剧本"}团队 ${index + 1}`,
      candidate
    )
  );
  const shortProfiles =
    workspaceType === "short"
      ? migratedProfiles
      : [createAgentTeamProfile("short")];
  const scriptProfiles =
    workspaceType === "script"
      ? migratedProfiles
      : [createAgentTeamProfile("script")];
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: { [workspaceType]: migratedProfiles[0]!.id },
    teams: [...shortProfiles, ...scriptProfiles, createAgentTeamProfile("long")]
  });
}

function catalogFromLongSettings(
  settings: readonly LongAgentTeamSettings[]
): AgentTeamCatalogSnapshot {
  const short = createAgentTeamProfile("short");
  const script = createAgentTeamProfile("script");
  const longProfiles = settings.map((longSettings, index) =>
    createAgentTeamProfile(
      "long",
      index === 0 ? defaultAgentTeamName("long") : `迁移长篇团队 ${index + 1}`,
      longSettings
    )
  );
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: { long: longProfiles[0]!.id },
    teams: [short, script, ...longProfiles]
  });
}

export function tryMigrateStandaloneCatalog(
  raw: Record<string, unknown>
): AgentTeamCatalogSnapshot | undefined {
  const short = migrateLegacyShortAgentTeamSettings(raw);
  if (short) return catalogFromStandaloneSettings("short", short);
  const script = migrateLegacyScriptAgentTeamSettings(raw);
  if (script) return catalogFromStandaloneSettings("script", script);
  const long = migrateLegacyLongAgentTeamSettings(raw);
  return long ? catalogFromLongSettings(long) : undefined;
}
