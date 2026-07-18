import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_WORKSPACE_AGENT_IDS,
  ShortWorkspaceAgentSettingsInputSchema,
  ShortWorkspaceAgentSettingsSchema,
  resolveShortWorkspaceAgentIdForStage,
  type ShortAgentReadAccess,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";

interface DiskWorkspaceAgentSettings {
  version: 1;
  workspaceType: "short";
  agents: ShortWorkspaceAgentSettingsInput["agents"];
}

const REQUIRED_WORKSPACE_STAGES: Record<
  ShortWorkspaceAgentId,
  readonly ShortWorkspaceStageId[]
> = {
  character_design: ["character_design"],
  plot_design: ["plot_design", "intro_design", "plot_refine"],
  outline: ["outline"],
  expert_draft_coordinator: ["draft"],
  expert_section_writer: ["draft"]
};

function cloneReadAccess(value: ShortAgentReadAccess): ShortAgentReadAccess {
  return {
    workspace: [...value.workspace],
    material: [...value.material],
    skill: [...value.skill]
  };
}

function cloneProfile(profile: ShortWorkspaceAgentProfile): ShortWorkspaceAgentProfile {
  return {
    ...profile,
    readAccess: cloneReadAccess(profile.readAccess)
  };
}

function defaultProfile(agentId: ShortWorkspaceAgentId): ShortWorkspaceAgentProfile {
  const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.find(
    (candidate) => candidate.id === agentId
  );
  if (!profile) {
    throw new Error(`Missing builtin short workspace profile: ${agentId}`);
  }
  return cloneProfile(profile);
}

function normalizeReadAccess(
  agentId: ShortWorkspaceAgentId,
  access: ShortAgentReadAccess
): ShortAgentReadAccess {
  const workspace = [...access.workspace];
  for (const required of REQUIRED_WORKSPACE_STAGES[agentId]) {
    if (!workspace.includes(required)) {
      workspace.push(required);
    }
  }
  return { workspace, material: [...access.material], skill: [...access.skill] };
}

function defaultsAsInput(): ShortWorkspaceAgentSettingsInput {
  return {
    workspaceType: "short",
    agents: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      readAccess: cloneReadAccess(profile.readAccess)
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

function normalizeDiskSettings(raw: unknown): ShortWorkspaceAgentSettingsInput {
  if (!raw || typeof raw !== "object") {
    return defaultsAsInput();
  }
  const candidate = raw as Record<string, unknown>;
  const parsed = ShortWorkspaceAgentSettingsInputSchema.safeParse({
    workspaceType: candidate.workspaceType,
    agents: candidate.agents
  });
  if (!parsed.success) {
    return defaultsAsInput();
  }
  return {
    workspaceType: "short",
    agents: parsed.data.agents.map((agent) => ({
      ...agent,
      readAccess: normalizeReadAccess(agent.id, agent.readAccess)
    }))
  };
}

export class WorkspaceAgentConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "workspace-agents.json");
  }

  async list(): Promise<ShortWorkspaceAgentSettings> {
    await this.writeChain;
    return this.toPublicSettings(await this.readInput());
  }

  async save(
    rawInput: ShortWorkspaceAgentSettingsInput
  ): Promise<ShortWorkspaceAgentSettings> {
    const input = ShortWorkspaceAgentSettingsInputSchema.parse(rawInput);
    let saved: ShortWorkspaceAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const normalized: ShortWorkspaceAgentSettingsInput = {
        workspaceType: "short",
        agents: input.agents.map((agent) => ({
          ...agent,
          readAccess: normalizeReadAccess(agent.id, agent.readAccess)
        }))
      };
      await this.writeInput(normalized);
      saved = this.toPublicSettings(normalized);
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async reset(agentId?: ShortWorkspaceAgentId): Promise<ShortWorkspaceAgentSettings> {
    let saved: ShortWorkspaceAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const next = agentId ? await this.readInput() : defaultsAsInput();
      if (agentId) {
        const builtin = defaultProfile(agentId);
        const index = next.agents.findIndex((agent) => agent.id === agentId);
        const replacement = {
          id: builtin.id,
          systemPrompt: builtin.systemPrompt,
          readAccess: cloneReadAccess(builtin.readAccess)
        };
        if (index >= 0) {
          next.agents[index] = replacement;
        } else {
          next.agents.push(replacement);
        }
      }
      const validated = ShortWorkspaceAgentSettingsInputSchema.parse(next);
      await this.writeInput(validated);
      saved = this.toPublicSettings(validated);
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async resolveForStage(
    stageId: ShortWorkspaceStageId
  ): Promise<ShortWorkspaceAgentProfile> {
    return await this.resolve(resolveShortWorkspaceAgentIdForStage(stageId));
  }

  async resolve(agentId: ShortWorkspaceAgentId): Promise<ShortWorkspaceAgentProfile> {
    const settings = await this.list();
    const profile = settings.agents.find((candidate) => candidate.id === agentId);
    if (!profile) {
      return defaultProfile(agentId);
    }
    return cloneProfile(profile);
  }

  private async readInput(): Promise<ShortWorkspaceAgentSettingsInput> {
    return normalizeDiskSettings(await readJson(this.settingsPath));
  }

  private async writeInput(input: ShortWorkspaceAgentSettingsInput): Promise<void> {
    const disk: DiskWorkspaceAgentSettings = {
      version: 1,
      workspaceType: "short",
      agents: input.agents
    };
    await atomicWriteJson(this.settingsPath, disk);
  }

  private toPublicSettings(
    input: ShortWorkspaceAgentSettingsInput
  ): ShortWorkspaceAgentSettings {
    const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
    return ShortWorkspaceAgentSettingsSchema.parse({
      workspaceType: "short",
      agents: SHORT_WORKSPACE_AGENT_IDS.map((agentId) => {
        const builtin = defaultProfile(agentId);
        const override = byId.get(agentId);
        return {
          ...builtin,
          ...(override ? { systemPrompt: override.systemPrompt } : {}),
          readAccess: normalizeReadAccess(
            agentId,
            override?.readAccess ?? builtin.readAccess
          )
        };
      })
    });
  }
}
