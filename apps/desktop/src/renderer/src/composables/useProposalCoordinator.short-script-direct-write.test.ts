import { computed, ref, shallowRef } from "vue";
import {
  createEnvelope,
  type Book,
  type SaveDocumentInput,
  type SaveDocumentResult,
  type WorkspaceEditorMutationEventEnvelope
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
const SESSION_ID = "session-direct-write";
const RUN_ID = "run-direct-write";
const BOOK_ID = "book-direct-write";
const DOCUMENT_ID = "draft-section-direct-write-body";
const DIRECTORY_ID = "draft-directory-direct-write";
const SECTION_ID = "section-direct-write";

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
    title: bookType === "short" ? "短篇直写测试" : "剧本直写测试",
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
    projectRevision: 7,
    createdAt: NOW,
    updatedAt: NOW
  } as unknown as Book;
}

function fixtureDocument(bookType: "short" | "script"): WorkspaceDocument {
  return {
    id: DOCUMENT_ID,
    domain: "creation",
    title: "第一节",
    eyebrow: "正文编写",
    path: ["正文编写", "第一节"],
    content: "初始正文",
    workspaceId: BOOK_ID,
    workspaceType: bookType,
    workspaceTitle: "直写测试",
    stageId: "draft",
    expertSectionId: SECTION_ID,
    draftDirectoryId: DIRECTORY_ID,
    draftFileKind: "body",
    catalogDocumentId: DOCUMENT_ID,
    catalogProjectRevision: 7,
    catalogContentLoaded: true
  };
}

function fixtureProjection(
  bookType: "short" | "script"
): CatalogWorkspaceProjection {
  return {
    draftDirectories: [
      {
        id: DIRECTORY_ID,
        workspaceId: BOOK_ID,
        workspaceType: bookType,
        title: "正文",
        sections: [
          {
            id: SECTION_ID,
            title: "第一节",
            wordCountRequirement: "",
            bodyDocumentId: DOCUMENT_ID,
            characterStateDocumentId: "draft-section-direct-write-state"
          }
        ]
      }
    ]
  } as unknown as CatalogWorkspaceProjection;
}

function mutationEvent(
  toolCallId: string,
  text: string,
  staleBaseRevision: string,
  second: number
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
      mutationTarget: {
        kind: "expert-draft-file" as const,
        documentId: DOCUMENT_ID,
        sectionId: SECTION_ID,
        fileKind: "body" as const
      },
      baseRevision: staleBaseRevision,
      summary: `第 ${second} 次写入正文`,
      runtime: {
        provider: "example-provider",
        model: "example-model",
        mode: "provider" as const
      }
    },
    {
      id: `event-direct-write-${second}`,
      timestamp: `2026-08-30T00:00:0${second}.000Z`,
      context: {
        sessionId: SESSION_ID,
        runId: RUN_ID,
        resourceId: BOOK_ID
      }
    }
  ) as WorkspaceEditorMutationEventEnvelope;
}

function renameEvent(
  toolCallId: string,
  title: string,
  second: number
): WorkspaceEditorMutationEventEnvelope {
  return createEnvelope(
    "workspace.editor_mutation",
    {
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolCallId,
      workspaceId: BOOK_ID,
      stageId: "draft" as const,
      text: "",
      mutationTarget: {
        kind: "expert-draft-section-rename" as const,
        sectionId: SECTION_ID,
        previousTitle: "第一节",
        title
      },
      baseRevision: "stale-rename-revision",
      summary: "先修改章节名称",
      runtime: {
        provider: "example-provider",
        model: "example-model",
        mode: "provider" as const
      }
    },
    {
      id: `event-direct-rename-${second}`,
      timestamp: `2026-08-30T00:00:0${second}.000Z`,
      context: {
        sessionId: SESSION_ID,
        runId: RUN_ID,
        resourceId: BOOK_ID
      }
    }
  ) as WorkspaceEditorMutationEventEnvelope;
}

function savedDocument(
  input: SaveDocumentInput,
  projectRevision: number,
  currentTitle = "第一节"
): SaveDocumentResult {
  return {
    id: input.documentId,
    title: input.title ?? currentTitle,
    content: input.content,
    createdAt: NOW,
    updatedAt: NOW,
    projectRevision
  };
}

