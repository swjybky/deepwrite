import {
  createAcademicCardDocumentId,
  createAcademicSectionDocumentId,
  createEnvelope,
  createShortWorkspaceContentRevision as revision,
  type AcademicMutationTarget,
  type AcademicWorkspaceMutationEventEnvelope,
  type Book
} from "@deepwrite/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStoredEditProposal } from "./agent-conversation/parse-proposal";
import type { ProposalCoordinatorContext } from "./useProposalCoordinator";
import {
  BOOK_ID,
  createFixture,
  NOW,
  RUN_ID,
  SESSION_ID
} from "./useProposalCoordinator.short-script.test-support";

const runtime = {
  provider: "example-provider",
  model: "example-model",
  mode: "provider" as const
};

function academicEvent(
  toolCallId: string,
  target: AcademicMutationTarget,
  summary: string,
  second: number
): AcademicWorkspaceMutationEventEnvelope {
  return createEnvelope(
    "academic.workspace_mutation",
    {
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolCallId,
      workspaceId: BOOK_ID,
      summary,
      baseProjectRevision: 7,
      target,
      runtime
    },
    {
      id: `event-acad-${second}`,
      timestamp: `2026-08-30T00:00:0${second}.000Z`,
      context: { sessionId: SESSION_ID, runId: RUN_ID, resourceId: BOOK_ID }
    }
  ) as AcademicWorkspaceMutationEventEnvelope;
}

function createAcademicProposalFixture(
  approvalMode: "auto-approve" | "request-approval" = "auto-approve",
  options: {
    holdFirstSave?: boolean;
    applyAcceptedDocumentLocally?: ProposalCoordinatorContext["catalog"]["applyAcceptedDocumentLocally"];
  } = {}
) {
  const createAcademicReferenceCard = vi.fn(
    async (input: { citeKey: string; title: string }) => ({
      card: {
        id: "real-card-1",
        citeKey: input.citeKey,
        cardType: "literature" as const,
        title: input.title,
        document: {
          id: createAcademicCardDocumentId("real-card-1"),
          title: input.title
        }
      },
      projectRevision: 8
    })
  );
  const updateAcademicReferenceCard = vi.fn(async () => ({
    projectRevision: 9
  }));
  const deleteAcademicReferenceCard = vi.fn(async () => ({
    projectRevision: 10
  }));
  const mutateAcademicFramework = vi.fn(async () => ({
    frameworkStages: [
      {
        id: "real-stage-1",
        title: "效度威胁分析",
        description: "内部与外部效度边界。",
        enabled: true
      }
    ],
    projectRevision: 11
  }));
  const mutateAcademicManuscript = vi.fn(
    async (input: {
      mutation: { type: string };
      baseProjectRevision?: number;
    }) => {
      if (input.mutation.type === "create-chapter") {
        return { chapterId: "real-chap-1", projectRevision: 12 };
      }
      if (input.mutation.type === "create-section") {
        return { sectionId: "real-sec-1", projectRevision: 13 };
      }
      return { projectRevision: 14 };
    }
  );

  let baseApiCatalog!: Record<string, unknown>;
  const fixture = createFixture("short", {
    approvalMode,
    holdFirstSave: options.holdFirstSave ?? false,
    configure(context) {
      baseApiCatalog = context.api()!.catalog as unknown as Record<
        string,
        unknown
      >;
      const academicBook = {
        id: BOOK_ID,
        title: "证据门控学术论文",
        bookType: "academic",
        subtype: "empirical_paper",
        citationStyle: "apa",
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
        foundation: { cards: [] },
        frameworkStages: [],
        manuscript: { chapters: [], sections: [] },
        documents: [],
        projectRevision: 7,
        createdAt: NOW,
        updatedAt: NOW
      } as unknown as Book;
      context.catalog.catalogBook = (id: string) =>
        id === BOOK_ID ? academicBook : undefined;
      if (options.applyAcceptedDocumentLocally) {
        context.catalog.applyAcceptedDocumentLocally =
          options.applyAcceptedDocumentLocally;
      }
      context.api = () =>
        ({
          catalog: {
            ...baseApiCatalog,
            createAcademicReferenceCard,
            updateAcademicReferenceCard,
            deleteAcademicReferenceCard,
            mutateAcademicFramework,
            mutateAcademicManuscript
          }
        }) as unknown as ReturnType<typeof context.api>;
    }
  });

  return {
    ...fixture,
    createAcademicReferenceCard,
    updateAcademicReferenceCard,
    deleteAcademicReferenceCard,
    mutateAcademicFramework,
    mutateAcademicManuscript
  };
}

