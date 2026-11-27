import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_LONG_AGENT_PROFILES,
  LongGetWorkspaceIndexCommandEnvelopeSchema,
  SystemEventEnvelopeSchema,
  createEnvelope,
  createDefaultCreativePlotStages,
  createExpertDraftDirectoryRevision,
  createShortWorkspaceContentRevision,
  longChapterBodyFileId,
  longChapterFilePath,
  type CommandResult,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type {
  AgentRunInput,
  AgentRuntimeEvent,
  ExtrasAgentRunInput
} from "@deepwrite/pi-runtime-adapter";
import type {
  UtilityCommandHandlerContext,
  UtilityRuntimeOptions
} from "./runtime";

type AgentCommandHandler = NonNullable<UtilityRuntimeOptions["commandHandler"]>;

const captured = vi.hoisted(() => ({
  commandHandler: undefined as AgentCommandHandler | undefined,
  startInputs: [] as AgentRunInput[],
  extrasInputs: [] as ExtrasAgentRunInput[],
  runtimeEvents: [] as AgentRuntimeEvent[],
  testConnectionImpl: undefined as
    | ((
        config: unknown,
        options?: { signal?: AbortSignal; timeoutMs?: number }
      ) => Promise<unknown>)
    | undefined
}));

vi.mock("./runtime", () => ({
  bootUtility: vi.fn(
    (
      _worker: string,
      options: { commandHandler?: AgentCommandHandler }
    ): void => {
      captured.commandHandler = options.commandHandler;
    }
  )
}));

vi.mock("@deepwrite/pi-runtime-adapter", () => ({
  ModelConnectionTestCancelledError: class ModelConnectionTestCancelledError extends Error {
    constructor(message = "模型连接测试已取消。") {
      super(message);
      this.name = "ModelConnectionTestCancelledError";
    }
  },
  ModelConnectionTestTimeoutError: class ModelConnectionTestTimeoutError extends Error {
    constructor(message = "模型连接超时，请检查网络或稍后重试。") {
      super(message);
      this.name = "ModelConnectionTestTimeoutError";
    }
  },
  PiAgentRuntimeAdapter: class {
    describe(): {
      provider: string;
      model: string;
      mode: "local-faux";
    } {
      return {
        provider: "deepwrite",
        model: "deepwrite-writing-faux",
        mode: "local-faux"
      };
    }

    async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
      captured.startInputs.push(input);
      for (const event of captured.runtimeEvents.splice(0)) {
        yield event;
      }
    }

    async *startExtras(
      input: ExtrasAgentRunInput
    ): AsyncIterable<AgentRuntimeEvent> {
      captured.extrasInputs.push(input);
      for (const event of captured.runtimeEvents.splice(0)) {
        yield event;
      }
    }

    async testConnection(
      config: unknown,
      options?: { signal?: AbortSignal; timeoutMs?: number }
    ): Promise<unknown> {
      if (captured.testConnectionImpl) {
        return await captured.testConnectionImpl(config, options);
      }
      throw new Error("Not used by this test.");
    }

    resolveModelCapacity(): never {
      throw new Error("Not used by this test.");
    }

    resolveUserInput(payload: {
      sessionId: string;
      runId: string;
      requestId: string;
    }) {
      return {
        ...payload,
        resolvedAt: "2026-08-22T00:00:00.000Z"
      };
    }
  }
}));

