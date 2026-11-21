import { t } from "../i18n";
import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toRaw,
  triggerRef,
  watch,
  type Ref,
  type WatchStopHandle
} from "vue";
import type { AgentConversationController } from "./useAgentConversation";
import type { AgentActivityContext } from "./agentActivityContext";
import type {
  AgentActivityDescriptor,
  AgentActivityItem,
  AgentActivityStatus,
  CurrentAgentActivityView
} from "../types/agentActivity";

interface AgentActivityNotifications {
  warning(message: string): void;
}

export interface AgentActivityCoordinatorOptions {
  controllers: Readonly<Ref<Map<string, AgentConversationController>>>;
  scopesByKey: Readonly<Ref<Map<string, string>>>;
  registryRevision: Readonly<Ref<number>>;
  currentView: Readonly<Ref<CurrentAgentActivityView | null>>;
  resolveDescriptor(
    conversationKey: string,
    scope: string | undefined
  ): AgentActivityDescriptor | undefined;
  navigate(
    item: AgentActivityItem
  ): Promise<"navigated" | "blocked" | "missing">;
  notifications: AgentActivityNotifications;
  now?: () => number;
}

interface ControllerObserver {
  controller: AgentConversationController;
  stop: WatchStopHandle;
}

interface LatestRunState {
  runKey: string | undefined;
  status: AgentActivityStatus | undefined;
  running: boolean;
}

function latestRunState(
  controller: AgentConversationController
): LatestRunState {
  const message = [...controller.messages.value]
    .reverse()
    .find((candidate) => candidate.role === "assistant");
  const running = controller.isBusy.value || message?.status === "streaming";
  return {
    runKey: message
      ? `${controller.sessionId.value}:${message.runId ?? message.id}`
      : running
        ? `${controller.sessionId.value}:pending`
        : undefined,
    status:
      message?.status === "completed" ||
      message?.status === "error" ||
      message?.status === "stopped"
        ? message.status
        : undefined,
    running
  };
}

function activitySort(left: AgentActivityItem, right: AgentActivityItem) {
  const leftRank = left.status === "running" ? 0 : 1;
  const rightRank = right.status === "running" ? 0 : 1;
  return leftRank - rightRank || right.updatedAt - left.updatedAt;
}

