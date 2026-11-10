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
  type Model
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  createShortWorkspaceContentRevision,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";
import { snapshotSubagentHistory } from "./subagent-history";
import {
  createLibraryManagementRuntime,
  libraryManagementParentPrompt
} from "./library-management-runtime";
import { buildAskUserQuestionTool } from "./ask-user-question-tool";
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
          description: "优化技能"
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
      { role: "system", content: "parent-only instructions", timestamp: 0 },
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
    expect(JSON.stringify(copy)).not.toContain("parent-only instructions");
    (copy[0] as { content: string }).content = "改变";
    expect(history[1]).toMatchObject({ content: "保存上面的素材" });
  });

  it("loads bound libraries lazily and emits proposals directly", async () => {
    const run = input();
    const tools = createLibraryManagementRuntime(run).tools;
    expect(tools.some((tool) => tool.name === "load_skill")).toBe(false);
    expect(run.libraryManagementCommandExecutor).not.toHaveBeenCalled();
    const read = tools.find(
      (tool) => tool.name === "manage_skill_read_skill_entry"
    )!;
    const edit = tools.find(
      (tool) => tool.name === "manage_skill_edit_skill_entry"
    )!;
    const call = (params: Record<string, unknown>) =>
      read.execute("read", params);
    expect(JSON.stringify(await call({ entry_id: "skill-1" }))).toContain(
      "library_id"
    );
    expect(
      JSON.stringify(await call({ library_id: "unbound", entry_id: "skill-1" }))
    ).toContain("库不存在");
    await call({ library_id: "skills", entry_id: "skill-1" });
    const result = await edit.execute("edit", {
      library_id: "skills",
      entry_id: "skill-1",
      mode: "replace",
      allow_overwrite_existing: true,
      body: "新内容",
      summary: "优化"
    });
    expect(result.details).toMatchObject({
      kind: "library-entry-mutation",
      libraryId: "skills",
      baseProjectRevision: 1
    });
    expect(run.libraryManagementCommandExecutor).toHaveBeenCalledOnce();
    expect(libraryManagementParentPrompt(run)).not.toContain("spawn_subagent");
  });

  it("allows reading built-in libraries but refuses writes", async () => {
    const run = input();
    run.libraryManagement!.libraries[0]!.readOnly = true;
    const tools = createLibraryManagementRuntime(run).tools;
    const result = await tools
      .find((tool) => tool.name === "manage_skill_create_skill_entry")!
      .execute("create", {
        library_id: "skills",
        stage_id: "outline",
        title: "技能",
        body: "内容",
        summary: "创建"
      });
    expect(JSON.stringify(result)).toContain("只读");
    expect(result.details).not.toHaveProperty("libraryId");
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
