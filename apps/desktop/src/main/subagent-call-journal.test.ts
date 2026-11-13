import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SystemEventEnvelope } from "@deepwrite/contracts";
import { appendSubagentCallJournal } from "./subagent-call-journal";

describe("subagent diagnostic journal", () => {
  it("persists start and end independently of renderer saves and strips unknown content", () => {
    const dir = mkdtempSync(join(tmpdir(), "call-journal-"));
    try {
      const event = {
        payload: {
          sessionId: "session",
          runId: "run",
          parentToolCallId: "parent",
          subagentRunId: "child",
          subagentId: "preset",
          secret: "never-save",
          activity: {
            type: "model_call",
            call: {
              snapshot: {
                systemPrompt: "full system",
                messages: [{ role: "user", content: "全文".repeat(20000) }],
                tools: [],
                providerInput: {
                  messages: [{ role: "system", content: "second instruction" }]
                }
              },
              requestId: "request",
              sequence: 1,
              requestedProvider: "test",
              requestedModel: "model",
              responseModel: null,
              responseModelEvidence: "unknown",
              startedAt: "2026-11-11T00:00:00Z",
              status: "running",
              content: "never-save"
            }
          }
        }
      } as unknown as Extract<
        SystemEventEnvelope,
        { type: "subagent.activity" }
      >;
      appendSubagentCallJournal(dir, event);
      const path = join(dir, "subagent-model-calls.jsonl");
      const saved = readFileSync(path, "utf8");
      expect(JSON.parse(saved).call.snapshot.messages[0].content).toBe(
        "全文".repeat(20000)
      );
      expect(
        JSON.parse(saved).call.snapshot.providerInput.messages[0].content
      ).toBe("second instruction");
      expect(JSON.parse(saved).call.status).toBe("running");
      expect(saved).not.toContain("never-save");
      if (event.payload.activity.type === "model_call")
        event.payload.activity.call.status = "completed";
      appendSubagentCallJournal(dir, event);
      expect(
        readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).call.status)
      ).toEqual(["running", "completed"]);
      for (let i = 0; i < 4; i++) appendSubagentCallJournal(dir, event, 1);
      expect(readdirSync(dir).sort()).toEqual([
        "subagent-model-calls.jsonl",
        "subagent-model-calls.jsonl.1",
        "subagent-model-calls.jsonl.2"
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
