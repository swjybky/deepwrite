import {
  createEnvelope,
  type Book,
  type DeepWriteApi,
  type WorkspaceEditorMutationEventEnvelope
} from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import {
  createPlotStructureProposalLane,
  plotStructureCreationStageId
} from "./plot-structure-lane";

const NOW = "2026-08-30T00:00:00.000Z";
const BOOK_ID = "book-plot-direct";

function fixtureBook(
  projectRevision: number | undefined,
  plotStages: Book["plotStages"] = [
    {
      id: "plot-opening",
      title: "开端",
      description: "故事开端",
      enabled: true
    }
  ]
): Book {
  return {
    id: BOOK_ID,
    title: "剧情结构直写测试",
    bookType: "short",
    genre: "其他",
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: [],
      other: []
    },
    characterStructure: { format: "text" },
    plotStages,
    documents: [],
    draft: { sections: [] },
    ...(projectRevision === undefined ? {} : { projectRevision }),
    createdAt: NOW,
    updatedAt: NOW
  } as unknown as Book;
}

function createPlotEvent(title = "终局"): WorkspaceEditorMutationEventEnvelope {
  return createEnvelope(
    "workspace.editor_mutation",
    {
      sessionId: "session-plot-direct",
      runId: "run-plot-direct",
      toolCallId: `tool-${title}`,
      workspaceId: BOOK_ID,
      stageId: "plot_design",
      text: `${title}\n回收线索。\n\n结构正文`,
      mutationTarget: {
        kind: "plot-structure" as const,
        mutation: {
          type: "create" as const,
          title,
          description: "回收线索。",
          provisionalStageId: "pending:plot-stage:1",
          content: "结构正文"
        }
      },
      baseRevision: "v1:0:1234abcd",
      summary: `创建剧情结构：${title}`,
      runtime: {
        provider: "example-provider",
        model: "example-model",
        mode: "provider" as const
      }
    },
    {
      id: `event-${title}`,
      timestamp: NOW,
      context: {
        sessionId: "session-plot-direct",
        runId: "run-plot-direct",
        resourceId: BOOK_ID
      }
    }
  ) as WorkspaceEditorMutationEventEnvelope;
}

function updatePlotEvent(
  previousTitle: string,
  title: string
): WorkspaceEditorMutationEventEnvelope {
  return createEnvelope(
    "workspace.editor_mutation",
    {
      sessionId: "session-plot-direct",
      runId: "run-plot-direct",
      toolCallId: `tool-update-${title}`,
      workspaceId: BOOK_ID,
      stageId: "plot-opening",
      text: `${title}\n更新后的说明`,
      mutationTarget: {
        kind: "plot-structure" as const,
        mutation: {
          type: "update" as const,
          stageId: "plot-opening",
          previousTitle,
          title,
          description: "更新后的说明"
        }
      },
      baseRevision: "v1:0:1234abcd",
      summary: `更新剧情结构：${title}`,
      runtime: {
        provider: "example-provider",
        model: "example-model",
        mode: "provider" as const
      }
    },
    {
      id: `event-update-${title}`,
      timestamp: NOW,
      context: {
        sessionId: "session-plot-direct",
        runId: "run-plot-direct",
        resourceId: BOOK_ID
      }
    }
  ) as WorkspaceEditorMutationEventEnvelope;
}

function createConversation() {
  const proposals = new Map<string, AgentEditProposal>();
  const controller = {
    markToolConflict: vi.fn(),
    getEditProposal: vi.fn((runId: string, proposalId: string) => {
      const proposal = proposals.get(proposalId);
      return proposal?.runId === runId ? proposal : undefined;
    }),
    upsertEditProposal: vi.fn((runId: string, proposal: AgentEditProposal) => {
      if (proposal.runId === runId) proposals.set(proposal.id, proposal);
    }),
    updateEditProposal: vi.fn(
      (
        runId: string,
        proposalId: string,
        patch: Partial<AgentEditProposal>
      ) => {
        const proposal = proposals.get(proposalId);
        if (!proposal || proposal.runId !== runId) return;
        proposals.set(proposalId, { ...proposal, ...patch });
      }
    )
  } as unknown as AgentConversationController;
  return { controller, proposals };
}

