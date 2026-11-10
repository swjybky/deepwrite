import { describe, expect, it, vi } from "vitest";
import { inspectTranscript } from "./transcript.test-support";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  type Api,
  type Model,
  type Context
} from "@earendil-works/pi-ai";
import { buildRunTools } from "./run-tools";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";

function harness() {
  const faux = fauxProvider({
    api: "material-context-test",
    provider: "material-context-test",
    tokensPerSecond: 0,
    models: [{ id: "test-model", name: "Test", reasoning: true }]
  });
  faux.setResponses([fauxAssistantMessage("完成")]);
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
const definition = {
  id: "writer",
  name: "写手",
  description: "写作",
  systemPrompt: "完成委派",
  enabled: true,
  agentMode: "standard" as const,
  modelMode: "inherit" as const
};

describe("subagent material context", () => {
  it("passes the cross-stage material directory through the actual team tool wiring", async () => {
    const runtime = harness();
    const tools = buildRunTools(
      {
        sessionId: "session",
        runId: "run",
        prompt: "父对话私有内容",
        agentProfile: shortProfile(),
        subagentDefinitions: [definition],
        workspaceContext: {
          shortWorkspace: shortWorkspace("character_design"),
          materialReadNotice: "测试读取提示",
          attachedMaterials: [
            {
              id: "character-reference",
              title: "人物参考",
              kind: "character",
              source: "attached-material",
              content: "参考摘要\n\n" + "不应全文注入".repeat(100)
            },
            {
              id: "plot-reference",
              title: "跨阶段剧情参考",
              kind: "plot",
              source: "attached-material",
              content: "剧情"
            }
          ]
        }
      },
      {
        ...runtime,
        parentRuntime: {
          provider: "test",
          model: "test-model",
          mode: "provider"
        },
        thinkingLevel: "off",
        toolExecutionHooks: {},
        requestUserInput: vi.fn(),
        getParentMessages: () => [
          { role: "user", content: "父对话私有内容", timestamp: 1 }
        ],
        portableToolSchemaProfile: "writing-workspace"
      }
    );
    await tools
      .find((tool) => tool.name === "spawn_subagent")!
      .execute("call", { subagent_id: "writer", task: "检查人物" } as never);
    const context = runtime.contexts[0]!;
    const text = JSON.stringify(context.messages);
    expect(text).toContain("人物参考");
    expect(text).toContain("character-reference");
    expect(text).toContain("测试读取提示");
    expect(text).toContain("mode=read");
    expect(text).toContain("检查人物");
    expect(text).toContain("跨阶段剧情参考");
    expect(text).not.toContain("父对话私有内容");
    expect(text).not.toContain("不应全文注入".repeat(100));
    expect(context.tools?.map((tool) => tool.name)).toContain(
      "query_linked_material_entries"
    );
    expect(context.tools?.map((tool) => tool.name)).not.toContain("load_skill");
  });
});