const activeFixtures: Array<ReturnType<typeof createAcademicProposalFixture>> =
  [];

it("rejects a pending academic deletion when the reviewed project revision is stale", async () => {
  const fixture = createAcademicProposalFixture("request-approval");
  activeFixtures.push(fixture);
  fixture.mutateAcademicManuscript.mockImplementationOnce(async (input) => {
    if (input.baseProjectRevision === 7) {
      throw { code: "catalog.conflict", message: "小节已有新保存版本" };
    }
    return { projectRevision: 9 };
  });
  await fixture.coordinator.stageAcademicWorkspaceProposal(
    academicEvent(
      "delete-section",
      {
        kind: "section-mutation",
        mutation: {
          type: "delete",
          sectionId: "section-kept",
          title: "方法",
          deletedText: "原稿"
        }
      },
      "删除方法小节",
      1
    )
  );
  const proposal = fixture.conversation.listEditProposals(RUN_ID)[0]!;
  const restored = parseStoredEditProposal(
    JSON.parse(JSON.stringify(proposal))
  );
  expect(restored?.academicBaseProjectRevision).toBe(7);
  expect(restored?.academicMutationTarget).toEqual(
    proposal.academicMutationTarget
  );
  fixture.conversation.upsertEditProposal(RUN_ID, restored!);
  await fixture.coordinator.reviewAgentEdit({
    runId: RUN_ID,
    proposalId: proposal.id,
    decision: "accept"
  });
  await fixture.coordinator.drain();
  expect(fixture.mutateAcademicManuscript).toHaveBeenCalledWith({
    bookId: BOOK_ID,
    baseProjectRevision: 7,
    mutation: { type: "delete-section", sectionId: "section-kept" }
  });
  expect(
    fixture.conversation.getEditProposal(RUN_ID, proposal.id)?.status
  ).toBe("conflict");
});

it("captures the editor draft before an academic proposal writes to disk", async () => {
  const applyAcceptedDocumentLocally = vi.fn();
  const fixture = createAcademicProposalFixture("request-approval", {
    holdFirstSave: true,
    applyAcceptedDocumentLocally
  });
  activeFixtures.push(fixture);
  const sectionId = "section-draft";
  const documentId = createAcademicSectionDocumentId(sectionId, "body");
  await fixture.coordinator.stageAcademicWorkspaceProposal(
    academicEvent(
      "edit-section",
      {
        kind: "document-edit",
        objectKind: "section",
        targetId: sectionId,
        sectionDocument: "body",
        catalogDocumentId: documentId,
        title: "研究方法",
        beforeText: "原稿",
        text: "提案正文",
        baseRevision: revision("原稿")
      },
      "补充研究方法",
      1
    )
  );
  const proposal = fixture.conversation.listEditProposals(RUN_ID)[0]!;
  const reviewing = fixture.coordinator.reviewAgentEdit({
    runId: RUN_ID,
    proposalId: proposal.id,
    decision: "accept"
  });
  await vi.waitFor(() => expect(fixture.saveDocument).toHaveBeenCalledOnce());
  fixture.drafts.value = {
    [proposal.documentId]: {
      title: "研究方法",
      content: "等待时输入的草稿",
      dirty: true
    }
  };
  fixture.firstSave.resolve({
    id: documentId,
    title: "研究方法",
    content: "提案正文",
    createdAt: NOW,
    updatedAt: NOW,
    projectRevision: 8
  });
  await reviewing;
  expect(applyAcceptedDocumentLocally).toHaveBeenCalledWith(
    { id: proposal.documentId, title: "研究方法", content: "提案正文" },
    8,
    undefined
  );
});

