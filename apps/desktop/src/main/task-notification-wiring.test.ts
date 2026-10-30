import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("task notification wiring in Main", () => {
  it("reads the live general setting and raises the window on click", () => {
    expect(source).toContain("createTaskNotifier({");
    expect(source).toContain(
      "isEnabled: () => cachedGeneralSettings.taskNotification"
    );
    expect(source).toContain("onActivate: () => showMainWindow()");
  });

  it("reports every run end, including the synthesized one after a crash", () => {
    expect(source).toContain("taskNotifier.notifyRunEnd(validated, {");
    expect(source).toContain("taskNotifier.notifyRunEnd(event, {");
    expect(source).toContain(
      "decompositionJobId: activeRun?.decompositionJobId"
    );
  });

  it("takes task state only from Core and keeps it away from the Renderer", () => {
    expect(source).toMatch(
      /decomposition\.job_settled"\) \{[^}]*worker === "core"\) taskNotifier\.notifyJobEvent\(validated\);\s*return;/
    );
  });

  it("tells the Renderer when the system refuses the confirmation", () => {
    expect(source).toContain("onEnableRefused: () =>");
    expect(source).toContain('"system.notification_blocked"');
  });

  it("confirms only the moment the setting turns on, and names Windows notifications", () => {
    expect(source).toContain("!cachedGeneralSettings.taskNotification");
    expect(source).toContain("taskNotifier.notifyEnabled()");
    expect(source).toContain('app.setAppUserModelId("cn.deepwrite.desktop")');
  });
});