describe("Agent Utility prompt forwarding", () => {
  beforeEach(() => {
    captured.startInputs.length = 0;
    captured.extrasInputs.length = 0;
    captured.runtimeEvents.length = 0;
    captured.testConnectionImpl = undefined;
  });

  it("forwards a chat turn and gives only long project chats the Core bridge", async () => {
    await import("./agent-entry");
    const history = [
      {
        role: "user" as const,
        content: "先聊聊出版趋势",
        createdAt: "2026-08-17T07:58:00.000Z"
      },
      {
        role: "assistant" as const,
        content: "可以先比较纸书与电子书市场。",
        createdAt: "2026-08-17T07:59:00.000Z"
      }
    ];
    const project = { projectType: "long" as const, projectId: "longbook_a" };
    const webSearch = {
      providerId: "deepseek" as const,
      baseUrl: "https://search.example.test",
      apiKey: "invalid-test-search-key",
      maxResults: 8,
      perRunCallLimit: 20
    };
    const chatRun = (sessionId: string, task: unknown, search = false) =>
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "agent.extras_run",
          {
            sessionId,
            ...(search ? { webSearch } : {}),
            task,
            conversation: {
              message: "查询今天的行业动态",
              history,
              historyMode: "replace"
            }
          },
          {
            id: `command-${sessionId}`,
            context: { correlationId: `correlation-${sessionId}`, sessionId }
          }
        )
      );
    const utilityContext: UtilityCommandHandlerContext = {
      worker: "agent",
      requestId: "command-chat",
      requestInternalCommand: vi.fn()
    };
    const profile = { id: "default", name: "默认", systemPrompt: "只读顾问。" };

    await expect(
      captured.commandHandler!(
        chatRun(
          "session-chat-long",
          {
            agentId: "chat-project",
            profile,
            input: {
              project,
              runtime: { projectBook: { id: "longbook_a", bookType: "long" } }
            }
          },
          true
        ),
        vi.fn(),
        utilityContext
      )
    ).resolves.toMatchObject({ status: "accepted" });
    await expect(
      captured.commandHandler!(
        chatRun("session-chat-roleplay", {
          agentId: "chat-roleplay",
          profile: { id: "role", name: "守望者", systemPrompt: "你是守望者。" },
          input: {}
        }),
        vi.fn(),
        utilityContext
      )
    ).resolves.toMatchObject({ status: "accepted" });
    await vi.waitFor(() => expect(captured.extrasInputs).toHaveLength(2));

    const [longChat, roleplay] = captured.extrasInputs;
    expect(longChat?.spec).toMatchObject({
      task: { agentId: "chat-project" },
      webSearch,
      conversation: { history, historyMode: "replace" }
    });
    expect(roleplay?.spec.webSearch).toBeUndefined();
    expect(longChat?.longCommandExecutor).toBeTypeOf("function");
    expect(roleplay?.longCommandExecutor).toBeUndefined();
    expect(captured.startInputs).toHaveLength(0);
  });

  it("forwards the Main-resolved web search settings from the command payload", async () => {
    await import("./agent-entry");
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId: "session-workspace-web-search",
          message: "查一下近期同类题材",
          webSearch: {
            providerId: "deepseek",
            baseUrl: "https://search.example.test",
            apiKey: "invalid-test-search-key",
            maxResults: 8,
            perRunCallLimit: 20
          }
        },
        {
          id: "command-workspace-web-search",
          context: {
            correlationId: "correlation-workspace-web-search",
            sessionId: "session-workspace-web-search"
          }
        }
      )
    );

    await expect(
      captured.commandHandler!(command, vi.fn())
    ).resolves.toMatchObject({
      status: "accepted"
    });
    await vi.waitFor(() => expect(captured.startInputs).toHaveLength(1));

    expect(captured.startInputs[0]).toMatchObject({
      webSearch: {
        providerId: "deepseek",
        apiKey: "invalid-test-search-key",
        perRunCallLimit: 20
      }
    });
    expect(captured.startInputs[0]).not.toHaveProperty("webSearchEnabled");
  });

  it("forwards scriptAgentProfile from the command payload into streamPrompt", async () => {
    await import("./agent-entry");

    const scriptAgentProfile = DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!;
    const emptyRevision = createShortWorkspaceContentRevision("");
    const characterContent = "人物设定快照";
    const plotStages = createDefaultCreativePlotStages();
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId: "session-script-forwarding",
          message: "请检查人物设定",
          scriptAgentProfile,
          workspaceContext: {
            activeResource: {
              id: "script-1:character_design",
              domain: "creation",
              title: "人物设计",
              path: ["测试剧本", "人物设计"],
              source: "live-editor",
              content: characterContent
            },
            scriptWorkspace: {
              id: "script-1",
              title: "测试剧本",
              categories: ["悬疑"],
              activeStageId: "character_design",
              activeAgentId: "script",
              plotStages,
              expertDraft: {
                id: "draft",
                title: "剧集",
                revision: createExpertDraftDirectoryRevision([
                  {
                    id: "episode-1",
                    title: "第一集",
                    wordCountRequirement: ""
                  }
                ]),
                sections: [
                  {
                    id: "episode-1",
                    title: "第一集",
                    wordCountRequirement: "",
                    body: {
                      documentId: "draft-section:episode-1:body",
                      title: "第一集",
                      content: "",
                      revision: emptyRevision
                    },
                    characterState: {
                      documentId: "draft-section:episode-1:character-state",
                      title: "第一集 · 人物状态",
                      content: "",
                      revision: emptyRevision
                    }
                  }
                ]
              },
              stages: [
                {
                  stageId: "character_design",
                  title: "人物设计",
                  content: characterContent,
                  revision:
                    createShortWorkspaceContentRevision(characterContent)
                },
                ...plotStages.map((stage) => ({
                  stageId: stage.id,
                  title: stage.title,
                  content: "",
                  revision: emptyRevision
                }))
              ]
            }
          }
        },
        {
          id: "command-script-forwarding",
          context: {
            correlationId: "correlation-script-forwarding",
            sessionId: "session-script-forwarding",
            resourceId: "script-1:character_design"
          }
        }
      )
    );
    const emittedEvents: SystemEventEnvelope[] = [];

    const handler = captured.commandHandler;
    expect(handler).toBeTypeOf("function");
    const result = (await handler!(command, (event) =>
      emittedEvents.push(event)
    )) as CommandResult;

    expect(result).toMatchObject({
      status: "accepted",
      requestId: "command-script-forwarding",
      payload: {
        sessionId: "session-script-forwarding"
      }
    });
    await vi.waitFor(() => {
      expect(captured.startInputs).toHaveLength(1);
    });
    expect(captured.startInputs[0]).toMatchObject({
      sessionId: "session-script-forwarding",
      prompt: "请检查人物设定",
      scriptAgentProfile,
      workspaceContext: {
        scriptWorkspace: {
          id: "script-1",
          activeAgentId: "script"
        }
      }
    });
    expect(captured.startInputs[0]?.agentProfile).toBeUndefined();
    expect(emittedEvents).toHaveLength(1);
    expect(SystemEventEnvelopeSchema.parse(emittedEvents[0])).toMatchObject({
      type: "agent.run_drained",
      payload: {
        sessionId: "session-script-forwarding",
        promptRequestId: command.id,
        runId: expect.any(String)
      }
    });
  });

  it("forwards the isolated longAgentProfile and navigation context", async () => {
    await import("./agent-entry");
    const longAgentProfile = DEFAULT_LONG_AGENT_PROFILES.find(
      (profile) => profile.id === "long"
    )!;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId: "session-long-forwarding",
          message: "检查世界规则",
          longAgentProfile,
          workspaceContext: {
            longWorkspace: {
              bookId: "longbook_forwarding",
              title: "长篇测试",
              activeRoot: "worldbuilding",
              activeAgentId: "long",
              navigation: {
                schemaVersion: 1,
                bookId: "longbook_forwarding",
                updatedAt: "2026-07-26T10:00:00.000Z",
                counts: {
                  worldbuildingCategories: 0,
                  characters: 0,
                  volumes: 1,
                  arcs: 0,
                  chapterCards: 0,
                  storyEvents: 0,
                  storyPlots: 0,
                  foreshadowingThreads: 0,
                  committedChapters: 0
                },
                worldbuilding: [],
                characters: [],
                volumes: [{ id: "volume_default", title: "第一卷", order: 1 }],
                arcs: [],
                chapterCards: [],
                committedThroughChapterId: null
              }
            }
          }
        },
        {
          id: "command-long-forwarding",
          context: {
            correlationId: "correlation-long-forwarding",
            sessionId: "session-long-forwarding"
          }
        }
      )
    );

    const requestInternalCommand = vi.fn<
      UtilityCommandHandlerContext["requestInternalCommand"]
    >(async (_target, internalCommand) => ({
      status: "accepted",
      requestId: internalCommand.id,
      payload: { forwarded: true }
    }));
    const utilityContext: UtilityCommandHandlerContext = {
      worker: "agent",
      requestId: command.id,
      requestInternalCommand
    };
    const result = await captured.commandHandler!(
      command,
      () => undefined,
      utilityContext
    );
    expect(result.status).toBe("accepted");
    await vi.waitFor(() => expect(captured.startInputs).toHaveLength(1));
    expect(captured.startInputs[0]).toMatchObject({
      longAgentProfile: { id: "long" },
      workspaceContext: {
        longWorkspace: {
          bookId: "longbook_forwarding",
          activeRoot: "worldbuilding"
        }
      }
    });
    expect(captured.startInputs[0]?.agentProfile).toBeUndefined();
    expect(captured.startInputs[0]?.scriptAgentProfile).toBeUndefined();
    expect(captured.startInputs[0]?.longCommandExecutor).toBeTypeOf("function");

    const queryCommand = LongGetWorkspaceIndexCommandEnvelopeSchema.parse(
      createEnvelope(
        "long.getWorkspaceIndex",
        { bookId: "longbook_forwarding" },
        {
          id: "query-long-forwarding",
          context: {
            correlationId: "correlation-long-forwarding",
            sessionId: "session-long-forwarding",
            runId: "run-long-forwarding",
            resourceId: "longbook_forwarding"
          }
        }
      )
    );
    const querySignal = new AbortController();
    await expect(
      captured.startInputs[0]!.longCommandExecutor!(
        queryCommand,
        querySignal.signal
      )
    ).resolves.toMatchObject({
      status: "accepted",
      requestId: "query-long-forwarding"
    });
    expect(requestInternalCommand).toHaveBeenCalledWith("core", queryCommand, {
      timeoutMs: 60_000
    });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      captured.startInputs[0]!.longCommandExecutor!(
        queryCommand,
        aborted.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requestInternalCommand).toHaveBeenCalledTimes(1);
  });

  it("forwards internal usage observations to Main as validated envelopes", async () => {
    await import("./agent-entry");
    captured.runtimeEvents.push({
      type: "agent.usage_observed",
      runId: "run-usage-envelope",
      sessionId: "session-usage-envelope",
      payload: {
        observationId: "run-usage-envelope:turn:1:attempt:1",
        observedAt: "2026-07-29T10:00:00.000Z",
        messageId: "run-usage-envelope_assistant",
        turnId: "run-usage-envelope:turn:1",
        attempt: 1,
        status: "completed",
        hadToolCall: false,
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 14
        },
        runtime: {
          provider: "openai",
          model: "writer",
          mode: "provider",
          configId: "writer-config"
        }
      }
    });
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId: "session-usage-envelope",
          message: "记录用量"
        },
        {
          id: "command-usage-envelope",
          context: {
            correlationId: "correlation-usage-envelope",
            sessionId: "session-usage-envelope"
          }
        }
      )
    );
    const emitted: SystemEventEnvelope[] = [];

    await expect(
      captured.commandHandler!(command, (event) => emitted.push(event))
    ).resolves.toMatchObject({ status: "accepted" });
    await vi.waitFor(() => expect(emitted).toHaveLength(2));
    expect(emitted[1]).toMatchObject({
      type: "agent.run_drained",
      payload: { promptRequestId: command.id }
    });

    expect(SystemEventEnvelopeSchema.parse(emitted[0]).type).toBe(
      "agent.usage_observed"
    );
    expect(emitted[0]).toMatchObject({
      payload: {
        observationId: "run-usage-envelope:turn:1:attempt:1",
        runtime: { configId: "writer-config" }
      }
    });
  });

  it("maps a runtime user-input request to a validated system event", async () => {
    await import("./agent-entry");
    captured.runtimeEvents.push({
      type: "agent.user_input_requested",
      runId: "run-user-input",
      sessionId: "session-user-input",
      payload: {
        requestId: "request-tone",
        toolCallId: "ask-tone",
        source: "ask_user_question",
        questions: [
          {
            id: "tone",
            question: "选择叙事语气",
            options: [
              { id: "restrained", label: "克制" },
              { id: "intense", label: "强烈" }
            ]
          }
        ],
        runtime: {
          provider: "deepwrite",
          model: "proposal-test",
          mode: "local-faux"
        }
      }
    });
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        { sessionId: "session-user-input", message: "先确认语气" },
        {
          id: "command-user-input",
          context: {
            correlationId: "correlation-user-input",
            sessionId: "session-user-input"
          }
        }
      )
    );
    const emitted: SystemEventEnvelope[] = [];

    await expect(
      captured.commandHandler!(command, (event) => emitted.push(event))
    ).resolves.toMatchObject({ status: "accepted" });
    await vi.waitFor(() => expect(emitted).toHaveLength(2));
    expect(emitted[1]).toMatchObject({
      type: "agent.run_drained",
      payload: { promptRequestId: command.id }
    });

    expect(SystemEventEnvelopeSchema.parse(emitted[0])).toMatchObject({
      type: "agent.user_input_requested",
      payload: {
        sessionId: "session-user-input",
        runId: expect.any(String),
        requestId: "request-tone",
        toolCallId: "ask-tone",
        source: "ask_user_question"
      }
    });
  });

  it("maps all long proposal runtime events to validated system envelopes", async () => {
    await import("./agent-entry");
    const eventBase = {
      runId: "run-long-proposals",
      sessionId: "session-long-proposals"
    };
    const payloadBase = {
      toolCallId: "tool-long-proposal",
      bookId: "longbook_proposals",
      summary: "等待审阅。",
      runtime: {
        provider: "deepwrite",
        model: "proposal-test",
        mode: "local-faux" as const
      }
    };
    captured.runtimeEvents.push(
      {
        ...eventBase,
        type: "long.mutation_proposal",
        payload: {
          ...payloadBase,
          agentId: "long",
          batch: {
            updatedAt: "2026-07-26T12:00:00.000Z",
            operations: [
              {
                type: "worldbuilding.update",
                id: "world_rules",
                patch: { title: "硬规则" }
              }
            ],
            documentWrites: []
          },
          review: {
            targetKey: "meta:world_rules",
            targetKind: "worldbuilding_category",
            targetId: "world_rules",
            action: "meta",
            title: "世界观分类 · 世界规则"
          }
        }
      },
      {
        ...eventBase,
        type: "long.worldbuilding_file_proposal",
        payload: {
          ...payloadBase,
          agentId: "long",
          batch: {
            updatedAt: "2026-07-26T12:00:00.000Z",
            operations: [
              {
                type: "worldbuildingItem.create",
                categoryId: "world_rules",
                item: {
                  id: "worlditem_memory",
                  title: "记忆代价",
                  order: 1,
                  file: {
                    id: "file_worlditem_memory:content",
                    path: "long/worldbuilding/world_rules/items/worlditem_memory.md",
                    updatedAt: "2026-07-26T12:00:00.000Z"
                  }
                }
              }
            ],
            documentWrites: []
          },
          files: [
            {
              categoryId: "world_rules",
              itemId: "worlditem_memory",
              fileId: "file_worlditem_memory:content",
              filePath:
                "long/worldbuilding/world_rules/items/worlditem_memory.md",
              title: "记忆代价",
              operation: "create",
              beforeText: "",
              afterText: ""
            }
          ]
        }
      },
      {
        ...eventBase,
        type: "long.chapter_write_proposal",
        payload: {
          ...payloadBase,
          agentId: "long",
          batch: {
            updatedAt: "2026-07-26T12:00:00.000Z",
            operations: [],
            documentWrites: [
              {
                proposalId: "proposal_chapter_one",
                fileId: longChapterBodyFileId("chapter_one"),
                content: "正文",
                mode: "replace",
                updatedAt: "2026-07-26T12:00:00.000Z",
                reason: "完成第一章"
              }
            ]
          },
          file: {
            chapterCardId: "chapter_one",
            chapterTitle: "第一章",
            fileId: longChapterBodyFileId("chapter_one"),
            filePath: longChapterFilePath("chapter_one", "body.md"),
            operation: "create",
            beforeText: "",
            afterText: "正文"
          }
        }
      },
      {
        ...eventBase,
        type: "long.ledger_commit_proposal",
        payload: {
          ...payloadBase,
          agentId: "long",
          input: {
            mode: "structured",
            bookId: "longbook_proposals",
            chapterCardId: "chapter_one",
            commitMessage: "提交第一章连续性",
            chapterSummary: {
              timeline: "第一天。",
              characterStates: "人物状态已核对。",
              factionStates: "势力状态无变化。",
              realmStates: "境界状态无变化。",
              foreshadowingStates: "伏笔状态已核对。",
              continuityNotes: "下一章继续。"
            },
            placementDecisions: {},
            foreshadowingBeatDecisions: {},
            fileUpdates: [],
            coverage: {
              character: {
                status: "unchanged",
                note: "人物状态已核验。"
              },
              plot: {
                status: "unchanged",
                note: "剧情推进已核验。"
              },
              foreshadowing: {
                status: "unchanged",
                note: "伏笔状态已核验。"
              },
              world: {
                status: "unchanged",
                note: "世界状态已核验。"
              },
              knowledge: {
                status: "unchanged",
                note: "知识边界已核验。"
              },
              openLoops: {
                status: "unchanged",
                note: "开放事项已核验。"
              }
            },
            factMutations: [],
            knowledgeMutations: [],
            openLoopMutations: [],
            chapterOutputs: {
              characterState: "第一章章末人物状态。",
              handoff: {
                summary: "下一章继续。",
                mustCarry: [],
                nextChapterConstraints: [],
                openLoops: []
              }
            }
          }
        }
      }
    );
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId: "session-long-proposals",
          message: "生成三类长篇提案"
        },
        {
          id: "command-long-proposals",
          context: {
            correlationId: "correlation-long-proposals",
            sessionId: "session-long-proposals"
          }
        }
      )
    );
    const emitted: SystemEventEnvelope[] = [];

    await expect(
      captured.commandHandler!(command, (event) => emitted.push(event))
    ).resolves.toMatchObject({ status: "accepted" });
    await vi.waitFor(() => expect(emitted).toHaveLength(5));

    expect(
      emitted.map((event) => SystemEventEnvelopeSchema.parse(event).type)
    ).toEqual([
      "long.mutation_proposal",
      "long.worldbuilding_file_proposal",
      "long.chapter_write_proposal",
      "long.ledger_commit_proposal",
      "agent.run_drained"
    ]);
    expect(emitted[0]).toMatchObject({
      type: "long.mutation_proposal",
      payload: {
        sessionId: "session-long-proposals",
        runId: "run-long-proposals",
        bookId: "longbook_proposals",
        review: {
          targetKey: "meta:world_rules",
          targetKind: "worldbuilding_category",
          targetId: "world_rules",
          action: "meta",
          title: "世界观分类 · 世界规则"
        }
      }
    });
  });

  it("aborts in-flight agent.model_test on agent.model_test_cancel and maps timeout errors", async () => {
    await import("./agent-entry");
    let capturedSignal: AbortSignal | undefined;
    captured.testConnectionImpl = (_config, options) =>
      new Promise((_resolve, reject) => {
        capturedSignal = options?.signal;
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true }
        );
      });

    const runtimeConfig = {
      id: "gemini-official",
      label: "Gemini Official",
      provider: "google",
      modelId: "gemini-2.5-pro",
      api: "google-generative-ai" as const,
      baseUrl: "https://provider.example.test/v1beta",
      reasoning: true,
      defaultThinkingLevel: "high" as const,
      thinkingLevelOptions: ["low", "high"],
      temperatureOptions: [0.1, 0.7, 1] as [number, number, number],
      apiKey: "invalid-test-key"
    };
    const testCommand = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.model_test",
        { runtimeConfig, requestId: "req_agent_cancel" },
        { id: "cmd_agent_model_test" }
      )
    );
    const pending = captured.commandHandler!(testCommand, vi.fn());
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);

    const cancelCommand = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.model_test_cancel",
        { requestId: "req_agent_cancel" },
        { id: "cmd_agent_model_test_cancel" }
      )
    );
    await expect(
      captured.commandHandler!(cancelCommand, vi.fn())
    ).resolves.toMatchObject({
      status: "accepted",
      payload: { cancelled: true }
    });
    expect(capturedSignal?.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      error: { code: "models.test_cancelled" }
    });

    // Already finished request returns cancelled: false
    await expect(
      captured.commandHandler!(cancelCommand, vi.fn())
    ).resolves.toMatchObject({
      status: "accepted",
      payload: { cancelled: false }
    });

    const { ModelConnectionTestTimeoutError } =
      await import("@deepwrite/pi-runtime-adapter");
    captured.testConnectionImpl = async () => {
      throw new ModelConnectionTestTimeoutError();
    };
    const timeoutCommand = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.model_test",
        { runtimeConfig, requestId: "req_agent_timeout" },
        { id: "cmd_agent_model_test_timeout" }
      )
    );
    await expect(
      captured.commandHandler!(timeoutCommand, vi.fn())
    ).resolves.toMatchObject({
      status: "rejected",
      error: { code: "models.test_timeout" }
    });
  });
});
