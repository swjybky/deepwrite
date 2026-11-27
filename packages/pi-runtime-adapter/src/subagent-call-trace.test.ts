import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  createAssistantMessageEventStream
} from "@earendil-works/pi-ai";
import { ModelCallTraceSchema } from "@deepwrite/contracts";
import { traceSubagentStream } from "./subagent-call-trace";

describe("subagent call metadata", () => {
  it.each(["completed", "error", "aborted"] as const)(
    "records %s without content",
    async (status) => {
      const events: unknown[] = [];
      const source: StreamFn = (model) => {
        if (status === "error")
          throw new Error("secret prompt must not be logged");
        const stream = createAssistantMessageEventStream();
        const message = {
          role: "assistant" as const,
          content: [],
          api: model.api,
          provider: model.provider,
          model: "sdk-configured-name",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason:
            status === "aborted" ? ("aborted" as const) : ("stop" as const),
          timestamp: Date.now()
        };
        if (status === "aborted")
          stream.push({ type: "error", reason: "aborted", error: message });
        else stream.push({ type: "done", reason: "stop", message });
        return stream;
      };
      const traced = traceSubagentStream(source, (event) => events.push(event));
      const stream = await traced(
        {
          id: "requested",
          provider: "test",
          api: "openai-completions"
        } as Parameters<StreamFn>[0],
        { messages: [] } as unknown as Parameters<StreamFn>[1],
        {}
      );
      for await (const event of stream) void event;
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        call: {
          status: "running",
          requestedModel: "requested",
          inputSummary: { systemPromptChars: 0, messageCount: 0, toolCount: 0 }
        }
      });
      expect(events[1]).toMatchObject({
        call: {
          status,
          responseModel: null,
          responseModelEvidence: "unknown",
          stopReason:
            status === "completed"
              ? "stop"
              : status === "aborted"
                ? "aborted"
                : "error"
        }
      });
      expect(
        (events[1] as { call: { snapshot?: unknown } }).call.snapshot
      ).toBeUndefined();
      expect(JSON.stringify(events)).not.toContain("secret prompt");
      expect(JSON.stringify(events)).not.toContain("sdk-configured-name");
    }
  );

  it("omits snapshots by default and summarizes provider payload + usage without leaking secrets", async () => {
    const events: unknown[] = [];
    const bigText = "正文内容".repeat(5000);
    const source: StreamFn = async (model, _context, options) => {
      await options?.onPayload?.({ messages: [], apiKey: "never-save" }, model);
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: "upstream",
          usage: {
            input: 120,
            output: 45,
            cacheRead: 10,
            cacheWrite: 0,
            totalTokens: 175,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: "stop",
          timestamp: Date.now()
        }
      });
      return stream;
    };
    const traced = traceSubagentStream(source, (activity) =>
      events.push(structuredClone(activity.call))
    );
    const stream = await traced(
      {
        id: "requested",
        provider: "test",
        api: "openai-completions"
      } as Parameters<StreamFn>[0],
      {
        systemPrompt: "sys prompt",
        messages: [{ role: "user", content: bigText, timestamp: 0 }]
      } as unknown as Parameters<StreamFn>[1],
      {
        onPayload: async () => ({
          messages: [
            { role: "system", content: "preset" },
            { role: "user", content: bigText }
          ],
          tools: [{ name: "read" }],
          apiKey: "never-save"
        })
      }
    );
    for await (const event of stream) void event;

    expect(events).toHaveLength(2);
    const completed = ModelCallTraceSchema.parse(events[1]);
    expect(completed.snapshot).toBeUndefined();
    expect(completed.inputSummary).toEqual({
      systemPromptChars: 10,
      messageCount: 1,
      toolCount: 0,
      providerMessageCount: 2,
      hasProviderTools: true
    });
    expect(completed.stopReason).toBe("stop");
    expect(completed.usage).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      totalTokens: 175
    });
    expect(JSON.stringify(events)).not.toContain("never-save");
    expect(JSON.stringify(events)).not.toContain("正文内容");
  });

  it("captures each full ordered input after async preset transformation in evaluation mode", async () => {
    const calls: unknown[] = [];
    const longText = "完整上下文".repeat(20000);
    const source: StreamFn = async (model, _context, options) => {
      await options?.onPayload?.({ messages: [], apiKey: "never-save" }, model);
      throw new Error("failed after request preparation");
    };
    const traced = traceSubagentStream(
      source,
      (activity) => calls.push(structuredClone(activity.call)),
      { captureSnapshot: true }
    );
    const model = {
      id: "test",
      provider: "test",
      api: "openai-completions"
    } as Parameters<StreamFn>[0];
    for (const step of [1, 2]) {
      const stream = await traced(
        model,
        normalizeContext({
          systemPrompt: `step ${step}`,
          messages: [{ role: "user", content: longText, timestamp: 0 }]
        }),
        {
          onPayload: async () => ({
            messages: [
              { role: "system", content: `preset ${step}` },
              { role: "user", content: longText },
              { role: "system", content: "late instruction" }
            ],
            apiKey: "never-save"
          })
        }
      );
      for await (const event of stream) void event;
    }
    const final = calls
      .map((call) => ModelCallTraceSchema.parse(call))
      .filter((call) => call.status === "error");
    expect(final).toHaveLength(2);
    expect(final.map((call) => call.sequence)).toEqual([1, 2]);
    expect(final[0]?.snapshot?.messages[1]).toMatchObject({
      content: longText
    });
    expect(final[1]?.snapshot?.providerInput?.messages).toEqual([
      { role: "system", content: "preset 2" },
      { role: "user", content: longText },
      { role: "system", content: "late instruction" }
    ]);
    expect(JSON.stringify(calls)).not.toContain("never-save");
  });
});
