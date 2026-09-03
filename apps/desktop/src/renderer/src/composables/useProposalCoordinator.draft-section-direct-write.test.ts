import { computed, ref, shallowRef } from "vue";
import {
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createEnvelope,
  type Book,
  type CreateDraftSectionsInput,
  type CreateDraftSectionsResult,
  type SaveDocumentInput,
  type SaveDocumentResult,
  type WorkspaceEditorMutationEventEnvelope,
  type WorkspaceEditorMutationTarget
} from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import type { CatalogWorkspaceProjection } from "../data/catalogWorkspace";
import type { AgentEditProposal } from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";
import type { AgentConversationController } from "./useAgentConversation";
import {
  useProposalCoordinator,
  type ProposalCoordinatorContext
} from "./useProposalCoordinator";

const NOW = "2026-08-30T00:00:00.000Z";
const SESSION_ID = "session-create-then-write";
const RUN_ID = "run-create-then-write";
const BOOK_ID = "book-create-then-write";
const DIRECTORY_ID = "draft-directory-create-then-write";
const PROVISIONAL_SECTION_ID = "pending:section:create-then-write";
const REAL_SECTION_ID = "section-created";
const PROVISIONAL_BODY_ID = catalogDraftBodyDocumentId(PROVISIONAL_SECTION_ID);
const PROVISIONAL_STATE_ID = catalogDraftCharacterStateDocumentId(
  PROVISIONAL_SECTION_ID
);
const REAL_BODY_ID = catalogDraftBodyDocumentId(REAL_SECTION_ID);
const REAL_STATE_ID = catalogDraftCharacterStateDocumentId(REAL_SECTION_ID);

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fixtureBook(bookType: "short" | "script"): Book {
  return {
    id: BOOK_ID,
    title: bookType === "short" ? "短篇建章直写" : "剧本建章直写",
    bookType,
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
    plotStages: [],
    documents: [],
    draft: { sections: [] },
    projectRevision: 3,
    createdAt: NOW,
    updatedAt: NOW
  } as unknown as Book;
}

function projection(
  bookType: "short" | "script",
  withCreatedSection: boolean
): CatalogWorkspaceProjection {
  return {
    draftDirectories: [
      {
        id: DIRECTORY_ID,
        workspaceId: BOOK_ID,
        workspaceType: bookType,
        title: "正文",
        sections: withCreatedSection
          ? [
              {
                id: REAL_SECTION_ID,
                title: "新建小节",
                wordCountRequirement: "",
                bodyDocumentId: REAL_BODY_ID,
                characterStateDocumentId: REAL_STATE_ID
              }
            ]
          : []
      }
    ]
  } as unknown as CatalogWorkspaceProjection;
}

function createdWorkspaceDocument(
  bookType: "short" | "script",
  fileKind: "body" | "character-state"
): WorkspaceDocument {
  const body = fileKind === "body";
  return {
    id: body ? REAL_BODY_ID : REAL_STATE_ID,
    domain: "creation",
    title: body ? "新建小节" : "新建小节 · 人物状态",
    eyebrow: "正文编写",
    path: ["正文编写", "新建小节"],
    content: "",
    workspaceId: BOOK_ID,
    workspaceType: bookType,
    workspaceTitle: "建章直写测试",
    stageId: "draft",
    expertSectionId: REAL_SECTION_ID,
    draftDirectoryId: DIRECTORY_ID,
    draftFileKind: fileKind,
    catalogDocumentId: body ? REAL_BODY_ID : REAL_STATE_ID,
    catalogProjectRevision: 4,
    catalogContentLoaded: true
  };
}

function mutationEvent(
  toolCallId: string,
  text: string,
  mutationTarget: WorkspaceEditorMutationTarget,
  sequence: number
): WorkspaceEditorMutationEventEnvelope {
  return createEnvelope(
    "workspace.editor_mutation",
    {
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolCallId,
      workspaceId: BOOK_ID,
      stageId: "draft" as const,
      text,
      mutationTarget,
      baseRevision: `v1:${900 + sequence}:deadbee${sequence}`,
      summary: `建章后写入步骤 ${sequence}`,
      runtime: {
        provider: "example-provider",
        model: "example-model",
        mode: "provider" as const
      }
    },
    {
      id: `event-create-then-write-${sequence}`,
      timestamp: `2026-08-30T00:00:0${sequence}.000Z`,
      context: {
        sessionId: SESSION_ID,
        runId: RUN_ID,
        resourceId: BOOK_ID
      }
    }
  ) as WorkspaceEditorMutationEventEnvelope;
}

