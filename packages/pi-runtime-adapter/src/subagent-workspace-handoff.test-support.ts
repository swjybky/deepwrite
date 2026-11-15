import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model
} from "@earendil-works/pi-ai";
import { DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES } from "@deepwrite/contracts";
import { buildRunTools } from "./run-tools";
import type { AgentRunInput } from "./runtime-types";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";
import { inspectTranscript } from "./transcript.test-support";

const model: Model<"openai-completions"> = {
  id: "handoff-test-model",
  name: "Handoff Test",
  provider: "handoff-test",
  api: "openai-completions",
  baseUrl: "https://provider.example.test/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 128_000,
  maxTokens: 4_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};

export function writingInput(
  type: "short" | "script",
  stage: "character_design" | "plot_design" | "draft" = "draft"
): AgentRunInput {
  const workspace = shortWorkspace(stage, { characterList: true });
  return {
    sessionId: "handoff-session",
    runId: "handoff-run",
    prompt: "先创建对象，再读取对象。",
    writeApprovalMode: "auto-approve",
    ...(type === "script"
      ? {
          scriptAgentProfile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!,
          workspaceContext: {
            scriptWorkspace: { ...workspace, activeAgentId: "script" }
          }
        }
      : {
          agentProfile: shortProfile(),
          workspaceContext: { shortWorkspace: workspace }
        }),
    subagentDefinitions: ["creator", "reader"].map((id) => ({
      id,
      name: id,
      description: "交接测试",
      systemPrompt: "完成指定任务。",
      enabled: true,
      modelMode: "inherit" as const,
      agentMode: "standard" as const
    }))
  };
}

export function handoffRuntime(
  input: AgentRunInput,
  reply: (context: Context, index: number) => AssistantMessage
) {
  const contexts: Context[] = [];
  const streamFn: StreamFn = (_model, transcript) => {
    const context = inspectTranscript(transcript);
    const message = reply(context, contexts.length);
    contexts.push(context);
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message
    });
    return stream;
  };
  const tools = buildRunTools(input, {
    model,
    streamFn,
    thinkingLevel: "off",
    parentRuntime: {
      provider: model.provider,
      model: model.id,
      mode: "provider"
    },
    // Auto-save runs confirm changes to the shared plot structure first.
    requestUserInput: async (request) => {
      if (request.source !== "plot_structure_change") {
        throw new Error("Unexpected user-input request in handoff test");
      }
      return {
        sessionId: input.sessionId,
        runId: input.runId,
        requestId: "plot-structure",
        answers: [
          { id: request.questions[0]!.id, selectedOptionIds: ["allow_once"] }
        ]
      };
    },
    getParentMessages: () => [],
    portableToolSchemaProfile: "writing-workspace",
    toolExecutionHooks: {},
    retryPolicy: { delaysMs: [] }
  });
  return { tools, contexts };
}

/** Extract ids from the model's own directory, never from a fixture oracle. */
export function directoryId(
  directory: string | undefined,
  title: string
): string {
  const line = directory?.split("\n").find((item) => item.includes(title));
  const suffix = line?.slice(line.indexOf(title) + title.length).trim();
  const match = /^[（(](?:kind=plot_stage[，,]\s*id=)?([^）)]+)[）)]/u.exec(
    suffix ?? ""
  );
  if (!match) throw new Error(`Directory does not contain ${title}`);
  return match[1]!;
}

export function lastToolText(context: Context): string {
  const message = [...context.messages]
    .reverse()
    .find((item) => item.role === "toolResult");
  if (message?.role !== "toolResult") throw new Error("Missing tool result");
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}
