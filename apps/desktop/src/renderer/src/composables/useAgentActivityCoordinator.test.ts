import {
  effectScope,
  nextTick,
  ref,
  shallowRef,
  type EffectScope,
  type Ref
} from "vue";
import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "./useAgentConversation";
import { useAgentActivityCoordinator } from "./useAgentActivityCoordinator";
import type {
  AgentActivityDescriptor,
  AgentActivityItem,
  CurrentAgentActivityView
} from "../types/agentActivity";
import type { ChatMessage } from "../types/conversation";
import {
  createDeferredApi,
  document,
  useAgentConversation
} from "./useAgentConversation.test-support";
import { useConversationStore } from "../stores/conversationStore";

function controller(id: string): AgentConversationController {
  return {
    messages: ref<ChatMessage[]>([]),
    sessionId: ref("session-" + id),
    isBusy: ref(false),
    dispose() {}
  } as unknown as AgentConversationController;
}

function assistant(
  id: string,
  status: "streaming" | "completed" | "error" | "stopped"
): ChatMessage {
  return {
    id,
    runId: "run-" + id,
    role: "assistant",
    content: "",
    createdAt: "2026-08-19T00:00:00.000Z",
    status
  };
}

function setBusy(target: AgentConversationController, value: boolean): void {
  (target.isBusy as Ref<boolean>).value = value;
}

