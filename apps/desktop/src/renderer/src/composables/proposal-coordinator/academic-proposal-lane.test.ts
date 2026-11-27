import { ref } from "vue";
import {
  createEnvelope,
  createShortWorkspaceContentRevision,
  type AcademicWorkspaceMutationEventEnvelope,
  type DeepWriteApi,
  type SaveDocumentInput
} from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import { createAcademicProposalLane } from "./academic-proposal-lane";

const NOW = "2026-11-23T00:00:00.000Z";
const BOOK_ID = "book-academic-lane";
const SESSION_ID = "session-academic-lane";
const RUN_ID = "run-academic-lane";
const DOCUMENT_ID = "academic-section:sec-method:body";

function editEvent(
  index: number,
  beforeText: string,
  text: string
): AcademicWorkspaceMutationEventEnvelope {
  return createEnvelope(
    "academic.workspace_mutation",
    {
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolCallId: `tool-${index}`,
      workspaceId: BOOK_ID,
      summary: `第 ${index} 次修改`,
      baseProjectRevision: 3,
      target: {
        kind: "document-edit" as const,
        objectKind: "section" as const,
        targetId: "sec-method",
        sectionDocument: "body" as const,
        catalogDocumentId: DOCUMENT_ID,
        title: "3 方法设计",
        beforeText,
        text,
        baseRevision: createShortWorkspaceContentRevision(beforeText)
      },
      runtime: {
        provider: "example-provider",
        model: "example-model",
        mode: "provider" as const
      }
    },
    {
      id: `event-${index}`,
      timestamp: NOW,
      context: { sessionId: SESSION_ID, runId: RUN_ID, resourceId: BOOK_ID }
    }
  ) as AcademicWorkspaceMutationEventEnvelope;
}

function createHarness(diskText: string) {
  let disk = diskText;
  const proposals = new Map<string, AgentEditProposal>();
  const conversation = {
    sessionId: ref(SESSION_ID),
    isBusy: ref(true),
    acceptsRunEvent: (sessionId: string, runId: string) =>
      sessionId === SESSION_ID && runId === RUN_ID,
    approvalModeForRun: () => "auto-approve" as const,
    messages: ref([]),
    listEditProposals: () => [...proposals.values()],
    getEditProposal: (_runId: string, id: string) => proposals.get(id),
    upsertEditProposal: (_runId: string, proposal: AgentEditProposal) => {
      proposals.set(proposal.id, proposal);
    },
    updateEditProposal: (
      _runId: string,
      id: string,
      patch: Partial<AgentEditProposal>
    ) => {
      const proposal = proposals.get(id);
      if (proposal) proposals.set(id, { ...proposal, ...patch });
    }
  } as unknown as AgentConversationController;
  const saveDocument = vi.fn(async (request: SaveDocumentInput) => {
    if (
      request.baseRevision !== undefined &&
      request.baseRevision !== createShortWorkspaceContentRevision(disk)
    ) {
      throw Object.assign(new Error("conflict"), { conflict: true });
    }
    disk = request.content;
    return { projectRevision: 4 };
  });
  const context = {
    api: () => ({ catalog: { saveDocument } }) as unknown as DeepWriteApi,
    notifications: { error: vi.fn() },
    conversations: { all: () => [conversation] },
    catalog: {
      isConflict: (error: unknown) =>
        Boolean((error as { conflict?: boolean }).conflict),
      applyAcceptedDocumentLocally: vi.fn(),
      loadSnapshot: vi.fn(async () => true)
    },
    editor: {
      drafts: ref({}),
      rememberWorkspaceMutationEvent: () => true,
      setWorkspaceAccepting: vi.fn()
    }
  } as unknown as ProposalCoordinatorContext;
  const queueAgentEdit = vi.fn();
  const lane = createAcademicProposalLane(context, { queueAgentEdit });
  return {
    lane,
    conversation,
    proposals,
    saveDocument,
    queueAgentEdit,
    disk: () => disk
  };
}

describe("academic proposal lane", () => {
  it("saves repeated edits of one document from the disk base", async () => {
    const harness = createHarness("");
    harness.lane.stageAcademicWorkspaceProposal(editEvent(1, "", "初稿"));
    harness.lane.stageAcademicWorkspaceProposal(editEvent(2, "初稿", "二稿"));
    harness.lane.stageAcademicWorkspaceProposal(editEvent(3, "二稿", "定稿"));

    expect(harness.proposals.size).toBe(1);
    const proposal = [...harness.proposals.values()][0]!;
    expect(proposal.baseRevision).toBe(createShortWorkspaceContentRevision(""));
    expect(proposal.toolCallIds).toEqual(["tool-1", "tool-2", "tool-3"]);
    expect(proposal.additions).toBe(1);
    expect(proposal.deletions).toBe(0);

    await harness.lane.acceptAcademicWorkspaceProposal(
      harness.conversation,
      proposal
    );

    expect(harness.disk()).toBe("定稿");
    expect(harness.proposals.get(proposal.id)?.status).toBe("accepted");
  });

  it("bases the next generation on the saved predecessor", async () => {
    const harness = createHarness("");
    harness.lane.stageAcademicWorkspaceProposal(editEvent(1, "", "初稿"));
    const first = [...harness.proposals.values()][0]!;
    await harness.lane.acceptAcademicWorkspaceProposal(
      harness.conversation,
      first
    );

    harness.lane.stageAcademicWorkspaceProposal(editEvent(2, "初稿", "二稿"));
    const second = [...harness.proposals.values()].find(
      (proposal) => proposal.id !== first.id
    )!;
    expect(second.baseRevision).toBe(
      createShortWorkspaceContentRevision("初稿")
    );
    await harness.lane.acceptAcademicWorkspaceProposal(
      harness.conversation,
      second
    );

    expect(harness.disk()).toBe("二稿");
    expect(harness.proposals.get(second.id)?.status).toBe("accepted");
  });
});
