import { describe, expect, it, vi } from "vitest";
import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";
import { buildRunTools } from "./run-tools";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";
import { scriptAgentProfile, screenplayWorkspace } from "./index.test-support";
import { profile, workspace } from "./long-agent-tools.test-support";
import { isSubagentToolProgressDetails } from "./subagent-runtime";
import { toSubagentRuntimeEvents } from "./subagent-events";
import type { AgentRunInput, AgentRuntimeEvent } from "./runtime-types";

const runtime = {
  provider: "flow-test",
  model: "test",
  mode: "provider" as const
};
const managerWorkspace: LibraryAgentWorkspaceSnapshot = {
  domain: "material",
  libraryId: "materials",
  title: "情节素材库",
  kind: "plot",
  libraryType: "short",
  readOnly: false,
  projectRevision: 1,
  overview: "情节参考",
  overviewDocumentId: "overview",
  overviewRevision: createShortWorkspaceContentRevision("情节参考"),
  entries: []
};
function input(
  kind: "short" | "script" | "long",
  team: boolean
): AgentRunInput {
  return {
    sessionId: "session",
    runId: "run",
    prompt: "将刚才的情节记录为素材",
    mode: "workspace",
    ...(kind === "short"
      ? {
          agentProfile: shortProfile(),
          workspaceContext: { shortWorkspace: shortWorkspace() }
        }
      : kind === "script"
        ? {
            scriptAgentProfile: scriptAgentProfile(),
            workspaceContext: { scriptWorkspace: screenplayWorkspace() }
          }
        : {
            longAgentProfile: profile("long"),
            workspaceContext: {
              longWorkspace: workspace("long", "plot_design")
            }
          }),
    subagentDefinitions: team
      ? [
          {
            id: "writer",
            name: "写作成员",
            description: "处理写作任务",
            systemPrompt: "完成写作任务",
            enabled: true,
            modelMode: "inherit"
          }
        ]
      : [],
    libraryManagement: {
      scope: { bookId: "book", bookType: kind },
      libraries: [
        {
          domain: "material",
          libraryId: "materials",
          title: "情节素材库",
          readOnly: false
        }
      ],
      managers: DEFAULT_LIBRARY_AGENT_PROFILES.map((profile) => ({
        domain: profile.domain,
        description: "管理已确认的资料",
        profile
      }))
    },
    libraryManagementCommandExecutor: vi.fn(async () => ({
      status: "accepted" as const,
      requestId: "query",
      payload: { libraries: [], workspace: managerWorkspace }
    }))
  };
}
function provider() {
  const faux = fauxProvider({
    api: "flow-test",
    provider: "flow-test",
    tokensPerSecond: 0,
    models: [{ id: "test", name: "Test", reasoning: true }]
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    faux,
    model: faux.getModel("test") as Model<Api>,
    streamFn: models.streamSimple.bind(models) as StreamFn
  };
}

describe("creative workspace management delegation", () => {
  it.each(["short", "script", "long"] as const)(
    "registers global managers and main questions in %s normal and team modes",
    (kind) => {
      const { model, streamFn } = provider();
      for (const team of [false, true]) {
        const run = input(kind, team);
        const options = {
          model,
          streamFn,
          thinkingLevel: "off" as const,
          parentRuntime: runtime,
          toolExecutionHooks: {},
          portableToolSchemaProfile: "default" as const,
          getParentMessages: () => [],
          requestUserInput: vi.fn()
        };
        const tools = buildRunTools(run, options);
        expect(
          tools.filter((tool) => tool.name === "ask_user_question")
        ).toHaveLength(1);
        const spawn = tools.find((tool) => tool.name === "spawn_subagent")!;
        expect(spawn.description).toContain("builtin:skill-manager");
        expect(spawn.description).toContain("builtin:material-manager");
        expect(spawn.description.includes("写作成员")).toBe(team);
        run.libraryManagement!.managers = [];
        const disabledSpawn = buildRunTools(run, options).find(
          (tool) => tool.name === "spawn_subagent"
        );
        expect(Boolean(disabledSpawn)).toBe(team);
        expect(disabledSpawn?.description ?? "").not.toContain("builtin:");
      }
    }
  );

  it("asks for a target, delegates, relays manager ambiguity, and proposes after the second answer", async () => {
    const run = input("short", false);
    // Auto-save is allowed to approve proposals, but it never answers questions.
    run.writeApprovalMode = "auto-approve";
    const { faux, model, streamFn } = provider();
    const toolMessage = (name: string, args: Record<string, unknown>) =>
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
    const delegate = () =>
      toolMessage("spawn_subagent", {
        subagent_id: "builtin:material-manager",
        library_id: "materials",
        task: "按用户要求记录情节"
      });
    faux.setResponses([
      toolMessage("ask_user_question", {
        questions: [
          {
            id: "library",
            question: "保存到哪个素材库？",
            options: [
              { id: "plot", label: "情节库" },
              { id: "character", label: "人物库" }
            ]
          }
        ]
      }),
      delegate(),
      fauxAssistantMessage("待澄清：这条情节用于悬疑还是爱情创作？"),
      toolMessage("ask_user_question", {
        questions: [{ id: "purpose", question: "这条情节用于什么创作？" }]
      }),
      delegate(),
      toolMessage("create_material_entry", {
        stage_id: "plot_refine",
        title: "反转线索",
        name: "反转线索",
        description: "悬疑情节参考",
        body: "旧线索在终章解释真相。"
      }),
      fauxAssistantMessage("已提交素材提案，保存状态以界面为准。"),
      fauxAssistantMessage("素材提案已生成。")
    ]);
    const answers: Array<(text: string) => void> = [];
    const requestUserInput = vi.fn(
      (
        request: Parameters<
          NonNullable<Parameters<typeof buildRunTools>[1]["requestUserInput"]>
        >[0]
      ) =>
        new Promise<
          Awaited<
            ReturnType<Parameters<typeof buildRunTools>[1]["requestUserInput"]>
          >
        >((resolve) => {
          answers.push((text) =>
            resolve({
              sessionId: run.sessionId,
              runId: run.runId,
              requestId: request.toolCallId,
              answers: [{ id: request.questions[0]!.id, text }]
            })
          );
        })
    );
    const events: AgentRuntimeEvent[] = [];
    const contexts: string[] = [];
    const tools = buildRunTools(run, {
      model,
      streamFn: (model, context, options) => {
        contexts.push(JSON.stringify(context.messages));
        return streamFn(model, context, options);
      },
      thinkingLevel: "off",
      parentRuntime: runtime,
      toolExecutionHooks: {},
      portableToolSchemaProfile: "default",
      getParentMessages: () => agent.state.messages,
      requestUserInput
    });
    const agent = new Agent({ initialState: { model, tools }, streamFn });
    agent.subscribe((event) => {
      if (
        event.type === "tool_execution_update" &&
        isSubagentToolProgressDetails(event.partialResult.details)
      ) {
        events.push(
          ...toSubagentRuntimeEvents(
            event.partialResult.details.progress,
            run,
            runtime,
            "message"
          )
        );
      }
    });
    const pending = agent.prompt(run.prompt);
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    expect(run.libraryManagementCommandExecutor).not.toHaveBeenCalled();
    answers[0]!("情节素材库");
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    expect(
      events.filter((event) => event.type === "library.editor_mutation")
    ).toHaveLength(0);
    answers[1]!("悬疑创作");
    await pending;
    expect(requestUserInput).toHaveBeenCalledTimes(2);
    expect(run.libraryManagementCommandExecutor).toHaveBeenCalledTimes(2);
    expect(contexts.at(-1)).toContain("悬疑创作");
    const proposals = events.filter(
      (event) => event.type === "library.editor_mutation"
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      payload: {
        operation: "create",
        libraryId: "materials",
        managementScope: { bookId: "book", bookType: "short" }
      }
    });
  });
});
