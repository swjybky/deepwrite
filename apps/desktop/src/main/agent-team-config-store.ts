import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AgentTeamSettingsInputSchema,
  AgentTeamSettingsSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  SHORT_WORKSPACE_AGENT_IDS,
  ShortWorkspaceAgentIdSchema,
  type AgentTeamSettings,
  type AgentTeamSettingsInput,
  type ShortAgentSubagentDefinition,
  type ShortWorkspaceAgentId
} from "@deepwrite/contracts";

interface DiskAgentTeamSettings extends AgentTeamSettingsInput {
  version: 1;
}

function cloneDefinition(
  definition: ShortAgentSubagentDefinition
): ShortAgentSubagentDefinition {
  return { ...definition };
}

function cloneSettings(settings: AgentTeamSettingsInput): AgentTeamSettings {
  const byParentId = new Map(
    settings.teams.map((team) => [team.parentAgentId, team])
  );
  return AgentTeamSettingsSchema.parse({
    workspaceType: "short",
    teams: SHORT_WORKSPACE_AGENT_IDS.map((parentAgentId) => ({
      parentAgentId,
      subagents:
        byParentId.get(parentAgentId)?.subagents.map(cloneDefinition) ?? []
    }))
  });
}

function defaultSettings(): AgentTeamSettings {
  return cloneSettings(DEFAULT_AGENT_TEAM_SETTINGS);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

export class AgentTeamConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "agent-teams.json");
  }

  async list(): Promise<AgentTeamSettings> {
    await this.writeChain;
    const raw = await readJson(this.settingsPath);
    if (raw === undefined) return defaultSettings();
    if (
      !raw ||
      typeof raw !== "object" ||
      !("version" in raw) ||
      raw.version !== 1
    ) {
      throw new Error("智能体团队配置版本无效，已停止加载以避免覆盖原文件。");
    }
    const parsed = AgentTeamSettingsInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `智能体团队配置内容无效，已停止加载以避免覆盖原文件${
          issue ? `：${issue.path.join(".") || "root"} ${issue.message}` : "。"
        }`
      );
    }
    return cloneSettings(parsed.data);
  }

  async save(rawInput: AgentTeamSettingsInput): Promise<AgentTeamSettings> {
    const input = AgentTeamSettingsInputSchema.parse(rawInput);
    let saved: AgentTeamSettings | undefined;
    const operation = this.writeChain.then(async () => {
      saved = cloneSettings(input);
      const disk: DiskAgentTeamSettings = {
        version: 1,
        workspaceType: "short",
        teams: saved.teams.map((team) => ({
          parentAgentId: team.parentAgentId,
          subagents: team.subagents.map(cloneDefinition)
        }))
      };
      await atomicWriteJson(this.settingsPath, disk);
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async resolve(
    rawParentAgentId: ShortWorkspaceAgentId
  ): Promise<ShortAgentSubagentDefinition[]> {
    const parentAgentId = ShortWorkspaceAgentIdSchema.parse(rawParentAgentId);
    const settings = await this.list();
    return (
      settings.teams
        .find((team) => team.parentAgentId === parentAgentId)
        ?.subagents.filter((definition) => definition.enabled)
        .map(cloneDefinition) ?? []
    );
  }
}
