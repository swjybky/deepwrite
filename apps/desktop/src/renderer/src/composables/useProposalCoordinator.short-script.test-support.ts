import { computed, ref, shallowRef } from "vue";
import {
  createEnvelope,
  type Book,
  type SaveDocumentInput,
  type SaveDocumentResult,
  type WorkspaceEditorMutationEventEnvelope
} from "@deepwrite/contracts";
import { vi } from "vitest";
import type { CatalogWorkspaceProjection } from "../data/catalogWorkspace";
import type {
  AgentApprovalMode,
  AgentEditProposal
} from "../types/conversation";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import type { AgentConversationController } from "./useAgentConversation";
import {
  useProposalCoordinator,
  type ProposalCoordinatorContext
} from "./useProposalCoordinator";

export const NOW = "2026-08-30T00:00:00.000Z";
export const SESSION_ID = "session-direct-write";
export const RUN_ID = "run-direct-write";
export const BOOK_ID = "book-direct-write";
export const DOCUMENT_ID = "draft-section-direct-write-body";
export const INITIAL_CONTENT = "初始正文";
const DIRECTORY_ID = "draft-directory-direct-write";
const SECTION_ID = "section-direct-write";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type BookType = "short" | "script";

function fixtureBook(bookType: BookType): Book {
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

function fixtureDocument(bookType: BookType): WorkspaceDocument {
  return {
    id: DOCUMENT_ID,
    domain: "creation",
    title: "第一节",
    eyebrow: "正文编写",
    path: ["正文编写", "第一节"],
    content: INITIAL_CONTENT,
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

function fixtureProjection(bookType: BookType): CatalogWorkspaceProjection {
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

const runtime = {
  provider: "example-provider",
  model: "example-model",
  mode: "provider" as const
};

function eventMeta(id: string, second: number) {
  return {
    id,
    timestamp: `2026-08-30T00:00:0${second}.000Z`,
    context: { sessionId: SESSION_ID, runId: RUN_ID, resourceId: BOOK_ID }
  };
}

export function mutationEvent(
  toolCallId: string,
  text: string,
  baseRevision: string,
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
      baseRevision,
      summary: `第 ${second} 次写入正文`,
      runtime
    },
    eventMeta(`event-direct-write-${second}`, second)
  ) as WorkspaceEditorMutationEventEnvelope;
}

export function renameEvent(
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
      runtime
    },
    eventMeta(`event-direct-rename-${second}`, second)
  ) as WorkspaceEditorMutationEventEnvelope;
}

export function savedDocument(
  input: SaveDocumentInput,
  projectRevision: number,
  currentTitle = "第一节",
  currentContent = INITIAL_CONTENT
): SaveDocumentResult {
  return {
    id: input.documentId,
    title: input.title ?? currentTitle,
    // Like Core, a title-only write keeps the body that is on disk.
    content: input.preserveCurrentContent ? currentContent : input.content,
    createdAt: NOW,
    updatedAt: NOW,
    projectRevision
  };
}

interface FixtureOptions {
  approvalMode?: AgentApprovalMode;
  configure?(context: ProposalCoordinatorContext): void;
  /** Keep the first save pending until the test resolves `firstSave`. */
  holdFirstSave?: boolean;
}

export function createFixture(
  bookType: BookType,
  options: FixtureOptions = {}
) {
  const book = fixtureBook(bookType);
  const firstSave = deferred<SaveDocumentResult>();
  const documents = shallowRef<WorkspaceDocument[]>([
    fixtureDocument(bookType)
  ]);
  const drafts = ref<Record<string, EditorDraftState>>({});
  let persistedTitle = "第一节";
  const proposals = new Map<string, AgentEditProposal>();
  const holdFirstSave = options.holdFirstSave ?? true;
  const saveDocument = vi.fn((input: SaveDocumentInput) => {
    if (input.title !== undefined) persistedTitle = input.title;
    if (holdFirstSave && saveDocument.mock.calls.length === 1) {
      return firstSave.promise;
    }
    const current = documents.value.find(({ id }) => id === input.documentId);
    return Promise.resolve(
      savedDocument(input, 9, persistedTitle, current?.content)
    );
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
    approvalModeForRun: () => options.approvalMode ?? "auto-approve",
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
        const { [payload.id]: _accepted, ...rest } = drafts.value;
        drafts.value = rest;
      },
      applyCreatedLibraryEntry: vi.fn(async () => undefined),
      applySavedLibraryEntry: vi.fn(async () => undefined),
      applyUpdatedLibrary: vi.fn(async () => undefined),
      isConflict: (error: unknown) =>
        (error as { code?: unknown } | undefined)?.code === "catalog.conflict",
      refreshBookAfterSave: vi.fn(async () => true)
    },
    editor: {
      documents,
      drafts,
      liveDocuments: computed(() =>
        documents.value.map((document) => {
          const draft = drafts.value[document.id];
          return draft
            ? { ...document, title: draft.title, content: draft.content }
            : document;
        })
      ),
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

  /** The user's own save, as autosave would publish it. */
  function saveUserText(content: string): void {
    documents.value = documents.value.map((document) =>
      document.id === DOCUMENT_ID ? { ...document, content } : document
    );
  }

  /** An unsaved edit still in the editor. */
  function typeUserDraft(content: string): void {
    drafts.value = {
      ...drafts.value,
      [DOCUMENT_ID]: { title: "第一节", content, dirty: true }
    };
  }

  options.configure?.(context);
  return {
    coordinator: useProposalCoordinator(context),
    conversation,
    documents,
    drafts,
    firstSave,
    markToolConflict,
    notifications,
    saveDocument,
    saveUserText,
    typeUserDraft
  };
}
