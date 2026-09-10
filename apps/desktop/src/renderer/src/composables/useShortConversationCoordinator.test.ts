import type {
  CatalogIndexSnapshot,
  LibraryAgentSettings,
  WorkspaceAgentSettings
} from "@deepwrite/contracts";
import { computed, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "./useAgentConversation";
import {
  useShortConversationCoordinator,
  type ShortConversationCoordinatorOptions
} from "./useShortConversationCoordinator";
import type { ChatMessage } from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function workspaceDocument(
  patch: Partial<WorkspaceDocument> = {}
): WorkspaceDocument {
  return {
    id: "document-one",
    domain: "creation",
    title: "正文",
    eyebrow: "短篇",
    path: ["作品", "正文"],
    content: "正文内容",
    workspaceType: "short",
    workspaceId: "book-one",
    workspaceTitle: "作品",
    stageId: "draft",
    shortAgentId: "short",
    ...patch
  };
}

function controllerFixture() {
  const sessionId = ref("session-one");
  const draft = ref("请继续写");
  const isBusy = ref(false);
  const canRewriteHistory = ref(true);
  const messages = ref<ChatMessage[]>([
    {
      id: "user-history-one",
      role: "user",
      content: "历史问题",
      createdAt: "2026-08-25T08:00:00.000Z",
      status: "completed"
    }
  ]);
  const conversationError = ref<string | null>(null);
  const webSearchEnabled = ref(false);
  const sendMessage = vi.fn(async () => undefined);
  const resendMessage = vi.fn(async (request: { messageId: string }) => {
    const index = messages.value.findIndex(
      (message) => message.id === request.messageId
    );
    if (index < 0) return false;
    messages.value.splice(index);
    return true;
  });
  const newConversation = vi.fn(() => {
    sessionId.value = "session-new";
    draft.value = "";
  });
  const selectConversation = vi.fn((nextSessionId: string) => {
    if (isBusy.value) return false;
    sessionId.value = nextSessionId;
    return true;
  });
  const stopGeneration = vi.fn(async () => true);
  const controller = {
    sessionId,
    draft,
    messages,
    isBusy,
    canRewriteHistory,
    conversationError,
    webSearchEnabled,
    sendMessage,
    resendMessage,
    newConversation,
    selectConversation,
    stopGeneration,
    useSuggestion: vi.fn((value: string) => {
      draft.value = value;
    }),
    selectModel: vi.fn(),
    selectThinkingLevel: vi.fn(),
    selectWebSearchEnabled: vi.fn((enabled: boolean) => {
      webSearchEnabled.value = enabled;
    }),
    selectTemperature: vi.fn(),
    selectApprovalMode: vi.fn()
  } as unknown as AgentConversationController;
  return {
    controller,
    conversationError,
    canRewriteHistory,
    draft,
    isBusy,
    newConversation,
    messages,
    resendMessage,
    selectConversation,
    sendMessage,
    sessionId,
    stopGeneration
  };
}

function createHarness(
  overrides: Partial<ShortConversationCoordinatorOptions> = {}
) {
  const conversation = controllerFixture();
  const selectedResourceId = ref("document-one");
  const activeCreationResourceId = ref("document-one");
  const activeDocument = shallowRef(workspaceDocument());
  const activeAgentDocument = computed(() => activeDocument.value);
  const activePromptDocument = computed(() => activeDocument.value);
  const liveWorkspaceDocuments = computed(() => [activeDocument.value]);
  const catalogDocuments = shallowRef([workspaceDocument()]);
  const ensureDocumentsLoaded = vi.fn(async () => true);
  const hydratedCatalogSnapshot = vi.fn(() => null);
  const notifications = {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  };
  const schedule = vi.fn();
  const showConversation = vi.fn();
  const clearEditorSelectionReferences = vi.fn();
  const options: ShortConversationCoordinatorOptions = {
    runtime: {
      conversationForKey: vi.fn(() => conversation.controller),
      synchronizeSessionModelSelection: vi.fn(),
      synchronizeRunPreferences: vi.fn()
    },
    resource: {
      selectedResourceId,
      activeCreationResourceId,
      activeAgentDocument,
      activePromptDocument,
      liveWorkspaceDocuments,
      pendingEditorReferences: ref([]),
      leftCollapsed: ref(false),
      rightCollapsed: ref(false),
      clearEditorSelectionReferences,
      contextDocuments: vi.fn(() => catalogDocuments.value),
      ensureDocumentsLoaded,
      hydratedCatalogSnapshot
    },
    catalog: {
      snapshot: shallowRef<CatalogIndexSnapshot | null>(null),
      findBook: vi.fn(() => undefined)
    },
    profiles: {
      workspaceAgents: shallowRef([] as WorkspaceAgentSettings[]),
      libraryAgents: shallowRef({
        agents: []
      } as unknown as LibraryAgentSettings)
    },
    edits: {
      acceptingDocumentIds: ref(new Set<string>()),
      acceptingWorkspaceIds: ref(new Set<string>()),
      hasQueued: vi.fn(() => false),
      schedule,
      resumeRecovered: vi.fn()
    },
    settings: {
      permissionMode: () => "request-approval",
      updatePermissionMode: vi.fn()
    },
    runtimeAvailable: () => true,
    showConversation,
    notifications,
    ...overrides
  };
  const coordinator = useShortConversationCoordinator(options);
  return {
    activeCreationResourceId,
    activeDocument,
    clearEditorSelectionReferences,
    conversation,
    coordinator,
    ensureDocumentsLoaded,
    hydratedCatalogSnapshot,
    notifications,
    options,
    schedule,
    selectedResourceId,
    showConversation
  };
}

describe("useShortConversationCoordinator", () => {
  it("hydrates writing and skill documents without loading linked material bodies before a writing run", async () => {
    const test = createHarness();
    const material = workspaceDocument({
      id: "material-entry",
      domain: "material"
    });
    const skill = workspaceDocument({ id: "skill-entry", domain: "skill" });
    vi.mocked(test.options.resource.contextDocuments).mockReturnValue([
      test.activeDocument.value,
      material,
      skill
    ]);
    await test.coordinator.sendMessage();
    expect(test.ensureDocumentsLoaded).toHaveBeenCalledWith([
      test.activeDocument.value,
      skill
    ]);
    expect(test.conversation.sendMessage).toHaveBeenCalledOnce();
  });
  it("keeps full Catalog context construction on the send cold path", async () => {
    const test = createHarness();

    expect(test.coordinator.conversationContext.value.contextTitle).toBe(
      "正文"
    );
    expect(test.hydratedCatalogSnapshot).not.toHaveBeenCalled();

    await test.coordinator.sendMessage();

    expect(test.hydratedCatalogSnapshot).toHaveBeenCalledOnce();
    expect(test.conversation.sendMessage).toHaveBeenCalledOnce();
  });

  it("rejects a second send while the first preflight is pending", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.ensureDocumentsLoaded.mockImplementation(() => gate.promise);

    const first = test.coordinator.sendMessage();
    await test.coordinator.sendMessage();

    expect(test.ensureDocumentsLoaded).toHaveBeenCalledOnce();
    expect(test.notifications.info).toHaveBeenCalledWith(
      "正在准备上一条消息，请稍候。"
    );
    gate.resolve(true);
    await first;
    expect(test.conversation.sendMessage).toHaveBeenCalledOnce();
  });

  it("reuses the current workspace preflight when resending an edited history question", async () => {
    const test = createHarness();
    test.conversation.draft.value = "保留主输入草稿";

    expect(test.coordinator.conversationContext.value.canRewriteHistory).toBe(
      true
    );
    const result = await test.coordinator.resendMessage({
      messageId: "user-history-one",
      content: "修改后的历史问题"
    });

    expect(result).toBe(true);
    expect(test.ensureDocumentsLoaded).toHaveBeenCalledOnce();
    expect(test.hydratedCatalogSnapshot).toHaveBeenCalledOnce();
    expect(test.conversation.resendMessage).toHaveBeenCalledWith(
      {
        messageId: "user-history-one",
        content: "修改后的历史问题"
      },
      test.activeDocument.value,
      [test.activeDocument.value],
      {}
    );
    expect(test.conversation.sendMessage).not.toHaveBeenCalled();
    expect(test.conversation.draft.value).toBe("保留主输入草稿");
    expect(test.schedule).toHaveBeenCalledOnce();
  });

  it("keeps the editor branch when rewrite preflight fails or saves are queued", async () => {
    const preflightFailure = createHarness();
    preflightFailure.ensureDocumentsLoaded.mockResolvedValue(false);

    await expect(
      preflightFailure.coordinator.resendMessage({
        messageId: "user-history-one",
        content: "预检失败"
      })
    ).resolves.toBe(false);
    expect(preflightFailure.conversation.resendMessage).not.toHaveBeenCalled();
    expect(
      preflightFailure.conversation.messages.value.map((message) => message.id)
    ).toContain("user-history-one");

    const queuedSave = createHarness();
    vi.mocked(queuedSave.options.edits.hasQueued).mockReturnValue(true);
    await expect(
      queuedSave.coordinator.resendMessage({
        messageId: "user-history-one",
        content: "保存队列结束后再发送"
      })
    ).resolves.toBe(false);
    expect(queuedSave.ensureDocumentsLoaded).not.toHaveBeenCalled();
    expect(queuedSave.notifications.info).toHaveBeenCalledWith(
      "请先等待当前回复、审批和修改保存全部完成。"
    );
  });

  it("cancels the captured target when the resource changes during preflight", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.ensureDocumentsLoaded.mockImplementation(() => gate.promise);

    const sending = test.coordinator.sendMessage();
    test.selectedResourceId.value = "document-two";
    gate.resolve(true);
    await sending;

    expect(test.conversation.sendMessage).not.toHaveBeenCalled();
    expect(test.notifications.info).toHaveBeenCalledWith(
      "当前资源、会话或输入内容已切换，本次发送已取消。"
    );
  });

  it("cancels the captured target when the session or draft changes", async () => {
    const sessionGate = deferred<boolean>();
    const sessionTest = createHarness();
    sessionTest.ensureDocumentsLoaded.mockImplementation(
      () => sessionGate.promise
    );
    const sessionSend = sessionTest.coordinator.sendMessage();
    sessionTest.conversation.sessionId.value = "session-two";
    sessionGate.resolve(true);
    await sessionSend;
    expect(sessionTest.conversation.sendMessage).not.toHaveBeenCalled();

    const draftGate = deferred<boolean>();
    const draftTest = createHarness();
    draftTest.ensureDocumentsLoaded.mockImplementation(() => draftGate.promise);
    const draftSend = draftTest.coordinator.sendMessage();
    draftTest.conversation.draft.value = "新的输入";
    draftGate.resolve(true);
    await draftSend;
    expect(draftTest.conversation.sendMessage).not.toHaveBeenCalled();
  });

  it("invalidates a pending send before selecting another conversation", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.ensureDocumentsLoaded.mockImplementation(() => gate.promise);
    const sending = test.coordinator.sendMessage();

    test.coordinator.selectConversation("session-two");
    gate.resolve(true);
    await sending;

    expect(test.conversation.selectConversation).toHaveBeenCalledWith(
      "session-two"
    );
    expect(test.conversation.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks a new short conversation while the controller is busy", () => {
    const test = createHarness();
    test.conversation.isBusy.value = true;

    test.coordinator.newConversation();

    expect(test.conversation.newConversation).not.toHaveBeenCalled();
    expect(test.notifications.warning).toHaveBeenCalledWith(
      "请先停止当前回复，再新建对话。"
    );
    expect(test.showConversation).not.toHaveBeenCalled();
  });

  it("disposal invalidates and drains an active preflight without publishing", async () => {
    const gate = deferred<boolean>();
    const test = createHarness();
    test.ensureDocumentsLoaded.mockImplementation(() => gate.promise);
    const sending = test.coordinator.sendMessage();
    const disposing = test.coordinator.dispose();

    gate.resolve(true);
    await Promise.all([sending, disposing]);

    expect(test.conversation.sendMessage).not.toHaveBeenCalled();
    expect(test.notifications.info).not.toHaveBeenCalledWith(
      "当前资源、会话或输入内容已切换，本次发送已取消。"
    );
  });

  it("stops only the captured busy controller before draining disposal", async () => {
    const gate = deferred<void>();
    const test = createHarness();
    const otherConversation = controllerFixture();
    vi.mocked(test.options.runtime.conversationForKey).mockImplementation(
      (key) =>
        key.includes("document-two")
          ? otherConversation.controller
          : test.conversation.controller
    );
    test.conversation.sendMessage.mockImplementation(async () => {
      test.conversation.isBusy.value = true;
      await gate.promise;
      test.conversation.isBusy.value = false;
    });
    test.conversation.stopGeneration.mockImplementation(async () => {
      test.conversation.isBusy.value = false;
      gate.resolve();
      return true;
    });

    const sending = test.coordinator.sendMessage();
    await vi.waitFor(() =>
      expect(test.conversation.sendMessage).toHaveBeenCalledOnce()
    );
    test.activeDocument.value = workspaceDocument({ id: "document-two" });
    test.selectedResourceId.value = "document-two";
    test.activeCreationResourceId.value = "document-two";

    await test.coordinator.dispose();
    await sending;

    expect(test.conversation.stopGeneration).toHaveBeenCalledOnce();
    expect(otherConversation.stopGeneration).not.toHaveBeenCalled();
    expect(test.coordinator.sendPreflightPending.value).toBe(false);
  });

  it("persists a composer web-search toggle through the session model selection", () => {
    const test = createHarness();
    test.conversation.controller.webSearchEnabled.value = true;
    expect(
      test.options.runtime.synchronizeSessionModelSelection
    ).toHaveBeenCalledWith(test.conversation.controller);
  });
});
