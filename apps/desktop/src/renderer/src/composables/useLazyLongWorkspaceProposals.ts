import { ref } from "vue";
import type { SystemEventEnvelope } from "@deepwrite/contracts";
import type {
  LongWorkspaceProposalController,
  LongWorkspaceProposalEvent,
  LongWorkspaceProposalItem,
  UseLongWorkspaceProposalsOptions
} from "./useLongWorkspaceProposals";

export type LongWorkspaceProposalsModule = Pick<
  typeof import("./useLongWorkspaceProposals"),
  "useLongWorkspaceProposals"
>;

const proposalTypes = {
  "long.mutation_proposal": true,
  "long.worldbuilding_file_proposal": true,
  "long.character_file_proposal": true,
  "long.continuity_file_proposal": true,
  "long.ledger_commit_proposal": true
} satisfies Record<LongWorkspaceProposalEvent["type"], true>;

function isProposalEvent(
  event: SystemEventEnvelope
): event is LongWorkspaceProposalEvent {
  return Object.hasOwn(proposalTypes, event.type);
}

/** Keep proposal identity and cancellation synchronous while loading its processor. */
export function useLazyLongWorkspaceProposals(
  options: UseLongWorkspaceProposalsOptions,
  loadModule: () => Promise<LongWorkspaceProposalsModule> = () =>
    import("./useLongWorkspaceProposals")
): LongWorkspaceProposalController & { dispose(): void } {
  const queues = ref<Record<string, LongWorkspaceProposalItem[]>>({});
  const discardedBooks = new Set<string>();
  const bookGenerations = new Map<string, number>();
  const quarantinedSessions = new Map<
    string,
    { bookId: string; sessionId: string }
  >();
  const acceptedEvents = new Map<
    LongWorkspaceProposalEvent,
    {
      approvalMode: ReturnType<
        NonNullable<typeof options.approvalModeForEvent>
      >;
      versionOrigin: ReturnType<
        NonNullable<typeof options.versionOriginForEvent>
      >;
    }
  >();
  let controller: LongWorkspaceProposalController | undefined;
  let loading: Promise<LongWorkspaceProposalController | undefined> | undefined;
  let disposed = false;

  const sessionKey = (bookId: string, sessionId: string) =>
    JSON.stringify([bookId, sessionId]);

  function load(): Promise<LongWorkspaceProposalController | undefined> {
    if (disposed) return Promise.resolve(undefined);
    if (controller) return Promise.resolve(controller);
    loading ??= loadModule()
      .then(({ useLongWorkspaceProposals }) => {
        if (disposed) return undefined;
        controller = useLongWorkspaceProposals({
          ...options,
          queues,
          acceptsEvent: (event) =>
            !disposed &&
            (acceptedEvents.has(event) || options.acceptsEvent(event)),
          approvalModeForEvent: (event) =>
            acceptedEvents.has(event)
              ? acceptedEvents.get(event)?.approvalMode
              : options.approvalModeForEvent?.(event),
          versionOriginForEvent: (event) =>
            acceptedEvents.has(event)
              ? acceptedEvents.get(event)?.versionOrigin
              : options.versionOriginForEvent?.(event)
        });
        for (const bookId of discardedBooks) controller.discardBook(bookId);
        for (const { bookId, sessionId } of quarantinedSessions.values()) {
          controller.quarantineSession(bookId, sessionId);
        }
        return controller;
      })
      .catch((error: unknown) => {
        loading = undefined;
        throw error;
      });
    return loading;
  }

  function itemsForBook(bookId: string | null | undefined) {
    return bookId ? (queues.value[bookId] ?? []) : [];
  }

  function activateBook(bookId: string): void {
    if (disposed) return;
    discardedBooks.delete(bookId);
    controller?.activateBook(bookId);
  }

  function discardBook(bookId: string): void {
    discardedBooks.add(bookId);
    bookGenerations.set(bookId, (bookGenerations.get(bookId) ?? 0) + 1);
    controller?.discardBook(bookId);
  }

  function quarantineSession(bookId: string, sessionId: string): void {
    const key = sessionKey(bookId, sessionId);
    quarantinedSessions.set(key, { bookId, sessionId });
    if (quarantinedSessions.size > 2_000) {
      const oldest = quarantinedSessions.keys().next().value;
      if (oldest !== undefined) quarantinedSessions.delete(oldest);
    }
    controller?.quarantineSession(bookId, sessionId);
  }

  async function handleEvent(event: SystemEventEnvelope): Promise<boolean> {
    if (!isProposalEvent(event) || disposed) return false;
    const { bookId, sessionId } = event.payload;
    const quarantined = () =>
      discardedBooks.has(bookId) ||
      quarantinedSessions.has(sessionKey(bookId, sessionId));
    if (quarantined() || !options.acceptsEvent(event)) return false;
    const generation = bookGenerations.get(bookId) ?? 0;
    // A run may finish while its first proposal chunk loads. Preserve its
    // already-authorized event and approval mode, without reviving removed books.
    acceptedEvents.set(event, {
      approvalMode: options.approvalModeForEvent?.(event),
      versionOrigin: options.versionOriginForEvent?.(event)
    });
    try {
      const loaded = await load();
      if (
        !loaded ||
        disposed ||
        quarantined() ||
        generation !== (bookGenerations.get(bookId) ?? 0)
      )
        return false;
      return await loaded.handleEvent(event);
    } finally {
      acceptedEvents.delete(event);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const bookId of Object.keys(queues.value)) discardBook(bookId);
    acceptedEvents.clear();
  }

  return {
    queues,
    itemsForBook,
    activateBook,
    discardBook,
    quarantineSession,
    handleEvent,
    async enqueueManualMutation(input) {
      const generation = bookGenerations.get(input.bookId) ?? 0;
      const loaded = await load();
      if (
        !loaded ||
        disposed ||
        generation !== (bookGenerations.get(input.bookId) ?? 0)
      )
        throw new DOMException("", "AbortError");
      activateBook(input.bookId);
      return loaded.enqueueManualMutation(input);
    },
    async retryPreview(bookId, eventId) {
      const loaded = controller ?? (loading && (await loading));
      if (!disposed) await loaded?.retryPreview(bookId, eventId);
    },
    async approve(bookId, eventId) {
      const loaded = controller ?? (loading && (await loading));
      if (!disposed) await loaded?.approve(bookId, eventId);
    },
    reject: (bookId, eventId) =>
      !disposed && (controller?.reject(bookId, eventId) ?? false),
    dispose
  };
}
