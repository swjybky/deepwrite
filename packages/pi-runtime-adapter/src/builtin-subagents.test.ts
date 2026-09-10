import { describe, expect, it, vi } from "vitest";
import {
  Agent,
  type AgentMessage,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type Api,
  type Model,
  type Context
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";
import {
  buildSpawnSubagentTool,
  isSubagentToolProgressDetails
} from "./subagent-runtime";
import { snapshotSubagentHistory } from "./subagent-history";
import {
  createLibraryManagementRuntime,
  libraryManagementParentPrompt
} from "./library-management-runtime";
import { buildAskUserQuestionTool } from "./ask-user-question-tool";
import { toSubagentRuntimeEvents } from "./subagent-events";
import type { AgentRunInput } from "./runtime-types";
import { reconcileLibraryToolState } from "./library-management-state";

const revision = createShortWorkspaceContentRevision;
const workspace: LibraryAgentWorkspaceSnapshot = {
  domain: "skill",
  libraryId: "skills",
  title: "测试技能库",
  kind: "general",
  libraryType: "short",
  readOnly: false,
  projectRevision: 1,
  overview: "用途",
  overviewDocumentId: "overview",
  overviewRevision: revision("用途"),
  entries: [
    {
      id: "skill-1",
      documentId: "doc-1",
      title: "技能一",
      stageId: "outline",
      content: "旧内容",
      revision: revision("旧内容"),
      readOnly: false
    }
  ]
};
function input(): AgentRunInput {
  return {
    sessionId: "session",
    runId: "run",
    prompt: "优化这个技能",
    libraryManagement: {
      scope: { bookId: "book", bookType: "short" },
      managers: [
        {
          domain: "skill",
          description: "优化技能",
          profile: DEFAULT_LIBRARY_AGENT_PROFILES.find(
            (profile) => profile.domain === "skill"
          )!
        }
      ],
      libraries: [
        {
          libraryId: "skills",
          title: "测试技能库",
          domain: "skill",
          readOnly: false
        }
      ]
    },
    libraryManagementCommandExecutor: vi.fn(async () => ({
      status: "accepted" as const,
      requestId: "query",
      payload: { libraries: [], workspace }
    }))
  };
}
function provider() {
  const faux = fauxProvider({
    api: "management-test",
    provider: "management-test",
    tokensPerSecond: 0,
    models: [{ id: "test-model", name: "Test", reasoning: true }]
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    faux,
    model: faux.getModel("test-model") as Model<Api>,
    stream: models.streamSimple.bind(models) as StreamFn
  };
}

describe("built-in management subagents", () => {
  it("copies complete history and removes pending calls and orphan results", () => {
    const complete = fauxAssistantMessage(
      fauxToolCall("read", { id: "file" }, { id: "read-1" })
    );
    const pending = fauxAssistantMessage([
      fauxToolCall("spawn_subagent", {}, { id: "spawn-1" })
    ]);
    const history: AgentMessage[] = [
      { role: "user", content: "保存上面的素材", timestamp: 1 },
      complete,
      {
        role: "toolResult",
        toolCallId: "read-1",
        toolName: "read",
        content: [{ type: "text", text: "已读正文" }],
        isError: false,
        timestamp: 2
      },
      pending,
      {
        role: "toolResult",
        toolCallId: "orphan",
        toolName: "read",
        content: [],
        isError: false,
        timestamp: 3
      }
    ];
    const copy = snapshotSubagentHistory(history);
    expect(copy).toHaveLength(3);
    expect(JSON.stringify(copy)).toContain("已读正文");
    expect(JSON.stringify(copy)).not.toContain("spawn-1");
    (copy[0] as { content: string }).content = "改变";
    expect(history[0]).toMatchObject({ content: "保存上面的素材" });
  });

  it("uses manager tools, inherits parent history, and forwards library proposals", async () => {
    const run = input();
    const management = createLibraryManagementRuntime(run);
    const prepared = await management.prepareChild(
      management.definitions[0]!,
      "skills"
    );
    const names = prepared.tools.map((tool) => tool.name);
    expect(names).toContain("load_skill");
    expect(names).toContain("edit_skill_entry");
    expect(names).not.toContain("write");
    expect(names).not.toContain("ask_user_question");
    const runtime = provider();
    const seen: Context[] = [];
    runtime.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "read_skill_entry",
          { entry_id: "skill-1" },
          { id: "read" }
        ),
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage(
        fauxToolCall(
          "edit_skill_entry",
          { entry_id: "skill-1", mode: "append", body: "新增方法" },
          { id: "edit" }
        ),
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("已提交技能优化提案，等待审阅。")
    ]);
    const parentMessages: AgentMessage[] = [
      { role: "user", content: "请将前面的规则优化成技能", timestamp: 1 }
    ];
    const tool = buildSpawnSubagentTool({
      parentSessionId: run.sessionId,
      parentRuntime: { provider: "test", model: "test", mode: "provider" },
      model: runtime.model,
      thinkingLevel: "off",
      streamFn: (model, ctx, opts) => {
        seen.push(ctx);
        return runtime.stream(model, ctx, opts);
      },
      definitions: management.definitions,
      prepareChild: management.prepareChild,
      getParentMessages: () => parentMessages,
      buildChildTools: () => {
        throw new Error("must not inherit tools");
      }
    })!;
    const events: ReturnType<typeof toSubagentRuntimeEvents> = [];
    await tool.execute(
      "spawn",
      {
        subagent_id: "builtin:skill-manager",
        task: "优化技能",
        library_id: "skills"
      },
      undefined,
      (update) => {
        if (isSubagentToolProgressDetails(update.details))
          events.push(
            ...toSubagentRuntimeEvents(
              update.details.progress,
              run,
              { provider: "test", model: "test", mode: "provider" },
              "message"
            )
          );
      }
    );
    expect(JSON.stringify(seen[0]?.messages)).toContain(
      "请将前面的规则优化成技能"
    );
    expect(seen[0]?.tools?.map((tool) => tool.name)).toContain("load_skill");
    expect(
      events.some(
        (event) =>
          event.type === "subagent.completed" &&
          event.payload.status === "completed"
      )
    ).toBe(true);
    expect(
      events.some((event) => event.type === "library.editor_mutation")
    ).toBe(true);
    // A mutation result is projected with the originating work's binding scope.
    const projected = toSubagentRuntimeEvents(
      {
        type: "child_tool_details",
        parentToolCallId: "spawn",
        subagentId: "builtin:skill-manager",
        subagentRunId: "child",
        name: "技能管理子智能体",
        toolCallId: "child:edit",
        toolName: "edit_skill_entry",
        isError: false,
        result: {
          content: [],
          details: {
            kind: "library-entry-mutation",
            operation: "edit",
            domain: "skill",
            libraryId: "skills",
            entryId: "skill-1",
            documentId: "doc-1",
            stageId: "outline",
            title: "技能一",
            text: "新内容",
            baseRevision: revision("旧内容"),
            summary: "优化"
          }
        }
      },
      run,
      { provider: "test", model: "test", mode: "provider" },
      "message"
    );
    expect(projected[0]).toMatchObject({
      type: "library.editor_mutation",
      payload: {
        managementScope: { bookId: "book", bookType: "short" },
        toolCallId: "child:edit"
      }
    });
    expect(parentMessages).toHaveLength(1);
  });

  it("rejects missing, unbound, and newly read-only targets", async () => {
    const run = input();
    const management = createLibraryManagementRuntime(run);
    const definition = management.definitions[0]!;
    await expect(
      management.prepareChild(definition, undefined)
    ).rejects.toThrow("library_id");
    await expect(
      management.prepareChild(definition, "unbound")
    ).rejects.toThrow("可写范围");
    vi.mocked(run.libraryManagementCommandExecutor!).mockResolvedValue({
      status: "accepted",
      requestId: "query",
      payload: { libraries: [], workspace: { ...workspace, readOnly: true } }
    });
    await expect(management.prepareChild(definition, "skills")).rejects.toThrow(
      "不可写"
    );
    expect(libraryManagementParentPrompt(run)).toContain("历史中已完成");
    expect(libraryManagementParentPrompt(run)).toContain("ask_user_question");
  });

  it("keeps pending edits across delegation with fresh read evidence and rejects external conflicts", () => {
    const state = reconcileLibraryToolState(workspace);
    state.entries[0]!.content = "待审阅内容";
    state.entries[0]!.revision = revision("待审阅内容");
    expect(
      reconcileLibraryToolState(workspace, { workspace, state }).entries[0]
        ?.content
    ).toBe("待审阅内容");
    const saved = {
      ...workspace,
      projectRevision: 2,
      entries: [
        {
          ...workspace.entries[0]!,
          content: "待审阅内容",
          revision: revision("待审阅内容")
        }
      ]
    };
    expect(
      reconcileLibraryToolState(saved, { workspace, state }).entries[0]?.content
    ).toBe("待审阅内容");
    expect(() =>
      reconcileLibraryToolState(
        { ...saved, entries: [{ ...saved.entries[0]!, content: "外部内容" }] },
        { workspace, state }
      )
    ).toThrow("其它操作");
  });

  it("blocks dependent execution until the user answers a creation question", async () => {
    const runtime = provider();
    let answer:
      | ((
          value: Awaited<
            ReturnType<
              NonNullable<Parameters<typeof buildAskUserQuestionTool>[0]>
            >
          >
        ) => void)
      | undefined;
    const ask = buildAskUserQuestionTool(
      vi.fn(
        () =>
          new Promise<
            Awaited<
              ReturnType<
                NonNullable<Parameters<typeof buildAskUserQuestionTool>[0]>
              >
            >
          >((resolve) => {
            answer = resolve;
          })
      )
    );
    const create = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "已创建" }],
      details: {}
    }));
    runtime.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("ask_user_question", {
          questions: [{ id: "library", question: "保存到哪个库？" }]
        }),
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage(fauxToolCall("create", {}), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage("完成")
    ]);
    const agent = new Agent({
      initialState: {
        model: runtime.model,
        tools: [
          ask,
          {
            name: "create",
            label: "创建",
            description: "测试创建",
            parameters: Type.Object({}),
            execute: create
          }
        ]
      },
      streamFn: runtime.stream
    });
    const pending = agent.prompt("创建素材");
    await vi.waitFor(() => expect(answer).toBeDefined());
    expect(create).not.toHaveBeenCalled();
    answer!({
      sessionId: "session",
      runId: "run",
      requestId: "question",
      answers: [{ id: "library", text: "剧情素材库" }]
    });
    await pending;
    expect(create).toHaveBeenCalledOnce();
  });
});
