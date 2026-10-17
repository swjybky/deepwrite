import { join } from "node:path";
import {
  ScriptWorkspaceAgentSettingsInputSchema,
  ScriptWorkspaceSnapshotSchema,
  ShortWorkspaceAgentSettingsInputSchema,
  ShortWorkspaceSnapshotSchema,
  WorkspaceAgentSettingsInputSchema,
  resolveShortWorkspaceAgentIdForStage,
  resolveScriptWorkspaceAgentIdForStage,
  type ScriptWorkspaceAgentId,
  type ScriptWorkspaceAgentProfile,
  type ScriptWorkspaceAgentSettings,
  type ScriptWorkspaceAgentSettingsInput,
  type ScriptWorkspaceSnapshot,
  type ScriptWorkspaceStageId,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput,
  type ShortWorkspaceSnapshot,
  type ShortWorkspaceStageId,
  type WorkspaceAgentProfile,
  type WorkspaceAgentSettings,
  type WorkspaceAgentSettingsInput,
  type WorkspaceType
} from "@deepwrite/contracts";
import {
  atomicWriteWorkspaceAgentJson,
  cloneProfile,
  cloneReadAccess,
  cloneScriptProfile,
  cloneScriptReadAccess,
  cloneScriptWelcomeShortcuts,
  cloneWelcomeShortcuts,
  defaultProfile,
  defaultScriptProfile,
  defaultsAsInput,
  readWorkspaceAgentJson,
  scriptDefaultsAsInput,
  toPublicScriptWorkspaceAgentSettings,
  toPublicShortWorkspaceAgentSettings
} from "./workspace-agent-config-helpers";
import {
  normalizeScriptWorkspaceAgentDisk,
  normalizeShortWorkspaceAgentDisk
} from "./workspace-agent-config-normalization";
import { mergeSettingsById, sameSettingsValue } from "./merge-agent-settings";

interface DiskWorkspaceAgentSettings {
  version: 5;
  workspaceType: "short";
  defaultPlotStageIds: ShortWorkspaceAgentSettingsInput["defaultPlotStageIds"];
  agents: ShortWorkspaceAgentSettingsInput["agents"];
}

interface DiskScriptWorkspaceAgentSettings {
  version: 4;
  workspaceType: "script";
  agents: ScriptWorkspaceAgentSettingsInput["agents"];
}

export class WorkspaceAgentConfigStore {
  private readonly shortSettingsPath: string;
  private readonly scriptSettingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();
  private shortInputCache: ShortWorkspaceAgentSettingsInput | undefined;
  private scriptInputCache: ScriptWorkspaceAgentSettingsInput | undefined;

  constructor(userDataPath: string) {
    this.shortSettingsPath = join(
      userDataPath,
      "config",
      "workspace-agents.json"
    );
    this.scriptSettingsPath = join(
      userDataPath,
      "config",
      "workspace-agents-script.json"
    );
  }

  async list(): Promise<ShortWorkspaceAgentSettings>;
  async list(workspaceType: "short"): Promise<ShortWorkspaceAgentSettings>;
  async list(workspaceType: "script"): Promise<ScriptWorkspaceAgentSettings>;
  async list(workspaceType: WorkspaceType): Promise<WorkspaceAgentSettings>;
  async list(
    workspaceType: WorkspaceType = "short"
  ): Promise<WorkspaceAgentSettings> {
    await this.writeChain;
    if (workspaceType === "script") {
      const input = await this.readScriptInput();
      this.scriptInputCache = input;
      return toPublicScriptWorkspaceAgentSettings(input);
    }
    const input = await this.readInput();
    this.shortInputCache = input;
    return toPublicShortWorkspaceAgentSettings(input);
  }

