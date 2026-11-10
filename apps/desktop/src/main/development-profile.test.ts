import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireStorageInstanceLock } from "./storage-bootstrap";
import {
  applyDevelopmentProfile,
  DEVELOPMENT_USER_DATA_ENV
} from "./development-profile";

const name = "@deepwrite/desktop";
let appData = "";
let installedProfile = "";

beforeAll(async () => {
  appData = await mkdtemp(join(tmpdir(), "deepwrite-development-profile-"));
  installedProfile = join(appData, name);
});
afterAll(() =>
  rm(appData, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50
  })
);

function application(options: { isPackaged: boolean; userData?: string }) {
  const paths = { appData, userData: options.userData ?? installedProfile };
  const locks: string[] = [];
  return {
    isPackaged: options.isPackaged,
    locks,
    paths,
    getName: () => name,
    getPath: (key: "userData" | "appData") => paths[key],
    setPath: (key: "userData" | "sessionData", path: string) => {
      if (key === "userData") paths.userData = path;
    },
    requestSingleInstanceLock: () => {
      locks.push(paths.userData);
      return true;
    }
  };
}

describe("development profile", () => {
  it("keeps the packaged app on the Electron default profile", () => {
    const app = application({ isPackaged: true });
    applyDevelopmentProfile(app, {});
    expect(app.paths.userData).toBe(installedProfile);
  });

  it("moves development to a sibling profile with its own instance lock", () => {
    const installed = application({ isPackaged: true });
    const development = application({ isPackaged: false });
    applyDevelopmentProfile(installed, {});
    expect(applyDevelopmentProfile(development, {})).toBe(installedProfile);
    acquireStorageInstanceLock(installed);
    acquireStorageInstanceLock(development);

    expect(development.paths.userData).toBe(`${installedProfile}-dev`);
    expect(development.locks[0]).not.toBe(installed.locks[0]);
    expect(development.locks[0]).toBe(
      join(appData, "@deepwrite", ".desktop-dev.storage-bootstrap")
    );
  });

  it("accepts an explicit development profile", () => {
    const app = application({ isPackaged: false });
    const copy = join(appData, "profiles", "copy");
    expect(
      applyDevelopmentProfile(app, { [DEVELOPMENT_USER_DATA_ENV]: ` ${copy} ` })
    ).toBeUndefined();
    expect(app.paths.userData).toBe(copy);
  });

  it("leaves a profile chosen by --user-data-dir or a smoke fixture", () => {
    const chosen = join(appData, "smoke-profile");
    const app = application({ isPackaged: false, userData: chosen });
    applyDevelopmentProfile(app, {
      [DEVELOPMENT_USER_DATA_ENV]: join(appData, "ignored")
    });
    expect(app.paths.userData).toBe(chosen);
  });
});
