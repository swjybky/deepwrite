import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("Zhuque detection webview security", () => {
  it("enables only a constrained, sandboxed Tencent webview", () => {
    expect(source).toContain("webviewTag: true");
    expect(source).toContain('"will-attach-webview"');
    expect(source).toContain("webPreferences.nodeIntegration = false");
    expect(source).toContain("webPreferences.contextIsolation = true");
    expect(source).toContain("webPreferences.sandbox = true");
    expect(source).toContain(
      "new URL(rawUrl).origin === ZHUQUE_DETECTION_ORIGIN"
    );
  });
});