function createHarness(initialBook: Book, workspaceAccepting = false) {
  let book = structuredClone(initialBook);
  let persistedBook = structuredClone(initialBook);
  let accepting = workspaceAccepting;
  let refreshEnabled = true;
  const mutatePlotStructure = vi.fn(
    async (
      request: Parameters<DeepWriteApi["catalog"]["mutatePlotStructure"]>[0]
    ) => {
      const mutation = request.mutation;
      if (mutation.type === "create") {
        const stageId = mutation.stageId ?? "plot-generated";
        const existing = persistedBook.plotStages.find(
          ({ id }) => id === stageId
        );
        if (existing) {
          if (
            existing.title !== mutation.title ||
            existing.description !== mutation.description
          ) {
            throw new Error("稳定剧情结构 id 已用于其他创建请求。");
          }
          return structuredClone(persistedBook);
        }
        const createdStage = {
          id: stageId,
          title: mutation.title,
          description: mutation.description,
          enabled: true
        };
        persistedBook = {
          ...persistedBook,
          projectRevision: (persistedBook.projectRevision ?? 0) + 1,
          plotStages: [...persistedBook.plotStages, createdStage],
          documents: [
            ...persistedBook.documents,
            {
              id: createdStage.id,
              title: createdStage.title,
              content: "",
              createdAt: NOW,
              updatedAt: NOW
            }
          ]
        };
      }
      return structuredClone(persistedBook);
    }
  );
  const saveDocument = vi.fn(
    async (request: Parameters<DeepWriteApi["catalog"]["saveDocument"]>[0]) => {
      const existing = persistedBook.documents.find(
        ({ id }) => id === request.documentId
      );
      if (!existing) throw new Error("剧情结构正文不存在。");
      const projectRevision = (persistedBook.projectRevision ?? 0) + 1;
      persistedBook = {
        ...persistedBook,
        projectRevision,
        documents: persistedBook.documents.map((document) =>
          document.id === request.documentId
            ? {
                ...document,
                content: request.content,
                updatedAt: NOW
              }
            : document
        )
      };
      return {
        ...existing,
        content: request.content,
        updatedAt: NOW,
        projectRevision
      };
    }
  );
  const api = {
    catalog: { mutatePlotStructure, saveDocument }
  } as unknown as DeepWriteApi;
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const loadCatalogSnapshot = vi.fn(async () => {
    if (!refreshEnabled) return false;
    book = structuredClone(persistedBook);
    return true;
  });
  const setWorkspaceAccepting = vi.fn((_workspaceId: string, next: boolean) => {
    accepting = next;
  });
  const lane = createPlotStructureProposalLane({
    api: () => api,
    catalogBook: () => book,
    loadCatalogSnapshot,
    isCatalogConflict: () => false,
    isWorkspaceAccepting: () => accepting,
    setWorkspaceAccepting,
    notifications,
    queueAgentEdit: vi.fn()
  });
  return {
    lane,
    notifications,
    mutatePlotStructure,
    saveDocument,
    loadCatalogSnapshot,
    setBook(next: Book) {
      book = structuredClone(next);
      persistedBook = structuredClone(next);
    },
    setRefreshEnabled(enabled: boolean) {
      refreshEnabled = enabled;
    },
    persistedBook() {
      return structuredClone(persistedBook);
    }
  };
}

