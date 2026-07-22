import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  createShortWorkspaceContentRevision,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentSettingsInput,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import {
  RETIRED_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT_V1,
  WorkspaceAgentConfigStore
} from "./workspace-agent-config-store";

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

  it("upgrades only the retired builtin coordinator prompt to the file-based default", async () => {
    const root = await makeTemporaryRoot();
    const configDirectory = join(root, "config");
    await mkdir(configDirectory);
    const input = defaultInput();
    expect(
      createHash("sha256")
        .update(RETIRED_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT_V1, "utf8")
        .digest("hex")
    ).toBe("9164c162be37db9e82eeb7c3d3caf2d3b242f1f426021c3ca619391b5aaa9d49");
    byAgentId(input.agents, "expert_draft_coordinator").systemPrompt =
      RETIRED_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT_V1;
    await writeFile(
      join(configDirectory, "workspace-agents.json"),
      JSON.stringify({ version: 1, ...input }),
      "utf8"
    );

    const settings = await new WorkspaceAgentConfigStore(root).list();

    expect(
      byAgentId(settings.agents, "expert_draft_coordinator").systemPrompt
    ).toBe(
      byAgentId(
        DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
        "expert_draft_coordinator"
      ).systemPrompt
    );
  });

  it("preserves a customized coordinator prompt even when it is based on the retired default", async () => {
    const root = await makeTemporaryRoot();
    const configDirectory = join(root, "config");
    await mkdir(configDirectory);
    const input = defaultInput();
    const customized = `${RETIRED_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT_V1}\n自定义要求：保留我的审阅口径。`;
    byAgentId(input.agents, "expert_draft_coordinator").systemPrompt = customized;
    await writeFile(
      join(configDirectory, "workspace-agents.json"),
      JSON.stringify({ version: 1, ...input }),
      "utf8"
    );

    const settings = await new WorkspaceAgentConfigStore(root).list();

    expect(
      byAgentId(settings.agents, "expert_draft_coordinator").systemPrompt
    ).toBe(customized);
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

  it("resolves a validated draft section target to the section writer", async () => {
    const store = new WorkspaceAgentConfigStore(await makeTemporaryRoot());
    const emptyRevision = createShortWorkspaceContentRevision("");
    const workspace = {
      id: "short-1",
      title: "雨夜来信",
      categories: ["悬疑"],
      activeStageId: "draft" as const,
      activeAgentId: "expert_section_writer" as const,
      activeSectionId: "section-1",
      expertDraft: {
        id: "draft" as const,
        title: "正文",
        revision: emptyRevision,
        sections: [
          {
            id: "section-1",
            title: "第一节",
            wordCountRequirement: "1000 字",
            body: {
              documentId: "draft:section-1:body",
              title: "第一节",
              content: "",
              revision: emptyRevision
            },
            characterState: {
              documentId: "draft:section-1:character-state",
              title: "第一节 · 人物状态",
              content: "",
              revision: emptyRevision
            }
          }
        ]
      },
      stages: SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => ({
        stageId,
        title: stageId,
        content: "",
        revision: emptyRevision
      }))
    };

    await expect(store.resolveForWorkspace(workspace)).resolves.toMatchObject({
      id: "expert_section_writer"
    });
    await expect(
      store.resolveForWorkspace({ ...workspace, activeSectionId: "missing" })
    ).rejects.toThrow(/Unknown expert draft section/u);
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
