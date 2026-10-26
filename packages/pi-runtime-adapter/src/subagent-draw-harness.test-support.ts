/** Draw-mode tool harness shared by the fixed and auto-count draw tests. */
import type { AgentToolResult, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessage,
  type Context,
  type TranscriptContext,
  type Model
} from "@earendil-works/pi-ai";
import { vi } from "vitest";
import type {
  AgentUserInputAnswer,
  SubagentDrawSettings
} from "@deepwrite/contracts";
import type { AgentUserInputRequest } from "./runtime-types";
import {
  buildSpawnSubagentTool,
  isSubagentToolProgressDetails,
  type RuntimeSubagentDefinition,
  type SubagentToolDetails,
  type SubagentToolProgress
} from "./subagent-runtime";
import { inspectTranscript } from "./transcript.test-support";

export const EVALUATOR_MARK = "【抽卡评估运行边界】";

export function drawMember(
  draw: Partial<SubagentDrawSettings> = {},
  agentMode: RuntimeSubagentDefinition["agentMode"] = "pure-bare"
): RuntimeSubagentDefinition {
  return {
    id: "titler",
    name: "标题助手",
    description: "起章节标题。",
    systemPrompt: "只输出标题。",
    enabled: true,
    modelMode: "inherit",
    agentMode,
    draw: {
      enabled: true,
      count: 3,
      selection: "manual",
      evaluator: { modelMode: "inherit" },
      ...draw
    }
  };
}

export const follower: RuntimeSubagentDefinition = {
  id: "follower",
  name: "后续成员",
  description: "接着做。",
  systemPrompt: "接着做。",
  enabled: true,
  modelMode: "inherit"
};

type Responder = (context: Context) => AssistantMessage;

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Drafts answer `草稿N` in arrival order; the evaluator's turns go to
 * `evaluator`. `gate` holds every request until that many have arrived, which
 * only finishes when the draws really run at the same time.
 */
export function harness(options: {
  definitions: RuntimeSubagentDefinition[];
  gate?: number;
  draft?: (arrival: number) => AssistantMessage;
  evaluator?: Responder;
  answer?: (request: AgentUserInputRequest) => AgentUserInputAnswer;
}) {
  const faux = fauxProvider({
    api: `subagent-draw-${Math.random()}`,
    provider: `subagent-draw-${Math.random()}`,
    models: [{ id: "child-model", name: "Child Model", reasoning: true }],
    tokensPerSecond: 0
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const contexts: Context[] = [];
  let drafts = 0;
  const respond = (transcript: TranscriptContext) => {
    const context = inspectTranscript(transcript);
    if (context.systemPrompt?.includes(EVALUATOR_MARK)) {
      return options.evaluator
        ? options.evaluator(context)
        : fauxAssistantMessage("没有评估回应");
    }
    drafts += 1;
    return options.draft?.(drafts) ?? fauxAssistantMessage(`草稿${drafts}`);
  };
  faux.setResponses(Array.from({ length: 40 }, () => respond));
  const model = faux.getModel("child-model") as Model<Api>;
  const source = models.streamSimple.bind(models) as StreamFn;
  const gate = deferred();
  let arrivals = 0;
  const streamFn: StreamFn = async (requestModel, context, streamOptions) => {
    contexts.push(inspectTranscript(context));
    arrivals += 1;
    if (arrivals >= (options.gate ?? 1)) gate.resolve();
    await gate.promise;
    return source(requestModel, context, streamOptions);
  };
  const requests: AgentUserInputRequest[] = [];
  const requestUserInput = vi.fn(async (request: AgentUserInputRequest) => {
    requests.push(request);
    return {
      sessionId: "parent-session",
      runId: "parent-run",
      requestId: `request_${requests.length}`,
      answers: [
        options.answer?.(request) ?? {
          id: "draw",
          selectedOptionIds: ["c2"]
        }
      ]
    };
  });
  let sequence = 0;
  const tool = buildSpawnSubagentTool({
    parentSessionId: "parent-session",
    model,
    thinkingLevel: "medium",
    streamFn,
    definitions: options.definitions,
    buildChildTools: () => [],
    createRunId: () => `subrun_${++sequence}`,
    requestUserInput
  });
  if (!tool) throw new Error("spawn_subagent was not built");
  return { tool, contexts, requests, requestUserInput };
}

export async function run(
  tool: NonNullable<ReturnType<typeof buildSpawnSubagentTool>>,
  tasks: unknown[]
) {
  const updates: AgentToolResult<SubagentToolDetails>[] = [];
  const result = await tool.execute(
    "parent-call",
    { tasks } as never,
    undefined,
    (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
  );
  const progress = updates.flatMap((update) =>
    isSubagentToolProgressDetails(update.details)
      ? [update.details.progress]
      : []
  );
  const text = result.content
    .map((item) => (item.type === "text" ? item.text : ""))
    .join("");
  return { text, progress };
}

export function drawUpdates(progress: SubagentToolProgress[]) {
  return progress.filter(
    (item): item is Extract<SubagentToolProgress, { type: "draw_updated" }> =>
      item.type === "draw_updated"
  );
}