function createFixture(bookType: "short" | "script") {
  const book = fixtureBook(bookType);
  const firstSave = deferred<SaveDocumentResult>();
  const documents = shallowRef<WorkspaceDocument[]>([
    fixtureDocument(bookType)
  ]);
  let persistedTitle = "第一节";
  const proposals = new Map<string, AgentEditProposal>();
  const saveDocument = vi.fn((input: SaveDocumentInput) => {
    if (input.title !== undefined) persistedTitle = input.title;
    if (saveDocument.mock.calls.length === 1) return firstSave.promise;
    return Promise.resolve(savedDocument(input, 9, persistedTitle));
  });
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
  const context = {
    api: () => ({ catalog: { saveDocument } }),
    notifications,
    catalog: {
      snapshot: shallowRef(null),
      projection: shallowRef(fixtureProjection(bookType)),
      catalogBook: (bookId: string) => (bookId === BOOK_ID ? book : undefined),
      findCatalogLibrary: () => undefined,
      loadSnapshot: vi.fn(async () => undefined),
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
    coordinator: useProposalCoordinator(context),
    conversation,
    documents,
    firstSave,
    markToolConflict,
    notifications,
    saveDocument
  };
}

describe("short/script agent direct document writes", () => {
  it.each([
    ["short", "短篇"],
    ["script", "剧本"]
  ] as const)(
    "%s ignores stale event revisions and serializes consecutive full-text writes",
    async (bookType, _label) => {
      const fixture = createFixture(bookType);
      const firstText = "上一个子智能体写入的完整正文";
      const secondText = "下一个子智能体接着写入的最终完整正文";

      fixture.coordinator.stageAgentEditProposal(
        mutationEvent("tool-first", firstText, "stale-revision-before-first", 1)
      );
      await vi.waitFor(() =>
        expect(fixture.saveDocument).toHaveBeenCalledTimes(1)
      );

      fixture.coordinator.stageAgentEditProposal(
        mutationEvent("tool-second", secondText, "another-stale-revision", 2)
      );

      const staged = fixture.conversation
        .listEditProposals(RUN_ID)
        .sort(
          (left, right) => (left.generation ?? 1) - (right.generation ?? 1)
        );
      expect(staged).toHaveLength(2);
      expect(staged[0]).toMatchObject({
        generation: 1,
        proposedText: firstText,
        status: "accepting"
      });
      expect(staged[1]).toMatchObject({
        generation: 2,
        predecessorProposalId: staged[0]!.id,
        proposedText: secondText,
        status: "pending"
      });
      expect(fixture.saveDocument).toHaveBeenCalledTimes(1);
      expect(fixture.markToolConflict).not.toHaveBeenCalled();

      const firstInput = fixture.saveDocument.mock.calls[0]![0];
      fixture.firstSave.resolve(savedDocument(firstInput, 8));
      await fixture.coordinator.drain();

      expect(fixture.saveDocument).toHaveBeenCalledTimes(2);
      expect(fixture.saveDocument.mock.calls.map(([input]) => input)).toEqual([
        {
          bookId: BOOK_ID,
          documentId: DOCUMENT_ID,
          content: firstText,
          force: true
        },
        {
          bookId: BOOK_ID,
          documentId: DOCUMENT_ID,
          content: secondText,
          force: true
        }
      ]);
      for (const [input] of fixture.saveDocument.mock.calls) {
        expect(input).not.toHaveProperty("baseRevision");
        expect(input).not.toHaveProperty("baseProjectRevision");
      }
      expect(fixture.documents.value[0]!.content).toBe(secondText);
      expect(
        fixture.conversation
          .listEditProposals(RUN_ID)
          .map((proposal) => proposal.status)
      ).toEqual(["accepted", "accepted"]);
      expect(fixture.markToolConflict).not.toHaveBeenCalled();
      expect(fixture.notifications.warning).not.toHaveBeenCalled();

      await fixture.coordinator.dispose();
    }
  );

  it.each([
    ["short", "短篇"],
    ["script", "剧本"]
  ] as const)(
    "%s preserves an earlier rename when the next subagent writes body text",
    async (bookType, _label) => {
      const fixture = createFixture(bookType);
      const renamedTitle =
        bookType === "short" ? "改名后的章节" : "改名后的剧集";
      const nextText = "下一个子智能体写入的正文";

      fixture.coordinator.stageAgentEditProposal(
        renameEvent("tool-rename", renamedTitle, 1)
      );
      await vi.waitFor(() =>
        expect(fixture.saveDocument).toHaveBeenCalledTimes(1)
      );

      fixture.coordinator.stageAgentEditProposal(
        mutationEvent(
          "tool-body-after-rename",
          nextText,
          "stale-before-rename",
          2
        )
      );
      expect(fixture.saveDocument).toHaveBeenCalledTimes(1);

      const renameInput = fixture.saveDocument.mock.calls[0]![0];
      expect(renameInput).toEqual({
        bookId: BOOK_ID,
        documentId: DOCUMENT_ID,
        title: renamedTitle,
        content: "",
        preserveCurrentContent: true,
        force: true
      });
      fixture.firstSave.resolve(savedDocument(renameInput, 8, renamedTitle));
      await fixture.coordinator.drain();

      expect(fixture.saveDocument).toHaveBeenCalledTimes(2);
      expect(fixture.saveDocument.mock.calls[1]![0]).toEqual({
        bookId: BOOK_ID,
        documentId: DOCUMENT_ID,
        content: nextText,
        force: true
      });
      expect(fixture.saveDocument.mock.calls[1]![0]).not.toHaveProperty(
        "title"
      );
      expect(fixture.documents.value[0]).toMatchObject({
        title: renamedTitle,
        content: nextText
      });
      expect(fixture.markToolConflict).not.toHaveBeenCalled();

      await fixture.coordinator.dispose();
    }
  );
});
