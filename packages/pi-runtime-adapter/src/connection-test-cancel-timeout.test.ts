import http from "node:http";
import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  ModelConnectionTestCancelledError,
  ModelConnectionTestTimeoutError,
  PiAgentRuntimeAdapter
} from "./index";

interface MockRequestRecord {
  url: string;
  closed: boolean;
  abortedBeforeEnd: boolean;
  endedNormally: boolean;
}

function createHttpMockServer(
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    record: MockRequestRecord,
    index: number
  ) => void
) {
  const requests: MockRequestRecord[] = [];
  const openSockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    const socket = req.socket;
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));

    const record: MockRequestRecord = {
      url: req.url ?? "",
      closed: false,
      abortedBeforeEnd: false,
      endedNormally: false
    };
    const index = requests.length;
    requests.push(record);

    const markClosed = () => {
      if (!record.closed) {
        record.closed = true;
        if (!record.endedNormally) {
          record.abortedBeforeEnd = true;
        }
      }
    };
    res.once("close", markClosed);
    socket.once("close", markClosed);

    req.on("data", () => {});
    req.on("end", () => {
      handler(req, res, record, index);
    });
  });

  return {
    requests,
    openSocketCount: () => openSockets.size,
    start: () =>
      new Promise<number>((resolveStart) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            throw new Error("Expected numeric port");
          }
          resolveStart(addr.port);
        });
      }),
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const socket of openSockets) socket.destroy();
        server.close(() => resolveClose());
      })
  };
}

function geminiOfficialConfig(port: number): AgentProviderRuntimeConfig {
  return {
    id: "gemini-official-test",
    label: "Gemini Official Test",
    provider: "google",
    modelId: "gemini-2.5-pro",
    api: "google-generative-ai",
    baseUrl: `http://127.0.0.1:${port}/v1beta`,
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.1, 0.7, 1],
    apiKey: "invalid-test-key"
  };
}

function openAiCompatConfig(port: number): AgentProviderRuntimeConfig {
  return {
    id: "openai-compat-test",
    label: "OpenAI Compat Test",
    provider: "custom",
    modelId: "gemini-2.5-pro",
    api: "openai-completions",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.1, 0.7, 1],
    apiKey: "invalid-test-key"
  };
}

function jevConfig(port: number): AgentProviderRuntimeConfig {
  return {
    id: "jev-test",
    label: "JEV Test",
    provider: "custom",
    modelId: "jev-1",
    modelKind: "jev",
    api: "openai-completions",
    baseUrl: `http://127.0.0.1:${port}`,
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["medium"],
    temperatureOptions: [0.1, 0.7, 1],
    apiKey: "invalid-test-key"
  };
}

async function waitForCondition(
  check: () => boolean,
  timeoutMs = 3_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("Timed out waiting for condition");
}

const serversToClose: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (serversToClose.length > 0) {
    await serversToClose.pop()!();
  }
});

