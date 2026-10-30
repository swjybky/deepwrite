import { describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  type ModelUsageModule,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { setNativeLanguage } from "./native-i18n";
import { createTaskNotifier, type SystemNotice } from "./task-notification";
import type { NotificationWindow } from "./task-notification-policy";

vi.mock("electron", () => ({
  Notification: class {
    static isSupported = () => false;
  }
}));

const runtime = {
  provider: "faux",
  model: "faux",
  mode: "local-faux"
} as const;

function completedEvent(runId = "run-1"): SystemEventEnvelope {
  return createEnvelope(
    "agent.message_completed",
    {
      sessionId: "session-1",
      runId,
      messageId: "message-1",
      runtime,
      role: "assistant",
      content: "正文"
    },
    {
      id: `evt-${runId}`,
      context: { correlationId: "corr-1", sessionId: "session-1", runId }
    }
  ) as SystemEventEnvelope;
}

function errorEvent(code: string, runId = "run-1"): SystemEventEnvelope {
  return createEnvelope(
    "agent.error",
    { sessionId: "session-1", runId, code, message: "出错", runtime },
    {
      id: `evt-err-${runId}`,
      context: { correlationId: "corr-1", sessionId: "session-1", runId }
    }
  ) as SystemEventEnvelope;
}

function settledEvent(
  outcome: "completed" | "failed" | "paused"
): SystemEventEnvelope {
  return createEnvelope(
    "decomposition.job_settled",
    { jobId: "job-1", outcome },
    { id: "evt-job", context: { correlationId: "corr-job" } }
  ) as SystemEventEnvelope;
}

function windowState(
  state: Partial<Record<"visible" | "focused" | "minimized", boolean>> = {}
): NotificationWindow {
  return {
    isDestroyed: () => false,
    isVisible: () => state.visible ?? false,
    isFocused: () => state.focused ?? false,
    isMinimized: () => state.minimized ?? false
  };
}

function harness(
  options: { enabled?: boolean; window?: NotificationWindow | undefined } = {}
) {
  setNativeLanguage("zh-CN", "zh-CN");
  const shown: SystemNotice[] = [];
  const onActivate = vi.fn();
  const notifier = createTaskNotifier({
    isEnabled: () => options.enabled ?? true,
    getWindow: () => options.window,
    onActivate,
    present: (notice) => shown.push(notice)
  });
  return { notifier, shown, onActivate };
}

const fresh = { previouslyTerminal: false };

describe("task notifications", () => {
  it("says nothing while the setting is off", () => {
    const { notifier, shown } = harness({ enabled: false });
    notifier.notifyRunEnd(completedEvent(), fresh);
    notifier.notifyJobEvent(settledEvent("completed"));
    expect(shown).toEqual([]);
  });

  it("notifies when a run completes and the window is hidden", () => {
    const { notifier, shown } = harness({ window: windowState() });
    notifier.notifyRunEnd(completedEvent(), {
      ...fresh,
      module: "short-writing"
    });
    expect(shown).toEqual([{ title: "DeepWrite", body: "短篇创作已完成" }]);
  });

  it("notifies when no window exists, such as after it was closed", () => {
    const { notifier, shown } = harness({ window: undefined });
    notifier.notifyRunEnd(completedEvent(), fresh);
    expect(shown).toEqual([{ title: "DeepWrite", body: "智能体任务已完成" }]);
  });

  it("stays quiet while the user is looking at the main window", () => {
    const { notifier, shown } = harness({
      window: windowState({ visible: true, focused: true })
    });
    notifier.notifyRunEnd(completedEvent(), fresh);
    expect(shown).toEqual([]);
  });

  it.each([
    ["hidden to the menu bar", windowState({ focused: true })],
    ["in the background", windowState({ visible: true })],
    [
      "minimized",
      windowState({ visible: true, focused: true, minimized: true })
    ]
  ])("notifies when the window is %s", (_name, window) => {
    const { notifier, shown } = harness({ window });
    notifier.notifyRunEnd(completedEvent(), fresh);
    expect(shown).toHaveLength(1);
  });

  it("reports a failed run without leaking the error text", () => {
    const { notifier, shown } = harness();
    notifier.notifyRunEnd(errorEvent("model.rate_limited"), {
      ...fresh,
      module: "assistant-chat"
    });
    expect(shown).toEqual([
      { title: "DeepWrite", body: "聊天未能完成，点击查看" }
    ]);
  });

  it("does not notify for a run the user stopped", () => {
    const { notifier, shown } = harness();
    notifier.notifyRunEnd(errorEvent("pi_agent.aborted"), fresh);
    expect(shown).toEqual([]);
  });

  it("notifies once per run even if the end is reported twice", () => {
    const { notifier, shown } = harness();
    notifier.notifyRunEnd(completedEvent(), fresh);
    notifier.notifyRunEnd(errorEvent("agent.utility_exited"), {
      previouslyTerminal: true
    });
    expect(shown).toHaveLength(1);
  });

  it.each<[string, ModelUsageModule | undefined, string | undefined]>([
    ["a connection test", "model-test", undefined],
    ["a decomposition run", "long-book-decomposition", undefined],
    ["a run bound to a decomposition task", undefined, "job-1"]
  ])("leaves %s to other notices", (_name, module, decompositionJobId) => {
    const { notifier, shown } = harness();
    notifier.notifyRunEnd(completedEvent(), {
      ...fresh,
      module,
      decompositionJobId
    });
    expect(shown).toEqual([]);
  });

  it("ignores events that do not end a run", () => {
    const { notifier, shown } = harness();
    notifier.notifyRunEnd(settledEvent("completed"), fresh);
    notifier.notifyJobEvent(completedEvent());
    expect(shown).toEqual([]);
  });

  it.each([
    ["completed", "整书拆解已完成"],
    ["failed", "整书拆解未能完成，点击查看"],
    ["paused", "整书拆解已暂停，点击查看"]
  ] as const)("reports a %s decomposition task once", (outcome, body) => {
    const { notifier, shown } = harness();
    notifier.notifyJobEvent(settledEvent(outcome));
    expect(shown).toEqual([{ title: "DeepWrite", body }]);
  });

  it("follows the app language", () => {
    const { notifier, shown } = harness();
    setNativeLanguage("en-US", "en-US");
    notifier.notifyRunEnd(completedEvent(), {
      ...fresh,
      module: "style-comparison"
    });
    expect(shown[0]?.body).toBe("Style comparison finished");
  });

  it("confirms the setting even while the main window is in use", () => {
    const { notifier, shown, onActivate } = harness({
      window: windowState({ visible: true, focused: true })
    });
    notifier.notifyEnabled();
    expect(shown).toEqual([
      { title: "任务完成通知已开启", body: expect.stringContaining("主窗口") }
    ]);
    expect(onActivate).not.toHaveBeenCalled();
  });
});
