import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureLinuxSecretBackend,
  rememberLinuxSecretBackend,
  selectLinuxSecretBackend
} from "./linux-secret-backend";

const roots: string[] = [];
function root() {
  const path = mkdtempSync(join(tmpdir(), "deepwrite-keyring-test-"));
  roots.push(path);
  return path;
}
function services(running: string[], activatable: string[] = []) {
  return { running: new Set(running), activatable: new Set(activatable) };
}
afterEach(() => {
  roots
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
});

describe("Linux secret backend selection", () => {
  it.each(["niri", "sway", "Hyprland", "GNOME", "XFCE", ""])(
    "selects Secret Service for %s without distribution checks",
    (desktop) => {
      expect(
        selectLinuxSecretBackend(services(["org.freedesktop.secrets"]), {
          XDG_CURRENT_DESKTOP: desktop
        })
      ).toBe("gnome-libsecret");
    }
  );
  it("uses activatable services, preferring the matching KDE wallet", () => {
    const available = services(
      [],
      ["org.freedesktop.secrets", "org.kde.kwalletd5", "org.kde.kwalletd6"]
    );
    expect(
      selectLinuxSecretBackend(available, {
        XDG_CURRENT_DESKTOP: "KDE:Plasma",
        KDE_SESSION_VERSION: "5"
      })
    ).toBe("kwallet5");
    expect(selectLinuxSecretBackend(available, {})).toBe("gnome-libsecret");
  });
  it("prefers standard Secret Service outside KDE and supports wallet-only sessions", () => {
    expect(
      selectLinuxSecretBackend(
        services(["org.kde.kwalletd6"], ["org.freedesktop.secrets"]),
        {}
      )
    ).toBe("gnome-libsecret");
    expect(selectLinuxSecretBackend(services(["org.kde.kwalletd6"]), {})).toBe(
      "kwallet6"
    );
    expect(selectLinuxSecretBackend(services([]), {})).toBeUndefined();
  });
  it("preserves explicit switches and leaves other platforms untouched", () => {
    const commandLine = { hasSwitch: vi.fn(() => true), appendSwitch: vi.fn() };
    const probe = vi.fn(() => services(["org.freedesktop.secrets"]));
    configureLinuxSecretBackend(commandLine, root(), {
      platform: "linux",
      services: probe
    });
    commandLine.hasSwitch.mockReturnValue(false);
    configureLinuxSecretBackend(commandLine, root(), {
      platform: "darwin",
      services: probe
    });
    expect(probe).not.toHaveBeenCalled();
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
  it("keeps a successful backend across restarts even when its service is unavailable", () => {
    const path = root();
    const commandLine = { hasSwitch: () => false, appendSwitch: vi.fn() };
    configureLinuxSecretBackend(commandLine, path, {
      platform: "linux",
      services: () => services([], ["org.freedesktop.secrets"])
    });
    expect(commandLine.appendSwitch).toHaveBeenLastCalledWith(
      "password-store",
      "gnome-libsecret"
    );
    rememberLinuxSecretBackend(path, "gnome_libsecret");
    const probe = vi.fn(() => services(["org.kde.kwalletd6"]));
    configureLinuxSecretBackend(commandLine, path, {
      platform: "linux",
      services: probe
    });
    expect(probe).not.toHaveBeenCalled();
    expect(commandLine.appendSwitch).toHaveBeenLastCalledWith(
      "password-store",
      "gnome-libsecret"
    );
    expect(
      readFileSync(join(path, "config/linux-secret-backend.json"), "utf8")
    ).toBe('"gnome-libsecret"\n');
  });
  it("does not silently change providers when the saved preference is corrupt", () => {
    const path = root();
    rememberLinuxSecretBackend(path, "kwallet6");
    writeFileSync(join(path, "config/linux-secret-backend.json"), "invalid");
    const commandLine = { hasSwitch: () => false, appendSwitch: vi.fn() };
    expect(() =>
      configureLinuxSecretBackend(commandLine, path, { platform: "linux" })
    ).toThrow("preference");
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
