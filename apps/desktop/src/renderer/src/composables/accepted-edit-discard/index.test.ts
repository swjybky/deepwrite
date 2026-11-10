import { ref } from "vue";
import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import type { ProposalCoordinatorContext } from "../proposal-coordinator/types";
import { createAcceptedEditDiscardCoordinator } from "./index";

describe("accepted edit undo coordinator", () => {
  it("restores a saved short-story edit without a matching tool trace", async () => {
    let proposal: AgentEditProposal = {
      id: "proposal-1",
      runId: "run-1",
      workspaceId: "book-1",
      stageId: "plot_design",
      documentId: "plot-design-1",
      title: "剧情设计",
      summary: "修改剧情设计",
      status: "accepted",
      baseRevision: createShortWorkspaceContentRevision("修改前"),
      proposedRevision: createShortWorkspaceContentRevision("修改后"),
      toolCallIds: ["missing-tool-trace"],
      additions: 1,
      deletions: 1,
      hunks: [],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:01.000Z",
      discardSnapshot: { beforeText: "修改前", beforeTitle: "剧情设计" }
    };
    const conversation = {
      messages: ref([{ editProposals: [proposal] }]),
      getEditProposal: vi.fn(() => proposal),
      listEditProposals: vi.fn(() => [proposal]),
      updateEditProposal: vi.fn(
        (
          _runId: string,
          _proposalId: string,
          patch: Partial<AgentEditProposal>
        ) => {
          proposal = { ...proposal, ...patch };
        }
      )
    } as unknown as AgentConversationController;
    const applyAcceptedDocumentLocally = vi.fn();
    const context = {
      api: () => undefined,
      conversations: { active: ref(conversation), activeLong: ref(null) },
      editor: {
        acceptingWorkspaceIds: ref(new Set<string>()),
        setWorkspaceAccepting: vi.fn(),
        documents: ref([
          { id: "plot-design-1", title: "剧情设计", content: "修改后" }
        ]),
        drafts: ref({})
      },
      catalog: {
        isConflict: () => false,
        applyAcceptedDocumentLocally
      },
      notifications: {
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn()
      }
    } as unknown as ProposalCoordinatorContext;

    await createAcceptedEditDiscardCoordinator(context).discardAgentEdit({
      runId: proposal.runId,
      proposalId: proposal.id
    });

    expect(applyAcceptedDocumentLocally).toHaveBeenCalledWith(
      { id: "plot-design-1", title: "剧情设计", content: "修改前" },
      undefined,
      undefined
    );
    expect(proposal.discardState?.status).toBe("discarded");
  });

  it("restores an accepted long-form deletion from its restore point", async () => {
    let proposal: AgentEditProposal = {
      id: "proposal-long",
      runId: "run-1",
      workspaceId: "long:book-1",
      stageId: "long-plot-design",
      documentId: "plot-design",
      title: "剧情设计变更",
      summary: "删除重复条目",
      status: "accepted",
      toolCallIds: ["tool-1"],
      additions: 1,
      deletions: 0,
      hunks: [],
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:01.000Z",
      discardSnapshot: { longRestorePointId: "restore_abc12345" },
      longPlotDesignTarget: {
        bookId: "book-1",
        batch: {
          updatedAt: "2026-08-25T00:00:00.000Z",
          operations: [{ type: "worldbuilding.delete", id: "world_rules" }],
          documentWrites: []
        }
      }
    };
    const successor: AgentEditProposal = {
      ...proposal,
      id: "proposal-long-2",
      status: "pending",
      predecessorProposalId: proposal.id
    };
    const updates = new Map<string, Partial<AgentEditProposal>>();
    const conversation = {
      getEditProposal: vi.fn(() => proposal),
      listEditProposals: vi.fn(() => [proposal, successor]),
      updateEditProposal: vi.fn(
        (
          _runId: string,
          proposalId: string,
          patch: Partial<AgentEditProposal>
        ) => {
          if (proposalId === proposal.id) proposal = { ...proposal, ...patch };
          else updates.set(proposalId, patch);
        }
      )
    } as unknown as AgentConversationController;
    const summary = { id: "book-1", updatedAt: "2026-08-25T00:00:03.000Z" };
    const restoreOperations = vi.fn(async () => ({
      bookId: "book-1",
      summary,
      restoredFileCount: 2
    }));
    const refreshWorkspaceAfterProposal = vi.fn(async () => true);
    const books = ref<unknown[]>([]);
    const context = {
      api: () => ({ long: { restoreOperations } }),
      conversations: {
        active: ref(undefined),
        activeLong: ref(conversation)
      },
      editor: {
        acceptingWorkspaceIds: ref(new Set<string>()),
        setWorkspaceAccepting: vi.fn()
      },
      catalog: { isConflict: () => false },
      longWorkspace: { books, refreshWorkspaceAfterProposal },
      notifications: {
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn()
      }
    } as unknown as ProposalCoordinatorContext;

    await createAcceptedEditDiscardCoordinator(context).discardAgentEdit({
      runId: proposal.runId,
      proposalId: proposal.id
    });

    expect(restoreOperations).toHaveBeenCalledWith({
      bookId: "book-1",
      restorePointId: "restore_abc12345"
    });
    expect(refreshWorkspaceAfterProposal).toHaveBeenCalledWith("book-1");
    expect(books.value).toEqual([summary]);
    expect(proposal.discardState?.status).toBe("discarded");
    expect(updates.get(successor.id)).toMatchObject({ status: "conflict" });
  });

  it("marks a long-form undo as a conflict when later edits overlap", async () => {
    let proposal = {
      id: "proposal-long",
      runId: "run-1",
      workspaceId: "long:book-1",
      status: "accepted",
      discardSnapshot: { longRestorePointId: "restore_abc12345" },
      longPlotDesignTarget: { bookId: "book-1" }
    } as unknown as AgentEditProposal;
    const conversation = {
      getEditProposal: vi.fn(() => proposal),
      listEditProposals: vi.fn(() => [proposal]),
      updateEditProposal: vi.fn(
        (_runId: string, _id: string, patch: Partial<AgentEditProposal>) => {
          proposal = { ...proposal, ...patch };
        }
      )
    } as unknown as AgentConversationController;
    const warning = vi.fn();
    const context = {
      api: () => ({
        long: {
          restoreOperations: vi.fn(async () => {
            throw {
              code: "long.operation.restore_conflict",
              message: "conflict"
            };
          })
        }
      }),
      conversations: {
        active: ref(undefined),
        activeLong: ref(conversation)
      },
      editor: {
        acceptingWorkspaceIds: ref(new Set<string>()),
        setWorkspaceAccepting: vi.fn()
      },
      catalog: { isConflict: () => false },
      longWorkspace: { books: ref([]), refreshWorkspaceAfterProposal: vi.fn() },
      notifications: {
        info: vi.fn(),
        success: vi.fn(),
        warning,
        error: vi.fn()
      }
    } as unknown as ProposalCoordinatorContext;

    await createAcceptedEditDiscardCoordinator(context).discardAgentEdit({
      runId: proposal.runId,
      proposalId: proposal.id
    });

    expect(proposal.discardState?.status).toBe("conflict");
    expect(warning).toHaveBeenCalledOnce();
  });
});
