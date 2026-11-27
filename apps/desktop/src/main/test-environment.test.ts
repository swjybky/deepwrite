import { describe, expect, it, vi } from "vitest";
import {
  TEST_ENVIRONMENT_ENV,
  forwardRendererConsole,
  isTestEnvironment,
  readOnlyOnlineFetch,
  type RendererConsoleMessage
} from "./test-environment";

describe("test environment", () => {
  it("is honored only by development builds", () => {
    const environment = { [TEST_ENVIRONMENT_ENV]: "1" };
    expect(isTestEnvironment(false, environment)).toBe(true);
    expect(isTestEnvironment(true, environment)).toBe(false);
    expect(isTestEnvironment(false, {})).toBe(false);
  });

  it("lets reads through and answers writes locally", async () => {
    const fetcher = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response("ok")
    );
    const guarded = readOnlyOnlineFetch(fetcher);

    await expect(
      (await guarded("https://api.example.test/market/v1/list")).text()
    ).resolves.toBe("ok");
    const blocked = await guarded(
      "https://api.example.test/market/v1/auth/session",
      { method: "delete" }
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toEqual({
      error: {
        code: "test_environment.read_only",
        message: "测试环境不向线上服务写入（DELETE /market/v1/auth/session）。"
      }
    });
  });

  it("accepts extra read methods such as WebDAV listing", async () => {
    const fetcher = vi.fn(
      async (_input: string, _init?: RequestInit) =>
        new Response(null, { status: 207 })
    );
    const guarded = readOnlyOnlineFetch(
      fetcher,
      new Set(["GET", "HEAD", "PROPFIND"])
    );

    expect(
      (await guarded("https://dav.example.test/", { method: "PROPFIND" }))
        .status
    ).toBe(207);
    expect(
      (await guarded("https://dav.example.test/a.md", { method: "PUT" })).status
    ).toBe(403);
  });

  it("copies renderer console messages into the dev log", () => {
    let listener: ((event: RendererConsoleMessage) => void) | undefined;
    const lines: string[] = [];
    forwardRendererConsole(
      { on: (_event, next) => (listener = next) },
      (line) => lines.push(line)
    );
    listener?.({
      level: "error",
      message: "Uncaught TypeError: x is undefined",
      lineNumber: 12,
      sourceId: "http://localhost:5173/src/App.vue"
    });
    listener?.({
      level: "info",
      message: "[vite] connected.",
      lineNumber: 0,
      sourceId: ""
    });
    expect(lines).toEqual([
      "[renderer:error] Uncaught TypeError: x is undefined (http://localhost:5173/src/App.vue:12)\n",
      "[renderer:info] [vite] connected.\n"
    ]);
  });
});
