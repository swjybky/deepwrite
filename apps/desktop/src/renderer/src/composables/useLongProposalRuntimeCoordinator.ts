import { conversationVersionOrigin } from "./proposal-coordinator/version-origin";
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { longBookConversationKey } from "../utils/bookConversationKey";
import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRuntimeContext,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import { computed, nextTick, type Ref } from "vue";
import type {
  AgentConversationController,
  AgentRunSettings
} from "./useAgentConversation";
import type {
  LongWorkspaceProposalEvent,
  LongWorkspaceProposalItem
} from "./useLongWorkspaceProposals";
import { useLazyLongWorkspaceProposals } from "./useLazyLongWorkspaceProposals";
import {
  clipWriteApprovalTitle,
  registerWriteApprovalSource
} from "./agent-conversation/write-approval";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import type { ConversationDisposalOptions } from "./book-removal-runtime";

const t = createScopedTranslator("workspace.longProposalRuntimeCoordinator");

export interface LongProposalRuntimeNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface LongProposalRuntimeState {
  activeBookId: Ref<string | null>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  workspaceIndex: Ref<LongWorkspaceIndexSnapshot | null>;
  proposalApprovalPending: Ref<boolean>;
}

export interface LongProposalConversationRegistry {
  byKey: Map<string, AgentConversationController>;
  remove(key: string, options?: { clearPersistence?: boolean }): void;
  active(): AgentConversationController | null;
}

export interface LongProposalWorkspacePort {
  saveActiveEditorChanges(): Promise<boolean>;
  refreshActiveWorkspace(bookId: string): Promise<boolean>;
  refreshBookList(): Promise<void>;
}

export interface LongProposalRuntimeCoordinatorContext {
  state: LongProposalRuntimeState;
  api(): LongWorkspaceRendererApi | undefined;
  conversations: LongProposalConversationRegistry;
  workspace: LongProposalWorkspacePort;
  removeAgentRunPreferences(scope: string): void;
  navigateToAcceptedProposal(item: LongWorkspaceProposalItem): Promise<boolean>;
  notifications: LongProposalRuntimeNotifications;
}

