import { storeToRefs } from "pinia";
import { computed, nextTick, onScopeDispose, ref, type Ref } from "vue";
import type {
  CreateMysteryBookInput,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import type { BookAgentTeamChoice } from "../components/WorkspaceDialogLayer.types";
import type { ExternalControlBridgePorts } from "../extras/external-control/useExternalControlBridge";
import { externalTeamAvailable } from "../extras/external-control/team-availability";
import { formatError } from "../i18n/errors";
import type { useSettingsStore } from "../stores/settingsStore";
import {
  mysteryBookResourceId,
  mysteryDocumentResourceId,
  mysteryConversationKey,
  useMysteryWorkspaceStore
} from "../stores/mysteryWorkspaceStore";
import { mysteryWorkspaceNavigation } from "../stores/mysteryWorkspaceNavigation";
import {
  clipWriteApprovalTitle,
  registerWriteApprovalSource
} from "./agent-conversation/write-approval";
import type { AgentConversationController } from "./useAgentConversation";

export interface MysteryShellBridgeOptions {
  createBookDialogOpen: Ref<boolean>;
  selectedResourceId: Ref<string>;
  deactivateLongBook?: () => void;
  saveLongEditor?: () => Promise<boolean>;
  showConversation(): void;
  fallbackResourceId(): string;
  conversationForKey(key: string, scope: string): AgentConversationController;
  findConversation(key: string): AgentConversationController | undefined;
  loadLongBooks(options?: { notify?: boolean }): Promise<unknown>;
  notifications: {
    error(message: string): void;
  };
}

export function useMysteryShellBridge(options: MysteryShellBridgeOptions) {
  const store = useMysteryWorkspaceStore();
  const {
    books,
    diagnostics,
    activeBookId,
    activeBook,
    activeWorkspaceIndex,
    selectedTarget,
    openLoading
  } = storeToRefs(store);
  const selectedDocumentId = computed(() =>
    activeBookId.value
      ? mysteryDocumentResourceId(activeBookId.value, selectedTarget.value)
      : null
  );
  const mutationPending = ref(false);
  onScopeDispose(
    registerWriteApprovalSource((request) => {
      const toolCallIds = new Set(request.writeApproval.toolCallIds);
      return Object.values(store.proposalsByBookId)
        .flat()
        .filter(
          (item) =>
            item.sessionId === request.sessionId &&
            item.runId === request.runId &&
            toolCallIds.has(item.toolCallId)
        )
        .map((item) => ({
          key: `mystery:${item.id}`,
          state:
            item.status === "accepted"
              ? "saved"
              : item.status === "rejected"
                ? "rejected"
                : "waiting",
          result: {
            title: clipWriteApprovalTitle(item.summary),
            toolCallIds: [item.toolCallId]
          }
        }));
    })
  );

  const activeConversation = computed<AgentConversationController | null>(() =>
    activeBookId.value
      ? options.conversationForKey(
          mysteryConversationKey(activeBookId.value),
          "mystery"
        )
      : null
  );

  const sendReady = computed(() =>
    Boolean(
      activeBook.value &&
      activeWorkspaceIndex.value &&
      !openLoading.value &&
      mysteryWorkspaceNavigation.value?.bookId() === activeBook.value.id &&
      !mysteryWorkspaceNavigation.value.busy()
    )
  );

  async function createMysteryBook(
    input: CreateMysteryBookInput & BookAgentTeamChoice
  ): Promise<void> {
    if (mutationPending.value) return;
    const { linkedAgentTeamIds, ...bookInput } = input;
    mutationPending.value = true;
    try {
      if (
        mysteryWorkspaceNavigation.value &&
        !(await mysteryWorkspaceNavigation.value.save())
      )
        return;
      if (options.saveLongEditor && !(await options.saveLongEditor())) return;
      const summary = await store.createBook(bookInput, linkedAgentTeamIds);
      if (!summary) return;
      options.deactivateLongBook?.();
      options.createBookDialogOpen.value = false;
      if (options.selectedResourceId.value !== selectedDocumentId.value)
        options.selectedResourceId.value = mysteryBookResourceId(summary.id);
      options.showConversation();
    } catch (error: unknown) {
      options.notifications.error(formatError(error, "Create mystery failed"));
    } finally {
      mutationPending.value = false;
    }
  }

  function onMysteryBookRemoved(): void {
    store.deactivateBook();
    options.selectedResourceId.value = options.fallbackResourceId();
    options.showConversation();
  }

  function loadAllBooks(notify = false): Promise<unknown> {
    return Promise.all([
      options.loadLongBooks(notify ? undefined : { notify: false }),
      store.loadBooks()
    ]);
  }

  function newMysteryConversation(): void {
    activeConversation.value?.newConversation();
  }

  async function handleMysteryProposalEvent(
    event: Extract<SystemEventEnvelope, { type: "mystery.mutation_proposal" }>
  ): Promise<void> {
    const { bookId, sessionId, runId } = event.payload;
    const conversation = options.findConversation(
      mysteryConversationKey(bookId)
    );
    if (!conversation) return;
    const approvalMode = conversation.approvalModeForRun(sessionId, runId);
    if (!approvalMode && !conversation.acceptsRunEvent(sessionId, runId))
      return;
    await store.handleProposalEvent(
      event.payload,
      approvalMode === "auto-approve"
    );
  }

  async function sendExternalMysteryMessage(): Promise<void> {
    const port = mysteryWorkspaceNavigation.value;
    if (port && port.bookId() === activeBookId.value) await port.send();
  }

  function externalControlPorts(ports: {
    open: ExternalControlBridgePorts["open"];
    settingsStore: ReturnType<typeof useSettingsStore>;
    isLong: () => boolean;
    isMystery: () => boolean;
    activeLongConversation: () => AgentConversationController | null;
    activeShortConversation: () => AgentConversationController;
    activeLongAgentId: () => string | undefined;
    longContextReady: () => boolean;
    sendLong: () => Promise<void>;
    sendShort: () => Promise<void>;
    conversationsRestored: ExternalControlBridgePorts["conversationsRestored"];
    longEditorHasUnsavedChanges: ExternalControlBridgePorts["longEditorHasUnsavedChanges"];
  }): ExternalControlBridgePorts {
    return {
      api: () => window.deepwrite,
      open: ports.open,
      conversation: () =>
        ports.isLong()
          ? ports.activeLongConversation()
          : ports.isMystery()
            ? activeConversation.value
            : ports.activeShortConversation(),
      conversationsRestored: ports.conversationsRestored,
      teamAvailable: (target) =>
        externalTeamAvailable(
          ports.settingsStore,
          target,
          ports.activeLongAgentId()
        ),
      sendReady: () =>
        ports.isLong()
          ? ports.longContextReady()
          : ports.isMystery()
            ? sendReady.value
            : true,
      send: () =>
        ports.isLong()
          ? ports.sendLong()
          : ports.isMystery()
            ? sendExternalMysteryMessage()
            : ports.sendShort(),
      longEditorHasUnsavedChanges: ports.longEditorHasUnsavedChanges
    };
  }

  const saveActiveEditorBeforeLeaving = () =>
    mysteryWorkspaceNavigation.value?.save() ?? Promise.resolve(true);

  return {
    books,
    saveEditorsBeforeLeaving: async () =>
      (await saveActiveEditorBeforeLeaving()) &&
      ((await options.saveLongEditor?.()) ?? true),
    diagnostics,
    activeBookId,
    activeBook,
    activeWorkspaceIndex,
    openLoading,
    mutationPending,
    activeConversation,
    sendReady,
    externalControlPorts,
    treePorts: {
      mysteryBooks: books,
      mysteryDiagnostics: diagnostics,
      activeMysteryBookId: activeBookId,
      activeMysteryWorkspaceIndex: activeWorkspaceIndex,
      selectedMysteryDocumentId: selectedDocumentId
    },
    navigationPort: {
      activeBookId,
      openBook: (bookId: string, current: () => boolean) =>
        store.openBook(bookId, current),
      async selectTarget(
        target: import("@deepwrite/contracts").MysteryDocumentTarget
      ) {
        await nextTick();
        const port = mysteryWorkspaceNavigation.value;
        return port?.bookId() === activeBookId.value
          ? port.selectTarget(target)
          : false;
      },
      saveActiveEditorBeforeLeaving,
      deactivateActiveBook: () => store.deactivateBook()
    },
    featureHostActions: {
      newMysteryConversation,
      resolveConversation: options.conversationForKey,
      onMysteryBookRemoved
    },
    loadBooks: () => store.loadBooks(),
    loadAllBooks,
    openBook: (bookId: string) => store.openBook(bookId),
    deactivateBook: () => store.deactivateBook(),
    createMysteryBook,
    onMysteryBookRemoved,
    newMysteryConversation,
    handleMysteryProposalEvent,
    sendExternalMysteryMessage
  };
}