describe("plot structure proposal lane", () => {
  it("accepts a legacy stale proposal and directly saves structure and content", async () => {
    const conversation = createConversation();
    const harness = createHarness(fixtureBook(3));
    const event = createPlotEvent();

    expect(
      harness.lane.stage(event, conversation.controller, "request-approval")
    ).toBe(true);
    const staged = [...conversation.proposals.values()][0]!;
    expect(staged.plotStructureTarget).not.toHaveProperty(
      "baseProjectRevision"
    );
    const proposal: AgentEditProposal = {
      ...staged,
      plotStructureTarget: {
        ...staged.plotStructureTarget!,
        baseProjectRevision: 1
      }
    };
    conversation.proposals.set(proposal.id, proposal);
    harness.setBook(fixtureBook(9));
    const createdStageId = plotStructureCreationStageId(
      proposal.id,
      "pending:plot-stage:1"
    );

    await harness.lane.accept(
      conversation.controller,
      { runId: proposal.runId, proposalId: proposal.id },
      proposal,
      false
    );

    expect(harness.mutatePlotStructure).toHaveBeenCalledWith({
      bookId: BOOK_ID,
      baseProjectRevision: 9,
      force: true,
      mutation: {
        type: "create",
        stageId: createdStageId,
        title: "终局",
        description: "回收线索。"
      }
    });
    expect(harness.saveDocument).toHaveBeenCalledWith({
      bookId: BOOK_ID,
      documentId: createdStageId,
      content: "结构正文",
      force: true
    });
    expect(conversation.proposals.get(proposal.id)).toMatchObject({
      status: "accepted",
      proposedText: undefined
    });
    expect(harness.loadCatalogSnapshot).toHaveBeenCalledOnce();
    expect(harness.notifications.warning).not.toHaveBeenCalled();
  });

  it("replays the same stable create after the initial content save fails", async () => {
    const conversation = createConversation();
    const harness = createHarness(fixtureBook(2));
    harness.lane.stage(
      createPlotEvent(),
      conversation.controller,
      "request-approval"
    );
    const proposal = [...conversation.proposals.values()][0]!;
    const createdStageId = plotStructureCreationStageId(
      proposal.id,
      "pending:plot-stage:1"
    );
    harness.saveDocument.mockRejectedValueOnce(
      new Error("正文文件暂时无法写入。")
    );

    await harness.lane.accept(
      conversation.controller,
      { runId: proposal.runId, proposalId: proposal.id },
      proposal,
      true
    );

    expect(conversation.proposals.get(proposal.id)).toMatchObject({
      status: "error",
      statusMessage: "正文文件暂时无法写入。"
    });
    expect(
      harness
        .persistedBook()
        .plotStages.filter(({ id }) => id === createdStageId)
    ).toHaveLength(1);

    const retry = conversation.proposals.get(proposal.id)!;
    await harness.lane.accept(
      conversation.controller,
      { runId: retry.runId, proposalId: retry.id },
      retry,
      true
    );

    expect(harness.mutatePlotStructure).toHaveBeenCalledTimes(2);
    expect(
      harness.mutatePlotStructure.mock.calls.map(
        ([request]) => request.mutation
      )
    ).toEqual([
      {
        type: "create",
        stageId: createdStageId,
        title: "终局",
        description: "回收线索。"
      },
      {
        type: "create",
        stageId: createdStageId,
        title: "终局",
        description: "回收线索。"
      }
    ]);
    expect(harness.saveDocument).toHaveBeenCalledTimes(2);
    expect(
      harness
        .persistedBook()
        .plotStages.filter(({ id }) => id === createdStageId)
    ).toHaveLength(1);
    expect(
      harness.persistedBook().documents.find(({ id }) => id === createdStageId)
        ?.content
    ).toBe("结构正文");
    expect(conversation.proposals.get(proposal.id)).toMatchObject({
      status: "accepted",
      proposedText: undefined
    });
  });

  it("stays retryable until the created stage and document are visible after refresh", async () => {
    const conversation = createConversation();
    const harness = createHarness(fixtureBook(6));
    harness.lane.stage(
      createPlotEvent(),
      conversation.controller,
      "request-approval"
    );
    const proposal = [...conversation.proposals.values()][0]!;
    const createdStageId = plotStructureCreationStageId(
      proposal.id,
      "pending:plot-stage:1"
    );
    harness.setRefreshEnabled(false);

    await harness.lane.accept(
      conversation.controller,
      { runId: proposal.runId, proposalId: proposal.id },
      proposal,
      true
    );

    expect(conversation.proposals.get(proposal.id)).toMatchObject({
      status: "error",
      statusMessage: expect.stringContaining("刷新工作区后仍无法定位")
    });
    expect(harness.saveDocument).toHaveBeenCalledOnce();

    harness.setRefreshEnabled(true);
    const retry = conversation.proposals.get(proposal.id)!;
    await harness.lane.accept(
      conversation.controller,
      { runId: retry.runId, proposalId: retry.id },
      retry,
      true
    );

    expect(harness.mutatePlotStructure).toHaveBeenCalledTimes(2);
    expect(harness.saveDocument).toHaveBeenCalledOnce();
    expect(
      harness
        .persistedBook()
        .plotStages.filter(({ id }) => id === createdStageId)
    ).toHaveLength(1);
    expect(conversation.proposals.get(proposal.id)).toMatchObject({
      status: "accepted",
      proposedText: undefined
    });
  });

  it("accepts a book without a project revision through the forced command", async () => {
    const conversation = createConversation();
    const harness = createHarness(fixtureBook(undefined));
    const event = createPlotEvent();
    harness.lane.stage(event, conversation.controller, "request-approval");
    const proposal = [...conversation.proposals.values()][0]!;

    await harness.lane.accept(
      conversation.controller,
      { runId: proposal.runId, proposalId: proposal.id },
      proposal,
      true
    );

    expect(harness.mutatePlotStructure).toHaveBeenCalledWith(
      expect.objectContaining({
        baseProjectRevision: 0,
        force: true
      })
    );
    expect(conversation.proposals.get(proposal.id)).toMatchObject({
      status: "accepted"
    });
  });

  it("defers a possibly stale duplicate-title check to the serialized mutation", () => {
    const conversation = createConversation();
    const harness = createHarness(
      fixtureBook(4, [
        {
          id: "plot-ending",
          title: "终局",
          description: "已有终局",
          enabled: true
        }
      ])
    );

    expect(
      harness.lane.stage(
        createPlotEvent("终局"),
        conversation.controller,
        "request-approval"
      )
    ).toBe(true);
    expect(conversation.proposals.size).toBe(1);
    expect(conversation.controller.markToolConflict).not.toHaveBeenCalled();
    expect(harness.notifications.warning).not.toHaveBeenCalled();
    expect(harness.mutatePlotStructure).not.toHaveBeenCalled();
  });

  it("uses the live stage as the undo base when a stale previous title arrives", () => {
    const conversation = createConversation();
    const harness = createHarness(
      fixtureBook(8, [
        {
          id: "plot-opening",
          title: "前序子智能体已改名",
          description: "前序更新后的说明",
          enabled: true
        }
      ])
    );

    expect(
      harness.lane.stage(
        updatePlotEvent("开端", "最终标题"),
        conversation.controller,
        "request-approval"
      )
    ).toBe(true);

    expect([...conversation.proposals.values()][0]).toMatchObject({
      status: "pending",
      title: "修改剧情结构：前序子智能体已改名 → 最终标题",
      discardSnapshot: {
        beforeTitle: "前序子智能体已改名",
        beforeDescription: "前序更新后的说明"
      }
    });
    expect(conversation.controller.markToolConflict).not.toHaveBeenCalled();
  });

  it("keeps the per-workspace save barrier", async () => {
    const conversation = createConversation();
    const harness = createHarness(fixtureBook(5), true);
    const event = createPlotEvent();
    harness.lane.stage(event, conversation.controller, "request-approval");
    const proposal = [...conversation.proposals.values()][0]!;

    await harness.lane.accept(
      conversation.controller,
      { runId: proposal.runId, proposalId: proposal.id },
      proposal,
      true
    );

    expect(conversation.proposals.get(proposal.id)).toMatchObject({
      status: "error"
    });
    expect(harness.mutatePlotStructure).not.toHaveBeenCalled();
    expect(harness.notifications.info).toHaveBeenCalledOnce();
  });
});
