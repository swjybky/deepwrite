import { describe, expect, it } from "vitest";
import { planDocumentVersionCapture } from "./capture-rules";

const origin = { sessionId: "session_one", runId: "run_one", summary: "改写" };
const latest = {
  kind: "conversation" as const,
  content: "甲",
  origin
};

describe("document version capture rules", () => {
  it("does not record empty or unchanged text", () => {
    expect(
      planDocumentVersionCapture({ before: "", after: "", origin })
    ).toEqual([]);
    expect(
      planDocumentVersionCapture({ latest, before: "甲", after: "甲", origin })
    ).toEqual([]);
    expect(
      planDocumentVersionCapture({ latest, before: "甲", after: "", origin })
    ).toEqual([]);
  });

  it("preserves unrecorded text before clearing a document", () => {
    expect(
      planDocumentVersionCapture({ before: "手写", after: "", origin })
    ).toEqual([
      { action: "append", kind: "pre_conversation", content: "手写" }
    ]);
  });

  it("records the first nonempty write", () => {
    expect(
      planDocumentVersionCapture({ before: "", after: "甲", origin })
    ).toEqual([
      { action: "append", kind: "conversation", content: "甲", origin }
    ]);
  });

  it("coalesces consecutive writes from the same run", () => {
    expect(
      planDocumentVersionCapture({
        latest,
        before: "甲",
        after: "甲乙",
        origin
      })
    ).toEqual([
      { action: "update", kind: "conversation", content: "甲乙", origin }
    ]);
  });

  it("appends a conversation version for a different run", () => {
    const next = { ...origin, runId: "run_two" };
    expect(
      planDocumentVersionCapture({
        latest,
        before: "甲",
        after: "丙",
        origin: next
      })
    ).toEqual([
      { action: "append", kind: "conversation", content: "丙", origin: next }
    ]);
  });

  it("preserves manual edits made between writes from the same run", () => {
    expect(
      planDocumentVersionCapture({
        latest,
        before: "甲乙丁",
        after: "丙",
        origin
      })
    ).toEqual([
      { action: "append", kind: "pre_conversation", content: "甲乙丁" },
      { action: "append", kind: "conversation", content: "丙", origin }
    ]);
  });

  it("preserves the initial manual draft", () => {
    expect(
      planDocumentVersionCapture({ before: "手写", after: "改写", origin })
    ).toEqual([
      { action: "append", kind: "pre_conversation", content: "手写" },
      { action: "append", kind: "conversation", content: "改写", origin }
    ]);
  });

  it("preserves current edits and always appends a restore receipt", () => {
    expect(
      planDocumentVersionCapture({
        latest,
        before: "X",
        after: "甲",
        restoredFromSeq: 1
      })
    ).toEqual([
      {
        action: "append",
        kind: "pre_conversation",
        reason: "restore",
        content: "X"
      },
      { action: "append", kind: "restore", restoredFromSeq: 1, content: "甲" }
    ]);
    expect(
      planDocumentVersionCapture({
        latest,
        before: "甲",
        after: "甲",
        restoredFromSeq: 1
      })
    ).toEqual([
      { action: "append", kind: "restore", content: "甲", restoredFromSeq: 1 }
    ]);
  });
});