describe("useAgentActivityCoordinator", () => {
  let scope: EffectScope | undefined;

  afterEach(() => {
    scope?.stop();
    scope = undefined;
  });

  function setup() {
    const first = controller("first");
    const second = controller("second");
    const controllers = shallowRef(
      new Map<string, AgentConversationController>([
        ["first", first],
        ["second", second]
      ])
    );
    const scopesByKey = shallowRef(
      new Map([
        ["first", "book:one"],
        ["second", "book:two"]
      ])
    );
    const currentView = shallowRef<CurrentAgentActivityView | null>(null);
    const descriptors = new Map<string, AgentActivityDescriptor>([
      [
        "first",
        {
          conversationKey: "first",
          agentLabel: "人物智能体",
          contextLabel: "作品一 · 人物",
          targetResourceId: "resource-one"
        }
      ],
      [
        "second",
        {
          conversationKey: "second",
          agentLabel: "剧情智能体",
          contextLabel: "作品二 · 剧情",
          targetResourceId: "resource-two"
        }
      ]
    ]);
    const warning = vi.fn();
    const navigate = vi.fn(
      async (
        _item: AgentActivityItem
      ): Promise<"navigated" | "blocked" | "missing"> => "navigated"
    );
    let timestamp = 0;
    scope = effectScope();
    const activity = scope.run(() =>
      useAgentActivityCoordinator({
        controllers,
        scopesByKey,
        registryRevision: ref(0),
        currentView,
        resolveDescriptor: (key) => descriptors.get(key),
        navigate,
        notifications: { warning },
        now: () => ++timestamp
      })
    )!;
    return {
      first,
      second,
      controllers,
      currentView,
      warning,
      navigate,
      activity
    };
  }

  it("tracks concurrent runs and retains completed work until it is viewed", async () => {
    const test = setup();
    setBusy(test.first, true);
    test.first.messages.value = [assistant("first", "streaming")];
    await nextTick();
    setBusy(test.second, true);
    test.second.messages.value = [assistant("second", "streaming")];
    await nextTick();

    expect(
      test.activity.items.value.map(({ conversationKey }) => conversationKey)
    ).toEqual(["second", "first"]);
    expect(
      test.activity.items.value.every(({ status }) => status === "running")
    ).toBe(true);

    setBusy(test.first, false);
    test.first.messages.value = [assistant("first", "completed")];
    await nextTick();
    expect(
      test.activity.items.value.find(
        ({ conversationKey }) => conversationKey === "first"
      )?.status
    ).toBe("completed");

    test.currentView.value = {
      controller: test.first,
      agentLabel: "人物智能体",
      contextLabel: "作品一 · 人物",
      targetResourceId: "resource-one"
    };
    await nextTick();
    expect(
      test.activity.items.value.some(
        ({ conversationKey }) => conversationKey === "first"
      )
    ).toBe(false);

    test.currentView.value = {
      controller: test.second,
      agentLabel: "剧情智能体",
      contextLabel: "作品二 · 剧情",
      targetResourceId: "resource-two"
    };
    setBusy(test.second, false);
    test.second.messages.value = [assistant("second", "completed")];
    await nextTick();
    expect(test.activity.items.value).toEqual([]);
  });

  it("freezes the jump target of a running long-form activity", async () => {
    const test = setup();
    test.currentView.value = {
      controller: test.first,
      agentLabel: "长篇智能体",
      contextLabel: "测试长篇 · 第二章",
      targetResourceId: "chapter-card-two",
      chapterCardView: "card",
      chapterCardId: "chapter-two"
    };
    setBusy(test.first, true);
    test.first.messages.value = [assistant("first", "streaming")];
    await nextTick();
    expect(test.activity.items.value[0]).toMatchObject({
      conversationKey: "first",
      targetResourceId: "chapter-card-two",
      chapterCardView: "card",
      chapterCardId: "chapter-two",
      status: "running"
    });

    test.currentView.value = {
      controller: test.first,
      agentLabel: "长篇智能体",
      contextLabel: "测试长篇 · 规则",
      targetResourceId: "world-rules"
    };
    await nextTick();
    expect(test.activity.items.value[0]).toMatchObject({
      conversationKey: "first",
      targetResourceId: "chapter-card-two",
      chapterCardView: "card",
      chapterCardId: "chapter-two",
      status: "running"
    });
  });

  it("starts collapsed and keeps manual expansion independent from new activity", async () => {
    const test = setup();

    expect(test.activity.collapsed.value).toBe(true);
    test.activity.toggleCollapsed();
    expect(test.activity.collapsed.value).toBe(false);

    setBusy(test.first, true);
    test.first.messages.value = [assistant("first", "streaming")];
    await nextTick();

    expect(test.activity.collapsed.value).toBe(false);
  });

  it("shows a real conversation controller as soon as sending starts", async () => {
    const deferred = createDeferredApi();
    const realController = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    realController.draft.value = "开始人物设计";
    const controllers = shallowRef(
      new Map<string, AgentConversationController>([
        ["book-one:character_design", realController]
      ])
    );
    const currentView = shallowRef<CurrentAgentActivityView | null>({
      controller: realController,
      agentLabel: "人物智能体",
      contextLabel: "作品一 · 人物",
      targetResourceId: "resource-one"
    });
    const nestedScope = effectScope();
    const activity = nestedScope.run(() =>
      useAgentActivityCoordinator({
        controllers,
        scopesByKey: shallowRef(
          new Map([["book-one:character_design", "book:book-one"]])
        ),
        registryRevision: ref(0),
        currentView,
        resolveDescriptor: () => undefined,
        navigate: async () => "navigated",
        notifications: { warning: vi.fn() }
      })
    )!;

    const sending = realController.sendMessage(document);
    await nextTick();
    expect(realController.isBusy.value).toBe(true);
    expect(activity.items.value).toMatchObject([
      {
        conversationKey: "book-one:character_design",
        status: "running"
      }
    ]);

    deferred.rejectPrompt(0, new Error("cancelled"));
    await sending;
    activity.dispose();
    nestedScope.stop();
    realController.dispose();
  });

  it("observes controllers registered through the live Pinia registry", async () => {
    setActivePinia(createPinia());
    const store = useConversationStore();
    const { controllers, scopesByKey, controllerRegistryRevision } =
      storeToRefs(store);
    const currentView = shallowRef<CurrentAgentActivityView | null>(null);
    const nestedScope = effectScope();
    const activity = nestedScope.run(() =>
      useAgentActivityCoordinator({
        controllers,
        scopesByKey,
        registryRevision: controllerRegistryRevision,
        currentView,
        resolveDescriptor: (conversationKey) => ({
          conversationKey,
          agentLabel: "人物智能体",
          contextLabel: "作品一 · 人物",
          targetResourceId: "resource-one"
        }),
        navigate: async () => "navigated",
        notifications: { warning: vi.fn() }
      })
    )!;
    const lateController = controller("late");

    store.registerController(
      "book-one:character_design",
      "book:book-one",
      lateController
    );
    currentView.value = {
      controller: lateController,
      agentLabel: "人物智能体",
      contextLabel: "作品一 · 人物",
      targetResourceId: "resource-one"
    };
    setBusy(lateController, true);
    lateController.messages.value = [assistant("late", "streaming")];
    await nextTick();

    expect(activity.items.value).toMatchObject([
      {
        conversationKey: "book-one:character_design",
        status: "running"
      }
    ]);
    activity.dispose();
    nestedScope.stop();
    await store.dispose();
  });

  it("deduplicates reruns and distinguishes error and stopped outcomes", async () => {
    const test = setup();
    setBusy(test.first, true);
    test.first.messages.value = [assistant("first-a", "streaming")];
    await nextTick();
    setBusy(test.first, false);
    test.first.messages.value = [assistant("first-a", "error")];
    await nextTick();
    expect(test.activity.items.value).toHaveLength(1);
    expect(test.activity.items.value[0]?.status).toBe("error");

    setBusy(test.first, true);
    test.first.messages.value = [
      assistant("first-a", "error"),
      assistant("first-b", "streaming")
    ];
    await nextTick();
    expect(test.activity.items.value).toHaveLength(1);
    expect(test.activity.items.value[0]?.status).toBe("running");

    setBusy(test.first, false);
    test.first.messages.value = [
      assistant("first-a", "error"),
      assistant("first-b", "stopped")
    ];
    await nextTick();
    expect(test.activity.items.value[0]?.status).toBe("stopped");
  });

  it("keeps blocked navigation but removes missing targets", async () => {
    const test = setup();
    setBusy(test.first, true);
    test.first.messages.value = [assistant("first", "streaming")];
    await nextTick();
    setBusy(test.first, false);
    test.first.messages.value = [assistant("first", "completed")];
    await nextTick();

    test.navigate.mockResolvedValueOnce("blocked");
    await test.activity.selectActivity("first");
    expect(test.activity.items.value).toHaveLength(1);

    test.navigate.mockResolvedValueOnce("missing");
    await test.activity.selectActivity("first");
    expect(test.activity.items.value).toEqual([]);
    expect(test.warning).toHaveBeenCalledWith(
      "对应的智能体上下文已不存在，已移除该提醒。"
    );
  });

  it("drops activity when a controller is removed and clears on disposal", async () => {
    const test = setup();
    setBusy(test.first, true);
    test.first.messages.value = [assistant("first", "streaming")];
    await nextTick();
    expect(test.activity.items.value).toHaveLength(1);

    test.controllers.value = new Map([["second", test.second]]);
    await nextTick();
    expect(test.activity.items.value).toEqual([]);

    setBusy(test.second, true);
    test.second.messages.value = [assistant("second", "streaming")];
    await nextTick();
    expect(test.activity.items.value).toHaveLength(1);
    test.activity.dispose();
    expect(test.activity.items.value).toEqual([]);
  });
});
