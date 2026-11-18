import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_MYSTERY_AGENT_PROFILES,
  MYSTERY_AGENT_IDS,
  MysteryAgentIdSchema,
  MysteryAgentSettingsInputSchema,
  MysteryAgentSettingsSchema,
  getDefaultMysteryAgentProfile,
  type MysteryAgentId,
  type MysteryAgentProfile,
  type MysteryAgentSettings,
  type MysteryAgentSettingsInput,
  type MysteryAgentSettingsInputAgent
} from "@deepwrite/contracts";
import { localizeAgentSystemPrompt } from "./builtin-agent-prompts";
import { withConfigurationLock } from "./configuration-lock";
import { mergeSettingsById } from "./merge-agent-settings";

export const MYSTERY_AGENT_SETTINGS_DISK_VERSION = 1 as const;

interface DiskMysteryAgentSettings extends MysteryAgentSettingsInput {
  version: typeof MYSTERY_AGENT_SETTINGS_DISK_VERSION;
}

function cloneInputAgent(
  agent: MysteryAgentSettingsInputAgent
): MysteryAgentSettingsInputAgent {
  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    welcomeShortcuts: [
      agent.welcomeShortcuts[0],
      agent.welcomeShortcuts[1],
      agent.welcomeShortcuts[2]
    ]
  };
}

function cloneProfile(profile: MysteryAgentProfile): MysteryAgentProfile {
  return {
    ...profile,
    welcomeShortcuts: [
      profile.welcomeShortcuts[0],
      profile.welcomeShortcuts[1],
      profile.welcomeShortcuts[2]
    ]
  };
}

function defaultsAsInput(): MysteryAgentSettingsInput {
  return {
    workspaceType: "mystery",
    agents: DEFAULT_MYSTERY_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      welcomeShortcuts: [
        profile.welcomeShortcuts[0],
        profile.welcomeShortcuts[1],
        profile.welcomeShortcuts[2]
      ]
    }))
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDiskSettings(raw: unknown): MysteryAgentSettingsInput {
  if (raw === undefined) return defaultsAsInput();
  if (!isRecord(raw)) {
    throw new Error("剧本杀智能体配置内容无效，已停止加载以避免覆盖原文件。");
  }
  if (raw.version !== MYSTERY_AGENT_SETTINGS_DISK_VERSION) {
    return defaultsAsInput();
  }
  const { version: _version, ...rawSettings } = raw;
  const parsed = MysteryAgentSettingsInputSchema.safeParse(rawSettings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `剧本杀智能体配置内容无效，已停止加载以避免覆盖原文件${
        issue ? `：${issue.path.join(".") || "root"} ${issue.message}` : "。"
      }`
    );
  }
  return {
    workspaceType: "mystery",
    agents: parsed.data.agents.map(cloneInputAgent)
  };
}

export class MysteryAgentConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "mystery-agents.json");
  }

  async list(): Promise<MysteryAgentSettings> {
    await this.writeChain;
    const input = await this.readInput();
    return this.toPublicSettings(input);
  }

  async save(
    rawInput: MysteryAgentSettingsInput
  ): Promise<MysteryAgentSettings> {
    const input = MysteryAgentSettingsInputSchema.parse(rawInput);
    const baseline = input.baseAgents;
    let saved: MysteryAgentSettings | undefined;
    const operation = this.writeChain.then(() =>
      withConfigurationLock(this.settingsPath, async () => {
        const normalized: MysteryAgentSettingsInput = {
          workspaceType: "mystery",
          agents: input.agents.map(cloneInputAgent)
        };
        const current = baseline ? await this.readInput() : normalized;
        const next = baseline
          ? {
              workspaceType: "mystery" as const,
              agents: mergeSettingsById(
                current.agents,
                normalized.agents,
                baseline,
                (agent) => agent.id
              )
            }
          : normalized;
        await this.writeInput(next);
        saved = this.toPublicSettings(next);
      })
    );
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async reset(rawAgentId?: MysteryAgentId): Promise<MysteryAgentSettings> {
    const agentId = rawAgentId
      ? MysteryAgentIdSchema.parse(rawAgentId)
      : undefined;
    let saved: MysteryAgentSettings | undefined;
    const operation = this.writeChain.then(() =>
      withConfigurationLock(this.settingsPath, async () => {
        const next = agentId ? await this.readInput() : defaultsAsInput();
        if (agentId) {
          const builtin = getDefaultMysteryAgentProfile(agentId);
          const index = next.agents.findIndex((agent) => agent.id === agentId);
          if (index < 0) {
            throw new Error(`剧本杀智能体配置缺少角色：${agentId}`);
          }
          next.agents[index] = {
            id: builtin.id,
            systemPrompt: builtin.systemPrompt,
            welcomeShortcuts: [
              builtin.welcomeShortcuts[0],
              builtin.welcomeShortcuts[1],
              builtin.welcomeShortcuts[2]
            ]
          };
        }
        const validated = MysteryAgentSettingsInputSchema.parse(next);
        await this.writeInput(validated);
        saved = this.toPublicSettings(validated);
      })
    );
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async resolve(
    rawAgentId: MysteryAgentId = "mystery"
  ): Promise<MysteryAgentProfile> {
    const agentId = MysteryAgentIdSchema.parse(rawAgentId);
    const settings = await this.list();
    const profile = settings.agents.find((agent) => agent.id === agentId);
    return profile
      ? cloneProfile(profile)
      : cloneProfile(getDefaultMysteryAgentProfile(agentId));
  }

  private trackWrite(operation: Promise<unknown>): void {
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
  }

  private async readInput(): Promise<MysteryAgentSettingsInput> {
    return parseDiskSettings(await readJson(this.settingsPath));
  }

  private async writeInput(input: MysteryAgentSettingsInput): Promise<void> {
    const disk: DiskMysteryAgentSettings = {
      version: MYSTERY_AGENT_SETTINGS_DISK_VERSION,
      workspaceType: "mystery",
      agents: input.agents.map(cloneInputAgent)
    };
    await atomicWriteJson(this.settingsPath, disk);
  }

  private toPublicSettings(
    input: MysteryAgentSettingsInput
  ): MysteryAgentSettings {
    const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
    return MysteryAgentSettingsSchema.parse({
      workspaceType: "mystery",
      agents: MYSTERY_AGENT_IDS.map((id) => {
        const builtin = getDefaultMysteryAgentProfile(id);
        const override = byId.get(id);
        if (!override) {
          return {
            ...builtin,
            systemPrompt: localizeAgentSystemPrompt("mystery", undefined)
          };
        }
        return {
          ...builtin,
          systemPrompt: localizeAgentSystemPrompt(
            "mystery",
            override.systemPrompt
          ),
          welcomeShortcuts: [
            override.welcomeShortcuts[0],
            override.welcomeShortcuts[1],
            override.welcomeShortcuts[2]
          ]
        };
      })
    });
  }
}
