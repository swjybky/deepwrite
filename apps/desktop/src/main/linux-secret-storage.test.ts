import { describe, expect, it, vi } from "vitest";
import { configureLinuxSecretStorage } from "./linux-secret-storage";

function commandLine(explicit = false) {
  return { hasSwitch: vi.fn(() => explicit), appendSwitch: vi.fn() };
}

describe("Linux secret storage startup", () => {
  it.each(["niri", "sway", "Hyprland", "GNOME", "", "X-Cinnamon"])(
    "uses Secret Service for %s without requiring launcher arguments",
    (desktop) => {
      const command = commandLine();
      configureLinuxSecretStorage(command, "linux", {
        XDG_CURRENT_DESKTOP: desktop
      });
      expect(command.appendSwitch).toHaveBeenCalledExactlyOnceWith(
        "password-store",
        "gnome-libsecret"
      );
    }
  );

  it.each(["KDE", "LXQt", "custom:KDE", "kde"])(
    "preserves native wallet selection for %s",
    (desktop) => {
      const command = commandLine();
      configureLinuxSecretStorage(command, "linux", {
        XDG_CURRENT_DESKTOP: desktop
      });
      expect(command.appendSwitch).not.toHaveBeenCalled();
    }
  );

  it("preserves KDE session detection when the desktop variable is missing", () => {
    const command = commandLine();
    configureLinuxSecretStorage(command, "linux", { KDE_FULL_SESSION: "true" });
    expect(command.appendSwitch).not.toHaveBeenCalled();
  });

  it("preserves an explicit backend override", () => {
    const command = commandLine(true);
    configureLinuxSecretStorage(command, "linux", {
      XDG_CURRENT_DESKTOP: "niri"
    });
    expect(command.hasSwitch).toHaveBeenCalledWith("password-store");
    expect(command.appendSwitch).not.toHaveBeenCalled();
  });

  it.each(["darwin", "win32"] as const)("does not alter %s", (platform) => {
    const command = commandLine();
    configureLinuxSecretStorage(command, platform, {});
    expect(command.appendSwitch).not.toHaveBeenCalled();
  });
});
