import {
  createEnvelope,
  type AgentUserInputRequestedPayload,
  type MysteryMutationProposalEventEnvelope
} from "@deepwrite/contracts";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, ref, shallowRef } from "vue";
import { expect, it, vi } from "vitest";
import { useMysteryWorkspaceStore } from "../stores/mysteryWorkspaceStore";
import { createWriteApprovalWatcher } from "./agent-conversation/write-approval";
import type { AgentUserInputController } from "./agent-conversation/user-input";
import type { AgentConversationController } from "./useAgentConversation";
import { useMysteryShellBridge } from "./useMysteryShellBridge";

it("keeps a mystery run paused for its own proposal and reports the user's rejection", async () => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  const runtime = {
    mode: "local-faux",
    provider: "example",
    model: "fixture"
  } as const;
  const event = createEnvelope(
    "mystery.mutation_proposal",
    {
      bookId: "mystery_fixture",
      runId: "run-fixture",
      sessionId: "session-fixture",
      agentId: "mystery",
      toolCallId: "edit-fixture",
      summary: "更新角色名称",
      batch: {
        operations: [
          { type: "role.updateMeta", roleId: "role_1", title: "新角色" }
        ],
        documentWrites: []
      },
      fileChanges: [],
      structureChanges: [],
      runtime
    },
    { id: "mystery-proposal-fixture" }
  ) as MysteryMutationProposalEventEnvelope;
  const { bookId, sessionId, runId, toolCallId } = event.payload;
  const approvalModeForRun = vi.fn(() => "request-approval");
  const origin = {
    approvalModeForRun
  } as unknown as AgentConversationController;
  const selected = {
    approvalMode: ref("auto-approve")
  } as unknown as AgentConversationController;
  const applyOperations = vi.fn();
  vi.stubGlobal("window", { deepwrite: { mystery: { applyOperations } } });
  const scope = effectScope();
  const bridge = scope.run(() =>
    useMysteryShellBridge({
      createBookDialogOpen: ref(false),
      selectedResourceId: ref(""),
      showConversation: vi.fn(),
      fallbackResourceId: () => "",
      conversationForKey: () => selected,
      findConversation: (key) =>
        key === `mystery:${bookId}:chat` ? origin : undefined,
      loadLongBooks: async () => undefined,
      notifications: { error: vi.fn() }
    })
  )!;
  const pending = shallowRef<AgentUserInputRequestedPayload>({
    sessionId,
    runId,
    requestId: "approval-fixture",
    toolCallId,
    source: "write_approval",
    questions: [{ id: "write_approval", question: "等待审批" }],
    writeApproval: { toolCallIds: [toolCallId] },
    runtime
  });
  const submit = vi.fn(async () => true);
  const watcher = createWriteApprovalWatcher({
    messages: ref([]),
    userInput: {
      request: pending,
      submit
    } as unknown as AgentUserInputController
  });
  try {
    const store = useMysteryWorkspaceStore();
    store.activeBookId = "mystery_other_book";
    await bridge.handleMysteryProposalEvent(event);
    await nextTick();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(approvalModeForRun).toHaveBeenCalledWith(sessionId, runId);
    expect(applyOperations).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    const proposal = store.proposalsByBookId[bookId]?.[0];
    expect(proposal?.status).toBe("pending");

    store.rejectProposal(bookId, proposal!.id);
    await nextTick();
    expect(submit).toHaveBeenCalledWith(expect.any(Array), {
      items: [
        {
          title: event.payload.summary,
          toolCallIds: [toolCallId],
          status: "rejected"
        }
      ]
    });
  } finally {
    watcher.stop();
    scope.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setActivePinia(undefined);
  }
});
