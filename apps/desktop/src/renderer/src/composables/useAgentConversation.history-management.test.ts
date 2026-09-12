import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useAgentConversation,
  type AgentConversationController,
  type AgentConversationPersistenceRecord
} from "./useAgentConversation";
import { deferred } from "./conversation-history-reader/reader.test-support";
import { historyItemFor } from "./agent-conversation/conversation-history";
import { HistoryDeletionNotCommittedError } from "./agent-conversation/history-management-errors";

const controllers: AgentConversationController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
function record(
  sessionId: string,
  updatedAt = "2026-09-11T01:00:00.000Z"
): AgentConversationPersistenceRecord {
  return {
    sessionId,
    draft: "",
    approvalMode: "request-approval",
    temperature: 0.7,
    createdAt: updatedAt,
    updatedAt,
    messages: [
      {
        id: `${sessionId}-user`,
        role: "user",
        content: `${sessionId} content`,
        createdAt: updatedAt,
        status: "completed"
      }
    ]
  };
}
function setup() {
  const first = record("first", "2026-09-11T02:00:00.000Z");
  const second = record("second");
  const backend = {
    delete: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    restore: vi
      .fn<(id: string) => Promise<AgentConversationPersistenceRecord>>()
      .mockResolvedValue(second),
    listDeleted: vi
      .fn()
      .mockResolvedValue([historyItemFor(second, first.sessionId)])
  };
  const flush = vi.fn(async () => {
    const changes = controller.capturePersistenceChanges();
    controller.acknowledgePersistenceChanges(changes.revision);
  });
  const controller: AgentConversationController = useAgentConversation({
    api: () => undefined,
    flushPersistence: flush,
    historyManagement: backend,
    initialPersistenceSnapshot: {
      version: 1,
      activeSessionId: first.sessionId,
      conversations: [first, second]
    }
  });
  controller.initializePersistenceBaseline();
  controllers.push(controller);
  return { controller, backend, first, second, flush };
}

describe("acknowledged conversation history management", () => {
  it("does not acknowledge released late edits with an earlier isolated checkpoint", async () => {
    const { controller, backend } = setup();
    const response = deferred<void>();
    backend.delete.mockReturnValue(response.promise);
    const deletion = controller.deleteConversation("first");
    await vi.waitFor(() => expect(backend.delete).toHaveBeenCalledOnce());
    controller.messages.value[0]!.content += " late";
    const isolated = controller.capturePersistenceChanges();
    expect(isolated.deferredSessionIds).toEqual(["first"]);
    const rejected = expect(deletion).rejects.toThrow("confirmed rejection");
    response.reject(
      new HistoryDeletionNotCommittedError(new Error("confirmed rejection"))
    );
    await rejected;
    const released = controller.capturePersistenceChanges();
    expect(released.revision).toBeGreaterThan(isolated.revision);
    controller.acknowledgePersistenceChanges(isolated.revision);
    const remaining = controller.capturePersistenceChanges();
    expect(remaining.conversations[0]?.operations).toEqual([
      {
        type: "patchMessage",
        messageId: "first-user",
        changes: [{ op: "append", path: ["content"], text: " late" }]
      }
    ]);
  });
  it("keeps a pending deletion visible, then selects the recent survivor after ACK", async () => {
    const { controller, backend, flush } = setup();
    const acknowledgement = deferred<void>();
    backend.delete.mockReturnValue(acknowledgement.promise);
    const pending = controller.deleteConversation("first");
    await vi.waitFor(() => expect(backend.delete).toHaveBeenCalledOnce());
    expect(flush).toHaveBeenCalledTimes(2);
    expect(controller.history.value.map((item) => item.sessionId)).toContain(
      "first"
    );
    expect(controller.isBusy.value).toBe(true);
    expect(await controller.deleteConversation("first")).toBe(false);
    controller.newConversation();
    expect(controller.sessionId.value).toBe("first");
    acknowledgement.resolve();
    expect(await pending).toBe(true);
    expect(controller.sessionId.value).toBe("second");
    expect(
      controller.history.value.map((item) => item.sessionId)
    ).not.toContain("first");
    expect(
      controller
        .capturePersistenceChanges()
        .conversations.flatMap((value) => value.operations)
    ).toEqual([]);
  });

  it("keeps data unchanged when flush or deletion fails", async () => {
    const { controller, backend, flush } = setup();
    flush.mockRejectedValueOnce(new Error("save failed"));
    await expect(controller.deleteConversation("first")).rejects.toThrow(
      "save failed"
    );
    expect(backend.delete).not.toHaveBeenCalled();
    backend.delete.mockRejectedValueOnce(new Error("pending approval"));
    await expect(controller.deleteConversation("first")).rejects.toThrow(
      "pending approval"
    );
    expect(controller.sessionId.value).toBe("first");
    expect(controller.history.value).toHaveLength(2);
    expect(controller.isBusy.value).toBe(false);
  });

  it("forgets only the deleted session and never puts it back in later writes", async () => {
    const { controller } = setup();
    expect(await controller.deleteConversation("second")).toBe(true);
    controller.messages.value[0]!.content += " append";
    const changes = controller.capturePersistenceChanges();
    expect(changes.conversations.map((value) => value.sessionId)).toEqual([
      "first"
    ]);
    expect(changes.conversations[0]!.operations).toEqual([
      {
        type: "patchMessage",
        messageId: "first-user",
        changes: [{ op: "append", path: ["content"], text: " append" }]
      }
    ]);
  });

  it("restores a complete same-ID record without rewriting its parsed data", async () => {
    const { controller, second } = setup();
    await controller.deleteConversation("second");
    expect(await controller.listDeletedConversations()).toEqual([
      historyItemFor(second, "first")
    ]);
    expect(await controller.restoreConversation("second")).toBe(true);
    expect(controller.history.value.map((item) => item.sessionId)).toContain(
      "second"
    );
    expect(controller.capturePersistenceChanges().conversations).toEqual([]);
    expect(await controller.openConversation("second")).toBe(true);
    const changes = controller.capturePersistenceChanges();
    expect(changes.conversations.flatMap((value) => value.operations)).toEqual(
      []
    );
  });

  it("preserves edits arriving during deletion ACK in a new session", async () => {
    const { controller, backend } = setup();
    const acknowledgement = deferred<void>();
    backend.delete.mockReturnValue(acknowledgement.promise);
    const pending = controller.deleteConversation("first");
    await vi.waitFor(() => expect(backend.delete).toHaveBeenCalledOnce());
    controller.draft.value = "late local draft";
    acknowledgement.resolve();
    expect(await pending).toBe(true);
    expect(controller.sessionId.value).not.toBe("first");
    expect(controller.sessionId.value).not.toBe("second");
    expect(controller.draft.value).toBe("late local draft");
    expect(controller.messages.value[0]!.content).toBe("first content");
    const changes = controller.capturePersistenceChanges();
    expect(changes.conversations.map((value) => value.sessionId)).not.toContain(
      "first"
    );
    expect(changes.conversations[0]!.operations[0]?.type).toBe("putMessage");
  });

  it("creates an empty successor when the last conversation is deleted", async () => {
    const { controller } = setup();
    await controller.deleteConversation("second");
    await controller.deleteConversation("first");
    expect(controller.history.value).toEqual([]);
    expect(controller.messages.value).toEqual([]);
    expect(controller.sessionId.value).not.toBe("first");
    expect(
      controller
        .capturePersistenceChanges()
        .conversations.flatMap((value) => value.operations)
    ).toEqual([]);
  });

  it("hides management for legacy controllers", async () => {
    const controller = useAgentConversation({ api: () => undefined });
    controllers.push(controller);
    expect(controller.historyManagementAvailable).toBe(false);
    expect(await controller.deleteConversation("missing")).toBe(false);
    expect(await controller.restoreConversation("missing")).toBe(false);
    expect(await controller.listDeletedConversations()).toEqual([]);
  });
});

