import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { linuxPackageBuilderArgs } from "./run-test-package.mjs";

const require = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const builderRequire = createRequire(require.resolve("electron-builder"));
const libRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { createUpdateInfoTasks } = libRequire("./publish/updateInfoBuilder");
const { Platform } = libRequire("./core");
const { Arch } = libRequire("builder-util");
const yaml = libRequire("js-yaml");

describe("Linux package update manifests", () => {
  it.each([
    ["x64", "latest-linux.yml"],
    ["arm64", "latest-linux-arm64.yml"]
  ])("generates the release manifest for %s", async (arch, expected) => {
    const config = yaml.load(
      await readFile(
        new URL("../apps/desktop/electron-builder.yml", import.meta.url),
        "utf8"
      )
    );
    const args = linuxPackageBuilderArgs(arch, "42.5.0");
    const publish = { ...config.publish, url: "https://example.test/releases" };
    for (const argument of args) {
      const override = /^--config\.publish\.channel=(.+)$/u.exec(argument);
      if (override) publish.channel = override[1];
    }
    const tasks = await createUpdateInfoTasks(
      {
        packager: {
          platform: Platform.LINUX,
          platformSpecificBuildOptions: config.linux,
          config,
          appInfo: { version: "1.2.3" },
          info: { metadata: {} },
          getResource: async () => null
        },
        arch: Arch[arch],
        file: `DeepWrite-1.2.3-linux-${arch}-test.AppImage`,
        target: { outDir: "release" },
        updateInfo: { sha512: "invalid-test-digest", size: 1 }
      },
      [publish]
    );
    expect(tasks.map(({ file }) => basename(file))).toEqual([expected]);
  });
});
