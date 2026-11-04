import { EXTERNAL_CONTROL_LAUNCH_FLAG } from "@deepwrite/contracts/external-control";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isPackagedBridge,
  launchApp,
  resolveAppLaunchCommand
} from "./bridge-launch";
import { resolveExternalControlPaths } from "./control-paths";
import { readCore, type CoreRequest } from "./core-client";
import { pageText } from "./document-page";
import { createLineReader, encodeLine } from "./line-framing";
import { callExternalControlTool } from "./tool-routes";
import { createTrashStore } from "./trash-store";
import { testAppState } from "./external-control.test-support";

const TEST_SCOPE = {
  trash: createTrashStore({ directory: () => "/nonexistent" }),
  client: { name: "test-client" }
};

describe("control paths", () => {
  it("keeps development and packaged builds apart", () => {
    const packaged = resolveExternalControlPaths({
      homeDirectory: "/home/writer",
      packaged: true,
      platform: "linux"
    });
    const development = resolveExternalControlPaths({
      homeDirectory: "/home/writer",
      packaged: false,
      platform: "linux"
    });
    expect(packaged).toEqual({
      directory: "/home/writer/.deepwrite/control",
      stateFile: "/home/writer/.deepwrite/control/control.json",
      endpoint: "/home/writer/.deepwrite/control/control.sock"
    });
    expect(development.endpoint).not.toBe(packaged.endpoint);
  });

  it("uses a per-user named pipe on Windows", () => {
    const first = resolveExternalControlPaths({
      homeDirectory: "C:\\Users\\写作者",
      packaged: true,
      platform: "win32"
    });
    const second = resolveExternalControlPaths({
      homeDirectory: "C:\\Users\\other",
      packaged: true,
      platform: "win32"
    });
    expect(first.endpoint).toMatch(
      /^\\\\\.\\pipe\\deepwrite-control-[a-f0-9]{16}$/u
    );
    expect(first.endpoint).not.toBe(second.endpoint);
    expect(first.stateFile).toBe(
      "C:\\Users\\写作者\\.deepwrite\\control\\control.json"
    );
  });
});

describe("line reader", () => {
  function reader(maxBytes = 1024) {
    const lines: string[] = [];
    const onOverflow = vi.fn();
    const instance = createLineReader({
      maxBytes: () => maxBytes,
      onLine: (line) => lines.push(line),
      onOverflow
    });
    return { instance, lines, onOverflow };
  }

  it("rebuilds a Chinese line cut across chunks", () => {
    const { instance, lines } = reader();
    const bytes = Buffer.from(encodeLine({ text: "第三章" }));
    instance.push(bytes.subarray(0, 12));
    instance.push(bytes.subarray(12));
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { text: "第三章" }
    ]);
  });

  it("splits several lines from one chunk", () => {
    const { instance, lines } = reader();
    instance.push(Buffer.from("a\nb\nc"));
    instance.push(Buffer.from("\n"));
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("stops reading after an oversized line", () => {
    const { instance, lines, onOverflow } = reader(4);
    instance.push(Buffer.from("12345"));
    instance.push(Buffer.from("\nsmall\n"));
    expect(onOverflow).toHaveBeenCalledOnce();
    expect(lines).toEqual([]);
  });

  it("counts bytes rather than characters", () => {
    const { instance, onOverflow } = reader(4);
    instance.push(Buffer.from("第三章\n"));
    expect(onOverflow).toHaveBeenCalledOnce();
  });
});