describe("separate history summaries and complete active data", () => {
  function setupReader() {
    const load = vi
      .fn<(id: string) => Promise<AgentConversationPersistenceRecord>>()
      .mockImplementation(async (id) => record(id));
    const controller = useAgentConversation({
      api: () => undefined,
      loadHistoryRecord: load
    });
    controllers.push(controller);
    const first = record("first");
    const second = record("second");
    const snapshot = {
      activeSessionId: "first",
      items: [historyItemFor(first, "first"), historyItemFor(second, "first")],
      active: first
    };
    return { controller, snapshot, load };
  }

  it("loads only the active record, lists remote summaries, and fetches a selected record on demand", async () => {
    const { controller, snapshot, load } = setupReader();
    expect(await controller.restorePersistenceHistory(snapshot)).toBe(true);
    expect(controller.history.value).toHaveLength(2);
    expect(controller.capturePersistenceSnapshot().conversations).toHaveLength(
      1
    );
    expect(controller.capturePersistenceChanges().conversations).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    expect(controller.selectConversation("second")).toBe(false);
    expect(await controller.openConversation("second")).toBe(true);
    expect(load).toHaveBeenCalledExactlyOnceWith("second");
    expect(controller.messages.value[0]!.content).toBe("second content");
    expect(
      controller
        .capturePersistenceChanges()
        .conversations.flatMap((value) => value.operations)
    ).toEqual([]);
  });

  it("leaves the current complete session and journal unchanged if a remote load fails", async () => {
    const { controller, snapshot, load } = setupReader();
    await controller.restorePersistenceHistory(snapshot);
    load.mockRejectedValueOnce(new Error("read failed"));
    await expect(controller.openConversation("second")).rejects.toThrow(
      "read failed"
    );
    expect(controller.sessionId.value).toBe("first");
    expect(controller.messages.value[0]!.content).toBe("first content");
    expect(controller.capturePersistenceChanges().conversations).toEqual([]);
    expect(controller.isBusy.value).toBe(false);
  });

  it("preserves a new local draft when initial history arrives late, while making remote summaries available", async () => {
    const { controller, snapshot } = setupReader();
    const current = controller.sessionId.value;
    const restoring = controller.restorePersistenceHistory(snapshot);
    controller.draft.value = "new local input";
    expect(await restoring).toBe(false);
    expect(controller.sessionId.value).toBe(current);
    expect(controller.draft.value).toBe("new local input");
    expect(controller.history.value).toHaveLength(2);
    expect(
      controller
        .capturePersistenceChanges()
        .conversations.map((value) => value.sessionId)
    ).toEqual([]);
  });

  it("does not turn a missing active detail into an empty conversation", async () => {
    const { controller, snapshot } = setupReader();
    const { active: _active, ...unloaded } = snapshot;
    await expect(
      controller.restorePersistenceHistory(unloaded)
    ).rejects.toThrow("尚未完整加载");
    expect(controller.history.value).toEqual([]);
  });

  it("does not apply remote records after disposal", async () => {
    const { controller, snapshot, load } = setupReader();
    await controller.restorePersistenceHistory(snapshot);
    const waiting = deferred<AgentConversationPersistenceRecord>();
    load.mockReturnValue(waiting.promise);
    const opening = controller.openConversation("second");
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    controller.dispose();
    waiting.resolve(record("second"));
    expect(await opening).toBe(false);
    expect(controller.sessionId.value).toBe("first");
  });
});
