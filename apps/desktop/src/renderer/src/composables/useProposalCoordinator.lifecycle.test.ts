import { computed, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type {
  CatalogIndexSnapshot,
  CatalogLibrary,
  LongWorkspaceImpactConfirmation
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../types/conversation";
import type { AgentConversationController } from "./useAgentConversation";
import {
  useProposalCoordinator,
  type ProposalCoordinatorContext
} from "./useProposalCoordinator";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createFixture() {
  const createdEntry = deferred<{
    id: string;
    title: string;
    body: string;
    revision: string;
  }>();
  const createLibraryEntry = vi.fn(() => createdEntry.promise);
  let proposal: AgentEditProposal = {
    id: "proposal-lifecycle",
    laneId: "proposal-lifecycle",
    generation: 1,
    approvalMode: "auto-approve",
    sourceBaseRevision: "revision-base",
    runId: "run-lifecycle",
    workspaceId: "library-lifecycle",
    stageId: "library",
    documentId: "pending-library-entry",
    title: "测试条目",
    summary: "测试提交排空",
    status: "pending",
    baseRevision: "revision-base",
    proposedRevision: "revision-next",
    proposedText: "测试正文",
    toolCallIds: ["tool-lifecycle"],
    additions: 1,
    deletions: 0,
    hunks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    libraryTarget: {
      operation: "create",
      domain: "material",
      libraryId: "library-lifecycle",
      stageId: "character",
      baseProjectRevision: 4
    }
  };
  const conversation = {
    sessionId: ref("session-lifecycle"),
    isBusy: ref(false),
    messages: ref([{ editProposals: [proposal] }]),
    getEditProposal: vi.fn((runId: string, proposalId: string) =>
      runId === proposal.runId && proposalId === proposal.id
        ? proposal
        : undefined
    ),
    listEditProposals: vi.fn((runId: string) =>
      runId === proposal.runId ? [proposal] : []
    ),
    updateEditProposal: vi.fn(
      (
        runId: string,
        proposalId: string,
        patch: Partial<AgentEditProposal>
      ) => {
        if (runId !== proposal.runId || proposalId !== proposal.id) return;
        proposal = { ...proposal, ...patch };
      }
    )
  } as unknown as AgentConversationController;
  const library = {
    id: "library-lifecycle",
    projectRevision: 4
  } as unknown as CatalogLibrary;
  const context = {
    api: () => ({ catalog: { createLibraryEntry } }),
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    },
    catalog: {
      snapshot: shallowRef({} as CatalogIndexSnapshot),
      projection: shallowRef(null),
      catalogBook: vi.fn(),
      findCatalogLibrary: vi.fn(() => library),
      loadSnapshot: vi.fn(async () => undefined),
      applyAcceptedDocumentLocally: vi.fn(),
      applyCreatedLibraryEntry: vi.fn(async () => undefined),
      applySavedLibraryEntry: vi.fn(async () => undefined),
      applyUpdatedLibrary: vi.fn(async () => undefined),
      isConflict: vi.fn(() => false),
      refreshBookAfterSave: vi.fn(async () => true)
    },
    editor: {
      documents: shallowRef([]),
      drafts: ref({}),
      liveDocuments: computed(() => []),
      selectedDraftFileKinds: ref({}),
      selectedExpertSectionIds: ref({}),
      acceptingWorkspaceIds: ref(new Set<string>()),
      savingDocumentIds: ref(new Set<string>()),
      rememberWorkspaceMutationEvent: vi.fn(() => true),
      setDocumentAccepting: vi.fn(),
      setWorkspaceAccepting: vi.fn()
    },
    conversations: {
      active: computed(() => conversation),
      activeLong: computed(() => null),
      byKey: new Map(),
      all: () => [conversation],
      legacyDraftSectionKeys: vi.fn(() => []),
      forLongProposal: vi.fn()
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
    createLibraryEntry,
    createdEntry,
    proposal: () => proposal
  };
}

function createAutomaticLongDeleteFixture() {
  const confirmation: LongWorkspaceImpactConfirmation = {
    impact: {
      createdEntityIds: [],
      updatedEntityIds: [],
      deletedEntityIds: [],
      createdFileIds: [],
      deletedFileIds: [],
      documentWriteProposalIds: []
    },
    entityChanges: [],
    relationshipChanges: [],
    fileIntents: [],
    ledgerRecordEdits: []
  };
  const previewOperations = vi.fn(
    async ({ bookId }) =>
      ({
        bookId,
        preview: {
          ...confirmation,
          confirmation,
          documentWrites: [],
          provisionalIdMap: {}
        }
      }) as never
  );
  const applyOperations = vi.fn(
    async ({ bookId }) =>
      ({
        bookId,
        summary: { id: bookId },
        operationResult: {},
        restorePoint: {
          id: "restore_abc12345",
          createdAt: "2026-11-07T00:00:00.000Z"
        }
      }) as never
  );
  let proposal: AgentEditProposal = {
    id: "proposal-long-delete",
    laneId: "long-plot-design:plot-design",
    generation: 1,
    approvalMode: "auto-approve",
    runId: "run-long-delete",
    workspaceId: "long:longbook_delete",
    stageId: "long-plot-design",
    documentId: "plot-design",
    title: "剧情设计变更",
    summary: "删除第一卷",
    status: "pending",
    proposedText: "删除第一卷",
    toolCallIds: ["tool-long-delete"],
    additions: 0,
    deletions: 1,
    hunks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    longPlotDesignTarget: {
      bookId: "longbook_delete",
      batch: {
        updatedAt: "2026-01-01T00:00:00.000Z",
        operations: [{ type: "volume.delete", id: "volume_one" }],
        documentWrites: []
      }
    }
  };
  const messages = ref([{ editProposals: [proposal] }]);
  const conversation = {
    sessionId: ref("session-long-delete"),
    isBusy: ref(false),
    messages,
    getEditProposal: vi.fn((runId: string, proposalId: string) =>
      runId === proposal.runId && proposalId === proposal.id
        ? proposal
        : undefined
    ),
    listEditProposals: vi.fn((runId: string) =>
      runId === proposal.runId ? [proposal] : []
    ),
    updateEditProposal: vi.fn(
      (
        runId: string,
        proposalId: string,
        patch: Partial<AgentEditProposal>
      ) => {
        if (runId !== proposal.runId || proposalId !== proposal.id) return;
        proposal = { ...proposal, ...patch };
        messages.value = [{ editProposals: [proposal] }] as never;
        return proposal;
      }
    )
  } as unknown as AgentConversationController;
  const context = {
    api: () => undefined,
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    },
    catalog: {
      snapshot: shallowRef({} as CatalogIndexSnapshot),
      projection: shallowRef(null),
      catalogBook: vi.fn(),
      findCatalogLibrary: vi.fn(),
      loadSnapshot: vi.fn(async () => undefined),
      applyAcceptedDocumentLocally: vi.fn(),
      applyCreatedLibraryEntry: vi.fn(async () => undefined),
      applySavedLibraryEntry: vi.fn(async () => undefined),
      applyUpdatedLibrary: vi.fn(async () => undefined),
      isConflict: vi.fn(() => false),
      refreshBookAfterSave: vi.fn(async () => true)
    },
    editor: {
      documents: shallowRef([]),
      drafts: ref({}),
      liveDocuments: computed(() => []),
      selectedDraftFileKinds: ref({}),
      selectedExpertSectionIds: ref({}),
      acceptingWorkspaceIds: ref(new Set<string>()),
      savingDocumentIds: ref(new Set<string>()),
      rememberWorkspaceMutationEvent: vi.fn(() => true),
      setDocumentAccepting: vi.fn(),
      setWorkspaceAccepting: vi.fn()
    },
    conversations: {
      active: computed(() => conversation),
      activeLong: computed(() => conversation),
      byKey: new Map(),
      all: () => [conversation],
      legacyDraftSectionKeys: vi.fn(() => []),
      forLongProposal: vi.fn()
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

  vi.stubGlobal("window", {
    deepwrite: { long: { previewOperations, applyOperations } }
  });
  return {
    coordinator: useProposalCoordinator(context),
    previewOperations,
    applyOperations,
    proposal: () => proposal
  };
}

describe("useProposalCoordinator lifecycle", () => {
  it("drains a deferred keyed commit before reporting completion", async () => {
    const fixture = createFixture();
    fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
    await vi.waitFor(() =>
      expect(fixture.createLibraryEntry).toHaveBeenCalledTimes(1)
    );

    const draining = fixture.coordinator.drain();
    let drained = false;
    void draining.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    fixture.createdEntry.resolve({
      id: "entry-created",
      title: "测试条目",
      body: "测试正文",
      revision: "revision-created"
    });
    await draining;

    expect(drained).toBe(true);
    expect(fixture.proposal().status).toBe("accepted");
    expect(fixture.coordinator.hasQueuedAgentEdits()).toBe(false);
  });

  it("waits for an active commit during disposal and rejects new work", async () => {
    const fixture = createFixture();
    fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
    await vi.waitFor(() =>
      expect(fixture.createLibraryEntry).toHaveBeenCalledTimes(1)
    );

    const disposing = fixture.coordinator.dispose();
    fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
    await fixture.coordinator.reviewAgentEdit({
      runId: "run-lifecycle",
      proposalId: "proposal-lifecycle",
      decision: "accept"
    });
    expect(fixture.createLibraryEntry).toHaveBeenCalledTimes(1);
    expect(fixture.coordinator.dispose()).toBe(disposing);

    fixture.createdEntry.resolve({
      id: "entry-created",
      title: "测试条目",
      body: "测试正文",
      revision: "revision-created"
    });
    await disposing;

    expect(fixture.proposal().status).toBe("accepted");
    expect(fixture.coordinator.hasQueuedAgentEdits()).toBe(false);
  });

  it("saves an automatic deletion directly and keeps its restore point", async () => {
    const fixture = createAutomaticLongDeleteFixture();
    try {
      fixture.coordinator.resumeRecoveredAutomaticAgentEdits();
      await fixture.coordinator.drain();

      // Holding it for the user would stall every later edit in the lane.
      expect(fixture.previewOperations).toHaveBeenCalledTimes(1);
      expect(fixture.applyOperations).toHaveBeenCalledTimes(1);
      expect(fixture.applyOperations).toHaveBeenCalledWith(
        expect.objectContaining({ captureRestorePoint: true })
      );
      expect(fixture.coordinator.hasQueuedAgentEdits()).toBe(false);
      expect(fixture.proposal()).toMatchObject({
        status: "accepted",
        approvalMode: "auto-approve",
        discardSnapshot: { longRestorePointId: "restore_abc12345" }
      });
    } finally {
      await fixture.coordinator.dispose();
      vi.unstubAllGlobals();
    }
  });
});
