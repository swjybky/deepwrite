import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliGroups } from "./cli-groups.mjs";
import {
  checkFeatureMap,
  checkInvocation,
  codePathTokens,
  commandNameTokens
} from "./lib/feature-map.mjs";

let scratch;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "deepwrite-features-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("feature map check", () => {
  it("extracts code paths and IPC names, not data files", () => {
    const markdown =
      "见 `components/CreateBookDialog.vue`、`stale-base.ts`，数据在 `profile/config/models.json`，命令 `catalog.createShortBook` 和 `catalog.ts`。";
    expect(codePathTokens(markdown)).toEqual([
      "components/CreateBookDialog.vue",
      "stale-base.ts",
      "catalog.ts"
    ]);
    expect(commandNameTokens(markdown)).toEqual(["catalog.createShortBook"]);
  });

  it("names the wrong group, command or option", () => {
    expect(checkInvocation(cliGroups, "ui click --text 保存")).toBeUndefined();
    expect(checkInvocation(cliGroups, "ui clik --text 保存")).toBe(
      "命令组 ui 里没有「clik」"
    );
    expect(checkInvocation(cliGroups, "ui click --bogus 1")).toBe(
      "ui click 没有参数 --bogus"
    );
    expect(checkInvocation(cliGroups, "nope status")).toBe(
      "没有命令组「nope」"
    );
  });

  it("reports every kind of stale reference in a page", async () => {
    const directory = join(scratch, "features");
    await mkdir(directory);
    await writeFile(join(scratch, "present.md"), "ok");
    await writeFile(
      join(directory, "sample.md"),
      [
        "代码 `components/CreateBookDialog.vue` 与 `MissingDialog.vue`。",
        "命令 `catalog.createShortBook`、`catalog.notACommand`；工具 `manage_work`、`not_a_tool`。",
        "[有](../present.md) [无](../missing.md)",
        "```bash",
        "pnpm -s ctl data list",
        "pnpm -s ctl ui clik --text 保存   # 拼错",
        "```"
      ].join("\n")
    );
    const [result] = await checkFeatureMap({ directory, groups: cliGroups });
    expect(result.problems).toEqual([
      { kind: "path", value: "MissingDialog.vue" },
      { kind: "link", value: "../missing.md" },
      {
        kind: "cli",
        value: "ui clik --text 保存",
        issue: "命令组 ui 里没有「clik」"
      },
      { kind: "command", value: "catalog.notACommand" },
      { kind: "tool", value: "not_a_tool" }
    ]);
  });
});