  async save(
    rawInput: ShortWorkspaceAgentSettingsInput
  ): Promise<ShortWorkspaceAgentSettings>;
  async save(
    rawInput: ScriptWorkspaceAgentSettingsInput
  ): Promise<ScriptWorkspaceAgentSettings>;
  async save(
    rawInput: WorkspaceAgentSettingsInput
  ): Promise<WorkspaceAgentSettings>;
  async save(
    rawInput: WorkspaceAgentSettingsInput
  ): Promise<WorkspaceAgentSettings> {
    const input = WorkspaceAgentSettingsInputSchema.parse(rawInput);
    let saved: WorkspaceAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      if (input.workspaceType === "script") {
        const baseline = this.scriptInputCache;
        const normalized: ScriptWorkspaceAgentSettingsInput = {
          workspaceType: "script",
          agents: input.agents.map((agent) => ({
            ...agent,
            welcomeShortcuts: cloneScriptWelcomeShortcuts(
              agent.welcomeShortcuts
            ),
            readAccess: cloneScriptReadAccess(agent.readAccess)
          }))
        };
        const current = baseline ? await this.readScriptInput() : normalized;
        const next = baseline
          ? {
              workspaceType: "script" as const,
              agents: mergeSettingsById(
                current.agents,
                normalized.agents,
                baseline.agents,
                (agent) => agent.id
              )
            }
          : normalized;
        await this.writeScriptInput(next);
        this.scriptInputCache = next;
        saved = toPublicScriptWorkspaceAgentSettings(next);
        return;
      }
      const normalized: ShortWorkspaceAgentSettingsInput = {
        workspaceType: "short",
        defaultPlotStageIds: [...input.defaultPlotStageIds],
        agents: input.agents.map((agent) => ({
          ...agent,
          welcomeShortcuts: cloneWelcomeShortcuts(agent.welcomeShortcuts),
          readAccess: cloneReadAccess(agent.readAccess)
        }))
      };
      const baseline = this.shortInputCache;
      const current = baseline ? await this.readInput() : normalized;
      const next = baseline
        ? {
            workspaceType: "short" as const,
            defaultPlotStageIds: sameSettingsValue(
              normalized.defaultPlotStageIds,
              baseline.defaultPlotStageIds
            )
              ? current.defaultPlotStageIds
              : normalized.defaultPlotStageIds,
            agents: mergeSettingsById(
              current.agents,
              normalized.agents,
              baseline.agents,
              (agent) => agent.id
            )
          }
        : normalized;
      await this.writeInput(next);
      this.shortInputCache = next;
      saved = toPublicShortWorkspaceAgentSettings(next);
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async reset(): Promise<ShortWorkspaceAgentSettings>;
  async reset(
    agentId: ShortWorkspaceAgentId
  ): Promise<ShortWorkspaceAgentSettings>;
  async reset(
    workspaceType: "short",
    agentId?: ShortWorkspaceAgentId
  ): Promise<ShortWorkspaceAgentSettings>;
  async reset(
    workspaceType: "script",
    agentId?: ScriptWorkspaceAgentId
  ): Promise<ScriptWorkspaceAgentSettings>;
  async reset(
    workspaceType: WorkspaceType,
    agentId?: ShortWorkspaceAgentId | ScriptWorkspaceAgentId
  ): Promise<WorkspaceAgentSettings>;
  async reset(
    workspaceTypeOrAgentId?: WorkspaceType | ShortWorkspaceAgentId,
    rawAgentId?: ShortWorkspaceAgentId | ScriptWorkspaceAgentId
  ): Promise<WorkspaceAgentSettings> {
    const workspaceType: WorkspaceType =
      workspaceTypeOrAgentId === "script" ? "script" : "short";
    const agentId =
      workspaceTypeOrAgentId === "short" || workspaceTypeOrAgentId === "script"
        ? rawAgentId
        : workspaceTypeOrAgentId;
    let saved: WorkspaceAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      if (workspaceType === "script") {
        const scriptAgentId = agentId as ScriptWorkspaceAgentId | undefined;
        const next = scriptAgentId
          ? await this.readScriptInput()
          : scriptDefaultsAsInput();
        if (scriptAgentId) {
          const builtin = defaultScriptProfile(scriptAgentId);
          const index = next.agents.findIndex(
            (agent) => agent.id === scriptAgentId
          );
          const replacement = {
            id: builtin.id,
            systemPrompt: builtin.systemPrompt,
            welcomeShortcuts: cloneScriptWelcomeShortcuts(
              builtin.welcomeShortcuts
            ),
            readAccess: cloneScriptReadAccess(builtin.readAccess)
          };
          if (index >= 0) {
            next.agents[index] = replacement;
          } else {
            next.agents.push(replacement);
          }
        }
        const validated = ScriptWorkspaceAgentSettingsInputSchema.parse(next);
        await this.writeScriptInput(validated);
        this.scriptInputCache = validated;
        saved = toPublicScriptWorkspaceAgentSettings(validated);
        return;
      }
      const shortAgentId = agentId as ShortWorkspaceAgentId | undefined;
      const next = shortAgentId ? await this.readInput() : defaultsAsInput();
      if (shortAgentId) {
        const builtin = defaultProfile(shortAgentId);
        const index = next.agents.findIndex(
          (agent) => agent.id === shortAgentId
        );
        const replacement = {
          id: builtin.id,
          systemPrompt: builtin.systemPrompt,
          welcomeShortcuts: cloneWelcomeShortcuts(builtin.welcomeShortcuts),
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
      this.shortInputCache = validated;
      saved = toPublicShortWorkspaceAgentSettings(validated);
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
  ): Promise<ShortWorkspaceAgentProfile>;
  async resolveForStage(
    stageId: ScriptWorkspaceStageId,
    workspaceType: "script"
  ): Promise<ScriptWorkspaceAgentProfile>;
  async resolveForStage(
    stageId: ShortWorkspaceStageId | ScriptWorkspaceStageId,
    workspaceType: WorkspaceType = "short"
  ): Promise<WorkspaceAgentProfile> {
    return workspaceType === "script"
      ? await this.resolve(
          "script",
          resolveScriptWorkspaceAgentIdForStage(
            stageId as ScriptWorkspaceStageId
          )
        )
      : await this.resolve(
          "short",
          resolveShortWorkspaceAgentIdForStage(stageId as ShortWorkspaceStageId)
        );
  }

  async resolveForWorkspace(
    rawWorkspace: ShortWorkspaceSnapshot,
    workspaceType: "short"
  ): Promise<ShortWorkspaceAgentProfile>;
  async resolveForWorkspace(
    rawWorkspace: ScriptWorkspaceSnapshot,
    workspaceType: "script"
  ): Promise<ScriptWorkspaceAgentProfile>;
  async resolveForWorkspace(
    rawWorkspace: ShortWorkspaceSnapshot | ScriptWorkspaceSnapshot,
    workspaceType: WorkspaceType
  ): Promise<WorkspaceAgentProfile>;
  async resolveForWorkspace(
    rawWorkspace: ShortWorkspaceSnapshot | ScriptWorkspaceSnapshot,
    workspaceType: WorkspaceType
  ): Promise<WorkspaceAgentProfile> {
    if (workspaceType === "script") {
      const workspace = ScriptWorkspaceSnapshotSchema.parse(rawWorkspace);
      return await this.resolve(
        "script",
        workspace.activeAgentId ??
          resolveScriptWorkspaceAgentIdForStage(workspace.activeStageId)
      );
    }
    const workspace = ShortWorkspaceSnapshotSchema.parse(rawWorkspace);
    return await this.resolve(
      "short",
      workspace.activeAgentId ??
        resolveShortWorkspaceAgentIdForStage(workspace.activeStageId)
    );
  }

  async resolve(
    agentId: ShortWorkspaceAgentId
  ): Promise<ShortWorkspaceAgentProfile>;
  async resolve(
    workspaceType: "short",
    agentId: ShortWorkspaceAgentId
  ): Promise<ShortWorkspaceAgentProfile>;
  async resolve(
    workspaceType: "script",
    agentId: ScriptWorkspaceAgentId
  ): Promise<ScriptWorkspaceAgentProfile>;
  async resolve(
    workspaceTypeOrAgentId: WorkspaceType | ShortWorkspaceAgentId,
    rawAgentId?: ShortWorkspaceAgentId | ScriptWorkspaceAgentId
  ): Promise<WorkspaceAgentProfile> {
    const workspaceType: WorkspaceType =
      workspaceTypeOrAgentId === "script" ? "script" : "short";
    const agentId =
      workspaceTypeOrAgentId === "short" || workspaceTypeOrAgentId === "script"
        ? rawAgentId
        : workspaceTypeOrAgentId;
    if (!agentId) {
      throw new Error("Workspace agent id is required.");
    }
    if (workspaceType === "script") {
      const scriptAgentId = agentId as ScriptWorkspaceAgentId;
      const settings = await this.list("script");
      const profile = settings.agents.find(
        (candidate) => candidate.id === scriptAgentId
      );
      return profile
        ? cloneScriptProfile(profile)
        : defaultScriptProfile(scriptAgentId);
    }
    const shortAgentId = agentId as ShortWorkspaceAgentId;
    const settings = await this.list("short");
    const profile = settings.agents.find(
      (candidate) => candidate.id === shortAgentId
    );
    if (!profile) {
      return defaultProfile(shortAgentId);
    }
    return cloneProfile(profile);
  }

  private async readInput(): Promise<ShortWorkspaceAgentSettingsInput> {
    const raw = await readWorkspaceAgentJson(this.shortSettingsPath);
    const normalized = normalizeShortWorkspaceAgentDisk(raw);
    if (
      raw &&
      typeof raw === "object" &&
      (raw as Record<string, unknown>).version !== 5
    ) {
      await this.writeInput(normalized);
    }
    return normalized;
  }

  private async readScriptInput(): Promise<ScriptWorkspaceAgentSettingsInput> {
    const raw = await readWorkspaceAgentJson(this.scriptSettingsPath);
    const normalized = normalizeScriptWorkspaceAgentDisk(raw);
    if (
      raw &&
      typeof raw === "object" &&
      (raw as Record<string, unknown>).version !== 4
    ) {
      await this.writeScriptInput(normalized);
    }
    return normalized;
  }

  private async writeInput(
    input: ShortWorkspaceAgentSettingsInput
  ): Promise<void> {
    const disk: DiskWorkspaceAgentSettings = {
      version: 5,
      workspaceType: "short",
      defaultPlotStageIds: [...input.defaultPlotStageIds],
      agents: input.agents
    };
    await atomicWriteWorkspaceAgentJson(this.shortSettingsPath, disk);
  }

  private async writeScriptInput(
    input: ScriptWorkspaceAgentSettingsInput
  ): Promise<void> {
    const disk: DiskScriptWorkspaceAgentSettings = {
      version: 4,
      workspaceType: "script",
      agents: input.agents
    };
    await atomicWriteWorkspaceAgentJson(this.scriptSettingsPath, disk);
  }
}