function saveResult(
  input: SaveDocumentInput,
  projectRevision: number
): SaveDocumentResult {
  return {
    id: input.documentId,
    title:
      input.title ??
      (input.documentId === REAL_BODY_ID ? "新建小节" : "新建小节 · 人物状态"),
    content: input.content,
    createdAt: NOW,
    updatedAt: NOW,
    projectRevision
  };
}

function createdSectionResult(operationId: string): CreateDraftSectionsResult {
  return {
    operationId,
    bookId: BOOK_ID,
    projectRevision: 4,
    sections: [
      {
        clientSectionId: PROVISIONAL_SECTION_ID,
        section: {
          id: REAL_SECTION_ID,
          title: "新建小节",
          wordCountRequirement: "",
          body: {
            id: REAL_BODY_ID,
            title: "新建小节",
            content: "",
            createdAt: NOW,
            updatedAt: NOW
          },
          characterState: {
            id: REAL_STATE_ID,
            title: "新建小节 · 人物状态",
            content: "",
            createdAt: NOW,
            updatedAt: NOW
          },
          createdAt: NOW,
          updatedAt: NOW
        }
      }
    ]
  };
}

function createFixture(
  bookType: "short" | "script",
  refreshCreatedSection = true
) {
  const book = fixtureBook(bookType);
  const createResult = deferred<CreateDraftSectionsResult>();
  const documents = shallowRef<WorkspaceDocument[]>([]);
  const catalogProjection = shallowRef(projection(bookType, false));
  const proposals = new Map<string, AgentEditProposal>();
  const createDraftSections = vi.fn(
    (_input: CreateDraftSectionsInput) => createResult.promise
  );
  const saveDocument = vi.fn((input: SaveDocumentInput) =>
    Promise.resolve(
      saveResult(input, input.documentId === REAL_BODY_ID ? 5 : 6)
    )
  );
  const markToolConflict = vi.fn();
  const messages = ref<{ editProposals: AgentEditProposal[] }[]>([]);
  const syncMessages = () => {
    messages.value = [{ editProposals: [...proposals.values()] }];
  };
  const conversation = {
    sessionId: ref(SESSION_ID),
    isBusy: ref(false),
    messages,
    acceptsRunEvent: (sessionId: string, runId: string) =>
      sessionId === SESSION_ID && runId === RUN_ID,
    approvalModeForRun: () => "auto-approve" as const,
    markToolConflict,
    getEditProposal: (runId: string, proposalId: string) => {
      const proposal = proposals.get(proposalId);
      return proposal?.runId === runId ? proposal : undefined;
    },
    listEditProposals: (runId: string) =>
      [...proposals.values()].filter((proposal) => proposal.runId === runId),
    upsertEditProposal: (runId: string, proposal: AgentEditProposal) => {
      if (proposal.runId === runId) proposals.set(proposal.id, proposal);
      syncMessages();
      return proposal;
    },
    updateEditProposal: (
      runId: string,
      proposalId: string,
      patch: Partial<AgentEditProposal>
    ) => {
      const proposal = proposals.get(proposalId);
      if (!proposal || proposal.runId !== runId) return undefined;
      const updated = { ...proposal, ...patch };
      proposals.set(proposalId, updated);
      syncMessages();
      return updated;
    }
  } as unknown as AgentConversationController;
  const acceptingWorkspaceIds = ref(new Set<string>());
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const seenEvents = new Set<string>();
  const loadSnapshot = vi.fn(async () => {
    if (!refreshCreatedSection) return false;
    documents.value = [
      createdWorkspaceDocument(bookType, "body"),
      createdWorkspaceDocument(bookType, "character-state")
    ];
    catalogProjection.value = projection(bookType, true);
    return true;
  });
  const context = {
    api: () => ({ catalog: { createDraftSections, saveDocument } }),
    notifications,
    catalog: {
      snapshot: shallowRef(null),
      projection: catalogProjection,
      catalogBook: (bookId: string) => (bookId === BOOK_ID ? book : undefined),
      findCatalogLibrary: () => undefined,
      loadSnapshot,
      applyAcceptedDocumentLocally: (
        payload: { id: string; title: string; content: string },
        projectRevision: number | undefined
      ) => {
        documents.value = documents.value.map((document) =>
          document.id === payload.id
            ? {
                ...document,
                title: payload.title,
                content: payload.content,
                ...(projectRevision === undefined
                  ? {}
                  : { catalogProjectRevision: projectRevision })
              }
            : document
        );
      },
      applyCreatedLibraryEntry: vi.fn(async () => undefined),
      applySavedLibraryEntry: vi.fn(async () => undefined),
      applyUpdatedLibrary: vi.fn(async () => undefined),
      isConflict: () => false,
      refreshBookAfterSave: vi.fn(async () => true)
    },
    editor: {
      documents,
      drafts: ref({}),
      liveDocuments: computed(() => documents.value),
      selectedDraftFileKinds: ref({}),
      selectedExpertSectionIds: ref({}),
      acceptingWorkspaceIds,
      savingDocumentIds: ref(new Set<string>()),
      rememberWorkspaceMutationEvent: (eventId: string) => {
        if (seenEvents.has(eventId)) return false;
        seenEvents.add(eventId);
        return true;
      },
      setDocumentAccepting: vi.fn(),
      setWorkspaceAccepting: (workspaceId: string, accepting: boolean) => {
        const next = new Set(acceptingWorkspaceIds.value);
        if (accepting) next.add(workspaceId);
        else next.delete(workspaceId);
        acceptingWorkspaceIds.value = next;
      }
    },
    conversations: {
      active: computed(() => conversation),
      activeLong: computed(() => null),
      byKey: new Map(),
      all: () => [conversation],
      remove: vi.fn(),
      legacyDraftSectionKeys: () => [],
      forLongProposal: () => undefined
    },
    longWorkspace: {
      activeBookId: ref(null),
      books: shallowRef([]),
      refreshWorkspaceAfterProposal: vi.fn(async () => true),
      saveActiveEditorChanges: vi.fn(async () => true)
    },
    navigation: {
      selectedResourceId: ref(""),
      activeCreationResourceId: ref(""),
      rightCollapsed: ref(false)
    }
  } as unknown as ProposalCoordinatorContext;

  return {
    acceptingWorkspaceIds,
    coordinator: useProposalCoordinator(context),
    conversation,
    createDraftSections,
    createResult,
    documents,
    markToolConflict,
    notifications,
    saveDocument
  };
}

