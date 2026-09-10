import type { ModelSettings, ThinkingLevel } from "@deepwrite/contracts";
import { ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentConversationController,
  AgentRunSettings
} from "./useAgentConversation";
import {
  useConversationRuntimeRegistryCoordinator,
  type ConversationControllerPersistenceHooks,
  type ConversationRuntimeRegistryCoordinatorOptions,
  type ConversationRuntimeRegistryStorePort
} from "./useConversationRuntimeRegistryCoordinator";
import {
  RUN_PREFERENCES_PERSISTENCE_KEY,
  type ConversationPersistenceAdapter,
  type ConversationPersistenceOptions
} from "../stores/conversationStore";
import type {
  AgentModelSelection,
  AgentRunPreferences,
  AgentRunPreferencesByScope
} from "../utils/agentRunPreferences";
import { conversationHistoryPersistenceKey } from "../utils/conversationPersistence";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function modelSettings(): ModelSettings {
  return {
    defaultModelId: "model-default",
    models: [
      {
        id: "model-default",
        defaultThinkingLevel: "medium",
        temperatureOptions: [0.2, 0.7]
      }
    ]
  } as unknown as ModelSettings;
}

function controllerFixture(name: string) {
  const selectedModelId = ref(`${name}-model`);
  const thinkingLevel = ref<ThinkingLevel>("low");
  const temperature = ref(0.7);
  const approvalMode = ref<"request-approval" | "auto-approve">(
    "request-approval"
  );
  const agentTeamMode = ref<"normal" | "team">("normal");
  const webSearchEnabled = ref(false);
  const applyRunSettings = vi.fn((settings: AgentRunSettings) => {
    selectedModelId.value = settings.selectedModelId;
    thinkingLevel.value = settings.thinkingLevel;
    temperature.value = settings.temperature;
    approvalMode.value = settings.approvalMode;
    agentTeamMode.value = settings.agentTeamMode ?? "normal";
    webSearchEnabled.value = settings.webSearchEnabled === true;
  });
  const applyModelSettings = vi.fn((settings: ModelSettings) => {
    const selected =
      settings.models.find(({ id }) => id === settings.defaultModelId) ??
      settings.models[0];
    selectedModelId.value = selected?.id ?? "";
    thinkingLevel.value = selected?.defaultThinkingLevel ?? "medium";
  });
  const selectApprovalMode = vi.fn(
    (mode: "request-approval" | "auto-approve") => {
      approvalMode.value = mode;
    }
  );
  const selectAgentTeamMode = vi.fn((mode: "normal" | "team") => {
    agentTeamMode.value = mode;
  });
  const capturePersistenceSnapshot = vi.fn(() => ({ name }));
  const restorePersistenceSnapshot = vi.fn(async () => true);
  const holdPersistenceEmits = vi.fn();
  const releasePersistenceEmits = vi.fn();
  const controller = {
    selectedModelId,
    thinkingLevel,
    temperature,
    approvalMode,
    agentTeamMode,
    webSearchEnabled,
    applyRunSettings,
    applyModelSettings,
    selectAgentTeamMode,
    selectApprovalMode,
    capturePersistenceSnapshot,
    restorePersistenceSnapshot,
    holdPersistenceEmits,
    releasePersistenceEmits,
    dispose: vi.fn()
  } as unknown as AgentConversationController;
  return {
    applyModelSettings,
    applyRunSettings,
    agentTeamMode,
    approvalMode,
    capturePersistenceSnapshot,
    controller,
    holdPersistenceEmits,
    releasePersistenceEmits,
    restorePersistenceSnapshot,
    selectAgentTeamMode,
    selectApprovalMode,
    selectedModelId,
    temperature,
    thinkingLevel
  };
}

