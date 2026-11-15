import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref, shallowRef } from "vue";
import type {
  AgentUserInputRequestedPayload,
  AgentWriteApprovalResponse
} from "@deepwrite/contracts";
import type { AgentEditProposal, ChatMessage } from "../../types/conversation";
import type { AgentUserInputController } from "./user-input";
import {
  createWriteApprovalWatcher,
  registerWriteApprovalSource,
  type WriteApprovalItem
} from "./write-approval";

const request: AgentUserInputRequestedPayload = {
  sessionId: "session",
  runId: "run",
  requestId: "run:user-input:1",
  toolCallId: "call_2",
  source: "write_approval",
  questions: [{ id: "write_approval", question: "等待审批" }],
  writeApproval: { toolCallIds: ["call_1", "call_2"] },
  runtime: { mode: "local-faux", provider: "example", model: "fixture" }
};

function proposal(
  id: string,
  toolCallId: string,
  overrides: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  return {
    id,
    runId: "run",
    workspaceId: "book",
    stageId: "draft",
    documentId: id,
    title: `文档${id}`,
    summary: "改写，等待用户审阅。",
    status: "pending",
    toolCallIds: [toolCallId],
    additions: 1,
    deletions: 0,
    hunks: [],
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides
  };
}

function setup(proposals: AgentEditProposal[], graceMs = 5_000) {
  const messages = ref<ChatMessage[]>([
    {
      id: "assistant",
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: "2026-11-12T00:00:00.000Z",
      runId: "run",
      editProposals: proposals
    } as ChatMessage
  ]);
  const pending = shallowRef<AgentUserInputRequestedPayload | null>(request);
  const submit = vi.fn(
    async (_answers: unknown, _report?: AgentWriteApprovalResponse) => {
      pending.value = null;
      return true;
    }
  );
  const userInput = {
    request: pending,
    submitting: ref(false),
    submit
  } as unknown as AgentUserInputController;
  const watcher = createWriteApprovalWatcher({ messages, userInput }, graceMs);
  const update = (id: string, patch: Partial<AgentEditProposal>) => {
    const message = messages.value[0]!;
    message.editProposals = message.editProposals!.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    );
  };
  return { watcher, submit, update, pending };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("write approval watcher", () => {
  it("reports only after every proposal of the step is settled", async () => {
    const { watcher, submit, update } = setup([
      proposal("a", "call_1"),
      proposal("b", "call_2"),
      proposal("other", "call_9")
    ]);
    expect(watcher.items.value?.map(({ key }) => key)).toEqual([
      "proposal:a",
      "proposal:b"
    ]);

    update("a", { status: "accepted", userEditedText: "我的版本" });
    await nextTick();
    expect(submit).not.toHaveBeenCalled();

    update("b", { status: "error" });
    await nextTick();
    expect(submit).not.toHaveBeenCalled();

    update("b", { status: "rejected" });
    await nextTick();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![1]).toEqual({
      items: [
        {
          title: "文档a",
          summary: "改写",
          status: "saved",
          detail: "用户修改了你的版本后再保存，以作品中的内容为准。",
          edited: true,
          editedText: "我的版本",
          toolCallIds: ["call_1"]
        },
        {
          title: "文档b",
          summary: "改写",
          status: "rejected",
          toolCallIds: ["call_2"]
        }
      ]
    });
    watcher.stop();
  });

  it("treats a queue item that disappears as rejected", async () => {
    const queue = ref<WriteApprovalItem[]>([
      { key: "long:1", state: "waiting", result: { title: "剧情结构" } }
    ]);
    const unregister = registerWriteApprovalSource(() => queue.value);
    const { watcher, submit } = setup([]);
    await nextTick();
    expect(submit).not.toHaveBeenCalled();
    queue.value = [];
    await nextTick();
    expect(submit.mock.calls[0]![1]).toEqual({
      items: [{ title: "剧情结构", status: "rejected" }]
    });
    unregister();
    watcher.stop();
  });

  it("continues with an empty report when no card ever arrives", async () => {
    vi.useFakeTimers();
    const { watcher, submit } = setup([], 1_000);
    vi.advanceTimersByTime(999);
    expect(submit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(submit.mock.calls[0]![1]).toEqual({ items: [] });
    watcher.stop();
  });

  it("does not resubmit by itself after a failed report", async () => {
    const { watcher, submit, update, pending } = setup([
      proposal("a", "call_1")
    ]);
    submit.mockImplementationOnce(async () => {
      // A failed submission restores the request before it returns.
      pending.value = null;
      pending.value = request;
      return false;
    });
    update("a", { status: "accepted" });
    await nextTick();
    await nextTick();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(watcher.submitFailed.value).toBe(true);

    watcher.retry();
    await nextTick();
    expect(submit).toHaveBeenCalledTimes(2);
    watcher.stop();
  });
});
