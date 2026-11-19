import { computed } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  useLazyLongWorkspaceProposals,
  type LongWorkspaceProposalsModule
} from "./useLazyLongWorkspaceProposals";
import type {
  LongWorkspaceProposalController,
  LongWorkspaceProposalEvent,
  UseLongWorkspaceProposalsOptions
} from "./useLongWorkspaceProposals";
import {
  mutationEvent,
  chapterEvent
} from "./useLongWorkspaceProposals.test-support";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function harness() {
  const ready = deferred<LongWorkspaceProposalsModule>();
  const load = vi.fn(() => ready.promise);
  const acceptsEvent = vi.fn(() => true);
  const approvalModeForEvent = vi.fn<
    NonNullable<UseLongWorkspaceProposalsOptions["approvalModeForEvent"]>
  >(() => "request-approval");
  const versionOriginForEvent = vi.fn<
    NonNullable<UseLongWorkspaceProposalsOptions["versionOriginForEvent"]>
  >(() => undefined);
  const received: string[] = [];
  const receivedOrigins = new Map<
    string,
    ReturnType<
      NonNullable<UseLongWorkspaceProposalsOptions["versionOriginForEvent"]>
    >
  >();
  const approve = vi.fn(async () => undefined);
  const factory = vi.fn(
    (
      options: UseLongWorkspaceProposalsOptions
    ): LongWorkspaceProposalController => {
      const queues = options.queues!;
      const itemsForBook: LongWorkspaceProposalController["itemsForBook"] = (
        bookId
      ) => (bookId ? (queues.value[bookId] ?? []) : []);
      return {
        queues,
        itemsForBook,
        activateBook: vi.fn(),
        discardBook: vi.fn((bookId) => {
          const next = { ...queues.value };
          delete next[bookId];
          queues.value = next;
        }),
        quarantineSession: vi.fn((bookId, sessionId) => {
          queues.value = {
            ...queues.value,
            [bookId]: itemsForBook(bookId).filter(
              (item) => item.event.payload.sessionId !== sessionId
            )
          };
        }),
        async handleEvent(value) {
          const event = value as LongWorkspaceProposalEvent;
          if (!options.acceptsEvent(event)) return false;
          received.push(event.id);
          receivedOrigins.set(event.id, options.versionOriginForEvent?.(event));
          queues.value = {
            ...queues.value,
            [event.payload.bookId]: [
              ...itemsForBook(event.payload.bookId),
              {
                event,
                status: "ready",
                approvalMode:
                  options.approvalModeForEvent?.(event) ?? "request-approval"
              }
            ]
          };
          return true;
        },
        enqueueManualMutation: vi.fn(async () => mutationEvent()),
        retryPreview: vi.fn(async () => undefined),
        approve,
        reject: vi.fn(() => false)
      };
    }
  );
  const controller = useLazyLongWorkspaceProposals(
    {
      api: () => undefined,
      acceptsEvent,
      approvalModeForEvent,
      versionOriginForEvent,
      notifications: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    },
    load
  );
  const finishLoading = () =>
    ready.resolve({ useLongWorkspaceProposals: factory });
  return {
    controller,
    load,
    factory,
    acceptsEvent,
    approvalModeForEvent,
    versionOriginForEvent,
    received,
    receivedOrigins,
    approve,
    finishLoading
  };
}

const bookId = "longbook_test";

