import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentSettingsInput,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import { WorkspaceAgentConfigStore } from "./workspace-agent-config-store";

const temporaryRoots = new Set<string>();

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-workspace-agent-store-"));
  temporaryRoots.add(root);
  return root;
}

function defaultInput(): ShortWorkspaceAgentSettingsInput {
  return {
    workspaceType: "short",
    agents: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      readAccess: {
        workspace: [...profile.readAccess.workspace],
        material: [...profile.readAccess.material],
        skill: [...profile.readAccess.skill]
      }
    }))
  };
}

function customizedInput(prefix: string): ShortWorkspaceAgentSettingsInput {
  return {
    workspaceType: "short",
    agents: defaultInput().agents.map((agent) => ({
      ...agent,
      systemPrompt: `${prefix}:${agent.id}`,
      readAccess: {
        workspace: [],
        material: [],
        skill: []
      }
    }))
  };
}

function byAgentId<T extends { id: ShortWorkspaceAgentId }>(
  agents: readonly T[],
  agentId: ShortWorkspaceAgentId
): T {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new Error(`Missing test agent: ${agentId}`);
  }
  return agent;
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true }))
  );
  temporaryRoots.clear();
});

describe("WorkspaceAgentConfigStore", () => {
  it("returns cloned builtin settings when no persisted config exists", async () => {
    const store = new WorkspaceAgentConfigStore(await makeTemporaryRoot());

    const settings = await store.list();

    expect(settings).toEqual(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
    expect(settings).not.toBe(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
    expect(settings.agents[0]).not.toBe(DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]);
    expect(settings.agents[0]?.readAccess).not.toBe(
      DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]?.readAccess
    );
  });

  it("restores each agent's required workspace stages before saving", async () => {
    const root = await makeTemporaryRoot();
    const store = new WorkspaceAgentConfigStore(root);
    const required: Record<ShortWorkspaceAgentId, readonly ShortWorkspaceStageId[]> = {
      character_design: ["character_design"],
      plot_design: ["plot_design", "intro_design", "plot_refine"],
      outline: ["outline"],
      expert_draft_coordinator: ["draft"],
      expert_section_writer: ["draft"]
    };

    const saved = await store.save(customizedInput("required"));

    for (const [agentId, requiredStages] of Object.entries(required) as Array<
      [ShortWorkspaceAgentId, readonly ShortWorkspaceStageId[]]
    >) {
      expect(byAgentId(saved.agents, agentId).readAccess.workspace).toEqual(
        requiredStages
      );
    }

    const disk = JSON.parse(
      await readFile(join(root, "config", "workspace-agents.json"), "utf8")
    ) as {
      agents: ShortWorkspaceAgentSettingsInput["agents"];
    };
    for (const [agentId, requiredStages] of Object.entries(required) as Array<
      [ShortWorkspaceAgentId, readonly ShortWorkspaceStageId[]]
    >) {
      expect(byAgentId(disk.agents, agentId).readAccess.workspace).toEqual(
        requiredStages
      );
    }
  });

  it("resets only the requested agent and preserves the other overrides", async () => {
    const store = new WorkspaceAgentConfigStore(await makeTemporaryRoot());
    await store.save(customizedInput("custom"));

    const reset = await store.reset("plot_design");

    expect(byAgentId(reset.agents, "plot_design")).toEqual(
      byAgentId(DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES, "plot_design")
    );
    expect(byAgentId(reset.agents, "character_design").systemPrompt).toBe(
      "custom:character_design"
    );
    expect(byAgentId(reset.agents, "outline").systemPrompt).toBe("custom:outline");

    const reloaded = await store.list();
    expect(reloaded).toEqual(reset);
  });

  it("resets every prompt and read range to the builtin settings", async () => {
    const store = new WorkspaceAgentConfigStore(await makeTemporaryRoot());
    await store.save(customizedInput("discarded"));

    const reset = await store.reset();

    expect(reset).toEqual(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
    expect(await store.list()).toEqual(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
  });

  it("continues the write queue after a failed persistence operation", async () => {
    const root = await makeTemporaryRoot();
    const blockingConfigPath = join(root, "config");
    await writeFile(blockingConfigPath, "not-a-directory", "utf8");
    const store = new WorkspaceAgentConfigStore(root);

    await expect(store.save(customizedInput("failed"))).rejects.toMatchObject({
      code: expect.stringMatching(/EEXIST|ENOTDIR/)
    });

    await unlink(blockingConfigPath);
    await mkdir(blockingConfigPath);
    const recovered = await store.save(customizedInput("recovered"));

    expect(byAgentId(recovered.agents, "outline").systemPrompt).toBe(
      "recovered:outline"
    );
    expect(await store.list()).toEqual(recovered);
  });
});
