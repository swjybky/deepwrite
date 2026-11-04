import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  packagedSmokeEnvironment,
  validateSmokeSummary
} from "../apps/desktop/scripts/package-smoke-runner.mjs";

beforeEach(() => vi.stubEnv("DEEPWRITE_REQUIRE_RELEASE_CONFIG", "0"));
afterEach(() => vi.unstubAllEnvs());

function summary() {
  return {
    health: { status: "ok", workers: ["core", "agent", "tool"] },
    agent: { status: "ok", runtime: { mode: "local-faux" }, completed: true },
    bookTemplates: { status: "ok", created: 4 },
    conversation: {
      status: "ok",
      staged: true,
      reopened: false,
      chunkPages: 3,
      metadataChunkPages: 4,
      unknownRetained: true,
      proposalRetained: true
    }
  };
}

describe("packaged persistence smoke acceptance", () => {
  it("strips host-provided build values only for release acceptance", () => {
    const source = {
      DEEPWRITE_REQUIRE_RELEASE_CONFIG: "1",
      MAIN_VITE_OSS_ACCESS_KEY_SECRET: "invalid-test-host-secret",
      MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY: "invalid-test-host-key",
      PATH: "invalid-test-path"
    };
    expect(packagedSmokeEnvironment(source)).toEqual({
      DEEPWRITE_REQUIRE_RELEASE_CONFIG: "1",
      PATH: "invalid-test-path",
      DEEPWRITE_SMOKE: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
    });
    expect(source.MAIN_VITE_OSS_ACCESS_KEY_SECRET).toBe(
      "invalid-test-host-secret"
    );
    expect(
      packagedSmokeEnvironment({
        ...source,
        DEEPWRITE_REQUIRE_RELEASE_CONFIG: "0"
      }).MAIN_VITE_OSS_ACCESS_KEY_SECRET
    ).toBe("invalid-test-host-secret");
  });
  it("requires bundled public service and backup API configuration for release builds", () => {
    expect(() => validateSmokeSummary(summary(), false, true)).toThrow(
      "bundled release configuration"
    );
    vi.stubEnv("DEEPWRITE_REQUIRE_RELEASE_CONFIG", "1");
    expect(() => validateSmokeSummary(summary(), false)).toThrow(
      "bundled release configuration"
    );
    const result = {
      ...summary(),
      releaseConfig: { status: "ok", publicData: true, cloudBackup: true }
    };
    expect(() => validateSmokeSummary(result, false, true)).not.toThrow();
    result.releaseConfig.cloudBackup = false;
    expect(() => validateSmokeSummary(result, false, true)).toThrow(
      "bundled release configuration"
    );
  });
  it("requires the database path to have been exercised instead of accepting utility health alone", () => {
    const { conversation: _conversation, ...oldSummary } = summary();
    expect(() => validateSmokeSummary(oldSummary, false)).toThrow(
      "invalid smoke summary"
    );
    expect(() => validateSmokeSummary(summary(), false)).not.toThrow();
  });
  it("requires template creation to cross the real application IPC routes", () => {
    const { bookTemplates: _templates, ...missing } = summary();
    expect(() => validateSmokeSummary(missing, false)).toThrow(
      "invalid smoke summary"
    );
    const incomplete = summary();
    incomplete.bookTemplates.created = 2;
    expect(() => validateSmokeSummary(incomplete, false)).toThrow(
      "invalid smoke summary"
    );
  });
  it("requires the second application launch to read the previously committed profile", () => {
    const result = summary();
    expect(() => validateSmokeSummary(result, true)).toThrow(
      "invalid smoke summary"
    );
    result.conversation.reopened = true;
    expect(() => validateSmokeSummary(result, true)).not.toThrow();
    delete result.conversation.metadataChunkPages;
    expect(() => validateSmokeSummary(result, true)).toThrow(
      "invalid smoke summary"
    );
  });
});