export function useAgentActivityCoordinator(
  options: AgentActivityCoordinatorOptions
) {
  const now = options.now ?? Date.now;
  const activityByKey = shallowRef(new Map<string, AgentActivityItem>());
  const descriptorByKey = new Map<string, AgentActivityDescriptor>();
  const observers = new Map<string, ControllerObserver>();
  const lastRunByKey = new Map<string, string | undefined>();
  const collapsed = ref(true);
  const currentKey = ref<string>();
  let disposed = false;

  const items = computed<readonly AgentActivityItem[]>(() =>
    [...activityByKey.value.values()].sort(activitySort)
  );

  function publishItem(item: AgentActivityItem): void {
    activityByKey.value.set(item.conversationKey, item);
    triggerRef(activityByKey);
  }

  function removeItem(conversationKey: string): void {
    if (!activityByKey.value.delete(conversationKey)) return;
    triggerRef(activityByKey);
  }

  function descriptorFor(
    conversationKey: string
  ): AgentActivityDescriptor | undefined {
    const cached = descriptorByKey.get(conversationKey);
    if (cached) return cached;
    const resolved = options.resolveDescriptor(
      conversationKey,
      options.scopesByKey.value.get(conversationKey)
    );
    if (resolved) descriptorByKey.set(conversationKey, resolved);
    return resolved;
  }

  function updateActivity(
    conversationKey: string,
    status: AgentActivityStatus
  ): void {
    const descriptor = descriptorFor(conversationKey);
    if (!descriptor) return;
    if (status !== "running" && currentKey.value === conversationKey) {
      removeItem(conversationKey);
      return;
    }
    publishItem({ ...descriptor, status, updatedAt: now() });
  }

  function observeController(
    conversationKey: string,
    controller: AgentConversationController
  ): WatchStopHandle {
    let initialized = false;
    return watch(
      () => latestRunState(controller),
      (state) => {
        if (!initialized) {
          initialized = true;
          lastRunByKey.set(conversationKey, state.runKey);
          if (state.running) updateActivity(conversationKey, "running");
          return;
        }

        const previousRunKey = lastRunByKey.get(conversationKey);
        lastRunByKey.set(conversationKey, state.runKey);
        if (state.running) {
          const current = activityByKey.value.get(conversationKey);
          if (
            current?.status !== "running" ||
            state.runKey !== previousRunKey
          ) {
            updateActivity(conversationKey, "running");
          }
          return;
        }

        if (
          state.status &&
          activityByKey.value.get(conversationKey)?.status === "running"
        ) {
          updateActivity(conversationKey, state.status);
        }
      },
      { deep: false, immediate: true }
    );
  }

  function reconcileControllers(): void {
    if (disposed) return;
    const controllers = options.controllers.value;
    for (const [conversationKey, observer] of observers) {
      const controller = controllers.get(conversationKey);
      if (controller === observer.controller) continue;
      observer.stop();
      observers.delete(conversationKey);
      lastRunByKey.delete(conversationKey);
      descriptorByKey.delete(conversationKey);
      removeItem(conversationKey);
    }
    for (const [conversationKey, controller] of controllers) {
      if (observers.has(conversationKey)) continue;
      observers.set(conversationKey, {
        controller,
        stop: observeController(conversationKey, controller)
      });
    }
  }

  const stopControllers = watch(
    [options.controllers, options.registryRevision],
    reconcileControllers,
    { immediate: true }
  );

  const stopCurrentView = watch(
    options.currentView,
    (view) => {
      const entry = view
        ? [...options.controllers.value.entries()].find(
            ([, controller]) => controller === toRaw(view.controller)
          )
        : undefined;
      currentKey.value = entry?.[0];
      if (!view || !entry) return;
      const current = activityByKey.value.get(entry[0]);
      const freezeLocation = current?.status === "running";
      const chapterCardId = freezeLocation
        ? current?.chapterCardId
        : view.chapterCardId;
      const chapterCardView = freezeLocation
        ? current?.chapterCardView
        : view.chapterCardView;
      const descriptor: AgentActivityDescriptor = {
        conversationKey: entry[0],
        agentLabel: view.agentLabel,
        contextLabel: view.contextLabel,
        targetResourceId:
          freezeLocation && current
            ? current.targetResourceId
            : view.targetResourceId,
        ...(chapterCardId ? { chapterCardId } : {}),
        ...(chapterCardView ? { chapterCardView } : {})
      };
      descriptorByKey.set(entry[0], descriptor);
      if (!current) return;
      if (current.status === "running") {
        publishItem({ ...current, ...descriptor });
      } else {
        removeItem(entry[0]);
      }
    },
    { immediate: true }
  );

  function toggleCollapsed(): void {
    collapsed.value = !collapsed.value;
  }

  async function selectActivity(conversationKey: string): Promise<void> {
    const item = activityByKey.value.get(conversationKey);
    if (!item || disposed) return;
    let outcome: "navigated" | "blocked" | "missing";
    try {
      outcome = await options.navigate(item);
    } catch {
      outcome = "blocked";
    }
    if (outcome === "missing") {
      removeItem(conversationKey);
      options.notifications.warning(
        t(
          "workspace.agentActivityCoordinator.theAssociatedAgentContextNoLongerExistsTheNotice"
        )
      );
      return;
    }
    if (outcome === "navigated" && item.status !== "running") {
      removeItem(conversationKey);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stopControllers();
    stopCurrentView();
    for (const observer of observers.values()) observer.stop();
    observers.clear();
    lastRunByKey.clear();
    descriptorByKey.clear();
    activityByKey.value.clear();
    triggerRef(activityByKey);
  }

  const context: AgentActivityContext = {
    items,
    collapsed,
    toggleCollapsed,
    selectActivity
  };

  onScopeDispose(dispose);

  return {
    items,
    collapsed,
    currentKey,
    toggleCollapsed,
    selectActivity,
    dispose,
    context
  };
}
