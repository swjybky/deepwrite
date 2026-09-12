import { describe, expect, it } from "vitest";
import { createEnvelope } from "./envelope";
import { CommandEnvelopeSchema } from "./system";
import {
  ConversationHistoryBatchSchema,
  ConversationHistoryDetailQuerySchema,
  ConversationHistoryMessagesQuerySchema
} from "./conversation-history";

const batch = {
  key: "conversation-history:example",
  sessionId: "session-example",
  batchId: "batch-example",
  generation: 0,
  sequence: 1,
  expectedRevision: 0,
  operations: [
    {
      type: "putMessage",
      messageId: "message-example",
      position: 0,
      value: {
        id: "message-example",
        role: "user",
        content: "虚构测试消息",
        futureField: { enabled: true }
      }
    }
  ]
};

describe("incremental conversation history contracts", () => {
  it("validates commands through the shared envelope and preserves future JSON fields", () => {
    const payload = ConversationHistoryBatchSchema.parse(batch);
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope("rendererState.history.commit", payload, {
          id: "command-example",
          correlationId: "command-example"
        })
      )
    ).toMatchObject({ payload: batch });
  });

  it("requires a durable receipt identity and ordered revision coordinates", () => {
    for (const patch of [
      { batchId: "" },
      { sequence: 0 },
      { generation: -1 },
      { expectedRevision: 1.5 },
      { key: "conversation-preferences:example" }
    ]) {
      expect(
        ConversationHistoryBatchSchema.safeParse({ ...batch, ...patch }).success
      ).toBe(false);
    }
  });

  it("rejects dangerous property traversal and unbounded requests", () => {
    const changes = [
      { op: "set", path: ["__proto__", "enabled"], value: true }
    ];
    expect(
      ConversationHistoryBatchSchema.safeParse({
        ...batch,
        operations: [
          { type: "patchMessage", messageId: "message-example", changes }
        ]
      }).success
    ).toBe(false);
    const query = { key: batch.key, sessionId: batch.sessionId };
    expect(
      ConversationHistoryMessagesQuerySchema.safeParse({ ...query, limit: 201 })
        .success
    ).toBe(false);
    expect(
      ConversationHistoryMessagesQuerySchema.safeParse({
        ...query,
        maxBytes: 2 * 1024 * 1024
      }).success
    ).toBe(false);
    expect(
      ConversationHistoryDetailQuerySchema.safeParse({
        ...query,
        messageId: "message-example",
        path: [],
        expectedRevision: 1
      }).success
    ).toBe(true);
  });
});
