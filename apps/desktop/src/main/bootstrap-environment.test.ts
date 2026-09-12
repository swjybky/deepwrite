import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBootstrapEnvironment } from "./bootstrap-environment";

const home = resolve("/virtual-home");
const userData = join(home, "app-data");
const application = {
  getPath(name: "userData" | "home") {
    return name === "userData" ? userData : home;
  },
  getAppPath() {
    return join(home, "Application", "Contents", "Resources", "app.asar");
  }
};

describe("Main bootstrap environment", () => {
  it("generates one nonce for repeated initialization in the same Main process and replaces inherited values", () => {
    const environment: NodeJS.ProcessEnv = {
      DEEPWRITE_MAIN_INSTANCE_ID: "previous-main"
    };
    const createInstanceId = vi.fn(() => "current-main");
    const configure = createBootstrapEnvironment({
      environment,
      createInstanceId,
      cwd: () => home,
      exists: () => false
    });
    expect(configure(application, "evaluation")).toBe(userData);
    expect(environment).toMatchObject({
      DEEPWRITE_USER_DATA_PATH: userData,
      DEEPWRITE_MAIN_INSTANCE_ID: "current-main",
      DEEPWRITE_APP_MODE: "evaluation"
    });
    configure(application, undefined);
    expect(environment.DEEPWRITE_MAIN_INSTANCE_ID).toBe("current-main");
    expect(environment.DEEPWRITE_APP_MODE).toBe("runtime");
    expect(createInstanceId).toHaveBeenCalledOnce();
  });

  it("keeps legacy discovery precedence and deduplication when configuring the run owner", () => {
    const current = join(
      home,
      "Library",
      "Application Support",
      "DeepWrite",
      ".data"
    );
    const environment: NodeJS.ProcessEnv = {
      DEEPWRITE_LEGACY_PROJECT_DATA_ROOT: current
    };
    const configure = createBootstrapEnvironment({
      environment,
      cwd: () => home,
      exists: (path) => path === current,
      createInstanceId: () => "fixture-main"
    });
    configure(application, "runtime");
    expect(environment.DEEPWRITE_LEGACY_DATA_ROOT).toBe(current);
    expect(JSON.parse(environment.DEEPWRITE_LEGACY_DATA_ROOTS!)).toEqual([
      current
    ]);
    expect(environment.DEEPWRITE_MAIN_INSTANCE_ID).toBe("fixture-main");
  });

  it("clears stale legacy roots without disturbing other environment settings", () => {
    const environment: NodeJS.ProcessEnv = {
      DEEPWRITE_LEGACY_DATA_ROOT: "/old-fixture",
      DEEPWRITE_LEGACY_DATA_ROOTS: "[]",
      TASK_FIXTURE_FLAG: "preserved"
    };
    createBootstrapEnvironment({
      environment,
      cwd: () => home,
      exists: () => false
    })(application, "unsupported");
    expect(environment.DEEPWRITE_LEGACY_DATA_ROOT).toBeUndefined();
    expect(environment.DEEPWRITE_LEGACY_DATA_ROOTS).toBeUndefined();
    expect(environment.TASK_FIXTURE_FLAG).toBe("preserved");
    expect(environment.DEEPWRITE_APP_MODE).toBe("runtime");
  });
});
