import { computed, ref, shallowRef } from "vue";
import { vi } from "vitest";
import type {
  CatalogIndexSnapshot,
  LongWorkspaceImpactConfirmation
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../types/conversation";
import type { AgentConversationController } from "./useAgentConversation";
import {
  useProposalCoordinator,
  type ProposalCoordinatorContext
} from "./useProposalCoordinator";

export function createLongProposalRecoveryFixture(
  patches: Partial<AgentEditProposal>[] = [{}]
) {
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
  const initialProposal: AgentEditProposal = {
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
  const proposals = shallowRef(
    patches.map((patch) => ({ ...initialProposal, ...patch }))
  );
  const messages = computed(() => [{ editProposals: proposals.value }]);
  const conversation = {
    sessionId: ref("session-long-delete"),
    isBusy: ref(false),
    messages,
    getEditProposal: vi.fn((runId: string, proposalId: string) =>
      proposals.value.find(
        (proposal) => proposal.runId === runId && proposal.id === proposalId
      )
    ),
    listEditProposals: vi.fn((runId: string) =>
      proposals.value.filter((proposal) => proposal.runId === runId)
    ),
    updateEditProposal: vi.fn(
      (
        runId: string,
        proposalId: string,
        patch: Partial<AgentEditProposal>
      ) => {
        const proposal = proposals.value.find(
          (candidate) =>
            candidate.runId === runId && candidate.id === proposalId
        );
        if (!proposal) return;
        Object.assign(proposal, patch);
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
    conversation,
    proposal: (id = initialProposal.id) =>
      proposals.value.find((proposal) => proposal.id === id)!
  };
}
