import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  releaseEnvironmentKeys,
  restoreReleaseEnvironment,
  validateReleaseEnvironment
} from "./release-environment.mjs";

const fixture = {
  MAIN_VITE_DEEPWRITE_APP_MODE: "runtime",
  MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL:
    "https://gateway.example.test/prefix",
  MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY: "invalid-test-public-key"
};
const serialize = (values) =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      })
    )
  );
});

describe("private release environment", () => {
  it("rejects legacy OSS secrets without echoing their values", () => {
    expect(() =>
      validateReleaseEnvironment(
        serialize({
          ...fixture,
          MAIN_VITE_OSS_ACCESS_KEY_SECRET: "invalid-legacy-secret"
        })
      )
    ).toThrow("不得包含 MAIN_VITE_OSS_");
  });
  it("registers individual values for GitHub log masking with escaped workflow commands", () => {
    const source = serialize({
      ...fixture,
      MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY: "invalid-test-secret%value"
    });
    const output = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL("./release-environment.mjs", import.meta.url)),
        "check-secret"
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "true",
          DEEPWRITE_RELEASE_ENV: source
        }
      }
    );
    expect(output).toContain("::add-mask::invalid-test-secret%25value");
    expect(output).toContain("RELEASE_ENVIRONMENT_OK keys=3");
    expect(output).not.toContain("::add-mask::runtime");
  });
  it.each([undefined, "", " \r\n"])("rejects an absent secret", (source) => {
    expect(() => validateReleaseEnvironment(source)).toThrow(
      "DEEPWRITE_RELEASE_ENV"
    );
  });
  it.each(releaseEnvironmentKeys)(
    "rejects a missing or blank %s without echoing values",
    (key) => {
      for (const value of [undefined, " "]) {
        const values = { ...fixture };
        if (value === undefined) delete values[key];
        else values[key] = value;
        let message;
        try {
          validateReleaseEnvironment(serialize(values));
        } catch (cause) {
          message = cause.message;
        }
        expect(message).toContain(key);
        expect(message).not.toContain(
          fixture.MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY
        );
        expect(message).not.toContain(
          fixture.MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL
        );
      }
    }
  );
  it("accepts quoted CRLF configuration and preserves the original file", async () => {
    const source = `# Private release fixture\r\n${serialize(fixture).replaceAll("\n", "\r\n")}\r\n`;
    const root = await mkdtemp(join(tmpdir(), "deepwrite-release-env-"));
    roots.push(root);
    expect(validateReleaseEnvironment(source)).toEqual(fixture);
    await restoreReleaseEnvironment(source, root);
    expect(await readFile(join(root, ".env"), "utf8")).toBe(source);
  });
  it("does not overwrite an existing local environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-release-env-"));
    roots.push(root);
    await writeFile(join(root, ".env"), "existing local configuration");
    await expect(
      restoreReleaseEnvironment(serialize(fixture), root)
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(root, ".env"), "utf8")).toBe(
      "existing local configuration"
    );
  });
  it("rejects evaluation capture in a public release", () => {
    expect(() =>
      validateReleaseEnvironment(
        serialize({ ...fixture, MAIN_VITE_DEEPWRITE_APP_MODE: "evaluation" })
      )
    ).toThrow("必须为 runtime");
  });
  it.each([
    "not a URL",
    "file:///invalid-test-path",
    "https://gateway.example.test/?private=invalid-test-value",
    "https://invalid-test-user:invalid-test-password@gateway.example.test"
  ])("rejects invalid public service URLs without printing them", (value) => {
    expect(() =>
      validateReleaseEnvironment(
        serialize({
          ...fixture,
          MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL: value
        })
      )
    ).toThrow("API_BASE_URL 格式无效");
  });
});
