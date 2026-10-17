import { describe, expect, it } from "vitest";
import { validateReleaseTag } from "./validate-release-tag.mjs";
import { pnpmInvocation } from "./pnpm-command.mjs";

describe("tag release version guard", () => {
  it("accepts exactly the two package versions", () => {
    expect(validateReleaseTag("v1.2.3", "1.2.3", "1.2.3")).toBe("1.2.3");
  });
  it.each([
    "main",
    "v1.2",
    "v01.2.3",
    "v1.2.3-beta.1",
    "v1.2.3; echo invalid",
    undefined
  ])("rejects invalid tags", (tag) => {
    expect(() => validateReleaseTag(tag, "1.2.3", "1.2.3")).toThrow(
      "Release tags"
    );
  });
  it("rejects mismatched root or desktop versions", () => {
    expect(() => validateReleaseTag("v1.2.3", "1.2.2", "1.2.3")).toThrow(
      "both"
    );
    expect(() => validateReleaseTag("v1.2.3", "1.2.3", "1.2.2")).toThrow(
      "both"
    );
  });
});

describe("pnpm process invocation", () => {
  it("runs the Windows CLI without .cmd or shell argument parsing", () => {
    const options = {
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "C:\\runner\\pnpm\\pnpm.cjs"
    };
    expect(
      pnpmInvocation(
        [
          "exec",
          "electron-builder",
          "--config.electronDist=C:\\test packages\\runtime.zip"
        ],
        options
      )
    ).toEqual({
      command: options.execPath,
      args: [
        options.npmExecPath,
        "exec",
        "electron-builder",
        "--config.electronDist=C:\\test packages\\runtime.zip"
      ]
    });
  });
  it("requires the pnpm CLI on Windows and supports direct Unix invocation", () => {
    expect(() =>
      pnpmInvocation(["verify"], { platform: "win32", npmExecPath: "" })
    ).toThrow("through pnpm");
    expect(
      pnpmInvocation(["verify"], { platform: "linux", npmExecPath: "" })
    ).toEqual({ command: "pnpm", args: ["verify"] });
  });
});