afterEach(async () => {
  for (const fixture of activeFixtures.splice(0)) {
    await fixture.coordinator.dispose();
  }
});

describe("useProposalCoordinator academic workspace mutations", () => {
  it("prioritizes provisional chapter -> card/section -> document edits and remaps provisional IDs to real Core IDs", async () => {
    const fixture = createAcademicProposalFixture("auto-approve");
    activeFixtures.push(fixture);

    // Hold busy while staging all 4 mutations so auto-approve drains them by priority order
    (fixture.conversation.isBusy as { value: boolean }).value = true;

    // Stage in reverse dependency order to verify priority sorting:
    // 1. document-edit on provisional section
    await fixture.coordinator.stageAcademicWorkspaceProposal(
      academicEvent(
        "tool-edit-sec",
        {
          kind: "document-edit",
          objectKind: "section",
          targetId: "pending:academic-section:1",
          sectionDocument: "body",
          catalogDocumentId: createAcademicSectionDocumentId(
            "pending:academic-section:1",
            "body"
          ),
          title: "2.1 形式化建模",
          beforeText: "初始小节草稿。",
          text: "初始小节草稿。\n\n补充收敛性证明 [Smith2024a]。",
          baseRevision: revision("初始小节草稿。")
        },
        "补充 2.1 节收敛性证明",
        1
      )
    );

    // 2. document-edit + cardMeta on provisional card
    await fixture.coordinator.stageAcademicWorkspaceProposal(
      academicEvent(
        "tool-edit-card",
        {
          kind: "document-edit",
          objectKind: "reference_card",
          targetId: "pending:academic-card:1",
          catalogDocumentId: createAcademicCardDocumentId(
            "pending:academic-card:1"
          ),
          title: "Smith 2024 Grounding",
          beforeText: "初始卡片摘要。",
          text: "更新后的文献卡核验内容。",
          baseRevision: revision("初始卡片摘要。"),
          cardMeta: { citeKey: "Smith2024a", cardType: "evidence" }
        },
        "更新 Smith2024 卡片属性与摘要",
        2
      )
    );

    // 3. provisional section inside provisional chapter
    await fixture.coordinator.stageAcademicWorkspaceProposal(
      academicEvent(
        "tool-create-sec",
        {
          kind: "section-mutation",
          mutation: {
            type: "create",
            sections: [
              {
                provisionalSectionId: "pending:academic-section:1",
                chapterId: "pending:academic-chapter:1",
                title: "2.1 形式化建模",
                wordCountRequirement: "1200字",
                bodyContent: "初始小节草稿。"
              }
            ]
          }
        },
        "新建 2.1 节",
        3
      )
    );

    // 4. provisional card
    await fixture.coordinator.stageAcademicWorkspaceProposal(
      academicEvent(
        "tool-create-card",
        {
          kind: "reference-card-create",
          cards: [
            {
              provisionalCardId: "pending:academic-card:1",
              citeKey: "Smith2024",
              cardType: "literature",
              title: "Smith 2024 Grounding",
              content: "初始卡片摘要。"
            }
          ]
        },
        "新建文献卡 Smith2024",
        4
      )
    );

    // 5. provisional chapter
    await fixture.coordinator.stageAcademicWorkspaceProposal(
      academicEvent(
        "tool-create-chap",
        {
          kind: "chapter-mutation",
          mutation: {
            type: "create",
            chapters: [
              {
                provisionalChapterId: "pending:academic-chapter:1",
                title: "第二章 方法设计"
              }
            ]
          }
        },
        "新建第二章",
        5
      )
    );

    (fixture.conversation.isBusy as { value: boolean }).value = false;
    fixture.coordinator.scheduleQueuedAgentEdits(() => true);
    await fixture.coordinator.drain();

    const proposals = fixture.conversation.listEditProposals(RUN_ID);
    expect(proposals).toHaveLength(5);
    expect(proposals.every((p) => p.status === "accepted")).toBe(true);

    // Verify chapter was created first, then section received remapped `real-chap-1`
    expect(fixture.mutateAcademicManuscript).toHaveBeenCalledTimes(2);
    expect(fixture.mutateAcademicManuscript.mock.calls[0]![0]).toMatchObject({
      bookId: BOOK_ID,
      mutation: { type: "create-chapter", title: "第二章 方法设计" }
    });
    expect(fixture.mutateAcademicManuscript.mock.calls[1]![0]).toMatchObject({
      bookId: BOOK_ID,
      mutation: {
        type: "create-section",
        chapterId: "real-chap-1",
        title: "2.1 形式化建模"
      }
    });

    // Verify card was created, then updated with remapped `real-card-1`
    expect(fixture.createAcademicReferenceCard).toHaveBeenCalledOnce();
    expect(fixture.updateAcademicReferenceCard).toHaveBeenCalledWith({
      bookId: BOOK_ID,
      cardId: "real-card-1",
      citeKey: "Smith2024a",
      cardType: "evidence"
    });

    // Verify saveDocument received remapped real catalog document IDs
    const savedDocIds = fixture.saveDocument.mock.calls.map(
      ([input]) => input.documentId
    );
    expect(savedDocIds).toContain(
      createAcademicSectionDocumentId("real-sec-1", "body")
    );
    expect(savedDocIds).toContain(createAcademicCardDocumentId("real-card-1"));
  });

  it("transitions dependent pending proposals to conflict when a provisional creation is rejected", async () => {
    const fixture = createAcademicProposalFixture("request-approval");
    activeFixtures.push(fixture);

    await fixture.coordinator.stageAcademicWorkspaceProposal(
      academicEvent(
        "tool-create-sec-reject",
        {
          kind: "section-mutation",
          mutation: {
            type: "create",
            sections: [
              {
                provisionalSectionId: "pending:academic-section:9",
                title: "3.1 实验结果",
                wordCountRequirement: ""
              }
            ]
          }
        },
        "新建 3.1 节",
        1
      )
    );

    await fixture.coordinator.stageAcademicWorkspaceProposal(
      academicEvent(
        "tool-edit-sec-dependent",
        {
          kind: "document-edit",
          objectKind: "section",
          targetId: "pending:academic-section:9",
          sectionDocument: "body",
          catalogDocumentId: createAcademicSectionDocumentId(
            "pending:academic-section:9",
            "body"
          ),
          title: "3.1 实验结果",
          beforeText: "",
          text: "依赖新建小节的正文。",
          baseRevision: revision("")
        },
        "撰写 3.1 节正文",
        2
      )
    );

    const beforeReject = fixture.conversation.listEditProposals(RUN_ID);
    expect(beforeReject).toHaveLength(2);
    const creationProposal = beforeReject.find(
      (p) => p.academicMutationTarget?.kind === "section-mutation"
    )!;
    const dependentProposal = beforeReject.find(
      (p) => p.academicMutationTarget?.kind === "document-edit"
    )!;
    expect(creationProposal.status).toBe("pending");
    expect(dependentProposal.status).toBe("pending");

    await fixture.coordinator.reviewAgentEdit({
      runId: RUN_ID,
      proposalId: creationProposal.id,
      decision: "reject"
    });

    const afterReject = fixture.conversation.listEditProposals(RUN_ID);
    expect(afterReject.find((p) => p.id === creationProposal.id)?.status).toBe(
      "rejected"
    );
    expect(
      afterReject.find((p) => p.id === dependentProposal.id)
    ).toMatchObject({
      status: "conflict",
      statusMessage: "前置新建对象提案已被拒绝，依赖该临时对象的修改无法应用。"
    });
  });
});
