import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: spawn }));
import { configureLinuxSecretBackend } from "./linux-secret-backend";
const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
  spawn.mockReset();
});
function configure() {
  const path = mkdtempSync(join(tmpdir(), "deepwrite-dbus-probe-"));
  roots.push(path);
  const commandLine = { hasSwitch: () => false, appendSwitch: vi.fn() };
  configureLinuxSecretBackend(commandLine, path, {
    platform: "linux",
    environment: {}
  });
  return commandLine;
}
describe("bounded session bus probing", () => {
  it("discovers an activatable Secret Service through dbus-send", () => {
    spawn.mockReturnValueOnce({
      status: 0,
      stdout: 'array [ string "org.freedesktop.DBus" ]'
    });
    spawn.mockReturnValueOnce({
      status: 0,
      stdout: 'array [ string "org.freedesktop.secrets" ]'
    });
    expect(configure().appendSwitch).toHaveBeenCalledWith(
      "password-store",
      "gnome-libsecret"
    );
    expect(spawn.mock.calls[1]?.[1]).toContain(
      "org.freedesktop.DBus.ListActivatableNames"
    );
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({
      timeout: 800,
      maxBuffer: 128 * 1024
    });
  });
  it("uses busctl if dbus-send is not installed", () => {
    spawn.mockImplementation((command: string) =>
      command === "dbus-send"
        ? { error: { code: "ENOENT" } }
        : { status: 0, stdout: 'as 1 "org.kde.kwalletd6"' }
    );
    expect(configure().appendSwitch).toHaveBeenCalledWith(
      "password-store",
      "kwallet6"
    );
  });
  it("leaves native selection alone on timeouts or missing bus utilities", () => {
    spawn.mockReturnValue({ error: { code: "ETIMEDOUT" } });
    expect(configure().appendSwitch).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(2);
    spawn.mockReturnValue({ error: { code: "ENOENT" } });
    expect(configure().appendSwitch).not.toHaveBeenCalled();
  });
});
