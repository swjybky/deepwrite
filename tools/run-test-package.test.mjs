import { describe, expect, it } from "vitest";
import { parseTarget } from "./run-test-package.mjs";

function selected(args) {
  return Object.entries(parseTarget(args))
    .filter(([, enabled]) => enabled)
    .map(([target]) => target);
}

describe("test package target selection", () => {
  it("selects both Mac architectures and Windows in one desktop batch", () => {
    expect(selected(["desktop"])).toEqual([
      "buildMacArm64",
      "buildMacX64",
      "buildWinX64"
    ]);
  });

  it("retains Linux in the all-platform batch", () => {
    expect(selected(["all"])).toEqual([
      "buildLinuxX64",
      "buildMacArm64",
      "buildMacX64",
      "buildWinX64"
    ]);
  });

  it("selects Mac ARM and Windows x64 without building Mac Intel", () => {
    expect(selected(["desktop", "arm64"])).toEqual([
      "buildMacArm64",
      "buildWinX64"
    ]);
  });

  it.each([
    [
      ["mac", "all"],
      ["buildMacArm64", "buildMacX64"]
    ],
    [["mac", "arm64"], ["buildMacArm64"]],
    [["mac", "x64"], ["buildMacX64"]],
    [["win", "x64"], ["buildWinX64"]],
    [["win", "arm64"], ["buildWinArm64"]],
    [["linux", "x64"], ["buildLinuxX64"]]
  ])("preserves the requested targets for %j", (args, targets) => {
    expect(selected(args)).toEqual(targets);
  });

  it.each([
    { args: [] },
    { args: ["desktop", "x64"] },
    { args: ["win", "ia32"] },
    { args: ["win", "arm64", "extra"] },
    { args: ["mac"] },
    { args: ["other"] }
  ])("rejects unsupported target combinations $args", ({ args }) => {
    expect(() => parseTarget(args)).toThrow("Usage:");
  });
});
