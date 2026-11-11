import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
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
});
