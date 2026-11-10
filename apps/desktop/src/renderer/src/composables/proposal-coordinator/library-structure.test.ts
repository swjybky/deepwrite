import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { AgentEditProposal } from "../../types/conversation";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import type { AgentConversationController } from "../useAgentConversation";
import { acceptLibraryStructureProposal } from "./library-structure";

function harness() {
  const apply = vi.fn().mockResolvedValue({ applied: true });
  const refresh = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn();
  const notify = vi.fn();
  const documents = ref([{ id: "entry", domain: "material" }]);
  const drafts = ref<Record<string, { dirty: boolean }>>({});
  const context = {
    api: () => ({ catalog: { applyLibraryStructure: apply } }),
    editor: { liveDocuments: documents, drafts },
    catalog: { loadSnapshot: refresh },
    notifications: { error: notify }
  } as unknown as ProposalCoordinatorContext;
  const conversation = {
    listEditProposals: vi.fn(() => []),
    updateEditProposal: update
  } as unknown as AgentConversationController;
  const proposal = {
    id: "proposal",
    runId: "run",
    libraryStructureTarget: {
      domain: "material",
      requestId: "request",
      operations: [{ action: "delete-library", id: "library" }],
      baseVersion: "a".repeat(64),
      summary: "移除库并保留本地文件"
    }
  } as AgentEditProposal;
  return {
    apply,
    refresh,
    update,
    notify,
    drafts,
    context,
    conversation,
    proposal
  };
}

describe("library structure proposal acceptance", () => {
  it("blocks a structure change while domain text has unsaved edits", async () => {
    const h = harness();
    h.drafts.value.entry = { dirty: true };
    await acceptLibraryStructureProposal(h.context, h.conversation, h.proposal);
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenLastCalledWith(
      "run",
      "proposal",
      expect.objectContaining({ status: "error" })
    );
  });
  it("keeps the committed proposal accepted when refreshing the view fails", async () => {
    const h = harness();
    h.refresh.mockRejectedValue(new Error("refresh unavailable"));
    await acceptLibraryStructureProposal(h.context, h.conversation, h.proposal);
    expect(h.apply).toHaveBeenCalledExactlyOnceWith(
      h.proposal.libraryStructureTarget
    );
    expect(h.update).toHaveBeenLastCalledWith(
      "run",
      "proposal",
      expect.objectContaining({ status: "accepted" })
    );
    expect(h.notify).toHaveBeenCalledOnce();
  });
  it("preserves a Core conflict as an error without claiming success", async () => {
    const h = harness();
    h.apply.mockRejectedValue(new Error("版本已更新"));
    await acceptLibraryStructureProposal(h.context, h.conversation, h.proposal);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenLastCalledWith(
      "run",
      "proposal",
      expect.objectContaining({ status: "error", statusMessage: "版本已更新" })
    );
  });
});