describe("PiAgentRuntimeAdapter connection test cancel & timeout", () => {
  it("aborts and closes the HTTP socket when Google Official times out", async () => {
    const mock = createHttpMockServer(() => {
      // Hold headers open intentionally.
    });
    serversToClose.push(mock.close);
    const port = await mock.start();
    const adapter = new PiAgentRuntimeAdapter();

    await expect(
      adapter.testConnection(geminiOfficialConfig(port), { timeoutMs: 150 })
    ).rejects.toBeInstanceOf(ModelConnectionTestTimeoutError);

    await waitForCondition(() => mock.requests[0]?.closed === true);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.abortedBeforeEnd).toBe(true);
    expect(mock.openSocketCount()).toBe(0);
  });

  it("cancels Google Official during hang_headers and hang_first_token, closes sockets, and allows immediate retest", async () => {
    let mode: "hang_headers" | "hang_first_token" | "fast_ok" = "hang_headers";
    const mock = createHttpMockServer((_req, res, record) => {
      if (mode === "hang_headers") {
        return;
      }
      if (mode === "hang_first_token") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive"
        });
        res.flushHeaders();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8"
      });
      res.write(
        `data: ${JSON.stringify({
          responseId: "resp_ok",
          candidates: [
            {
              content: { role: "model", parts: [{ text: "OK" }] },
              finishReason: "STOP"
            }
          ]
        })}\n\n`
      );
      record.endedNormally = true;
      res.end();
    });
    serversToClose.push(mock.close);
    const port = await mock.start();
    const adapter = new PiAgentRuntimeAdapter();
    const config = geminiOfficialConfig(port);

    // 1. Cancel while headers hang
    const controller1 = new AbortController();
    const pending1 = adapter.testConnection(config, {
      signal: controller1.signal,
      timeoutMs: 15_000
    });
    await waitForCondition(() => mock.requests.length === 1);
    controller1.abort();
    await expect(pending1).rejects.toBeInstanceOf(
      ModelConnectionTestCancelledError
    );
    await waitForCondition(() => mock.requests[0]?.closed === true);
    expect(mock.requests[0]?.abortedBeforeEnd).toBe(true);

    // 2. Cancel while first token hangs
    mode = "hang_first_token";
    const controller2 = new AbortController();
    const pending2 = adapter.testConnection(config, {
      signal: controller2.signal,
      timeoutMs: 15_000
    });
    await waitForCondition(() => mock.requests.length === 2);
    await new Promise((r) => setTimeout(r, 40));
    controller2.abort();
    await expect(pending2).rejects.toBeInstanceOf(
      ModelConnectionTestCancelledError
    );
    await waitForCondition(() => mock.requests[1]?.closed === true);
    expect(mock.requests[1]?.abortedBeforeEnd).toBe(true);
    expect(mock.openSocketCount()).toBe(0);

    // 3. Immediate retest succeeds
    mode = "fast_ok";
    const result = await adapter.testConnection(config, { timeoutMs: 5_000 });
    expect(result.ok).toBe(true);
    expect(mock.requests).toHaveLength(3);
  });

  it("supports cancel, timeout, developer-role fallback, and route errors on openai-completions", async () => {
    let mode: "hang" | "fallback" | "not_found" = "hang";
    const mock = createHttpMockServer((_req, res, record, index) => {
      if (mode === "hang") return;
      if (mode === "not_found") {
        res.writeHead(404, { "Content-Type": "application/json" });
        record.endedNormally = true;
        res.end(
          JSON.stringify({
            error: { message: "404 model route does not exist" }
          })
        );
        return;
      }
      if (index === 2) {
        res.writeHead(400, { "Content-Type": "application/json" });
        record.endedNormally = true;
        res.end(
          JSON.stringify({
            error: {
              message:
                "messages[0].role: Input should be 'system', 'user', 'assistant' or 'tool'"
            }
          })
        );
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8"
      });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl_1",
          object: "chat.completion.chunk",
          created: 0,
          model: "gemini-2.5-pro",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "OK" },
              finish_reason: "stop"
            }
          ]
        })}\n\ndata: [DONE]\n\n`
      );
      record.endedNormally = true;
      res.end();
    });
    serversToClose.push(mock.close);
    const port = await mock.start();
    const adapter = new PiAgentRuntimeAdapter();
    const config = openAiCompatConfig(port);

    // Timeout
    await expect(
      adapter.testConnection(config, { timeoutMs: 150 })
    ).rejects.toBeInstanceOf(ModelConnectionTestTimeoutError);
    await waitForCondition(() => mock.requests[0]?.closed === true);

    // Cancel
    const controller = new AbortController();
    const cancelling = adapter.testConnection(config, {
      signal: controller.signal,
      timeoutMs: 10_000
    });
    await waitForCondition(() => mock.requests.length === 2);
    controller.abort();
    await expect(cancelling).rejects.toBeInstanceOf(
      ModelConnectionTestCancelledError
    );
    await waitForCondition(() => mock.requests[1]?.closed === true);

    // Developer-role fallback still works (for non-Gemini custom model that tries developer role first)
    mode = "fallback";
    const fallbackResult = await adapter.testConnection(
      { ...config, modelId: "qwen3-writer" },
      { timeoutMs: 5_000 }
    );
    expect(fallbackResult.ok).toBe(true);
    expect(fallbackResult.supportsDeveloperRole).toBe(false);
    expect(mock.requests).toHaveLength(4);

    // Route error (404) preserves error message and is not misclassified as timeout/cancel
    mode = "not_found";
    await expect(
      adapter.testConnection(config, { timeoutMs: 5_000 })
    ).rejects.toThrow(/404 model route does not exist/u);
  });

  it("handles pre-aborted signals and cancel/timeout races cleanly", async () => {
    const mock = createHttpMockServer(() => {});
    serversToClose.push(mock.close);
    const port = await mock.start();
    const adapter = new PiAgentRuntimeAdapter();
    const config = geminiOfficialConfig(port);

    // Pre-aborted signal fires zero requests
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      adapter.testConnection(config, { signal: preAborted.signal })
    ).rejects.toBeInstanceOf(ModelConnectionTestCancelledError);
    expect(mock.requests).toHaveLength(0);

    // Timeout wins before late abort
    const raceController = new AbortController();
    await expect(
      adapter.testConnection(config, {
        signal: raceController.signal,
        timeoutMs: 100
      })
    ).rejects.toBeInstanceOf(ModelConnectionTestTimeoutError);
    raceController.abort();
    await waitForCondition(() => mock.requests[0]?.closed === true);
  });

  it("cancels and times out JEV connection tests", async () => {
    const mock = createHttpMockServer(() => {});
    serversToClose.push(mock.close);
    const port = await mock.start();
    const adapter = new PiAgentRuntimeAdapter();
    const config = jevConfig(port);

    await expect(
      adapter.testConnection(config, { timeoutMs: 120 })
    ).rejects.toBeInstanceOf(ModelConnectionTestTimeoutError);
    await waitForCondition(() => mock.requests[0]?.closed === true);

    const controller = new AbortController();
    const pending = adapter.testConnection(config, {
      signal: controller.signal,
      timeoutMs: 5_000
    });
    await waitForCondition(() => mock.requests.length === 2);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(
      ModelConnectionTestCancelledError
    );
    await waitForCondition(() => mock.requests[1]?.closed === true);
  });
});
