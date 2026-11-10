import { describe, expect, it, vi } from "vitest";
import { inspectTranscript } from "./transcript.test-support";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type Context,
  type Model
} from "@earendil-works/pi-ai";
import type { SubagentAgentMode } from "@deepwrite/contracts";
import { buildRunTools } from "./run-tools";
import type { AgentRunInput } from "./runtime-types";
import {
  workspace as longWorkspace,
  profile as longProfile
} from "./long-agent-tools.test-support";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";
import {
  applySubagentAgentMode,
  subagentContextPolicyForMode,
  subagentModeLabel
} from "./subagent-mode";
import {
  buildSpawnSubagentTool,
  type RuntimeSubagentDefinition
} from "./subagent-runtime";
import type { ContextPolicy } from "./kernel/context";

const MATERIAL_TITLE = "跨阶段剧情参考";
const MODES: SubagentAgentMode[] = ["standard", "pure-read", "pure-bare"];

function member(
  agentMode: SubagentAgentMode,
  overrides: Partial<RuntimeSubagentDefinition> = {}
): RuntimeSubagentDefinition & { agentMode: SubagentAgentMode } {
  return {
    id: `member_${agentMode.replace("-", "_")}`,
    name: `成员-${agentMode}`,
    description: "测试成员",
    systemPrompt: "完成委派。",
    enabled: true,
    agentMode,
    modelMode: "inherit",
    ...overrides
  };
}

