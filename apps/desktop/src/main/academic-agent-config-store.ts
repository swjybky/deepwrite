import { withConfigurationLock } from "./configuration-lock";
import { join } from "node:path";
import {
  ACADEMIC_AGENT_IDS,
  AcademicAgentIdSchema,
  AcademicAgentSettingsInputSchema,
  AcademicAgentSettingsSchema,
  DEFAULT_ACADEMIC_AGENT_PROFILES,
  getDefaultAcademicAgentProfile,
  type AcademicAgentId,
  type AcademicAgentProfile,
  type AcademicAgentSettings,
  type AcademicAgentSettingsInput,
  type AcademicAgentSettingsInputAgent
} from "@deepwrite/contracts";
import { localizeAgentSystemPrompt } from "./builtin-agent-prompts";
import { mergeSettingsById } from "./merge-agent-settings";
import { isRecord } from "@deepwrite/shared";
import { writeJsonAtomic, readJsonIfExists } from "@deepwrite/shared/node";

export const ACADEMIC_AGENT_SETTINGS_DISK_VERSION = 1 as const;

interface DiskAcademicAgentSettings extends AcademicAgentSettingsInput {
  version: typeof ACADEMIC_AGENT_SETTINGS_DISK_VERSION;
}

function cloneInputAgent(
  agent: AcademicAgentSettingsInputAgent
): AcademicAgentSettingsInputAgent {
  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    welcomeShortcuts: [
      agent.welcomeShortcuts[0],
      agent.welcomeShortcuts[1],
      agent.welcomeShortcuts[2]
    ],
    modelMode: agent.modelMode ?? "inherit",
    ...(agent.modelMode === "custom" && agent.modelId
      ? {
          modelId: agent.modelId,
          ...(agent.thinkingLevel !== undefined
            ? { thinkingLevel: agent.thinkingLevel }
            : {}),
          ...(agent.thinkingLevel === "off" && agent.temperature !== undefined
            ? { temperature: agent.temperature }
            : {})
        }
      : {})
  };
}

function cloneProfile(profile: AcademicAgentProfile): AcademicAgentProfile {
  return {
    ...profile,
    welcomeShortcuts: [
      profile.welcomeShortcuts[0],
      profile.welcomeShortcuts[1],
      profile.welcomeShortcuts[2]
    ]
  };
}

function defaultsAsInput(): AcademicAgentSettingsInput {
  return {
    workspaceType: "academic",
    agents: DEFAULT_ACADEMIC_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      welcomeShortcuts: [
        profile.welcomeShortcuts[0],
        profile.welcomeShortcuts[1],
        profile.welcomeShortcuts[2]
      ],
      modelMode: profile.modelMode ?? "inherit"
    }))
  };
}

function parseDiskSettings(raw: unknown): AcademicAgentSettingsInput {
  if (raw === undefined) return defaultsAsInput();
  if (!isRecord(raw)) {
    throw new Error("学术智能体配置内容无效，已停止加载以避免覆盖原文件。");
  }
  if (raw.version !== ACADEMIC_AGENT_SETTINGS_DISK_VERSION) {
    return defaultsAsInput();
  }
  const { version: _version, ...rawSettings } = raw;
  const parsed = AcademicAgentSettingsInputSchema.safeParse(rawSettings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `学术智能体配置内容无效，已停止加载以避免覆盖原文件${
        issue ? `：${issue.path.join(".") || "root"} ${issue.message}` : "。"
      }`
    );
  }
  return {
    workspaceType: "academic",
    agents: parsed.data.agents.map(cloneInputAgent)
  };
}