function createHarness(
  input: { persistence?: boolean; prepareHistory?: () => Promise<void> } = {}
) {
  const controllers = new Map<string, AgentConversationController>();
  const scopes = new Map<string, string>();
  const sessionAgentModelSelection = shallowRef<AgentModelSelection>();
  const agentRunPreferences = shallowRef<AgentRunPreferencesByScope>({});
  const configurePersistenceAdapter = vi.fn();
  const schedulePersistence = vi.fn();
  const schedulePersistenceFactory = vi.fn();
  const loadPersistence = vi.fn(
    async (_key: string, _options?: { force?: boolean }) => undefined as unknown
  );
  const removePersistence = vi.fn(async () => undefined);
  const hydratePreferences = vi.fn(async () => undefined);
  const registerController = vi.fn(
    (key: string, scope: string, controller: AgentConversationController) => {
      controllers.set(key, controller);
      scopes.set(key, scope);
      return controller;
    }
  );
  const setControllerScope = vi.fn((key: string, scope: string) => {
    if (!controllers.has(key)) return false;
    scopes.set(key, scope);
    return true;
  });
  const setSessionAgentModelSelection = vi.fn(
    (
      selection: AgentModelSelection | undefined,
      options: {
        source?: AgentConversationController;
        persist?: boolean;
      } = {}
    ) => {
      sessionAgentModelSelection.value = selection
        ? { ...selection }
        : undefined;
      if (!selection) return;
      for (const controller of controllers.values()) {
        if (controller === options.source) continue;
        controller.applyRunSettings({
          selectedModelId: selection.selectedModelId,
          thinkingLevel: selection.thinkingLevel,
          temperature: controller.temperature.value,
          approvalMode: controller.approvalMode.value,
          agentTeamMode: controller.agentTeamMode.value
        });
      }
    }
  );
  const setAgentRunPreferences = vi.fn(
    (
      scope: string,
      preferences: AgentRunPreferences,
      options: {
        source?: AgentConversationController;
        persist?: boolean;
      } = {}
    ) => {
      agentRunPreferences.value = {
        ...agentRunPreferences.value,
        [scope]: { ...preferences }
      };
      for (const [key, controller] of controllers) {
        if (scopes.get(key) !== scope || controller === options.source)
          continue;
        controller.applyRunSettings({
          selectedModelId: controller.selectedModelId.value,
          thinkingLevel: controller.thinkingLevel.value,
          temperature: preferences.temperature,
          approvalMode: preferences.approvalMode,
          agentTeamMode:
            preferences.agentTeamMode ?? controller.agentTeamMode.value
        });
      }
    }
  );
  const removeAgentRunPreferences = vi.fn((scope: string) => {
    if (!(scope in agentRunPreferences.value)) return false;
    const next = { ...agentRunPreferences.value };
    delete next[scope];
    agentRunPreferences.value = next;
    return true;
  });
  const store: ConversationRuntimeRegistryStorePort = {
    sessionAgentModelSelection,
    agentRunPreferences,
    configurePersistenceAdapter,
    registerController,
    controllerForKey: (key) => controllers.get(key),
    scopeForKey: (key) => scopes.get(key),
    setControllerScope,
    listControllers: () => [...controllers.values()],
    controllerEntries: () => controllers.entries(),
    setSessionAgentModelSelection,
    setAgentRunPreferences,
    removeAgentRunPreferences,
    schedulePersistence,
    schedulePersistenceFactory,
    async loadPersistence<Value>(
      key: string,
      options?: { force?: boolean }
    ): Promise<Value | undefined> {
      return (await loadPersistence(key, options)) as Value | undefined;
    },
    removePersistence,
    hydratePreferences
  };
  const persistenceAdapter: ConversationPersistenceAdapter | null =
    input.persistence
      ? {
          ...(input.prepareHistory
            ? { prepareHistory: input.prepareHistory }
            : {}),
          load: vi.fn(async () => undefined),
          save: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined)
        }
      : null;
  const createdControllers: ReturnType<typeof controllerFixture>[] = [];
  const hooks = new Map<
    AgentConversationController,
    ConversationControllerPersistenceHooks
  >();
  const createController = vi.fn(
    (persistenceHooks: ConversationControllerPersistenceHooks) => {
      const fixture = controllerFixture(
        `controller-${createdControllers.length + 1}`
      );
      createdControllers.push(fixture);
      hooks.set(fixture.controller, persistenceHooks);
      return fixture.controller;
    }
  );
  const modelSettingsRef = shallowRef<ModelSettings | null>(null);
  const permissionMode = vi.fn(() => "request-approval" as const);
  const resumeRecovered = vi.fn();
  const notifications = { warning: vi.fn() };
  const options: ConversationRuntimeRegistryCoordinatorOptions = {
    store,
    persistenceAdapter,
    modelSettings: modelSettingsRef,
    permissionMode,
    createController,
    resumeRecovered,
    notifications
  };
  const coordinator = useConversationRuntimeRegistryCoordinator(options);
  return {
    agentRunPreferences,
    configurePersistenceAdapter,
    controllers,
    coordinator,
    createController,
    createdControllers,
    hooks,
    hydratePreferences,
    loadPersistence,
    modelSettingsRef,
    notifications,
    options,
    persistenceAdapter,
    registerController,
    removeAgentRunPreferences,
    removePersistence,
    resumeRecovered,
    schedulePersistence,
    schedulePersistenceFactory,
    scopes,
    sessionAgentModelSelection,
    setAgentRunPreferences,
    setControllerScope,
    setSessionAgentModelSelection,
    store
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useConversationRuntimeRegistryCoordinator", () => {
  it("reuses the book controller across stages and chapters while isolating books", () => {
    const test = createHarness();
    const short = test.coordinator.conversationForKey(
      "short-one:chat",
      "book:short-one"
    );
    for (const lane of [
      "character_design",
      "plot_design",
      "expert_draft_coordinator:section-one"
    ]) {
      expect(
        test.coordinator.conversationForKey(
          `short-one:${lane}`,
          "book:short-one"
        )
      ).toBe(short);
    }
    const long = test.coordinator.conversationForKey(
      "long:long-one:chat",
      "long:long-one"
    );
    for (const lane of [
      "worldbuilding:__book__",
      "draft:__book__",
      "continuity_ledger:chapter-one",
      "continuity_ledger:chapter-two"
    ]) {
      expect(
        test.coordinator.conversationForKey(
          `long:long-one:${lane}`,
          "long:long-one"
        )
      ).toBe(long);
    }
    expect(
      test.coordinator.conversationForKey("short-two:chat", "book:short-two")
    ).not.toBe(short);
    expect(
      test.coordinator.conversationForKey("long:long-two:chat", "long:long-two")
    ).not.toBe(long);
    expect(test.controllers.size).toBe(4);
  });

  it("creates once, applies runtime settings, and reuses controller identity", async () => {
    const test = createHarness();
    test.modelSettingsRef.value = modelSettings();

    const created = test.coordinator.conversationForKey("alpha", "book:one");
    await flushMicrotasks();
    const reused = test.coordinator.conversationForKey("alpha", "book:two");
    const fixture = test.createdControllers[0]!;

    expect(reused).toBe(created);
    expect(test.createController).toHaveBeenCalledOnce();
    expect(test.registerController).toHaveBeenCalledWith(
      "alpha",
      "book:one",
      created,
      {
        applyPreferences: false
      }
    );
    expect(fixture.applyModelSettings).toHaveBeenCalledWith(
      test.modelSettingsRef.value
    );
    expect(test.setControllerScope).toHaveBeenCalledWith("alpha", "book:two");
    expect(fixture.selectApprovalMode).toHaveBeenCalledWith("request-approval");
    expect(test.resumeRecovered).toHaveBeenCalledWith([created]);
  });

  it("schedules lazy snapshots only for the controller that still owns the key", async () => {
    const test = createHarness();
    const created = test.coordinator.conversationForKey("alpha");
    const persistenceHooks = test.hooks.get(created)!;

    await persistenceHooks.onPersistenceChange();
    const persistenceKey = conversationHistoryPersistenceKey("alpha");
    expect(test.schedulePersistenceFactory).toHaveBeenCalledWith(
      persistenceKey,
      created.capturePersistenceSnapshot
    );
    const snapshotFactory = test.schedulePersistenceFactory.mock
      .calls[0]?.[1] as (() => unknown) | undefined;
    expect(snapshotFactory?.()).toEqual({ name: "controller-1" });

    test.controllers.set("alpha", controllerFixture("replacement").controller);
    await persistenceHooks.onPersistenceChange();
    expect(test.schedulePersistenceFactory).toHaveBeenCalledOnce();

    await persistenceHooks.onPersistenceRemove();
    expect(test.removePersistence).toHaveBeenCalledWith(persistenceKey);
  });

  it("hydrates before applying runtime settings and resuming recovered edits", async () => {
    const gate = deferred<unknown>();
    const test = createHarness({ persistence: true });
    test.modelSettingsRef.value = modelSettings();
    test.loadPersistence.mockImplementation(() => gate.promise);
    const created = test.coordinator.conversationForKey("alpha", "book:one");
    const fixture = test.createdControllers[0]!;

    expect(fixture.applyModelSettings).not.toHaveBeenCalled();
    gate.resolve({ persisted: true });
    await test.coordinator.drain();
    await flushMicrotasks();

    expect(fixture.holdPersistenceEmits).toHaveBeenCalledOnce();
    expect(fixture.releasePersistenceEmits).toHaveBeenCalledOnce();
    expect(fixture.restorePersistenceSnapshot).toHaveBeenCalledWith({
      persisted: true
    });
    expect(fixture.applyModelSettings).toHaveBeenCalledWith(
      test.modelSettingsRef.value
    );
    expect(test.resumeRecovered).toHaveBeenCalledWith([created]);
  });

  it("ignores a hydration result when the controller identity was replaced", async () => {
    const gate = deferred<unknown>();
    const test = createHarness({ persistence: true });
    test.loadPersistence.mockImplementation(() => gate.promise);
    test.coordinator.conversationForKey("alpha", "book:one");
    const fixture = test.createdControllers[0]!;
    test.controllers.set("alpha", controllerFixture("replacement").controller);

    gate.resolve({ stale: true });
    await test.coordinator.drain();
    await flushMicrotasks();

    expect(fixture.holdPersistenceEmits).toHaveBeenCalledOnce();
    expect(fixture.releasePersistenceEmits).toHaveBeenCalledOnce();
    expect(fixture.restorePersistenceSnapshot).not.toHaveBeenCalled();
    expect(fixture.applyModelSettings).not.toHaveBeenCalled();
    expect(fixture.selectApprovalMode).not.toHaveBeenCalled();
    expect(test.resumeRecovered).not.toHaveBeenCalled();
  });

  it("does not publish runtime settings when replacement happens during restore", async () => {
    const restoreGate = deferred<boolean>();
    const test = createHarness({ persistence: true });
    test.loadPersistence.mockResolvedValue({ persisted: true });
    test.coordinator.conversationForKey("alpha", "book:one");
    const fixture = test.createdControllers[0]!;
    fixture.restorePersistenceSnapshot.mockImplementation(
      () => restoreGate.promise
    );
    await vi.waitFor(() =>
      expect(fixture.restorePersistenceSnapshot).toHaveBeenCalled()
    );

    test.controllers.set("alpha", controllerFixture("replacement").controller);
    restoreGate.resolve(true);
    await test.coordinator.drain();
    await flushMicrotasks();

    expect(fixture.releasePersistenceEmits).toHaveBeenCalledOnce();
    expect(fixture.applyModelSettings).not.toHaveBeenCalled();
    expect(fixture.selectApprovalMode).not.toHaveBeenCalled();
    expect(test.resumeRecovered).not.toHaveBeenCalled();
  });

  it("shows persistence read or save failure only once", async () => {
    const readTest = createHarness({ persistence: true });
    readTest.loadPersistence.mockRejectedValue(new Error("offline"));
    readTest.coordinator.conversationForKey("alpha");
    readTest.coordinator.conversationForKey("beta");
    await readTest.coordinator.drain();
    expect(readTest.notifications.warning).toHaveBeenCalledTimes(1);
    expect(readTest.notifications.warning).toHaveBeenCalledWith(
      "历史对话暂时无法读取，本次运行仍可正常使用"
    );

    const saveTest = createHarness();
    const configured = saveTest.configurePersistenceAdapter.mock
      .calls[0]?.[1] as ConversationPersistenceOptions | undefined;
    configured?.onError?.("alpha", new Error("disk full"));
    configured?.onError?.("beta", new Error("disk full"));
    expect(saveTest.notifications.warning).toHaveBeenCalledTimes(1);
    expect(saveTest.notifications.warning).toHaveBeenCalledWith(
      "历史对话暂时无法保存到本机，本次运行中仍可继续切换"
    );
  });

  it("restores readable history after migration fails and retries with a fresh read on reopening", async () => {
    const prepareHistory = vi
      .fn(async () => undefined)
      .mockRejectedValueOnce(new Error("test migration failed"));
    const test = createHarness({ persistence: true, prepareHistory });
    test.loadPersistence.mockResolvedValue({ persisted: true });
    const controller = test.coordinator.conversationForKey(
      "book:chat",
      "book:book"
    );
    await test.coordinator.drain();
    expect(
      test.createdControllers[0]!.restorePersistenceSnapshot
    ).toHaveBeenCalledWith({ persisted: true });
    expect(test.notifications.warning).toHaveBeenCalledWith(
      "历史对话迁移暂未完成，原始记录已保留"
    );
    expect(test.coordinator.conversationForKey("book:chat", "book:book")).toBe(
      controller
    );
    await test.coordinator.drain();
    expect(prepareHistory).toHaveBeenCalledTimes(2);
    expect(test.loadPersistence).toHaveBeenLastCalledWith(
      conversationHistoryPersistenceKey("book:chat"),
      { force: true }
    );
  });

  it("synchronizes session, scoped run preferences, models, and approval mode", () => {
    const test = createHarness();
    const first = test.coordinator.conversationForKey("alpha", "book:one");
    const second = test.coordinator.conversationForKey("beta", "book:two");
    test.agentRunPreferences.value = {
      "book:one": { temperature: 0.2, approvalMode: "auto-approve" }
    };
    test.setSessionAgentModelSelection.mockClear();
    test.setAgentRunPreferences.mockClear();
    test.schedulePersistence.mockClear();

    test.coordinator.synchronizeSessionAgentModelSelection(first);
    expect(test.setSessionAgentModelSelection).toHaveBeenCalledWith(
      {
        selectedModelId: first.selectedModelId.value,
        thinkingLevel: first.thinkingLevel.value,
        webSearchEnabled: first.webSearchEnabled.value
      },
      { source: first }
    );
    test.coordinator.synchronizeAgentRunPreferences("book:two", second);
    expect(test.setAgentRunPreferences).toHaveBeenCalledWith(
      "book:two",
      {
        temperature: second.temperature.value,
        approvalMode: second.approvalMode.value,
        agentTeamMode: second.agentTeamMode.value
      },
      { source: second }
    );

    test.sessionAgentModelSelection.value = undefined;
    const settings = modelSettings();
    test.coordinator.applyModelSettingsToConversations(settings);
    expect(test.createdControllers[0]!.applyModelSettings).toHaveBeenCalledWith(
      settings
    );
    expect(test.createdControllers[1]!.applyModelSettings).toHaveBeenCalledWith(
      settings
    );
    expect(test.setSessionAgentModelSelection).toHaveBeenCalledWith(
      expect.objectContaining({ selectedModelId: "model-default" }),
      { persist: false }
    );
    expect(test.schedulePersistence).toHaveBeenCalledWith(
      RUN_PREFERENCES_PERSISTENCE_KEY,
      expect.any(Object)
    );
  });

  it("dispose invalidates and drains a late hydrate without publishing", async () => {
    const gate = deferred<unknown>();
    const test = createHarness({ persistence: true });
    test.loadPersistence.mockImplementation(() => gate.promise);
    test.coordinator.conversationForKey("alpha");
    const fixture = test.createdControllers[0]!;
    let disposed = false;
    const disposing = test.coordinator.dispose().then(() => {
      disposed = true;
    });
    await flushMicrotasks();
    expect(disposed).toBe(false);

    gate.resolve({ stale: true });
    await disposing;
    await flushMicrotasks();

    expect(fixture.releasePersistenceEmits).toHaveBeenCalledOnce();
    expect(fixture.restorePersistenceSnapshot).not.toHaveBeenCalled();
    expect(fixture.applyModelSettings).not.toHaveBeenCalled();
    expect(test.resumeRecovered).not.toHaveBeenCalled();
    expect(test.notifications.warning).not.toHaveBeenCalled();
    expect(() => test.coordinator.conversationForKey("beta")).toThrow(
      "会话运行时注册表已经关闭。"
    );
  });
});
