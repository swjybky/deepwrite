import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SystemEventEnvelope } from "@deepwrite/contracts";
import {
  appendSubagentCallJournal,
  createSubagentCallJournal
} from "./subagent-call-journal";

type ActivityEvent = Extract<
  SystemEventEnvelope,
  { type: "subagent.activity" }
>;

function makeCallEvent(
  status: "running" | "completed" | "error",
  sequence: number,
  extra: Record<string, unknown> = {}
): ActivityEvent {
  return {
    payload: {
      sessionId: "session",
      runId: "run",
      parentToolCallId: "parent",
      subagentRunId: `child-${sequence}`,
      subagentId: "preset",
      secret: "never-save",
      activity: {
        type: "model_call",
        call: {
          requestId: `request-${sequence}`,
          sequence,
          requestedProvider: "test",
          requestedModel: "model",
          responseModel: null,
          responseModelEvidence: "unknown",
          startedAt: "2026-11-11T00:00:00Z",
          status,
          content: "never-save",
          ...extra
        }
      }
    }
  } as unknown as ActivityEvent;
}

describe("subagent diagnostic journal", () => {
  it("persists start and end asynchronously, strips unknown content, and rotates segments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "call-journal-"));
    try {
      const event = makeCallEvent("running", 1, {
        snapshot: {
          systemPrompt: "full system",
          messages: [{ role: "user", content: "全文".repeat(20000) }],
          tools: [],
          providerInput: {
            messages: [{ role: "system", content: "second instruction" }]
          }
        }
      });
      await appendSubagentCallJournal(dir, event);
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
      if (event.payload.activity.type === "model_call") {
        event.payload.activity.call.status = "completed";
      }
      await appendSubagentCallJournal(dir, event);
      expect(
        readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).call.status)
      ).toEqual(["running", "completed"]);
      for (let i = 0; i < 4; i++) {
        await appendSubagentCallJournal(dir, event, 1);
      }
      expect(readdirSync(dir).sort()).toEqual([
        "subagent-model-calls.jsonl",
        "subagent-model-calls.jsonl.1",
        "subagent-model-calls.jsonl.2"
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evicts oldest running entries before dropping terminal records when queue is bounded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "call-journal-bounded-"));
    try {
      const journal = createSubagentCallJournal({ maxQueueEntries: 3 });
      journal.enqueue(dir, makeCallEvent("running", 1));
      journal.enqueue(dir, makeCallEvent("completed", 2));
      journal.enqueue(dir, makeCallEvent("running", 3));
      journal.enqueue(dir, makeCallEvent("completed", 4));
      await journal.close();

      expect(journal.enqueue(dir, makeCallEvent("running", 5))).toBe(false);
      const path = join(dir, "subagent-model-calls.jsonl");
      const lines = readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as { call: { sequence: number; status: string } }
        );
      expect(lines.some((entry) => entry.call.sequence === 2)).toBe(true);
      expect(lines.some((entry) => entry.call.sequence === 4)).toBe(true);
      expect(journal.stats().droppedRunningEntries).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
