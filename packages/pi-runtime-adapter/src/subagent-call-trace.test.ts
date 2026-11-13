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
        call: { status: "running", requestedModel: "requested" }
      });
      expect(events[1]).toMatchObject({
        call: { status, responseModel: null, responseModelEvidence: "unknown" }
      });
      expect(JSON.stringify(events)).not.toContain("secret prompt");
      expect(JSON.stringify(events)).not.toContain("sdk-configured-name");
    }
  );
  it("captures each full ordered input after async preset transformation", async () => {
    const calls: unknown[] = [];
    const longText = "完整上下文".repeat(20000);
    const source: StreamFn = async (model, _context, options) => {
      await options?.onPayload?.({ messages: [], apiKey: "never-save" }, model);
      throw new Error("failed after request preparation");
    };
    const traced = traceSubagentStream(source, (activity) =>
      calls.push(structuredClone(activity.call))
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