function harness(responses = 1) {
  const faux = fauxProvider({
    api: `subagent-mode-${Math.random()}`,
    provider: `subagent-mode-${Math.random()}`,
    tokensPerSecond: 0,
    models: [{ id: "test-model", name: "Test", reasoning: true }]
  });
  faux.setResponses(
    Array.from({ length: responses }, (_, index) =>
      fauxAssistantMessage(`第 ${index + 1} 个完成`)
    )
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const contexts: Context[] = [];
  const streamFn: StreamFn = (model, context, options) => {
    contexts.push(inspectTranscript(context));
    return models.streamSimple(model, context, options);
  };
  return {
    contexts,
    streamFn,
    model: faux.getModel("test-model") as Model<Api>
  };
}

function runToolOptions(runtime: ReturnType<typeof harness>) {
  return {
    ...runtime,
    parentRuntime: {
      provider: "test",
      model: "test-model",
      mode: "provider" as const
    },
    thinkingLevel: "off" as const,
    toolExecutionHooks: {},
    requestUserInput: vi.fn(),
    getParentMessages: () => [],
    portableToolSchemaProfile: "writing-workspace" as const
  };
}

function shortInput(): AgentRunInput {
  return {
    sessionId: "session",
    runId: "run",
    prompt: "父对话",
    agentProfile: shortProfile(),
    subagentDefinitions: MODES.map((mode) => member(mode)),
    workspaceContext: {
      shortWorkspace: shortWorkspace("character_design"),
      attachedMaterials: [
        {
          id: "plot-reference",
          title: MATERIAL_TITLE,
          kind: "plot",
          source: "attached-material",
          content: "剧情"
        }
      ]
    }
  };
}

async function runMember(
  input: AgentRunInput,
  mode: SubagentAgentMode
): Promise<Context> {
  const runtime = harness();
  const spawn = buildRunTools(input, runToolOptions(runtime)).find(
    (tool) => tool.name === "spawn_subagent"
  )!;
  await spawn.execute("call", {
    tasks: [{ subagent_id: member(mode).id, task: "处理这一段" }]
  } as never);
  return runtime.contexts[0]!;
}

function toolNames(context: Context): string[] {
  return (context.tools ?? []).map((tool) => tool.name);
}

describe("subagent agent modes in a short workspace", () => {
  it("keeps the full working surface in standard mode", async () => {
    const context = await runMember(shortInput(), "standard");
    expect(toolNames(context)).toEqual(
      expect.arrayContaining(["read", "create", "edit", "delete"])
    );
    expect(JSON.stringify(context.messages)).toContain(MATERIAL_TITLE);
    expect(context.systemPrompt).toContain("【写入审批方式：用户审批】");
  });

  it("gives pure-read only reading tools and read-only rules", async () => {
    const context = await runMember(shortInput(), "pure-read");
    expect(toolNames(context).sort()).toEqual([
      "query_linked_material_entries",
      "read"
    ]);
    expect(JSON.stringify(context.messages)).toContain(MATERIAL_TITLE);
    expect(context.systemPrompt).toContain("【当前剧情结构配置");
    expect(context.systemPrompt).toContain("【当前作品位置】");
    expect(context.systemPrompt).toContain("纯净·只读模式");
    expect(context.systemPrompt).not.toContain("文本变更提案");
    expect(context.systemPrompt).not.toContain("跨阶段的新建");
  });

  it("gives pure-bare no tools, no materials and no work context", async () => {
    const context = await runMember(shortInput(), "pure-bare");
    expect(toolNames(context)).toEqual([]);
    expect(JSON.stringify(context.messages)).not.toContain(MATERIAL_TITLE);
    expect(JSON.stringify(context.messages)).toContain("处理这一段");
    expect(context.systemPrompt).toContain("纯净·无工具模式");
    expect(context.systemPrompt).toContain("本轮没有可用工具");
    expect(context.systemPrompt).not.toContain("【当前剧情结构配置");
    expect(context.systemPrompt).not.toContain("文本变更提案");
  });

  it("lists the mode of each member for the parent agent", () => {
    const spawn = buildRunTools(shortInput(), runToolOptions(harness())).find(
      (tool) => tool.name === "spawn_subagent"
    )!;
    expect(spawn.description).toContain("［纯净·只读");
    expect(spawn.description).toContain("［纯净·无工具");
    expect(spawn.description).toMatch(/成员-standard \(member_standard\)：/);
  });
});

describe("subagent agent modes in a long workspace", () => {
  it("limits a pure-read child to reading tools with read-only rules", async () => {
    const input: AgentRunInput = {
      sessionId: "session",
      runId: "run",
      prompt: "父对话",
      longAgentProfile: longProfile("long"),
      subagentDefinitions: [member("pure-read")],
      workspaceContext: { longWorkspace: longWorkspace("long", "plot_design") }
    };
    const context = await runMember(input, "pure-read");
    const names = toolNames(context);
    expect(names).toContain("read");
    expect(
      names.every((name) =>
        ["read", "list", "query_linked_material_entries"].includes(name)
      )
    ).toBe(true);
    expect(context.systemPrompt).toContain("单层只读子任务");
  });
});

describe("subagent mode helpers", () => {
  it("filters tools by mode with an allow list", () => {
    const names = [
      "read",
      "list",
      "query_linked_material_entries",
      "create",
      "edit",
      "delete",
      "propose_continuity_commit",
      "future_tool"
    ];
    const tools = names.map((name) => ({ name }) as AgentTool);
    expect(applySubagentAgentMode(tools, "standard")).toHaveLength(8);
    expect(
      applySubagentAgentMode(tools, "pure-read").map((tool) => tool.name)
    ).toEqual(["read", "list", "query_linked_material_entries"]);
    expect(applySubagentAgentMode(tools, "pure-bare")).toEqual([]);
  });

  it("drops rehydration for a bare child only", () => {
    const policy = {
      settings: {},
      task: "long",
      toolCompactors: {},
      rehydrate: () => "正文结尾"
    } as unknown as ContextPolicy;
    expect(subagentContextPolicyForMode(policy, "standard")).toBe(policy);
    expect(subagentContextPolicyForMode(policy, "pure-read")).toBe(policy);
    const bare = subagentContextPolicyForMode(policy, "pure-bare");
    expect(bare?.rehydrate).toBeUndefined();
    expect(bare?.task).toBe("long");
    expect(
      subagentContextPolicyForMode(undefined, "pure-bare")
    ).toBeUndefined();
  });

  it("labels only the pure modes", () => {
    expect(subagentModeLabel("standard")).toBeUndefined();
    expect(subagentModeLabel("pure-read")).toContain("只读");
    expect(subagentModeLabel("pure-bare")).toContain("无工具");
  });
});

describe("handoffs reach a bare child", () => {
  it("passes the predecessor summary to a no-tool member", async () => {
    const runtime = harness(2);
    const spawn = buildSpawnSubagentTool({
      ...runtime,
      parentSessionId: "parent",
      thinkingLevel: "off",
      definitions: [member("standard"), member("pure-bare")],
      buildChildTools: () => [],
      materialContext: "不应出现的素材目录"
    })!;
    await spawn.execute("call", {
      tasks: [
        { key: "draft", subagent_id: member("standard").id, task: "先写" },
        {
          key: "polish",
          subagent_id: member("pure-bare").id,
          task: "再润色",
          depends_on: ["draft"]
        }
      ]
    } as never);
    const bare = JSON.stringify(runtime.contexts[1]);
    expect(bare).toContain("【前置任务交接】");
    expect(bare).toContain("第 1 个完成");
    expect(bare).not.toContain("不应出现的素材目录");
  });
});
