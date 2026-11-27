import { DEFAULT_CREATIVE_PLOT_STAGES } from "@deepwrite/contracts";
import type { ExternalWindowRequest } from "@deepwrite/contracts/external-control";
import { describe, expect, it, vi } from "vitest";
import { testAppState } from "./external-control.test-support";
import { callExternalControlTool } from "./tool-routes";
import { createTrashStore } from "./trash-store";
import { createWindowRequests } from "./window-requests";

const RUN = {
  runId: "run-1",
  status: "running",
  reply: "",
  changes: []
};

function call(
  tool: string,
  args: Record<string, unknown>,
  overrides: Parameters<typeof testAppState>[0] = {}
) {
  return callExternalControlTool(testAppState(overrides), tool, args, {
    trash: createTrashStore({ directory: () => "/nonexistent" }),
    client: { name: "test-client" }
  });
}

describe("run tools", () => {
  it("needs exactly one target", async () => {
    await expect(call("run_agent", { message: "写" })).rejects.toMatchObject({
      code: "external.invalid_input"
    });
    await expect(
      call("open_in_app", { workId: "a", libraryId: "b" })
    ).rejects.toMatchObject({ code: "external.invalid_input" });
  });

  it("will not start a second run", async () => {
    await expect(
      call(
        "run_agent",
        { workId: "longbook_1", message: "写" },
        { activeRunCount: () => 1 }
      )
    ).rejects.toMatchObject({ code: "external.busy" });
  });

  it("waits for the window", async () => {
    await expect(
      call(
        "run_agent",
        { workId: "longbook_1", message: "写" },
        { rendererReady: () => false }
      )
    ).rejects.toMatchObject({ code: "external.not_ready" });
  });

  it("recovers the window through ensureWindow before running", async () => {
    let ready = false;
    const ensureWindow = vi.fn(async () => {
      ready = true;
      return true;
    });
    const windowRequest = vi.fn(async () => null);
    const snapshot = {
      schemaVersion: 1,
      revision: 0,
      creativePlotStages: DEFAULT_CREATIVE_PLOT_STAGES,
      books: [],
      materials: [
        {
          id: "lib-1",
          title: "资料库",
          materialType: "short",
          materialKind: "other",
          parentGenre: "",
          subGenre: "",
          overview: "",
          overviewContentBytes: 0,
          overviewContentStamp: "fs-v1:0",
          entries: [],
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z"
        }
      ],
      materialGroups: [],
      skills: [],
      skillGroups: [],
      updatedAt: "2026-11-01T00:00:00.000Z"
    };
    const core = (command: { id: string }) =>
      Promise.resolve({
        status: "accepted" as const,
        requestId: command.id,
        payload: snapshot
      });
    await expect(
      call(
        "open_in_app",
        { libraryId: "lib-1" },
        { rendererReady: () => ready, ensureWindow, windowRequest, core }
      )
    ).resolves.toEqual({ id: "lib-1" });
    expect(ensureWindow).toHaveBeenCalledOnce();
    expect(windowRequest).toHaveBeenCalledOnce();

    ready = false;
    const runWindowRequest = vi.fn(async () => RUN);
    await expect(
      call(
        "run_agent",
        { libraryId: "lib-1", message: "整理资料" },
        {
          rendererReady: () => ready,
          ensureWindow,
          windowRequest: runWindowRequest,
          core
        }
      )
    ).resolves.toEqual(RUN);
    expect(ensureWindow).toHaveBeenCalledTimes(2);
    expect(runWindowRequest).toHaveBeenCalledOnce();
  });

  it("routes restart_app and protects active runs unless force is true", async () => {
    const requestRestart = vi.fn(({ force }: { force: boolean }) => ({
      restarted: false,
      restarting: true,
      forced: force,
      previousPid: 1234
    }));
    await expect(
      call("restart_app", {}, { activeRunCount: () => 1, requestRestart })
    ).rejects.toMatchObject({ code: "external.busy" });
    expect(requestRestart).not.toHaveBeenCalled();

    await expect(
      call(
        "restart_app",
        { force: true },
        { activeRunCount: () => 1, requestRestart }
      )
    ).resolves.toMatchObject({
      restarted: false,
      restarting: true,
      forced: true,
      previousPid: 1234
    });
    expect(requestRestart).toHaveBeenCalledWith({ force: true });

    await expect(call("restart_app", {})).rejects.toMatchObject({
      code: "external.not_ready"
    });
  });

  it("passes run calls to the window and checks what comes back", async () => {
    const windowRequest = vi.fn(async (_request: ExternalWindowRequest) => RUN);
    await expect(
      call("get_agent_run", { runId: "run-1" }, { windowRequest })
    ).resolves.toEqual(RUN);
    await call(
      "answer_agent_question",
      { runId: "run-1", answers: [{ id: "q1", text: "林舟" }] },
      { windowRequest }
    );
    await call("stop_agent_run", { runId: "run-1" }, { windowRequest });
    expect(windowRequest.mock.calls.map(([request]) => request.action)).toEqual(
      ["run_status", "answer_run", "stop_run"]
    );
    await expect(
      call(
        "get_agent_run",
        { runId: "run-1" },
        {
          windowRequest: () => Promise.resolve({ ...RUN, secret: "leak" })
        }
      )
    ).rejects.toThrow();
  });
});