describe("short/script section creation followed by direct writes", () => {
  it.each(["short", "script"] as const)(
    "%s maps provisional files and accepts stale-base body/state writes in one run",
    async (bookType) => {
      const fixture = createFixture(bookType);
      const bodyText = "创建小节后写入的完整正文";
      const characterStateText = "创建小节后写入的人物状态";

      fixture.coordinator.stageAgentEditProposal(
        mutationEvent(
          "tool-create-section",
          "创建一个空白小节",
          {
            kind: "expert-draft-section-creation",
            sections: [
              {
                title: "新建小节",
                wordCountRequirement: "",
                provisionalSectionId: PROVISIONAL_SECTION_ID
              }
            ]
          },
          1
        )
      );
      await vi.waitFor(() =>
        expect(fixture.createDraftSections).toHaveBeenCalledTimes(1)
      );

      fixture.coordinator.stageAgentEditProposal(
        mutationEvent(
          "tool-write-body",
          bodyText,
          {
            kind: "expert-draft-file",
            documentId: PROVISIONAL_BODY_ID,
            sectionId: PROVISIONAL_SECTION_ID,
            fileKind: "body"
          },
          2
        )
      );
      fixture.coordinator.stageAgentEditProposal(
        mutationEvent(
          "tool-write-character-state",
          characterStateText,
          {
            kind: "expert-draft-file",
            documentId: PROVISIONAL_STATE_ID,
            sectionId: PROVISIONAL_SECTION_ID,
            fileKind: "characterState"
          },
          3
        )
      );

      const beforeCreateLands = fixture.conversation.listEditProposals(RUN_ID);
      expect(beforeCreateLands).toHaveLength(3);
      expect(
        beforeCreateLands.filter(
          (proposal) => proposal.provisionalExpertSection
        )
      ).toHaveLength(2);
      expect(fixture.saveDocument).not.toHaveBeenCalled();
      expect(fixture.markToolConflict).not.toHaveBeenCalled();

      const createInput = fixture.createDraftSections.mock.calls[0]![0];
      expect(createInput).toMatchObject({
        bookId: BOOK_ID,
        force: true,
        sections: [
          {
            clientSectionId: PROVISIONAL_SECTION_ID,
            title: "新建小节"
          }
        ]
      });
      expect(createInput).not.toHaveProperty("baseProjectRevision");
      fixture.createResult.resolve({
        operationId: createInput.operationId,
        bookId: BOOK_ID,
        projectRevision: 4,
        sections: [
          {
            clientSectionId: PROVISIONAL_SECTION_ID,
            section: {
              id: REAL_SECTION_ID,
              title: "新建小节",
              wordCountRequirement: "",
              body: {
                id: REAL_BODY_ID,
                title: "新建小节",
                content: "",
                createdAt: NOW,
                updatedAt: NOW
              },
              characterState: {
                id: REAL_STATE_ID,
                title: "新建小节 · 人物状态",
                content: "",
                createdAt: NOW,
                updatedAt: NOW
              },
              createdAt: NOW,
              updatedAt: NOW
            }
          }
        ]
      });
      await fixture.coordinator.drain();

      expect(fixture.saveDocument.mock.calls.map(([input]) => input)).toEqual([
        {
          bookId: BOOK_ID,
          documentId: REAL_BODY_ID,
          content: bodyText,
          force: true
        },
        {
          bookId: BOOK_ID,
          documentId: REAL_STATE_ID,
          content: characterStateText,
          force: true
        }
      ]);
      for (const [input] of fixture.saveDocument.mock.calls) {
        expect(input).not.toHaveProperty("baseRevision");
        expect(input).not.toHaveProperty("baseProjectRevision");
      }
      expect(fixture.documents.value.map(({ content }) => content)).toEqual([
        bodyText,
        characterStateText
      ]);
      const finalized = fixture.conversation.listEditProposals(RUN_ID);
      expect(finalized.map((proposal) => proposal.status)).toEqual([
        "accepted",
        "accepted",
        "accepted"
      ]);
      expect(
        finalized[0]?.draftSectionCreationTarget?.sections[0]?.realSectionId
      ).toBe(REAL_SECTION_ID);
      expect(finalized.slice(1)).toMatchObject([
        { documentId: REAL_BODY_ID, provisionalExpertSection: false },
        { documentId: REAL_STATE_ID, provisionalExpertSection: false }
      ]);
      expect(fixture.markToolConflict).not.toHaveBeenCalled();
      expect(fixture.notifications.error).not.toHaveBeenCalled();
      expect(fixture.notifications.warning).not.toHaveBeenCalled();
      expect(fixture.acceptingWorkspaceIds.value.size).toBe(0);
      expect(fixture.coordinator.hasQueuedAgentEdits()).toBe(false);

      await fixture.coordinator.dispose();
    }
  );

  it("does not mark creation accepted when refreshed targets are unavailable", async () => {
    const fixture = createFixture("short", false);
    fixture.coordinator.stageAgentEditProposal(
      mutationEvent(
        "tool-create-refresh-failure",
        "创建一个空白小节",
        {
          kind: "expert-draft-section-creation",
          sections: [
            {
              title: "新建小节",
              wordCountRequirement: "",
              provisionalSectionId: PROVISIONAL_SECTION_ID
            }
          ]
        },
        1
      )
    );
    await vi.waitFor(() =>
      expect(fixture.createDraftSections).toHaveBeenCalledOnce()
    );
    const input = fixture.createDraftSections.mock.calls[0]![0];
    fixture.createResult.resolve(createdSectionResult(input.operationId));
    await fixture.coordinator.drain();

    expect(fixture.conversation.listEditProposals(RUN_ID)[0]).toMatchObject({
      status: "error",
      statusMessage: expect.stringContaining("无法定位新章节")
    });
    expect(fixture.notifications.error).toHaveBeenCalled();
    await fixture.coordinator.dispose();
  });
});