describe("lazy long proposal processor", () => {
  it("keeps startup reads and unrelated or rejected events lightweight", async () => {
    const test = harness();
    expect(test.controller.itemsForBook(bookId)).toEqual([]);
    test.controller.activateBook(bookId);
    test.controller.discardBook(bookId);
    test.controller.activateBook(bookId);
    expect(await test.controller.handleEvent(chapterEvent())).toBe(false);
    test.acceptsEvent.mockReturnValue(false);
    expect(await test.controller.handleEvent(mutationEvent())).toBe(false);
    await test.controller.approve(bookId, "unknown");
    await test.controller.retryPreview(bookId, "unknown");
    expect(test.load).not.toHaveBeenCalled();
  });

  it("preserves accepted event order, approval mode and reactive queue identity while a run finishes during import", async () => {
    const test = harness();
    const queues = test.controller.queues;
    const count = computed(() => test.controller.itemsForBook(bookId).length);
    const origin = {
      sessionId: "session_test",
      runId: "run_test",
      summary: "同步来源"
    };
    test.approvalModeForEvent.mockReturnValue("auto-approve");
    test.versionOriginForEvent.mockReturnValue(origin);
    const first = test.controller.handleEvent(mutationEvent({ id: "first" }));
    const second = test.controller.handleEvent(mutationEvent({ id: "second" }));
    expect(test.load).toHaveBeenCalledTimes(1);
    expect(count.value).toBe(0);
    test.acceptsEvent.mockReturnValue(false);
    test.approvalModeForEvent.mockReturnValue("request-approval");
    test.versionOriginForEvent.mockReturnValue(undefined);
    test.finishLoading();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(test.received).toEqual(["first", "second"]);
    expect(test.receivedOrigins.get("first")).toEqual(origin);
    expect(test.receivedOrigins.get("second")).toEqual(origin);
    expect(test.controller.queues).toBe(queues);
    expect(count.value).toBe(2);
    expect(queues.value[bookId]?.map((item) => item.approvalMode)).toEqual([
      "auto-approve",
      "auto-approve"
    ]);
  });

  it("does not revive queued events after a book is discarded and reopened", async () => {
    const test = harness();
    const pending = test.controller.handleEvent(mutationEvent());
    test.controller.discardBook(bookId);
    test.controller.activateBook(bookId);
    test.finishLoading();
    expect(await pending).toBe(false);
    expect(test.received).toEqual([]);
    expect(
      await test.controller.handleEvent(mutationEvent({ id: "new-run" }))
    ).toBe(true);
  });

  it("quarantines sessions immediately while the processor is loading", async () => {
    const test = harness();
    const event = mutationEvent();
    const pending = test.controller.handleEvent(event);
    test.controller.quarantineSession(bookId, event.payload.sessionId);
    test.finishLoading();
    expect(await pending).toBe(false);
    expect(
      await test.controller.handleEvent(mutationEvent({ id: "late" }))
    ).toBe(false);
    expect(test.received).toEqual([]);
  });

  it("waits for queued event delivery before dispatching an approval", async () => {
    const test = harness();
    const event = mutationEvent();
    const pending = test.controller.handleEvent(event);
    const approval = test.controller.approve(bookId, event.id);
    expect(test.approve).not.toHaveBeenCalled();
    test.finishLoading();
    await Promise.all([pending, approval]);
    expect(test.received).toEqual([event.id]);
    expect(test.approve).toHaveBeenCalledWith(bookId, event.id);
  });

  it("retries a failed import without retaining the failed event", async () => {
    const test = harness();
    test.load.mockRejectedValueOnce(new Error("chunk unavailable"));
    await expect(
      test.controller.handleEvent(mutationEvent({ id: "failed" }))
    ).rejects.toThrow("chunk unavailable");
    const retry = test.controller.handleEvent(mutationEvent({ id: "retry" }));
    test.finishLoading();
    expect(await retry).toBe(true);
    expect(test.load).toHaveBeenCalledTimes(2);
    expect(test.received).toEqual(["retry"]);
  });

  it("cancels pending delivery on disposal and never constructs the processor", async () => {
    const test = harness();
    const pending = test.controller.handleEvent(mutationEvent());
    const approval = test.controller.approve(bookId, "pending");
    test.controller.dispose();
    test.finishLoading();
    expect(await pending).toBe(false);
    await approval;
    expect(test.factory).not.toHaveBeenCalled();
    expect(test.approve).not.toHaveBeenCalled();
  });

  it("loads manual mutations and retains their explicit book reactivation", async () => {
    const test = harness();
    const event = mutationEvent();
    test.controller.discardBook(bookId);
    const manual = test.controller.enqueueManualMutation({
      bookId,
      batch: event.payload.batch,
      summary: "Manual change"
    });
    test.finishLoading();
    expect((await manual).type).toBe("long.mutation_proposal");
    expect(await test.controller.handleEvent(event)).toBe(true);
  });

  it("cancels a manual mutation when its book is removed during loading", async () => {
    const test = harness();
    const event = mutationEvent();
    const manual = test.controller.enqueueManualMutation({
      bookId,
      batch: event.payload.batch,
      summary: "Manual change"
    });
    const rejected = expect(manual).rejects.toMatchObject({
      name: "AbortError"
    });
    test.controller.discardBook(bookId);
    test.controller.activateBook(bookId);
    test.finishLoading();
    await rejected;
    expect(test.controller.itemsForBook(bookId)).toEqual([]);
  });

  it("clears loaded queues on disposal and blocks later events", async () => {
    const test = harness();
    const pending = test.controller.handleEvent(mutationEvent());
    test.finishLoading();
    await pending;
    const count = computed(() => test.controller.itemsForBook(bookId).length);
    expect(count.value).toBe(1);
    test.controller.dispose();
    expect(count.value).toBe(0);
    expect(
      await test.controller.handleEvent(mutationEvent({ id: "late" }))
    ).toBe(false);
  });
});
