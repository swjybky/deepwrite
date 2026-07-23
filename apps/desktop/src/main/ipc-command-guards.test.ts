import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("IPC command requestId handling", () => {
  it("main preserves raw command id on early rejects and surfaces validation issues", () => {
    const source = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("function extractCommandRequestId");
    expect(source).toContain("function summarizeCommandValidationIssues");
    expect(source).toContain("const requestId = extractCommandRequestId(rawCommand)");
    expect(source).toContain("mainWindow.isDestroyed()");
    expect(source).not.toContain("requestId: \"unknown\"");
    expect(source).toContain('return "unknown"');
    expect(source).toContain("Command envelope failed schema validation.");
  });

  it("preload surfaces rejected IPC errors instead of masking them as requestId mismatches", () => {
    const source = readFileSync(
      new URL("../preload/index.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("const expectedRequestId = command.id");
    expect(source).toContain('if (result.status === "rejected")');
    expect(source).toContain(
      "`IPC result requestId does not match command id. expected=${expectedRequestId} actual=${result.requestId}`"
    );
    expect(source).not.toContain(
      'throw new Error("IPC result requestId does not match command id.");'
    );
  });
});
