import { describe, expect, it, vi } from "vitest";
import type {
  AgentProviderRuntimeConfig,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { resolveAgentTeamRuntime } from "./agent-team-run-mode";
import { ModelNotFoundError } from "./model-config-errors";

const inheritedMember: ShortAgentSubagentDefinition = {
  id: "researcher",
  name: "资料员",
  description: "查找资料",
  systemPrompt: "只整理与任务有关的资料。",
  enabled: true,
  agentMode: "standard",
  modelMode: "inherit"
};

const runtimeConfig: AgentProviderRuntimeConfig = {
  id: "reviewer-model",
  label: "Reviewer",
  provider: "custom",
  modelId: "reviewer-model",
  api: "openai-responses",
  baseUrl: "https://api.example.test/v1",
  reasoning: true,
  defaultThinkingLevel: "medium",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.2, 0.7, 1.2],
  apiKey: "invalid-test-key"
};

describe("agent team run mode", () => {
  it("does not resolve team configuration in normal mode", async () => {
    const resolveDefinitions = vi.fn(async () => [inheritedMember]);
    const resolveModel = vi.fn(async () => runtimeConfig);

    await expect(
      resolveAgentTeamRuntime(
        "normal",
        { workspaceType: "short", parentAgentId: "short" },
        { resolveDefinitions, resolveModel }
      )
    ).resolves.toEqual({ subagentRuntimeConfigs: {} });
    expect(resolveDefinitions).not.toHaveBeenCalled();
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it("resolves enabled members and custom model runtimes in team mode", async () => {
    const customMember: ShortAgentSubagentDefinition = {
      ...inheritedMember,
      id: "reviewer",
      name: "审阅员",
      modelMode: "custom",
      modelId: runtimeConfig.id,
      thinkingLevel: "high"
    };
    const resolveDefinitions = vi.fn(async () => [
      inheritedMember,
      customMember
    ]);
    const resolveModel = vi.fn(async () => runtimeConfig);

    await expect(
      resolveAgentTeamRuntime(
        "team",
        { workspaceType: "short", parentAgentId: "short" },
        { resolveDefinitions, resolveModel }
      )
    ).resolves.toEqual({
      subagentDefinitions: [inheritedMember, customMember],
      subagentRuntimeConfigs: { [runtimeConfig.id]: runtimeConfig }
    });
    expect(resolveDefinitions).toHaveBeenCalledWith(
      "short",
      "short",
      undefined
    );
    expect(resolveModel).toHaveBeenCalledWith(runtimeConfig.id);
  });

  it("resolves members and parallelism for the book being written", async () => {
    const resolveDefinitions = vi.fn(async () => [inheritedMember]);
    const resolveParallelSubagents = vi.fn(async () => false);

    await resolveAgentTeamRuntime(
      "team",
      { workspaceType: "long", parentAgentId: "long", bookId: "book-1" },
      {
        resolveDefinitions,
        resolveModel: async () => undefined,
        resolveParallelSubagents
      }
    );

    expect(resolveDefinitions).toHaveBeenCalledWith("long", "long", "book-1");
    expect(resolveParallelSubagents).toHaveBeenCalledWith("long", "book-1");
  });

  it("passes the enabled team's parallel switch only in team mode", async () => {
    const resolveParallelSubagents = vi.fn(async () => true);
    await expect(
      resolveAgentTeamRuntime(
        "team",
        { workspaceType: "script", parentAgentId: "script" },
        {
          resolveDefinitions: async () => [inheritedMember],
          resolveModel: async () => undefined,
          resolveParallelSubagents
        }
      )
    ).resolves.toEqual({
      subagentDefinitions: [inheritedMember],
      subagentRuntimeConfigs: {},
      parallelSubagents: true
    });
    expect(resolveParallelSubagents).toHaveBeenCalledWith("script", undefined);

    await expect(
      resolveAgentTeamRuntime(
        "team",
        { workspaceType: "short", parentAgentId: "short" },
        {
          resolveDefinitions: async () => [inheritedMember],
          resolveModel: async () => undefined,
          resolveParallelSubagents: async () => false
        }
      )
    ).resolves.toEqual({
      subagentDefinitions: [inheritedMember],
      subagentRuntimeConfigs: {}
    });

    resolveParallelSubagents.mockClear();
    await resolveAgentTeamRuntime(
      "normal",
      { workspaceType: "short", parentAgentId: "short" },
      {
        resolveDefinitions: async () => [inheritedMember],
        resolveModel: async () => undefined,
        resolveParallelSubagents
      }
    );
    expect(resolveParallelSubagents).not.toHaveBeenCalled();
  });

  it("rejects team mode when the current agent has no enabled members", async () => {
    await expect(
      resolveAgentTeamRuntime(
        "team",
        { workspaceType: "long", parentAgentId: "long" },
        {
          resolveDefinitions: async () => [],
          resolveModel: async () => undefined
        }
      )
    ).rejects.toThrow("没有已启用且含可用成员的团队");
  });

  it.each(["missing", "rejected"])(
    "points to team settings when a member model is %s",
    async (result) => {
      await expect(
        resolveAgentTeamRuntime(
          "team",
          { workspaceType: "long", parentAgentId: "long" },
          {
            resolveDefinitions: async () => [
              {
                ...inheritedMember,
                modelMode: "custom",
                modelId: "deleted-model"
              }
            ],
            resolveModel: async () => {
              if (result === "rejected") throw new ModelNotFoundError();
              return undefined;
            }
          }
        )
      ).rejects.toThrow("智能体团队成员配置模型不存在，请检查团队配置。");
    }
  );

  it("preserves model resolution errors unrelated to a missing model", async () => {
    const error = new Error(
      "模型 API Key 解密失败，请在模型配置中重新填写并保存。"
    );
    await expect(
      resolveAgentTeamRuntime(
        "team",
        { workspaceType: "long", parentAgentId: "long" },
        {
          resolveDefinitions: async () => [
            { ...inheritedMember, modelMode: "custom", modelId: "model" }
          ],
          resolveModel: async () => {
            throw error;
          }
        }
      )
    ).rejects.toBe(error);
  });
});