describe("app launch command", () => {
  const appDirectory = resolve("/repo/apps/desktop");
  const packagedUrl = pathToFileURL(
    "/Applications/DeepWrite.app/Contents/Resources/app.asar/out/main/extras/external-control/bridge-entry.js"
  ).href;
  const unpackagedUrl = pathToFileURL(
    resolve(appDirectory, "out/main/extras/external-control/bridge-entry.js")
  ).href;

  it("detects packaged and unpackaged bridges", () => {
    expect(isPackagedBridge(packagedUrl)).toBe(true);
    expect(isPackagedBridge(unpackagedUrl)).toBe(false);
  });

  it("reopens a packaged app without run-as-node", () => {
    const launch = resolveAppLaunchCommand({
      execPath: "/Applications/DeepWrite.app/Contents/MacOS/DeepWrite",
      moduleUrl: packagedUrl,
      env: { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin" }
    });
    expect(launch.args).toEqual([EXTERNAL_CONTROL_LAUNCH_FLAG]);
    expect(launch.env).toEqual({ PATH: "/usr/bin" });
  });

  it("passes the app directory to an unpackaged Electron", () => {
    const launch = resolveAppLaunchCommand({
      execPath: "/repo/electron",
      moduleUrl: unpackagedUrl,
      env: { DEEPWRITE_EXTERNAL_CONTROL_USER_DATA: "/tmp/data" }
    });
    expect(launch.args).toEqual([
      appDirectory,
      "--user-data-dir=/tmp/data",
      EXTERNAL_CONTROL_LAUNCH_FLAG
    ]);
  });

  it("ignores the test data override in a packaged app", () => {
    const launch = resolveAppLaunchCommand({
      execPath: "/DeepWrite",
      moduleUrl: packagedUrl,
      env: { DEEPWRITE_EXTERNAL_CONTROL_USER_DATA: "/tmp/data" }
    });
    expect(launch.args).toEqual([EXTERNAL_CONTROL_LAUNCH_FLAG]);
  });

  it("reports a binary that cannot be started", async () => {
    const launch = launchApp({
      command: "/nonexistent/deepwrite-test-binary",
      args: [],
      env: {}
    });
    await vi.waitFor(() => expect(launch.failure()).toBeDefined());
  });
});

describe("text pages", () => {
  it("returns the whole text when it fits", () => {
    expect(pageText("雾港")).toEqual({
      content: "雾港",
      offset: 0,
      totalCharacters: 2,
      nextOffset: null
    });
  });

  it("walks a long text to its end", () => {
    const first = pageText("abcde", 0, 2);
    expect(first).toMatchObject({ content: "ab", nextOffset: 2 });
    const second = pageText("abcde", first.nextOffset ?? 0, 2);
    expect(second).toMatchObject({ content: "cd", nextOffset: 4 });
    expect(pageText("abcde", 4, 2)).toMatchObject({
      content: "e",
      nextOffset: null
    });
  });

  it("never splits a surrogate pair", () => {
    expect(pageText("𠮷𠮷𠮷", 1, 1)).toMatchObject({
      content: "𠮷",
      totalCharacters: 3
    });
  });

  it("returns nothing past the end", () => {
    expect(pageText("ab", 9)).toEqual({
      content: "",
      offset: 9,
      totalCharacters: 2,
      nextOffset: null
    });
  });
});

describe("core failures", () => {
  const rejectingCore =
    (code: string, message: string): CoreRequest =>
    (command) =>
      Promise.resolve({
        status: "rejected",
        requestId: command.id,
        error: { code, message }
      });

  it("never relays Core's message, which can carry local paths", async () => {
    const error = await readCore(
      rejectingCore("catalog.failed", "/Users/someone/secret.md"),
      "catalog.index",
      {},
      { parse: (value) => value },
      "找不到"
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "external.not_found",
      message: "找不到"
    });
  });

  it("reports a stopped worker as not ready rather than not found", async () => {
    await expect(
      readCore(
        rejectingCore("utility.not_running", "stopped"),
        "catalog.index",
        {},
        { parse: (value) => value },
        "找不到"
      )
    ).rejects.toMatchObject({ code: "external.not_ready" });
  });
});

describe("tool routes", () => {
  it("reports status from Main's authoritative state", async () => {
    const result = await callExternalControlTool(
      testAppState({
        rendererReady: () => false,
        activeRunCount: () => 2
      }),
      "get_app_status",
      {},
      TEST_SCOPE
    );
    expect(result).toEqual({
      appVersion: "1.0.0",
      protocolVersion: 1,
      platform: "darwin",
      rendererReady: false,
      activeRunCount: 2,
      permissionMode: "auto-approve",
      crossStageAutoApprove: true
    });
  });

  it("reads teams only through the listed tool", async () => {
    const agentTeams = vi.fn(() => Promise.reject(new Error("not expected")));
    await callExternalControlTool(
      testAppState({ agentTeams }),
      "get_app_status",
      {},
      TEST_SCOPE
    );
    expect(agentTeams).not.toHaveBeenCalled();
  });

  it("rejects tools outside the allowlist", async () => {
    await expect(
      callExternalControlTool(
        testAppState(),
        "catalog.saveDocument",
        {},
        TEST_SCOPE
      )
    ).rejects.toMatchObject({ code: "external.invalid_input" });
  });

  it("rejects unexpected arguments", async () => {
    await expect(
      callExternalControlTool(
        testAppState(),
        "get_app_status",
        { x: 1 },
        TEST_SCOPE
      )
    ).rejects.toMatchObject({ code: "external.invalid_input" });
  });

  it("names the field that failed validation", async () => {
    await expect(
      callExternalControlTool(
        testAppState(),
        "read_document",
        { workId: "a" },
        TEST_SCOPE
      )
    ).rejects.toMatchObject({
      code: "external.invalid_input",
      message: expect.stringContaining("documentId") as string
    });
  });
});