describe("window requests", () => {
  const OPEN: ExternalWindowRequest = { action: "run_status", runId: "run-1" };

  it("matches a reply to its request", async () => {
    const sent: string[] = [];
    const requests = createWindowRequests({ send: (id) => sent.push(id) });
    const pending = requests.request(OPEN);
    requests.resolve({
      requestId: sent[0] ?? "",
      ok: true,
      result: { done: true }
    });
    await expect(pending).resolves.toEqual({ done: true });
  });

  it("carries a window failure's code", async () => {
    const sent: string[] = [];
    const requests = createWindowRequests({ send: (id) => sent.push(id) });
    const pending = requests.request(OPEN);
    requests.resolve({
      requestId: sent[0] ?? "",
      ok: false,
      code: "external.busy",
      message: "忙"
    });
    await expect(pending).rejects.toMatchObject({ code: "external.busy" });
  });

  it("gives up on a window that never answers and ignores the late reply", async () => {
    const sent: string[] = [];
    const requests = createWindowRequests({
      send: (id) => sent.push(id),
      timeoutMs: 5
    });
    await expect(requests.request(OPEN)).rejects.toMatchObject({
      code: "external.not_ready"
    });
    expect(() =>
      requests.resolve({ requestId: sent[0] ?? "", ok: true, result: null })
    ).not.toThrow();
  });

  it("fails all pending requests immediately when failAll is called", async () => {
    const sent: string[] = [];
    const requests = createWindowRequests({ send: (id) => sent.push(id) });
    const first = requests.request(OPEN);
    const second = requests.request(OPEN);
    requests.failAll("external.not_ready", "窗口已关闭");
    await expect(first).rejects.toMatchObject({
      code: "external.not_ready",
      message: "窗口已关闭"
    });
    await expect(second).rejects.toMatchObject({
      code: "external.not_ready",
      message: "窗口已关闭"
    });
    expect(() =>
      requests.resolve({ requestId: sent[0] ?? "", ok: true, result: null })
    ).not.toThrow();
  });
});

describe("long editor guard", () => {
  it("does not overwrite a long editor holding unsaved text", async () => {
    const command = vi.fn();
    await expect(
      call(
        "write_document",
        {
          workId: "longbook_1",
          documentId: "file_1",
          content: "外部",
          baseRevision: "2026-11-01T00:00:00.000Z"
        },
        { command, windowRequest: () => Promise.resolve({ dirty: true }) }
      )
    ).rejects.toMatchObject({ code: "external.busy" });
    expect(command).not.toHaveBeenCalled();
  });
});