/** Owns long-form proposal queues and their conversation/runtime association. */
export function useLongProposalRuntimeCoordinator(
  context: LongProposalRuntimeCoordinatorContext
) {
  const { state, notifications } = context;
  let disposed = false;

  const workspaceProposals = useLazyLongWorkspaceProposals({
    api: context.api,
    acceptsEvent: acceptsProposalEvent,
    approvalModeForEvent: proposalApprovalMode,
    versionOriginForEvent: (event) => {
      const conversation = conversationForProposalEvent(event);
      return conversation
        ? conversationVersionOrigin(
            conversation,
            event.payload.runId,
            event.payload.summary
          )
        : undefined;
    },
    prepareAutoApprove: prepareAutomaticProposal,
    onApplied: handleProposalApplied,
    notifications
  });
  // A paused user-review run also waits for this queue; a rejected item
  // leaves it, which the conversation reports as rejected.
  const unregisterWriteApprovalSource = registerWriteApprovalSource(
    (request) => {
      const toolCallIds = new Set(request.writeApproval.toolCallIds);
      return Object.values(workspaceProposals.queues.value)
        .flat()
        .filter(
          ({ event }) =>
            event.payload.sessionId === request.sessionId &&
            event.payload.runId === request.runId &&
            toolCallIds.has(event.payload.toolCallId)
        )
        .map((item) => ({
          key: `long:${item.event.id}`,
          state: item.status === "accepted" ? "saved" : "waiting",
          result: { title: clipWriteApprovalTitle(item.event.payload.summary) }
        }));
    }
  );
  const activeProposalItems = computed(() =>
    workspaceProposals.itemsForBook(state.activeBookId.value)
  );
  const activeConversationProposalItems = computed(() => {
    const sessionId = context.conversations.active()?.sessionId.value;
    return activeProposalItems.value.filter(
      (item) => item.event.payload.sessionId === sessionId
    );
  });

  function conversationKey(
    bookId: string,
    _activeRoot: LongWorkspaceRuntimeContext["activeRoot"],
    _chapterCardId?: string
  ): string {
    return longBookConversationKey(bookId);
  }

  function conversationForProposalEvent(
    event:
      | LongWorkspaceProposalEvent
      | Extract<SystemEventEnvelope, { type: "long.chapter_write_proposal" }>
  ): AgentConversationController | undefined {
    const prefix = `long:${encodeURIComponent(event.payload.bookId)}:`;
    for (const [key, conversation] of context.conversations.byKey) {
      if (
        key.startsWith(prefix) &&
        conversation.acceptsRunEvent(
          event.payload.sessionId,
          event.payload.runId
        )
      ) {
        return conversation;
      }
    }
    return undefined;
  }

  function acceptsProposalEvent(event: LongWorkspaceProposalEvent): boolean {
    return !disposed && conversationForProposalEvent(event) !== undefined;
  }

  function proposalApprovalMode(
    event: LongWorkspaceProposalEvent
  ): AgentRunSettings["approvalMode"] | undefined {
    return conversationForProposalEvent(event)?.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    );
  }

  async function refreshWorkspaceAfterProposal(
    bookId: string
  ): Promise<boolean> {
    if (disposed) return false;
    const refreshed = await context.workspace.refreshActiveWorkspace(bookId);
    await context.workspace.refreshBookList();
    return !disposed && refreshed;
  }

  async function handleProposalApplied(
    event: LongWorkspaceProposalEvent
  ): Promise<void> {
    await refreshWorkspaceAfterProposal(event.payload.bookId);
  }

  async function prepareAutomaticProposal(): Promise<void> {
    await nextTick();
    if (!(await context.workspace.saveActiveEditorChanges())) {
      throw new Error(t("currentNovelEditsAreUnsavedTheAgentProposalWas"));
    }
  }

  function bookConversationEntries(
    bookId: string
  ): Array<[string, AgentConversationController]> {
    const prefix = `long:${encodeURIComponent(bookId)}:`;
    return [...context.conversations.byKey.entries()].filter(([key]) =>
      key.startsWith(prefix)
    );
  }

  async function stopBookAgentRuns(bookId: string): Promise<void> {
    const entries = bookConversationEntries(bookId);
    for (const [, conversation] of entries) {
      const sessionId = conversation.sessionId.value;
      if (sessionId) {
        workspaceProposals.quarantineSession(bookId, sessionId);
      }
    }
    for (const [, conversation] of entries) {
      if (!conversation.isBusy.value) continue;
      const stopAccepted = await conversation.stopGeneration();
      if (!stopAccepted) {
        throw new Error(t("theNovelAgentIsStartingTheProjectCannotBe"));
      }
    }
    workspaceProposals.discardBook(bookId);
  }

  function disposeBookConversations(
    bookId: string,
    options: ConversationDisposalOptions
  ): void {
    for (const [key] of bookConversationEntries(bookId)) {
      context.conversations.remove(key, options);
    }
  }

  function disposeBookProposalState(bookId: string): void {
    workspaceProposals.discardBook(bookId);
    context.removeAgentRunPreferences(`long:${bookId}`);
  }

  function disposeBookRuntime(
    bookId: string,
    options: ConversationDisposalOptions
  ): void {
    disposeBookConversations(bookId, options);
    disposeBookProposalState(bookId);
  }

  async function stopActiveGeneration(): Promise<void> {
    const conversation = context.conversations.active();
    if (!conversation) return;
    try {
      if (await conversation.stopGeneration()) {
        notifications.info(t("novelGenerationStopped"));
      }
    } catch (error: unknown) {
      notifications.error(
        formatError(
          error,
          t("failedToStopNovelGenerationPleaseTryAgainShortly")
        )
      );
    }
  }

  async function approveProposal(eventId: string): Promise<void> {
    const bookId = state.activeBookId.value;
    if (!bookId || state.proposalApprovalPending.value) return;
    const item = workspaceProposals
      .itemsForBook(bookId)
      .find(({ event }) => event.id === eventId);
    if (!item) return;
    state.proposalApprovalPending.value = true;
    try {
      await nextTick();
      if (!(await context.workspace.saveActiveEditorChanges())) return;
      if (state.activeBookId.value !== bookId) {
        notifications.info(t("theActiveNovelChangedApprovalWasCanceled"));
        return;
      }
      if (
        !workspaceProposals
          .itemsForBook(bookId)
          .some(({ event }) => event.id === eventId)
      ) {
        return;
      }
      await workspaceProposals.approve(bookId, eventId);
    } finally {
      state.proposalApprovalPending.value = false;
    }
  }

  function rejectProposal(eventId: string): void {
    const bookId = state.activeBookId.value;
    if (!bookId) return;
    if (workspaceProposals.reject(bookId, eventId)) {
      notifications.info(t("novelProposalRejectedNoFilesWereWritten"));
    }
  }

  function retryProposalPreview(eventId: string): void {
    const bookId = state.activeBookId.value;
    if (!bookId) return;
    void workspaceProposals.retryPreview(bookId, eventId);
  }

  async function locateAcceptedProposal(eventId: string): Promise<void> {
    const bookId = state.activeBookId.value;
    if (!bookId) return;
    const item = workspaceProposals
      .itemsForBook(bookId)
      .find(({ event }) => event.id === eventId);
    if (!item || item.status !== "accepted") return;
    if (!(await context.navigateToAcceptedProposal(item))) {
      notifications.warning(t("theTargetFileOrItemNoLongerExistsAnd"));
    }
  }

  function dispose(): void {
    disposed = true;
    unregisterWriteApprovalSource();
    workspaceProposals.dispose();
  }

  return {
    workspaceProposals,
    activeProposalItems,
    activeConversationProposalItems,
    conversationKey,
    conversationForProposalEvent,
    refreshWorkspaceAfterProposal,
    stopBookAgentRuns,
    disposeBookProposalState,
    disposeBookConversations,
    disposeBookRuntime,
    stopActiveGeneration,
    approveProposal,
    rejectProposal,
    retryProposalPreview,
    locateAcceptedProposal,
    dispose
  };
}
