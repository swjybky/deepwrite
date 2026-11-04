import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, type SystemEventEnvelope } from "@deepwrite/contracts";

const electron = vi.hoisted(() => ({
  supported: true,
  activate: undefined as undefined | ((details: { type: string }) => void),
  handleActivation: vi.fn(),
  shown: [] as unknown[]
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Notification extends EventEmitter {
    static isSupported = () => electron.supported;
    static handleActivation = (
      callback: (details: { type: string }) => void
    ) => {
      electron.handleActivation(callback);
      electron.activate = callback;
    };
    constructor(readonly options: { title: string; body: string }) {
      super();
      electron.shown.push(this);
    }
    show = vi.fn();
  }
  return { Notification };
});

import { createTaskNotifier } from "./task-notification";

type FakeNotification = EventEmitter & {
  options: { title: string; body: string };
  show: ReturnType<typeof vi.fn>;
};

function enabledNotifier(onActivate = vi.fn()) {
  const onEnableRefused = vi.fn();
  return {
    onActivate,
    onEnableRefused,
    notifier: createTaskNotifier({
      isEnabled: () => true,
      getWindow: () => undefined,
      onActivate,
      onEnableRefused
    })
  };
}

function completedRun(): SystemEventEnvelope {
  return createEnvelope(
    "agent.message_completed",
    {
      sessionId: "session-1",
      runId: "run-1",
      messageId: "message-1",
      runtime: { provider: "faux", model: "faux", mode: "local-faux" },
      role: "assistant",
      content: "正文"
    },
    {
      id: "evt-run-1",
      context: {
        correlationId: "corr-1",
        sessionId: "session-1",
        runId: "run-1"
      }
    }
  ) as SystemEventEnvelope;
}

afterEach(() => {
  electron.supported = true;
  electron.shown.length = 0;
  electron.activate = undefined;
  electron.handleActivation.mockClear();
  vi.restoreAllMocks();
});

describe("system notification through Electron", () => {
  it("handles Windows Action Center clicks after the banner and its listeners are gone", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const { notifier, onActivate } = enabledNotifier();
    notifier.notifyEnabled();
    const shown = electron.shown[0] as FakeNotification;
    shown.emit("close", { reason: "timedOut" });
    shown.removeAllListeners();
    electron.shown.length = 0;
    electron.activate?.({ type: "click" });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("raises the Windows window once when both activation paths fire", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const { notifier, onActivate } = enabledNotifier();
    notifier.notifyEnabled();
    (electron.shown[0] as FakeNotification).emit("click");
    electron.activate?.({ type: "click" });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("keeps one activation callback for successive Windows notifications", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const { notifier, onActivate } = enabledNotifier();
    notifier.notifyEnabled();
    notifier.notifyRunEnd(completedRun(), { previouslyTerminal: false });
    expect(electron.handleActivation).toHaveBeenCalledTimes(1);
    electron.activate?.({ type: "click" });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it.each(["darwin", "linux"] as const)(
    "uses instance clicks on %s",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      const { notifier, onActivate } = enabledNotifier();
      notifier.notifyEnabled();
      expect(electron.handleActivation).not.toHaveBeenCalled();
      (electron.shown[0] as FakeNotification).emit("click");
      expect(onActivate).toHaveBeenCalledTimes(1);
    }
  );

  it("shows the notice and raises the window when it is clicked", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const { notifier, onActivate } = enabledNotifier();
    notifier.notifyEnabled();
    const shown = electron.shown[0] as FakeNotification;
    expect(shown.show).toHaveBeenCalledTimes(1);
    expect(shown.options.title).toBe("任务完成通知已开启");
    shown.emit("click");
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("logs why a notification was refused instead of failing silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { notifier } = enabledNotifier();
    notifier.notifyEnabled();
    (electron.shown[0] as FakeNotification).emit(
      "failed",
      {},
      "UNErrorDomain error 1"
    );
    expect(warn).toHaveBeenCalledWith(
      "DeepWrite system notification was not shown:",
      "UNErrorDomain error 1"
    );
  });

  it("does nothing on a system without notification support", () => {
    electron.supported = false;
    const { notifier } = enabledNotifier();
    notifier.notifyEnabled();
    expect(electron.shown).toEqual([]);
  });

  it("reports a refused confirmation so the app can explain it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { notifier, onEnableRefused } = enabledNotifier();
    notifier.notifyEnabled();
    expect(onEnableRefused).not.toHaveBeenCalled();
    (electron.shown[0] as FakeNotification).emit("failed", {}, "refused");
    expect(onEnableRefused).toHaveBeenCalledTimes(1);
  });

  it("reports an unsupported system as a refused confirmation", () => {
    electron.supported = false;
    const { notifier, onEnableRefused } = enabledNotifier();
    notifier.notifyEnabled();
    expect(onEnableRefused).toHaveBeenCalledTimes(1);
  });

  it("keeps a refused task notice out of the app, where nobody is looking", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { notifier, onEnableRefused } = enabledNotifier();
    notifier.notifyRunEnd(completedRun(), { previouslyTerminal: false });
    (electron.shown[0] as FakeNotification).emit("failed", {}, "refused");
    expect(onEnableRefused).not.toHaveBeenCalled();
  });
});
