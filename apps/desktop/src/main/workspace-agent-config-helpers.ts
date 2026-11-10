import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_DEFAULT_PLOT_STAGE_IDS,
  SCRIPT_WORKSPACE_AGENT_IDS,
  SHORT_WORKSPACE_AGENT_IDS,
  ScriptWorkspaceAgentSettingsSchema,
  ShortWorkspaceAgentSettingsSchema,
  type ScriptAgentReadAccess,
  type ScriptWorkspaceAgentId,
  type ScriptWorkspaceAgentProfile,
  type ScriptWorkspaceAgentSettings,
  type ScriptWorkspaceAgentSettingsInput,
  type ShortAgentReadAccess,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { localizeAgentSystemPrompt } from "./builtin-agent-prompts";

export function cloneReadAccess(
  value: ShortAgentReadAccess
): ShortAgentReadAccess {
  return { material: [...value.material], skill: [...value.skill] };
}

export function cloneWelcomeShortcuts(
  value: ShortWorkspaceAgentProfile["welcomeShortcuts"]
): ShortWorkspaceAgentProfile["welcomeShortcuts"] {
  return [value[0], value[1], value[2]];
}

export function cloneProfile(
  profile: ShortWorkspaceAgentProfile
): ShortWorkspaceAgentProfile {
  return {
    ...profile,
    welcomeShortcuts: cloneWelcomeShortcuts(profile.welcomeShortcuts),
    readAccess: cloneReadAccess(profile.readAccess)
  };
}

export function defaultProfile(
  agentId: ShortWorkspaceAgentId
): ShortWorkspaceAgentProfile {
  const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.find(
    (candidate) => candidate.id === agentId
  );
  if (!profile) {
    throw new Error(`Missing builtin short workspace profile: ${agentId}`);
  }
  return cloneProfile(profile);
}

export function defaultsAsInput(): ShortWorkspaceAgentSettingsInput {
  return {
    workspaceType: "short",
    defaultPlotStageIds: [...SHORT_DEFAULT_PLOT_STAGE_IDS],
    agents: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      welcomeShortcuts: cloneWelcomeShortcuts(profile.welcomeShortcuts),
      readAccess: cloneReadAccess(profile.readAccess)
    }))
  };
}

export function cloneScriptReadAccess(
  value: ScriptAgentReadAccess
): ScriptAgentReadAccess {
  return { material: [...value.material], skill: [...value.skill] };
}

export function cloneScriptWelcomeShortcuts(
  value: ScriptWorkspaceAgentProfile["welcomeShortcuts"]
): ScriptWorkspaceAgentProfile["welcomeShortcuts"] {
  return [value[0], value[1], value[2]];
}

export function cloneScriptProfile(
  profile: ScriptWorkspaceAgentProfile
): ScriptWorkspaceAgentProfile {
  return {
    ...profile,
    welcomeShortcuts: cloneScriptWelcomeShortcuts(profile.welcomeShortcuts),
    readAccess: cloneScriptReadAccess(profile.readAccess)
  };
}

export function defaultScriptProfile(
  agentId: ScriptWorkspaceAgentId
): ScriptWorkspaceAgentProfile {
  const profile = DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES.find(
    (candidate) => candidate.id === agentId
  );
  if (!profile) {
    throw new Error(`Missing builtin script workspace profile: ${agentId}`);
  }
  return cloneScriptProfile(profile);
}

export function scriptDefaultsAsInput(): ScriptWorkspaceAgentSettingsInput {
  return {
    workspaceType: "script",
    agents: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      welcomeShortcuts: cloneScriptWelcomeShortcuts(profile.welcomeShortcuts),
      readAccess: cloneScriptReadAccess(profile.readAccess)
    }))
  };
}

export function toPublicShortWorkspaceAgentSettings(
  input: ShortWorkspaceAgentSettingsInput
): ShortWorkspaceAgentSettings {
  const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
  return ShortWorkspaceAgentSettingsSchema.parse({
    workspaceType: "short",
    defaultPlotStageIds: [...input.defaultPlotStageIds],
    agents: SHORT_WORKSPACE_AGENT_IDS.map((agentId) => {
      const builtin = defaultProfile(agentId);
      const override = byId.get(agentId);
      return {
        ...builtin,
        ...(override
          ? {
              welcomeShortcuts: cloneWelcomeShortcuts(override.welcomeShortcuts)
            }
          : {}),
        systemPrompt: localizeAgentSystemPrompt(
          "short",
          override?.systemPrompt
        ),
        readAccess: cloneReadAccess(override?.readAccess ?? builtin.readAccess)
      };
    })
  });
}

export function toPublicScriptWorkspaceAgentSettings(
  input: ScriptWorkspaceAgentSettingsInput
): ScriptWorkspaceAgentSettings {
  const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
  return ScriptWorkspaceAgentSettingsSchema.parse({
    workspaceType: "script",
    agents: SCRIPT_WORKSPACE_AGENT_IDS.map((agentId) => {
      const builtin = defaultScriptProfile(agentId);
      const override = byId.get(agentId);
      return {
        ...builtin,
        ...(override
          ? {
              welcomeShortcuts: cloneScriptWelcomeShortcuts(
                override.welcomeShortcuts
              )
            }
          : {}),
        systemPrompt: localizeAgentSystemPrompt(
          "script",
          override?.systemPrompt
        ),
        readAccess: cloneScriptReadAccess(
          override?.readAccess ?? builtin.readAccess
        )
      };
    })
  });
}

export async function readWorkspaceAgentJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function atomicWriteWorkspaceAgentJson(
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
