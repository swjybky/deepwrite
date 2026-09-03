import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("general settings native behavior", () => {
  it("keeps a real tray icon and hides the main window on close when enabled", () => {
    expect(source).toContain("let menuBarTray: Tray | undefined");
    expect(source).toContain("menuBarTray = new Tray(trayIcon)");
    expect(source).toContain("cachedGeneralSettings.showInMenuBar");
    expect(source).toContain("event.preventDefault();");
    expect(source).toContain("window.hide();");
    expect(source).toContain('label: "显示 DeepWrite"');
    expect(source).toContain('label: "退出"');
  });

  it("destroys the tray immediately when the setting is disabled", () => {
    expect(source).toContain("destroyMenuBarTray();");
    expect(source).toContain("syncGeneralSettings(snapshot.settings);");
    expect(source).toContain("applyNetworkProxyPreference(");
  });
});
