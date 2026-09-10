import { ref, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LongBookSummary } from "@deepwrite/contracts";
import {
  harness,
  worldbuildingFileEvent
} from "../useLongWorkspaceProposals.test-support";
import {
  createDeferredApi,
  createEditProposal,
  useAgentConversation
} from "../useAgentConversation.test-support";
import { createLongWorldbuildingProposalLane } from "./long-worldbuilding-lane";

afterEach(() => vi.unstubAllGlobals());

describe("worldbuilding save acknowledgement", () => {
  it("releases the approval and sending when a successful write is followed by a stuck refresh", async () => {
    const event = worldbuildingFileEvent();
    if (event.type !== "long.worldbuilding_file_proposal")
      throw new Error("Invalid fixture");
    const core = harness();
    const applyOperations = vi.fn(async () => ({
      summary: { id: event.payload.bookId, updatedAt: event.timestamp }
    }));
    vi.stubGlobal("window", {
      deepwrite: {
        long: {
          getWorkspaceIndex: core.getWorkspaceIndex,
          previewOperations: core.previewOperations,
          applyOperations
        }
      }
    });
    const api = createDeferredApi();
    const conversation = useAgentConversation({ api: () => api.api });
    conversation.messages.value = [
      {
        id: "assistant-world",
        role: "assistant",
        runId: event.payload.runId,
        content: "已提出世界观规则",
        status: "completed",
        createdAt: event.timestamp
      }
    ];
    const proposal = createEditProposal({
      runId: event.payload.runId,
      workspaceId: event.payload.bookId,
      longWorldbuildingTarget: {
        bookId: event.payload.bookId,
        batch: event.payload.batch,
        file: event.payload.files[0]!
      }
    });
    conversation.upsertEditProposal(event.payload.runId, proposal);
    conversation.draft.value = "继续补充规则";
    const locks = ref(new Set<string>());
    let failRefresh!: (error: Error) => void;
    const refresh = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          failRefresh = reject;
        })
    );
    const warning = vi.fn();
    const lane = createLongWorldbuildingProposalLane({
      acceptingAgentEditWorkspaceIds: locks,
      setAgentEditWorkspaceAccepting: (key, accepting) => {
        if (accepting) locks.value.add(key);
        else locks.value.delete(key);
      },
      activeLongBookId: ref(null),
      longBooks: shallowRef<readonly LongBookSummary[]>([]),
      saveActiveLongEditorChanges: async () => true,
      refreshLongProposalWorkspace: refresh,
      removeQueuedAgentEdit: vi.fn(),
      uiMessage: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning }
    });
    try {
      await lane.accept(
        conversation,
        {
          runId: event.payload.runId,
          proposalId: proposal.id,
          decision: "accept"
        },
        proposal,
        true
      );
      expect(applyOperations).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
      expect(locks.value.size).toBe(0);
      expect(
        conversation.getEditProposal(event.payload.runId, proposal.id)?.status
      ).toBe("accepted");
      expect(conversation.canSend.value).toBe(true);
      failRefresh(new Error("模拟刷新失败"));
      await Promise.resolve();
      await Promise.resolve();
      expect(warning).toHaveBeenCalledOnce();
      expect(
        conversation.getEditProposal(event.payload.runId, proposal.id)?.status
      ).toBe("accepted");
      expect(applyOperations).toHaveBeenCalledOnce();
    } finally {
      conversation.dispose();
    }
  });
});
