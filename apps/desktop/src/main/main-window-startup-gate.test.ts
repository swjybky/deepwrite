import { describe, expect, it, vi } from "vitest";
import { createMainWindowStartupGate } from "./main-window-startup-gate";

describe("main window startup gate", () => {
  it("coalesces early show requests until startup is ready", () => {
    const showMainWindow = vi.fn();
    const gate = createMainWindowStartupGate(showMainWindow);

    gate.requestShow();
    gate.requestShow();
    expect(showMainWindow).not.toHaveBeenCalled();

    gate.markReady();
    expect(showMainWindow).toHaveBeenCalledOnce();

    gate.requestShow();
    expect(showMainWindow).toHaveBeenCalledTimes(2);
  });

  it("does not create a window merely because startup became ready", () => {
    const showMainWindow = vi.fn();
    const gate = createMainWindowStartupGate(showMainWindow);

    gate.markReady();
    gate.markReady();
    expect(showMainWindow).not.toHaveBeenCalled();
  });
});
