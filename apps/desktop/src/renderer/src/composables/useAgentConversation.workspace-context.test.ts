import type { WorkspaceDocument } from "./useAgentConversation.test-support";
import {
  SCRIPT_WORKSPACE_TEXT_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  createDeferredApi,
  createEnvelope,
  createScriptWorkspaceDocuments,
  createShortWorkspaceContentRevision,
  createShortWorkspaceDocuments,
  describe,
  document,
  eventOptions,
  expect,
  it,
  runtime,
  useAgentConversation,
  vi
} from "./useAgentConversation.test-support";

describe("agent conversation controller: workspace-context", () => {
  it("keeps complete short-stage files in tool context while bounding the automatic active snapshot", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      autoApproveCrossStageOperations: () => true,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const activeDocument = workspaceDocuments.find(
      (candidate) => candidate.stageId === "plot_design"
    );
    if (!activeDocument) throw new Error("Missing plot stage document.");
    const tail = "完整阶段文件末尾。";
    activeDocument.content = `${"长".repeat(20_010)}${tail}`;

    controller.draft.value = "检查完整剧情文件";
    const sending = controller.sendMessage(activeDocument, workspaceDocuments);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_complete_short_stage",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(deferred.prompts[0]?.autoApproveCrossStageOperations).toBe(true);
    expect(deferred.prompts[0]?.agentTeamMode).toBe("normal");

    const context = deferred.prompts[0]?.workspaceContext;
    const plotStage = context?.shortWorkspace?.stages.find(
      ({ stageId }) => stageId === "plot_design"
    );
    expect(plotStage?.content).toContain(tail);
    expect(plotStage?.truncated).toBeUndefined();
    expect(context?.shortWorkspace?.agentsMd).toBe("# 测试作品上下文");
    expect(context?.activeResource).toMatchObject({
      truncated: true,
      originalLength: activeDocument.content.length
    });
    expect(context?.activeResource?.content).toHaveLength(20_000);
    controller.dispose();
  });

  it("builds an isolated script workspace with the shared dynamic stages", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createScriptWorkspaceDocuments();
    const activeDocument = workspaceDocuments.find(
      (candidate) => candidate.draftFileKind === "body"
    );
    if (!activeDocument) throw new Error("Missing script episode body.");

    controller.selectAgentTeamMode("team");
    controller.draft.value = "继续编写第一集";
    const sending = controller.sendMessage(activeDocument, workspaceDocuments);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_script_snapshot",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const context = deferred.prompts[0]?.workspaceContext;
    expect(deferred.prompts[0]?.agentTeamMode).toBe("team");
    expect(context?.shortWorkspace).toBeUndefined();
    expect(context?.scriptWorkspace).toMatchObject({
      id: "script_story_1",
      title: "雨夜剧本",
      agentsMd: "# 测试作品上下文",
      activeStageId: "draft",
      activeAgentId: "script",
      activeSectionId: "episode-1",
      stages: SCRIPT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => ({
        stageId,
        content: `${stageId} 的剧本实时内容`
      })),
      expertDraft: {
        sections: [
          expect.objectContaining({
            id: "episode-1",
            title: "第一集"
          })
        ]
      }
    });
    expect(
      context?.scriptWorkspace?.stages.map((stage) => stage.stageId)
    ).toContain("intro_design");
    controller.dispose();
  });

  it("warns and still sends when the per-book context cannot be read", async () => {
    const deferred = createDeferredApi();
    const warning = vi.fn();
    vi.mocked(deferred.api.catalog.readWritingContext).mockRejectedValueOnce(
      new Error("AGENTS.md 暂时不可读")
    );
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000,
      onContextWarning: warning
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const activeDocument = workspaceDocuments.find(
      (candidate) => candidate.draftFileKind === "body"
    );
    if (!activeDocument) throw new Error("Missing short draft body.");

    controller.draft.value = "继续写短篇";
    const sending = controller.sendMessage(activeDocument, workspaceDocuments);
    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_without_context",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(warning).toHaveBeenCalledWith(
      "短篇上下文未注入：AGENTS.md 暂时不可读"
    );
    expect(
      deferred.prompts[0]?.workspaceContext?.shortWorkspace
    ).not.toHaveProperty("agentsMd");
    expect(deferred.prompts).toHaveLength(1);
    controller.dispose();
  });

  it("abandons a send whose context preflight outlives its conversation", async () => {
    const deferred = createDeferredApi();
    let resolveContext!: (value: {
      bookId: string;
      workspaceType: "short";
      content: string;
      truncated: boolean;
    }) => void;
    vi.mocked(deferred.api.catalog.readWritingContext).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveContext = resolve;
        })
    );
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const activeDocument = workspaceDocuments.find(
      (candidate) => candidate.draftFileKind === "body"
    );
    if (!activeDocument) throw new Error("Missing short draft body.");

    controller.draft.value = "这条消息不应进入新会话";
    const sending = controller.sendMessage(activeDocument, workspaceDocuments);
    await vi.waitFor(() => expect(resolveContext).toBeTypeOf("function"));
    controller.newConversation();
    resolveContext({
      bookId: activeDocument.workspaceId!,
      workspaceType: "short",
      content: "# 旧会话上下文",
      truncated: false
    });
    await sending;

    expect(deferred.prompts).toHaveLength(0);
    expect(controller.messages.value).toHaveLength(0);
    controller.dispose();
  });

  it("forwards the selected draft section to the unified draft agent", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const sectionDocument = workspaceDocuments.find(
      (candidate) =>
        candidate.expertSectionId === "section-1" &&
        candidate.draftFileKind === "body"
    );
    if (!sectionDocument) throw new Error("Missing draft section body.");

    controller.draft.value = "继续编写第一节";
    const sending = controller.sendMessage(sectionDocument, workspaceDocuments);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_section_writer",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(deferred.prompts[0]?.workspaceContext?.shortWorkspace).toMatchObject(
      {
        activeStageId: "draft",
        activeAgentId: "short",
        activeSectionId: "section-1",
        expertDraft: {
          sections: [
            expect.objectContaining({ id: "intro" }),
            expect.objectContaining({
              id: "section-1",
              body: expect.objectContaining({ content: "draft 的实时内容" }),
              characterState: expect.objectContaining({
                content: "第一节人物状态"
              })
            })
          ]
        }
      }
    );
    expect(
      deferred.prompts[0]?.workspaceContext?.shortWorkspace?.stages
    ).toHaveLength(SHORT_WORKSPACE_TEXT_STAGE_IDS.length);
    expect(deferred.prompts[0]?.workspaceContext?.activeResource).toMatchObject(
      {
        id: "short_draft_section-1_body",
        content: "draft 的实时内容"
      }
    );
    controller.dispose();
  });

  it("sends the tab-selected section body as the active physical draft file", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const firstBody = workspaceDocuments.find(
      (candidate) =>
        candidate.expertSectionId === "section-1" &&
        candidate.draftFileKind === "body"
    );
    const firstState = workspaceDocuments.find(
      (candidate) =>
        candidate.expertSectionId === "section-1" &&
        candidate.draftFileKind === "character-state"
    );
    if (!firstBody || !firstState)
      throw new Error("Missing first section files.");
    const secondBody: WorkspaceDocument = {
      ...firstBody,
      id: "short_draft_section-2_body",
      title: "第二节",
      path: ["雨夜来信", "正文", "第二节", "正文"],
      content: "第二节实时正文",
      expertSectionId: "section-2",
      expertSectionOrder: 2
    };
    const secondState: WorkspaceDocument = {
      ...firstState,
      id: "short_draft_section-2_state",
      title: "第二节 · 人物状态",
      path: ["雨夜来信", "正文", "第二节", "人物状态"],
      content: "第二节人物状态",
      expertSectionId: "section-2",
      expertSectionOrder: 2
    };
    workspaceDocuments.push(secondBody, secondState);

    controller.draft.value = "右侧标签已切到第二节";
    const sending = controller.sendMessage(secondBody, workspaceDocuments);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_tab_selected_section",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const context = deferred.prompts[0]?.workspaceContext;
    expect(context?.shortWorkspace).toMatchObject({
      activeStageId: "draft",
      activeAgentId: "short",
      activeSectionId: "section-2"
    });
    expect(
      context?.shortWorkspace?.expertDraft.sections.find(
        (section) => section.id === "section-2"
      )?.body
    ).toMatchObject({
      documentId: "short_draft_section-2_body",
      content: "第二节实时正文"
    });
    expect(context?.activeResource).toMatchObject({
      id: "short_draft_section-2_body",
      content: "第二节实时正文"
    });
    controller.dispose();
  });

  it("sends every physical draft file in full without the former 20k snapshot truncation", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const ordinaryStages = createShortWorkspaceDocuments().filter(
      (candidate) => candidate.stageId !== "draft"
    );
    const firstBody = `第一节完整开头${"雨".repeat(20_100)}第一节完整结尾`;
    const draftFiles: WorkspaceDocument[] = Array.from(
      { length: 5 },
      (_, index) => {
        const sectionId = `section-${index + 1}`;
        const title = `第${index + 1}节`;
        const common = {
          domain: "creation" as const,
          eyebrow: "短篇创作",
          workspaceId: "short_story_1",
          workspaceType: "short" as const,
          workspaceTitle: "雨夜来信",
          workspaceCategories: ["都市", "悬疑"],
          stageId: "draft" as const,
          shortAgentId: "short" as const,
          expertSectionId: sectionId,
          expertSectionOrder: index,
          expertWordCountRequirement: "1200 字",
          draftDirectoryId: "draft"
        };
        return [
          {
            ...common,
            id: `${sectionId}-body`,
            title,
            path: ["雨夜来信", "正文", title, "正文"],
            format: "正文" as const,
            content: index === 0 ? firstBody : `第${index + 1}节完整正文`,
            draftFileKind: "body" as const
          },
          {
            ...common,
            id: `${sectionId}-state`,
            title: `${title} · 人物状态`,
            path: ["雨夜来信", "正文", title, "人物状态"],
            format: "账本" as const,
            content: `第${index + 1}节人物状态`,
            draftFileKind: "character-state" as const
          }
        ];
      }
    ).flat();
    const workspaceDocuments = [...ordinaryStages, ...draftFiles];
    const sectionDocument = draftFiles.find(
      (candidate) =>
        candidate.expertSectionId === "section-5" &&
        candidate.draftFileKind === "body"
    );
    if (!sectionDocument) throw new Error("Missing fifth section body.");

    controller.draft.value = "继续编写第五节";
    const sending = controller.sendMessage(sectionDocument, workspaceDocuments);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_long_section_writer",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    const snapshot = deferred.prompts[0]?.workspaceContext?.shortWorkspace;
    expect(snapshot?.stages.map((stage) => stage.stageId)).toEqual(
      SHORT_WORKSPACE_TEXT_STAGE_IDS
    );
    expect(snapshot?.expertDraft.sections.map((section) => section.id)).toEqual(
      ["section-1", "section-2", "section-3", "section-4", "section-5"]
    );
    expect(snapshot?.expertDraft.sections[0]?.body.content).toBe(firstBody);
    expect(snapshot?.expertDraft.sections.at(-1)?.body.content).toBe(
      "第5节完整正文"
    );
    expect(deferred.prompts[0]?.workspaceContext?.activeResource).toMatchObject(
      {
        id: "section-5-body",
        content: "第5节完整正文"
      }
    );
    controller.dispose();
  });

  it("tracks a requested tool as running and updates it when completed", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "读取人物内容";
    const sessionId = controller.sessionId.value;
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_tools",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    controller.handleEvent(
      createEnvelope(
        "tool.call_requested",
        {
          sessionId,
          runId: "run_tools",
          toolCallId: "tool_read_character",
          toolName: "read_workspace_content",
          args: { stage_ids: ["character_design"] },
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tool_requested")
      )
    );

    expect(controller.messages.value.at(-1)).toMatchObject({
      id: "run_tools_assistant",
      role: "assistant",
      status: "streaming",
      tools: [
        {
          id: "tool_read_character",
          name: "read_workspace_content",
          status: "running"
        }
      ]
    });

    controller.handleEvent(
      createEnvelope(
        "tool.execution_completed",
        {
          sessionId,
          runId: "run_tools",
          toolCallId: "tool_read_character",
          toolName: "read_workspace_content",
          resultSummary: "已读取人物阶段",
          isError: false,
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tool_completed")
      )
    );

    expect(controller.messages.value.at(-1)?.tools).toEqual([
      {
        id: "tool_read_character",
        name: "read_workspace_content",
        status: "completed",
        summary: "已读取人物阶段"
      }
    ]);
    expect(controller.isBusy.value).toBe(true);
    expect(controller.acceptsRunEvent(sessionId, "run_tools")).toBe(true);
    controller.markToolConflict(
      "run_tools",
      "tool_read_character",
      "文稿版本已变化，未应用。"
    );
    expect(controller.messages.value.at(-1)?.tools?.[0]).toMatchObject({
      status: "error",
      summary: "文稿版本已变化，未应用。"
    });

    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId: "run_tools",
          messageId: "run_tools_assistant",
          role: "assistant" as const,
          content: "检查完成。",
          runtime
        },
        eventOptions(sessionId, "run_tools", "evt_tools_completed")
      )
    );
    expect(controller.acceptsRunEvent(sessionId, "run_tools")).toBe(false);
    controller.dispose();
  });

  it("forwards explicitly bound skill and material snapshots with the short workspace", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const workspaceDocuments = createShortWorkspaceDocuments();
    const activeDocument = workspaceDocuments.find(
      (candidate) => candidate.stageId === "plot_design"
    );
    if (!activeDocument) throw new Error("Missing plot_design stage document.");

    controller.draft.value = "使用绑定资料设计剧情";
    const sending = controller.sendMessage(activeDocument, workspaceDocuments, {
      attachedSkills: [
        {
          id: "skill_entry_1",
          title: "剧情反转",
          source: "attached-skill",
          kind: "plot",
          content: "先建立稳定预期，再用人物选择完成反转。"
        }
      ],
      attachedMaterials: [
        {
          id: "material_entry_1",
          title: "雨夜误导线索",
          source: "attached-material",
          kind: "plot",
          content: "雨水会冲淡脚印，但不会改变门轴上的新鲜锈痕。"
        }
      ]
    });
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_bound_libraries",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(deferred.prompts[0]?.workspaceContext).toMatchObject({
      attachedSkills: [
        {
          id: "skill_entry_1",
          title: "剧情反转",
          source: "attached-skill",
          kind: "plot"
        }
      ],
      attachedMaterials: [
        {
          id: "material_entry_1",
          title: "雨夜误导线索",
          source: "attached-material",
          kind: "plot"
        }
      ]
    });
    controller.dispose();
  });

  it("forwards only the explicitly selected library workspace for library management", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    const activeDocument: WorkspaceDocument = {
      id: "material-document-1",
      domain: "material",
      title: "人物甲",
      eyebrow: "短篇素材",
      path: ["人物素材", "人物甲"],
      content: "人物正文",
      libraryId: "material-library-1",
      catalogEntryId: "entry-1",
      stageCategoryId: "character"
    };
    const content = "人物正文";
    controller.draft.value = "整理当前素材";
    const sending = controller.sendMessage(activeDocument, [], {
      libraryWorkspace: {
        domain: "material",
        libraryId: "material-library-1",
        title: "人物素材",
        libraryType: "short",
        kind: "character",
        overviewDocumentId: "material-overview-1",
        overview: "人物素材边界",
        overviewRevision: createShortWorkspaceContentRevision("人物素材边界"),
        readOnly: false,
        activeEntryId: "entry-1",
        projectRevision: 7,
        entries: [
          {
            id: "entry-1",
            documentId: activeDocument.id,
            stageId: "character",
            title: activeDocument.title,
            content,
            revision: createShortWorkspaceContentRevision(content),
            readOnly: false
          }
        ]
      }
    });
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_material_library",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;

    expect(deferred.prompts[0]).not.toHaveProperty("agentTeamMode");

    expect(deferred.prompts[0]?.workspaceContext).toMatchObject({
      activeResource: {
        id: activeDocument.id,
        domain: "material"
      },
      libraryWorkspace: {
        domain: "material",
        libraryId: "material-library-1",
        activeEntryId: "entry-1",
        entries: [{ id: "entry-1", content }]
      }
    });
    expect(deferred.prompts[0]?.workspaceContext).not.toHaveProperty(
      "shortWorkspace"
    );
    expect(() =>
      structuredClone(deferred.prompts[0]?.workspaceContext?.libraryWorkspace)
    ).not.toThrow();
    controller.dispose();
  });

  it("records truncation metadata for a document over the context limit", () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "验证长文快照";
    void controller.sendMessage({ ...document, content: "长".repeat(20_010) });

    expect(deferred.prompts[0]?.workspaceContext?.activeResource).toMatchObject(
      {
        truncated: true,
        originalLength: 20_010
      }
    );
    expect(
      deferred.prompts[0]?.workspaceContext?.activeResource?.content
    ).toHaveLength(20_000);
    controller.dispose();
  });

  it("sends long-form prompts with an exclusive long workspace context", () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.draft.value = "检查当前世界规则";
    void controller.sendLongMessage(
      {
        bookId: "longbook_context",
        title: "雾港来信",
        activeRoot: "worldbuilding",
        activeAgentId: "long",
        activeFileId: "file_world_rules:content",
        navigation: {
          schemaVersion: 1,
          bookId: "longbook_context",
          updatedAt: "2026-07-26T12:00:00.000Z",
          counts: {
            worldbuildingCategories: 1,
            characters: 0,
            volumes: 1,
            arcs: 0,
            chapterCards: 0,
            storyEvents: 0,
            storyPlots: 0,
            foreshadowingThreads: 0,
            committedChapters: 0
          },
          worldbuilding: [
            {
              id: "world_rules",
              title: "世界规则",
              order: 1,
              format: "text"
            }
          ],
          characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
          characters: [],
          volumes: [{ id: "volume_one", title: "第一卷", order: 1 }],
          arcs: [],
          chapterCards: [],
          committedThroughChapterId: null
        }
      },
      {
        attachedSkills: [
          {
            id: "skill:long:world",
            title: "长篇世界构建",
            source: "attached-skill",
            kind: "general",
            content: "先建立规则边界。"
          }
        ],
        attachedMaterials: [
          {
            id: "material:long:world",
            title: "雾港地理",
            source: "attached-material",
            kind: "other",
            content: "港口终年有雾。"
          }
        ]
      }
    );

    expect(deferred.prompts[0]?.workspaceContext).toEqual({
      longWorkspace: expect.objectContaining({
        bookId: "longbook_context",
        activeRoot: "worldbuilding",
        activeAgentId: "long",
        activeFileId: "file_world_rules:content"
      }),
      attachedSkills: [
        expect.objectContaining({
          id: "skill:long:world",
          source: "attached-skill",
          kind: "general"
        })
      ],
      attachedMaterials: [
        expect.objectContaining({
          id: "material:long:world",
          source: "attached-material",
          kind: "other"
        })
      ]
    });
    expect(deferred.prompts[0]?.agentTeamMode).toBe("normal");
    expect(deferred.prompts[0]?.workspaceContext).not.toHaveProperty(
      "activeResource"
    );
    expect(deferred.prompts[0]?.workspaceContext).not.toHaveProperty(
      "shortWorkspace"
    );
    expect(deferred.prompts[0]?.workspaceContext).not.toHaveProperty(
      "scriptWorkspace"
    );
    controller.dispose();
  });
});
