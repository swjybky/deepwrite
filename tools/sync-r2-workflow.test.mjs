import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { resolvePublishedTag } from "./download-release-assets.mjs";

const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const yaml = createRequire(desktopRequire.resolve("electron-builder"))(
  "js-yaml"
);
const workflow = yaml.load(
  await readFile(
    new URL("../.github/workflows/sync-r2.yml", import.meta.url),
    "utf8"
  )
);
const script = workflow.jobs.sync.steps.find(
  (step) => step.name === "Resolve the published version"
).run;
const body = script
  .split("\n")
  .filter((line) => !line.trim().startsWith("import "))
  .slice(1, -2)
  .join("\n");
const execute = compileFunction(`return (async () => { ${body} })();`, [
  "readFile",
  "appendFile",
  "resolvePublishedTag",
  "process"
]);
const manifest = {
  schemaVersion: 1,
  version: "9.8.7",
  title: "Fixture",
  publishedAt: "2026-01-01T00:00:00Z",
  releaseNotes: [],
  releasePage: "https://example.test/release",
  feedUrl: "https://example.test/feed"
};

describe("R2 workflow activation boundary", () => {
  it("runs after main's published manifest changes and can be retried manually", () => {
    expect(workflow.on.push).toEqual({
      branches: ["main"],
      paths: ["update.json"]
    });
    expect(workflow.on.workflow_dispatch.inputs.tag.required).toBe(false);
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("writes an actual newline-delimited GitHub environment value", async () => {
    const appendFile = vi.fn();
    await execute(
      async () => JSON.stringify(manifest),
      appendFile,
      resolvePublishedTag,
      { env: { GITHUB_ENV: "fixture-env" } }
    );
    expect(appendFile).toHaveBeenCalledExactlyOnceWith(
      "fixture-env",
      "RELEASE_TAG=v9.8.7\n"
    );
  });

  it("rejects a different manual tag before changing the workflow environment", async () => {
    const appendFile = vi.fn();
    await expect(
      execute(
        async () => JSON.stringify(manifest),
        appendFile,
        resolvePublishedTag,
        { env: { GITHUB_ENV: "fixture-env", REQUESTED_TAG: "v9.8.6" } }
      )
    ).rejects.toThrow("版本一致");
    expect(appendFile).not.toHaveBeenCalled();
  });
});