export class AcademicAgentConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(
      userDataPath,
      "config",
      "academic-workspace-agents.json"
    );
  }

  async list(): Promise<AcademicAgentSettings> {
    await this.writeChain;
    const input = await this.readInput();
    return this.toPublicSettings(input);
  }

  async save(
    rawInput: AcademicAgentSettingsInput
  ): Promise<AcademicAgentSettings> {
    const input = AcademicAgentSettingsInputSchema.parse(rawInput);
    const baseline = input.baseAgents;
    let saved: AcademicAgentSettings | undefined;
    const operation = this.writeChain.then(() =>
      withConfigurationLock(this.settingsPath, async () => {
        const normalized: AcademicAgentSettingsInput = {
          workspaceType: "academic",
          agents: input.agents.map(cloneInputAgent)
        };
        const current = baseline ? await this.readInput() : normalized;
        const next = baseline
          ? {
              workspaceType: "academic" as const,
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

  async reset(rawAgentId?: AcademicAgentId): Promise<AcademicAgentSettings> {
    const agentId = rawAgentId
      ? AcademicAgentIdSchema.parse(rawAgentId)
      : undefined;
    let saved: AcademicAgentSettings | undefined;
    const operation = this.writeChain.then(() =>
      withConfigurationLock(this.settingsPath, async () => {
        const next = agentId ? await this.readInput() : defaultsAsInput();
        if (agentId) {
          const builtin = getDefaultAcademicAgentProfile(agentId);
          const replacement: AcademicAgentSettingsInputAgent = {
            id: builtin.id,
            systemPrompt: builtin.systemPrompt,
            welcomeShortcuts: [
              builtin.welcomeShortcuts[0],
              builtin.welcomeShortcuts[1],
              builtin.welcomeShortcuts[2]
            ],
            modelMode: "inherit"
          };
          const index = next.agents.findIndex((agent) => agent.id === agentId);
          if (index < 0) {
            throw new Error(`学术智能体配置缺少角色：${agentId}`);
          }
          next.agents[index] = replacement;
        }
        const validated = AcademicAgentSettingsInputSchema.parse(next);
        await this.writeInput(validated);
        saved = this.toPublicSettings(validated);
      })
    );
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async resolve(
    rawAgentId: AcademicAgentId = "academic"
  ): Promise<AcademicAgentProfile> {
    const agentId = AcademicAgentIdSchema.parse(rawAgentId);
    const settings = await this.list();
    const profile = settings.agents.find((agent) => agent.id === agentId);
    return profile
      ? cloneProfile(profile)
      : cloneProfile(getDefaultAcademicAgentProfile(agentId));
  }

  private trackWrite(operation: Promise<unknown>): void {
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
  }

  private async readInput(): Promise<AcademicAgentSettingsInput> {
    return parseDiskSettings(await readJsonIfExists(this.settingsPath));
  }

  private async writeInput(input: AcademicAgentSettingsInput): Promise<void> {
    const disk: DiskAcademicAgentSettings = {
      version: ACADEMIC_AGENT_SETTINGS_DISK_VERSION,
      workspaceType: "academic",
      agents: input.agents.map(cloneInputAgent)
    };
    await writeJsonAtomic(this.settingsPath, disk);
  }

  private toPublicSettings(
    input: AcademicAgentSettingsInput
  ): AcademicAgentSettings {
    const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
    return AcademicAgentSettingsSchema.parse({
      workspaceType: "academic",
      agents: ACADEMIC_AGENT_IDS.map((id) => {
        const builtin = getDefaultAcademicAgentProfile(id);
        const override = byId.get(id);
        if (!override) {
          return {
            ...builtin,
            systemPrompt: localizeAgentSystemPrompt("academic", undefined)
          };
        }
        return {
          ...builtin,
          systemPrompt: localizeAgentSystemPrompt(
            "academic",
            override.systemPrompt
          ),
          welcomeShortcuts: [
            override.welcomeShortcuts[0],
            override.welcomeShortcuts[1],
            override.welcomeShortcuts[2]
          ],
          modelMode: override.modelMode ?? "inherit",
          ...(override.modelMode === "custom" && override.modelId
            ? {
                modelId: override.modelId,
                ...(override.thinkingLevel !== undefined
                  ? { thinkingLevel: override.thinkingLevel }
                  : {}),
                ...(override.thinkingLevel === "off" &&
                override.temperature !== undefined
                  ? { temperature: override.temperature }
                  : {})
              }
            : {})
        };
      })
    });
  }
}
