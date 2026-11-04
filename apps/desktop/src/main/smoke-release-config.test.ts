import { beforeEach, describe, expect, it, vi } from "vitest";
import { smokeReleaseConfig } from "./smoke-release-config";

const state = vi.hoisted(() => ({ publicData: true, backup: true }));
vi.mock("./deepwrite-public-data-config", () => ({
  get DEEPWRITE_PUBLIC_DATA_API_CONFIGURED() {
    return state.publicData;
  }
}));
vi.mock("../extras/cloud-backup/config", () => ({
  loadCloudBackupApiConfig: () =>
    state.backup
      ? {
          baseUrl: "https://backup.example.test"
        }
      : null
}));
const environment = {
  DEEPWRITE_REQUIRE_RELEASE_CONFIG: "1",
  DEEPWRITE_APP_MODE: "runtime"
};
beforeEach(() => {
  state.publicData = true;
  state.backup = true;
});
describe("bundled release configuration smoke", () => {
  it("keeps ordinary development smoke independent of private configuration", () => {
    state.publicData = false;
    state.backup = false;
    expect(smokeReleaseConfig({})).toBeUndefined();
  });
  it("returns only success flags, without credentials or endpoint values", () => {
    expect(smokeReleaseConfig(environment)).toEqual({
      status: "ok",
      publicData: true,
      cloudBackup: true
    });
  });
  it("rejects a package without public service configuration", () => {
    state.publicData = false;
    expect(() => smokeReleaseConfig(environment)).toThrow(
      "bundled public service configuration is missing"
    );
  });
  it("rejects a package without backup API configuration", () => {
    state.backup = false;
    expect(() => smokeReleaseConfig(environment)).toThrow(
      "bundled backup API configuration is missing"
    );
  });
  it("rejects evaluation capture in a release package", () => {
    expect(() =>
      smokeReleaseConfig({ ...environment, DEEPWRITE_APP_MODE: "evaluation" })
    ).toThrow("runtime application mode");
  });
});
